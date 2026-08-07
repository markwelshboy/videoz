import json
import re
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from .config import Settings
from .models import ExportBundleRequest, ExportBundleResult


def _safe_bundle_stem(name: str | None) -> str:
    stem = Path(name or "videoz_dataset").stem
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-")
    return cleaned[:80] or "videoz_dataset"


def _inside(root: Path, candidate: Path) -> bool:
    return candidate == root or root in candidate.parents


def create_export_bundle(request: ExportBundleRequest, settings: Settings) -> ExportBundleResult:
    datasets_root = settings.datasets_dir.resolve()
    requested_media: list[Path] = []

    for filename in request.filenames:
        relative = Path(filename)
        if relative.is_absolute() or ".." in relative.parts:
            raise HTTPException(status_code=422, detail=f"Invalid export filename: {filename}")
        media_path = (settings.datasets_dir / relative).resolve()
        if not _inside(datasets_root, media_path) or not media_path.is_file():
            raise HTTPException(status_code=404, detail=f"Export was not found: {filename}")
        if media_path.suffix.lower() not in {".mp4", ".png"}:
            raise HTTPException(status_code=422, detail=f"Unsupported export file: {filename}")
        requested_media.append(media_path)

    included: list[Path] = []
    seen: set[Path] = set()
    for media_path in requested_media:
        for candidate in (media_path, media_path.with_suffix(".json"), media_path.with_suffix(".txt")):
            if candidate.is_file() and candidate not in seen:
                included.append(candidate)
                seen.add(candidate)

    bundle_stem = _safe_bundle_stem(request.name)
    bundle_filename = f"{bundle_stem}_videoz_{uuid.uuid4().hex[:8]}.zip"
    bundle_path = settings.datasets_dir / bundle_filename
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "media_exports": [path.relative_to(datasets_root).as_posix() for path in requested_media],
        "files": [path.name for path in included],
    }

    try:
        # Exported MP4/PNG files are already compressed. ZIP_STORED makes
        # packaging effectively a fast container operation instead of wasting
        # CPU trying to recompress media that will barely shrink.
        with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_STORED) as archive:
            for path in included:
                archive.write(path, arcname=path.name)
            archive.writestr("manifest.json", json.dumps(manifest, indent=2))
    except OSError as exc:
        bundle_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Could not create export ZIP") from exc

    return ExportBundleResult(
        filename=bundle_filename,
        url=f"/files/datasets/{bundle_filename}",
        files=[path.name for path in included] + ["manifest.json"],
    )
