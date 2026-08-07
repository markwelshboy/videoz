import json
import shutil
import sqlite3
import subprocess
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile
from pydantic import BaseModel, Field

from .caption_providers import CaptionProviderRegistry
from .config import Settings
from .database import Database
from .media import import_media
from .models import (
    CaptionAsset,
    CaptionAssetPatch,
    CaptionFrame,
    CaptionFrameRequest,
    CaptionGenerationRequest,
    CaptionGenerationResult,
    CaptionJob,
    CaptionProjectSettings,
    CaptionProjectSettingsUpdate,
    CaptionProviderInfo,
    CaptionRecipe,
    CaptionRecipeCreate,
    CaptionRecipeUpdate,
    CaptionVersion,
    CaptionWorkspace,
    ExportBundleResult,
)
from .profiles import PROFILE_BY_ID


class CaptionDatasetBundleRequest(BaseModel):
    asset_keys: list[str] = Field(min_length=1)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_key(value: str) -> str:
    return "".join(character if character.isalnum() or character in "-_" else "_" for character in value)[:120]


class CaptionService:
    def __init__(self, database: Database, settings: Settings):
        self.database = database
        self.settings = settings
        self.providers = CaptionProviderRegistry(settings)
        self.initialize()

    def initialize(self) -> None:
        with self.database.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS caption_project_settings (
                    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
                    trigger_phrase TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS caption_standalones (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    original_name TEXT NOT NULL,
                    stored_name TEXT NOT NULL,
                    duration REAL NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    fps REAL NOT NULL,
                    frame_count INTEGER,
                    has_audio INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS caption_records (
                    asset_key TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    caption_body TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'uncaptioned',
                    selected INTEGER NOT NULL DEFAULT 1,
                    current_recipe_id TEXT,
                    frame_times_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS caption_recipes (
                    id TEXT PRIMARY KEY,
                    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    system_prompt TEXT NOT NULL DEFAULT '',
                    sample_mode TEXT NOT NULL DEFAULT 'fixed_count',
                    frame_count INTEGER NOT NULL DEFAULT 8,
                    sample_fps REAL NOT NULL DEFAULT 2,
                    visual_detail TEXT NOT NULL DEFAULT 'standard',
                    max_tokens INTEGER NOT NULL DEFAULT 160,
                    temperature REAL NOT NULL DEFAULT 0.4,
                    top_p REAL NOT NULL DEFAULT 0.8,
                    seed INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS caption_versions (
                    id TEXT PRIMARY KEY,
                    asset_key TEXT NOT NULL,
                    recipe_id TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    frame_times_json TEXT NOT NULL,
                    caption_body TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS caption_jobs (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    asset_key TEXT NOT NULL,
                    recipe_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress REAL NOT NULL DEFAULT 0,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_caption_standalones_project ON caption_standalones(project_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_caption_records_project ON caption_records(project_id, updated_at);
                CREATE INDEX IF NOT EXISTS idx_caption_recipes_project ON caption_recipes(project_id, updated_at);
                CREATE INDEX IF NOT EXISTS idx_caption_jobs_project ON caption_jobs(project_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_caption_versions_asset ON caption_versions(asset_key, created_at);
                """
            )
            existing = db.execute("SELECT id FROM caption_recipes WHERE project_id IS NULL LIMIT 1").fetchone()
            if existing is None:
                timestamp = _now()
                db.execute(
                    """
                    INSERT INTO caption_recipes(
                        id, project_id, name, provider_id, model, prompt, system_prompt,
                        sample_mode, frame_count, sample_fps, visual_detail, max_tokens,
                        temperature, top_p, seed, created_at, updated_at
                    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
                    """,
                    (
                        uuid.uuid4().hex,
                        "Character LoRA — concise",
                        "mock",
                        "videoz/mock-vlm",
                        "Describe the visible action, clothing, setting, composition, camera angle and lighting in concise natural language. Avoid guessing identity or permanent traits that are not visually necessary.",
                        "Return only the training caption, with no analysis or preamble.",
                        "fixed_count",
                        8,
                        2.0,
                        "standard",
                        160,
                        0.4,
                        0.8,
                        timestamp,
                        timestamp,
                    ),
                )

    def list_providers(self) -> list[CaptionProviderInfo]:
        return self.providers.list()

    def get_settings(self, project_id: str) -> CaptionProjectSettings:
        self.database.get_project(project_id)
        with self.database.connect() as db:
            row = db.execute(
                "SELECT trigger_phrase FROM caption_project_settings WHERE project_id = ?",
                (project_id,),
            ).fetchone()
        return CaptionProjectSettings(project_id=project_id, trigger_phrase=row["trigger_phrase"] if row else "")

    def update_settings(self, project_id: str, request: CaptionProjectSettingsUpdate) -> CaptionProjectSettings:
        self.database.get_project(project_id)
        with self.database.connect() as db:
            db.execute(
                """
                INSERT INTO caption_project_settings(project_id, trigger_phrase) VALUES (?, ?)
                ON CONFLICT(project_id) DO UPDATE SET trigger_phrase = excluded.trigger_phrase
                """,
                (project_id, request.trigger_phrase.strip()),
            )
        self._refresh_project_caption_files(project_id)
        return self.get_settings(project_id)

    def list_recipes(self, project_id: str) -> list[CaptionRecipe]:
        self.database.get_project(project_id)
        with self.database.connect() as db:
            rows = db.execute(
                "SELECT * FROM caption_recipes WHERE project_id IS NULL OR project_id = ? ORDER BY project_id IS NOT NULL DESC, updated_at DESC",
                (project_id,),
            ).fetchall()
        return [self._recipe(row) for row in rows]

    def create_recipe(self, request: CaptionRecipeCreate) -> CaptionRecipe:
        if request.project_id:
            self.database.get_project(request.project_id)
        recipe_id = uuid.uuid4().hex
        timestamp = _now()
        with self.database.connect() as db:
            db.execute(
                """
                INSERT INTO caption_recipes(
                    id, project_id, name, provider_id, model, prompt, system_prompt,
                    sample_mode, frame_count, sample_fps, visual_detail, max_tokens,
                    temperature, top_p, seed, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    recipe_id,
                    request.project_id,
                    request.name.strip(),
                    request.provider_id,
                    request.model.strip(),
                    request.prompt.strip(),
                    request.system_prompt.strip(),
                    request.sample_mode,
                    request.frame_count,
                    request.sample_fps,
                    request.visual_detail,
                    request.max_tokens,
                    request.temperature,
                    request.top_p,
                    request.seed,
                    timestamp,
                    timestamp,
                ),
            )
        return self.get_recipe(recipe_id)

    def get_recipe(self, recipe_id: str) -> CaptionRecipe:
        with self.database.connect() as db:
            row = db.execute("SELECT * FROM caption_recipes WHERE id = ?", (recipe_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Caption recipe was not found")
        return self._recipe(row)

    def update_recipe(self, recipe_id: str, request: CaptionRecipeUpdate) -> CaptionRecipe:
        self.get_recipe(recipe_id)
        if request.project_id:
            self.database.get_project(request.project_id)
        with self.database.connect() as db:
            db.execute(
                """
                UPDATE caption_recipes SET
                    project_id = ?, name = ?, provider_id = ?, model = ?, prompt = ?, system_prompt = ?,
                    sample_mode = ?, frame_count = ?, sample_fps = ?, visual_detail = ?, max_tokens = ?,
                    temperature = ?, top_p = ?, seed = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    request.project_id,
                    request.name.strip(),
                    request.provider_id,
                    request.model.strip(),
                    request.prompt.strip(),
                    request.system_prompt.strip(),
                    request.sample_mode,
                    request.frame_count,
                    request.sample_fps,
                    request.visual_detail,
                    request.max_tokens,
                    request.temperature,
                    request.top_p,
                    request.seed,
                    _now(),
                    recipe_id,
                ),
            )
        return self.get_recipe(recipe_id)

    def import_standalone(self, project_id: str, file: UploadFile) -> CaptionAsset:
        self.database.get_project(project_id)
        asset = import_media(file, self.settings)
        standalone_id = uuid.uuid4().hex
        with self.database.connect() as db:
            db.execute(
                """
                INSERT INTO caption_standalones(
                    id, project_id, original_name, stored_name, duration, width, height, fps,
                    frame_count, has_audio, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    standalone_id,
                    project_id,
                    asset.original_name,
                    asset.stored_name,
                    asset.duration,
                    asset.width,
                    asset.height,
                    asset.fps,
                    asset.frame_count,
                    1 if asset.has_audio else 0,
                    _now(),
                ),
            )
        return self.get_asset(f"standalone:{standalone_id}")

    def get_workspace(self, project_id: str) -> CaptionWorkspace:
        project = self.database.get_project(project_id)
        return CaptionWorkspace(
            project=project,
            settings=self.get_settings(project_id),
            assets=self.list_assets(project_id),
            recipes=self.list_recipes(project_id),
        )

    def list_assets(self, project_id: str) -> list[CaptionAsset]:
        workspace = self.database.get_workspace(project_id)
        assets: list[CaptionAsset] = []
        for selection in workspace.selections:
            if not selection.export_filename or not selection.export_filename.lower().endswith(".mp4"):
                continue
            profile = PROFILE_BY_ID.get(selection.profile_id)
            if profile is None or selection.size_index >= len(profile.sizes):
                continue
            size = profile.sizes[selection.size_index]
            key = f"selection:{selection.id}"
            record = self._record(project_id, key)
            assets.append(
                CaptionAsset(
                    key=key,
                    project_id=project_id,
                    kind="selection",
                    selection_id=selection.id,
                    sequence=selection.sequence,
                    display_name=f"{workspace.project.dataset_prefix}_{selection.sequence:06d}.mp4",
                    url=f"/files/datasets/{workspace.project.dataset_prefix}/{selection.export_filename}",
                    duration=selection.frame_count / profile.fps,
                    width=size.width,
                    height=size.height,
                    fps=profile.fps,
                    **record,
                )
            )

        with self.database.connect() as db:
            rows = db.execute(
                "SELECT * FROM caption_standalones WHERE project_id = ? ORDER BY created_at, rowid",
                (project_id,),
            ).fetchall()
        for row in rows:
            key = f"standalone:{row['id']}"
            record = self._record(project_id, key)
            assets.append(
                CaptionAsset(
                    key=key,
                    project_id=project_id,
                    kind="standalone",
                    display_name=row["original_name"],
                    url=f"/files/sources/{row['stored_name']}",
                    duration=row["duration"],
                    width=row["width"],
                    height=row["height"],
                    fps=row["fps"],
                    **record,
                )
            )
        return assets

    def get_asset(self, asset_key: str) -> CaptionAsset:
        if ":" not in asset_key:
            raise HTTPException(status_code=404, detail="Caption asset was not found")
        kind, identifier = asset_key.split(":", 1)
        if kind == "selection":
            project, _, selection = self.database.selection_context(identifier)
            if not selection.export_filename:
                raise HTTPException(status_code=404, detail="Selection has not been exported")
            for asset in self.list_assets(project.id):
                if asset.key == asset_key:
                    return asset
        elif kind == "standalone":
            with self.database.connect() as db:
                row = db.execute("SELECT project_id FROM caption_standalones WHERE id = ?", (identifier,)).fetchone()
            if row:
                for asset in self.list_assets(row["project_id"]):
                    if asset.key == asset_key:
                        return asset
        raise HTTPException(status_code=404, detail="Caption asset was not found")

    def patch_asset(self, asset_key: str, request: CaptionAssetPatch) -> CaptionAsset:
        asset = self.get_asset(asset_key)
        current = self._record(asset.project_id, asset_key)
        caption_body = current["caption_body"] if request.caption_body is None else request.caption_body.strip()
        selected = current["selected"] if request.selected is None else request.selected
        frame_times = current["frame_times"] if request.frame_times is None else request.frame_times
        if request.status is not None:
            status = request.status
        elif request.caption_body is not None:
            status = "edited" if caption_body else "uncaptioned"
        else:
            status = current["status"]
        self._save_record(
            asset.project_id,
            asset_key,
            caption_body=caption_body,
            status=status,
            selected=selected,
            current_recipe_id=current["current_recipe_id"],
            frame_times=frame_times,
        )
        self._write_caption_sidecar(asset_key)
        return self.get_asset(asset_key)

    def preview_frames(self, asset_key: str, request: CaptionFrameRequest) -> list[CaptionFrame]:
        asset = self.get_asset(asset_key)
        source_path = self._asset_path(asset)
        if request.times is not None:
            if len(request.times) == 0 or len(request.times) > 64:
                raise HTTPException(status_code=422, detail="Frame timestamp list must contain 1 to 64 entries")
            times = [self._clamp_time(value, asset.duration) for value in request.times]
        else:
            count = request.count
            segment = asset.duration / count if count else asset.duration
            times = [self._clamp_time((index + 0.5) * segment, asset.duration) for index in range(count)]

        folder = self.settings.caption_frames_dir / _safe_key(asset_key)
        folder.mkdir(parents=True, exist_ok=True)
        frames: list[CaptionFrame] = []
        for index, timestamp in enumerate(times):
            filename = f"frame_{index:02d}_{round(timestamp * 1000):08d}.jpg"
            output_path = folder / filename
            if not output_path.is_file():
                command = [
                    self.settings.ffmpeg_bin,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    f"{timestamp:.6f}",
                    "-i",
                    str(source_path),
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=640:-2:flags=lanczos",
                    "-q:v",
                    "3",
                    str(output_path),
                ]
                try:
                    subprocess.run(command, check=True, capture_output=True, text=True)
                except FileNotFoundError as exc:
                    raise HTTPException(status_code=500, detail="ffmpeg is not installed") from exc
                except subprocess.CalledProcessError as exc:
                    raise HTTPException(status_code=422, detail=exc.stderr.strip() or "Frame extraction failed") from exc
            frames.append(
                CaptionFrame(
                    index=index,
                    time=timestamp,
                    url=f"/files/caption_frames/{_safe_key(asset_key)}/{filename}",
                )
            )

        current = self._record(asset.project_id, asset_key)
        self._save_record(
            asset.project_id,
            asset_key,
            caption_body=current["caption_body"],
            status=current["status"],
            selected=current["selected"],
            current_recipe_id=current["current_recipe_id"],
            frame_times=times,
        )
        return frames

    def start_generation(self, request: CaptionGenerationRequest) -> CaptionGenerationResult:
        project = self.database.get_project(request.project_id)
        recipe = self.get_recipe(request.recipe_id)
        if recipe.project_id not in (None, project.id):
            raise HTTPException(status_code=422, detail="Caption recipe does not belong to this project")

        jobs: list[CaptionJob] = []
        for asset_key in request.asset_keys:
            asset = self.get_asset(asset_key)
            if asset.project_id != project.id:
                raise HTTPException(status_code=422, detail="Caption asset does not belong to this project")
            job = self._create_job(project.id, asset_key, recipe.id)
            jobs.append(job)
            threading.Thread(target=self._run_job, args=(job.id,), daemon=True).start()
        return CaptionGenerationResult(jobs=jobs)

    def get_job(self, job_id: str) -> CaptionJob:
        with self.database.connect() as db:
            row = db.execute("SELECT * FROM caption_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Caption job was not found")
        return self._job(row)

    def list_versions(self, asset_key: str) -> list[CaptionVersion]:
        self.get_asset(asset_key)
        with self.database.connect() as db:
            rows = db.execute(
                "SELECT * FROM caption_versions WHERE asset_key = ? ORDER BY created_at DESC",
                (asset_key,),
            ).fetchall()
        return [
            CaptionVersion(
                id=row["id"],
                asset_key=row["asset_key"],
                recipe_id=row["recipe_id"],
                provider_id=row["provider_id"],
                model=row["model"],
                prompt=row["prompt"],
                frame_times=json.loads(row["frame_times_json"]),
                caption_body=row["caption_body"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def create_dataset_bundle(self, project_id: str, request: CaptionDatasetBundleRequest) -> ExportBundleResult:
        project = self.database.get_project(project_id)
        bundle_dir = self.settings.datasets_dir / project.dataset_prefix
        bundle_dir.mkdir(parents=True, exist_ok=True)
        bundle_filename = f"{project.dataset_prefix}_captioned.zip"
        bundle_path = bundle_dir / bundle_filename
        included: list[str] = []
        external_index = 1
        manifest: list[dict] = []

        with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_STORED) as archive:
            for asset_key in request.asset_keys:
                asset = self.get_asset(asset_key)
                if asset.project_id != project_id:
                    raise HTTPException(status_code=422, detail="Caption asset does not belong to this project")
                if not asset.caption_body.strip():
                    continue
                source_path = self._asset_path(asset)
                if asset.kind == "selection" and asset.sequence is not None:
                    media_name = f"{project.dataset_prefix}_{asset.sequence:06d}{source_path.suffix.lower()}"
                else:
                    media_name = f"{project.dataset_prefix}_external_{external_index:03d}{source_path.suffix.lower()}"
                    external_index += 1
                caption_name = str(Path(media_name).with_suffix(".txt"))
                effective = self._effective_caption(project_id, asset.caption_body)
                archive.write(source_path, arcname=media_name)
                archive.writestr(caption_name, effective + "\n")
                included.extend([media_name, caption_name])
                manifest.append({"asset_key": asset.key, "media": media_name, "caption": caption_name, "status": asset.status})
            archive.writestr("manifest.json", json.dumps({"project": project.model_dump(), "assets": manifest}, indent=2))
            included.append("manifest.json")

        return ExportBundleResult(
            filename=bundle_filename,
            url=f"/files/datasets/{project.dataset_prefix}/{bundle_filename}",
            files=included,
        )

    def _run_job(self, job_id: str) -> None:
        try:
            job = self.get_job(job_id)
            recipe = self.get_recipe(job.recipe_id)
            asset = self.get_asset(job.asset_key)
            self._update_job(job_id, "running", 0.1, None)
            record = self._record(asset.project_id, asset.key)
            times = record["frame_times"]
            if not times:
                count = recipe.frame_count
                if recipe.sample_mode == "fps":
                    count = max(1, min(64, round(asset.duration * recipe.sample_fps)))
                frames = self.preview_frames(asset.key, CaptionFrameRequest(count=count))
                times = [frame.time for frame in frames]
            else:
                frames = self.preview_frames(asset.key, CaptionFrameRequest(times=times, count=len(times)))
            self._update_job(job_id, "running", 0.45, None)
            frame_paths = [self._url_to_data_path(frame.url) for frame in frames]
            provider = self.providers.get(recipe.provider_id)
            caption = provider.generate(recipe, recipe.prompt, frame_paths).strip()
            if not caption:
                raise RuntimeError("Vision provider returned an empty caption")
            self._update_job(job_id, "running", 0.85, None)
            version_id = uuid.uuid4().hex
            timestamp = _now()
            with self.database.connect() as db:
                db.execute(
                    """
                    INSERT INTO caption_versions(
                        id, asset_key, recipe_id, provider_id, model, prompt,
                        frame_times_json, caption_body, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        version_id,
                        asset.key,
                        recipe.id,
                        recipe.provider_id,
                        recipe.model,
                        recipe.prompt,
                        json.dumps(times),
                        caption,
                        timestamp,
                    ),
                )
            self._save_record(
                asset.project_id,
                asset.key,
                caption_body=caption,
                status="new",
                selected=record["selected"],
                current_recipe_id=recipe.id,
                frame_times=times,
            )
            self._write_caption_sidecar(asset.key)
            self._update_job(job_id, "completed", 1.0, None)
        except Exception as exc:  # worker boundary: persist error rather than killing API process
            try:
                self._update_job(job_id, "failed", 1.0, str(exc))
                job = self.get_job(job_id)
                asset = self.get_asset(job.asset_key)
                current = self._record(asset.project_id, asset.key)
                self._save_record(
                    asset.project_id,
                    asset.key,
                    caption_body=current["caption_body"],
                    status="failed",
                    selected=current["selected"],
                    current_recipe_id=current["current_recipe_id"],
                    frame_times=current["frame_times"],
                )
            except Exception:
                pass

    def _create_job(self, project_id: str, asset_key: str, recipe_id: str) -> CaptionJob:
        job_id = uuid.uuid4().hex
        timestamp = _now()
        with self.database.connect() as db:
            db.execute(
                "INSERT INTO caption_jobs(id, project_id, asset_key, recipe_id, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?)",
                (job_id, project_id, asset_key, recipe_id, timestamp, timestamp),
            )
        return self.get_job(job_id)

    def _update_job(self, job_id: str, status: str, progress: float, error: str | None) -> None:
        with self.database.connect() as db:
            db.execute(
                "UPDATE caption_jobs SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?",
                (status, progress, error, _now(), job_id),
            )

    def _record(self, project_id: str, asset_key: str) -> dict:
        with self.database.connect() as db:
            row = db.execute("SELECT * FROM caption_records WHERE asset_key = ?", (asset_key,)).fetchone()
            if row is None:
                timestamp = _now()
                db.execute(
                    "INSERT INTO caption_records(asset_key, project_id, updated_at) VALUES (?, ?, ?)",
                    (asset_key, project_id, timestamp),
                )
                return {
                    "caption_body": "",
                    "status": "uncaptioned",
                    "selected": True,
                    "current_recipe_id": None,
                    "frame_times": [],
                    "updated_at": timestamp,
                }
        return {
            "caption_body": row["caption_body"],
            "status": row["status"],
            "selected": bool(row["selected"]),
            "current_recipe_id": row["current_recipe_id"],
            "frame_times": json.loads(row["frame_times_json"] or "[]"),
            "updated_at": row["updated_at"],
        }

    def _save_record(
        self,
        project_id: str,
        asset_key: str,
        *,
        caption_body: str,
        status: str,
        selected: bool,
        current_recipe_id: str | None,
        frame_times: list[float],
    ) -> None:
        with self.database.connect() as db:
            db.execute(
                """
                INSERT INTO caption_records(
                    asset_key, project_id, caption_body, status, selected,
                    current_recipe_id, frame_times_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset_key) DO UPDATE SET
                    caption_body = excluded.caption_body,
                    status = excluded.status,
                    selected = excluded.selected,
                    current_recipe_id = excluded.current_recipe_id,
                    frame_times_json = excluded.frame_times_json,
                    updated_at = excluded.updated_at
                """,
                (
                    asset_key,
                    project_id,
                    caption_body,
                    status,
                    1 if selected else 0,
                    current_recipe_id,
                    json.dumps(frame_times),
                    _now(),
                ),
            )

    def _asset_path(self, asset: CaptionAsset) -> Path:
        if asset.kind == "selection":
            _, _, selection = self.database.selection_context(asset.selection_id or "")
            project = self.database.get_project(asset.project_id)
            path = (self.settings.datasets_dir / project.dataset_prefix / (selection.export_filename or "")).resolve()
            root = (self.settings.datasets_dir / project.dataset_prefix).resolve()
        else:
            identifier = asset.key.split(":", 1)[1]
            with self.database.connect() as db:
                row = db.execute("SELECT stored_name FROM caption_standalones WHERE id = ?", (identifier,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Caption asset file was not found")
            path = (self.settings.sources_dir / row["stored_name"]).resolve()
            root = self.settings.sources_dir.resolve()
        if path.parent != root or not path.is_file():
            raise HTTPException(status_code=404, detail="Caption asset file was not found")
        return path

    def _url_to_data_path(self, url: str) -> Path:
        prefix = "/files/"
        if not url.startswith(prefix):
            raise RuntimeError("Caption frame URL is invalid")
        path = (self.settings.data_dir / url[len(prefix):]).resolve()
        if self.settings.data_dir.resolve() not in path.parents:
            raise RuntimeError("Caption frame escaped the data directory")
        return path

    def _write_caption_sidecar(self, asset_key: str) -> None:
        asset = self.get_asset(asset_key)
        if asset.kind != "selection" or not asset.caption_body.strip():
            return
        media_path = self._asset_path(asset)
        media_path.with_suffix(".txt").write_text(self._effective_caption(asset.project_id, asset.caption_body) + "\n", encoding="utf-8")

    def _refresh_project_caption_files(self, project_id: str) -> None:
        for asset in self.list_assets(project_id):
            if asset.caption_body.strip() and asset.kind == "selection":
                self._write_caption_sidecar(asset.key)

    def _effective_caption(self, project_id: str, body: str) -> str:
        trigger = self.get_settings(project_id).trigger_phrase.strip()
        body = body.strip()
        if trigger and body:
            return f"{trigger} {body}"
        return trigger or body

    @staticmethod
    def _clamp_time(value: float, duration: float) -> float:
        if duration <= 0:
            return 0
        return max(0.0, min(float(value), max(0.0, duration - 0.001)))

    @staticmethod
    def _recipe(row: sqlite3.Row) -> CaptionRecipe:
        return CaptionRecipe(
            id=row["id"],
            project_id=row["project_id"],
            name=row["name"],
            provider_id=row["provider_id"],
            model=row["model"],
            prompt=row["prompt"],
            system_prompt=row["system_prompt"],
            sample_mode=row["sample_mode"],
            frame_count=row["frame_count"],
            sample_fps=row["sample_fps"],
            visual_detail=row["visual_detail"],
            max_tokens=row["max_tokens"],
            temperature=row["temperature"],
            top_p=row["top_p"],
            seed=row["seed"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _job(row: sqlite3.Row) -> CaptionJob:
        return CaptionJob(
            id=row["id"],
            project_id=row["project_id"],
            asset_key=row["asset_key"],
            recipe_id=row["recipe_id"],
            status=row["status"],
            progress=row["progress"],
            error=row["error"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
