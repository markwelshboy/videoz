import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from .config import Settings
from .models import (
    CropRect,
    MediaAsset,
    Project,
    ProjectCreate,
    ProjectUpdate,
    ProjectWorkspace,
    SavedSelection,
    SelectionCreate,
    SelectionUpdate,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._-").lower()
    return slug[:80] or "dataset"


class Database:
    def __init__(self, settings: Settings):
        self.path = settings.database_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    dataset_prefix TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS assets (
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
                    thumbnails_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS selections (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    start_time REAL NOT NULL,
                    frame_count INTEGER NOT NULL,
                    profile_id TEXT NOT NULL,
                    size_index INTEGER NOT NULL,
                    crop_x REAL NOT NULL,
                    crop_y REAL NOT NULL,
                    crop_width REAL NOT NULL,
                    crop_height REAL NOT NULL,
                    crop_scale REAL NOT NULL,
                    export_filename TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(project_id, sequence)
                );

                CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_selections_project ON selections(project_id, sequence);
                CREATE INDEX IF NOT EXISTS idx_selections_asset ON selections(asset_id, sequence);
                """
            )

    def _unique_prefix(self, db: sqlite3.Connection, requested: str, exclude_project_id: str | None = None) -> str:
        base = _slugify(requested)
        candidate = base
        suffix = 2
        while True:
            if exclude_project_id:
                row = db.execute(
                    "SELECT id FROM projects WHERE dataset_prefix = ? AND id != ?",
                    (candidate, exclude_project_id),
                ).fetchone()
            else:
                row = db.execute("SELECT id FROM projects WHERE dataset_prefix = ?", (candidate,)).fetchone()
            if row is None:
                return candidate
            candidate = f"{base[:72]}_{suffix}"
            suffix += 1

    def create_project(self, request: ProjectCreate) -> Project:
        project_id = uuid.uuid4().hex
        timestamp = _now()
        with self.connect() as db:
            prefix = self._unique_prefix(db, request.dataset_prefix or request.name)
            db.execute(
                "INSERT INTO projects(id, name, dataset_prefix, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (project_id, request.name.strip(), prefix, timestamp, timestamp),
            )
        return self.get_project(project_id)

    def list_projects(self) -> list[Project]:
        with self.connect() as db:
            rows = db.execute("SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC").fetchall()
        return [self._project(row) for row in rows]

    def get_project(self, project_id: str) -> Project:
        with self.connect() as db:
            row = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Project was not found")
        return self._project(row)

    def update_project(self, project_id: str, request: ProjectUpdate) -> Project:
        with self.connect() as db:
            current = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            if current is None:
                raise HTTPException(status_code=404, detail="Project was not found")
            name = request.name.strip() if request.name is not None else current["name"]
            prefix = current["dataset_prefix"]
            if request.dataset_prefix is not None:
                prefix = self._unique_prefix(db, request.dataset_prefix, exclude_project_id=project_id)
            db.execute(
                "UPDATE projects SET name = ?, dataset_prefix = ?, updated_at = ? WHERE id = ?",
                (name, prefix, _now(), project_id),
            )
        return self.get_project(project_id)

    def add_asset(self, project_id: str, asset: MediaAsset) -> MediaAsset:
        self.get_project(project_id)
        with self.connect() as db:
            db.execute(
                """
                INSERT OR REPLACE INTO assets(
                    id, project_id, original_name, stored_name, duration, width, height, fps,
                    frame_count, has_audio, thumbnails_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asset.id,
                    project_id,
                    asset.original_name,
                    asset.stored_name,
                    asset.duration,
                    asset.width,
                    asset.height,
                    asset.fps,
                    asset.frame_count,
                    1 if asset.has_audio else 0,
                    json.dumps(asset.thumbnails),
                    _now(),
                ),
            )
            db.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (_now(), project_id))
        return asset.model_copy(update={"project_id": project_id})

    def get_asset(self, asset_id: str) -> MediaAsset:
        with self.connect() as db:
            row = db.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Source media was not found")
        return self._asset(row)

    def get_workspace(self, project_id: str) -> ProjectWorkspace:
        project = self.get_project(project_id)
        with self.connect() as db:
            asset_rows = db.execute(
                "SELECT * FROM assets WHERE project_id = ? ORDER BY created_at, rowid",
                (project_id,),
            ).fetchall()
            selection_rows = db.execute(
                "SELECT * FROM selections WHERE project_id = ? ORDER BY sequence",
                (project_id,),
            ).fetchall()
        return ProjectWorkspace(
            project=project,
            sources=[self._asset(row) for row in asset_rows],
            selections=[self._selection(row) for row in selection_rows],
        )

    def create_selection(self, project_id: str, request: SelectionCreate) -> SavedSelection:
        project = self.get_project(project_id)
        asset = self.get_asset(request.asset_id)
        if asset.project_id != project.id:
            raise HTTPException(status_code=422, detail="Source media does not belong to this project")
        selection_id = uuid.uuid4().hex
        timestamp = _now()
        with self.connect() as db:
            row = db.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM selections WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            sequence = int(row["next_sequence"])
            crop = request.crop
            db.execute(
                """
                INSERT INTO selections(
                    id, project_id, asset_id, sequence, start_time, frame_count, profile_id, size_index,
                    crop_x, crop_y, crop_width, crop_height, crop_scale, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    selection_id,
                    project_id,
                    request.asset_id,
                    sequence,
                    request.start_time,
                    request.frame_count,
                    request.profile_id,
                    request.size_index,
                    crop.x,
                    crop.y,
                    crop.width,
                    crop.height,
                    request.crop_scale,
                    timestamp,
                    timestamp,
                ),
            )
            db.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
        return self.get_selection(selection_id)

    def get_selection(self, selection_id: str) -> SavedSelection:
        with self.connect() as db:
            row = db.execute("SELECT * FROM selections WHERE id = ?", (selection_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Selection was not found")
        return self._selection(row)

    def update_selection(self, selection_id: str, request: SelectionUpdate) -> SavedSelection:
        current = self.get_selection(selection_id)
        asset = self.get_asset(request.asset_id)
        if asset.project_id != current.project_id:
            raise HTTPException(status_code=422, detail="Source media does not belong to this project")
        timestamp = _now()
        crop = request.crop
        with self.connect() as db:
            db.execute(
                """
                UPDATE selections SET
                    asset_id = ?, start_time = ?, frame_count = ?, profile_id = ?, size_index = ?,
                    crop_x = ?, crop_y = ?, crop_width = ?, crop_height = ?, crop_scale = ?,
                    export_filename = NULL, updated_at = ?
                WHERE id = ?
                """,
                (
                    request.asset_id,
                    request.start_time,
                    request.frame_count,
                    request.profile_id,
                    request.size_index,
                    crop.x,
                    crop.y,
                    crop.width,
                    crop.height,
                    request.crop_scale,
                    timestamp,
                    selection_id,
                ),
            )
            db.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, current.project_id))
        return self.get_selection(selection_id)

    def delete_selection(self, selection_id: str) -> None:
        current = self.get_selection(selection_id)
        with self.connect() as db:
            db.execute("DELETE FROM selections WHERE id = ?", (selection_id,))
            db.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (_now(), current.project_id))

    def mark_exported(self, selection_id: str, export_filename: str) -> SavedSelection:
        current = self.get_selection(selection_id)
        timestamp = _now()
        with self.connect() as db:
            db.execute(
                "UPDATE selections SET export_filename = ?, updated_at = ? WHERE id = ?",
                (export_filename, timestamp, selection_id),
            )
            db.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, current.project_id))
        return self.get_selection(selection_id)

    def selection_context(self, selection_id: str) -> tuple[Project, MediaAsset, SavedSelection]:
        selection = self.get_selection(selection_id)
        return self.get_project(selection.project_id), self.get_asset(selection.asset_id), selection

    @staticmethod
    def _project(row: sqlite3.Row) -> Project:
        return Project(
            id=row["id"],
            name=row["name"],
            dataset_prefix=row["dataset_prefix"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _asset(row: sqlite3.Row) -> MediaAsset:
        return MediaAsset(
            id=row["id"],
            project_id=row["project_id"],
            original_name=row["original_name"],
            stored_name=row["stored_name"],
            url=f"/files/sources/{row['stored_name']}",
            duration=row["duration"],
            width=row["width"],
            height=row["height"],
            fps=row["fps"],
            frame_count=row["frame_count"],
            has_audio=bool(row["has_audio"]),
            thumbnails=json.loads(row["thumbnails_json"] or "[]"),
        )

    @staticmethod
    def _selection(row: sqlite3.Row) -> SavedSelection:
        return SavedSelection(
            id=row["id"],
            project_id=row["project_id"],
            asset_id=row["asset_id"],
            sequence=row["sequence"],
            start_time=row["start_time"],
            frame_count=row["frame_count"],
            profile_id=row["profile_id"],
            size_index=row["size_index"],
            crop=CropRect(
                x=row["crop_x"],
                y=row["crop_y"],
                width=row["crop_width"],
                height=row["crop_height"],
            ),
            crop_scale=row["crop_scale"],
            export_filename=row["export_filename"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
