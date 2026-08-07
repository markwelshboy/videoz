import re
import subprocess
import uuid
from pathlib import Path

from fastapi import HTTPException

from .config import Settings
from .models import ExportRequest, ExportResult


def _crop_filter(request: ExportRequest) -> str:
    crop = request.crop
    return (
        f"crop='floor(iw*{crop.width:.8f}/2)*2':"
        f"'floor(ih*{crop.height:.8f}/2)*2':"
        f"'floor(iw*{crop.x:.8f}/2)*2':"
        f"'floor(ih*{crop.y:.8f}/2)*2',"
        f"scale={request.output_width}:{request.output_height}:flags=lanczos,setsar=1"
    )


def _safe_component(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._-")
    return cleaned[:100] or fallback


def build_export_command(
    request: ExportRequest,
    source_path: Path,
    output_path: Path,
    settings: Settings,
) -> list[str]:
    base = [
        settings.ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_path),
        "-ss",
        f"{request.start_time:.6f}",
    ]

    crop_filter = _crop_filter(request)
    if request.media_kind == "image":
        return [
            *base,
            "-vf",
            crop_filter,
            "-frames:v",
            "1",
            str(output_path),
        ]

    video_filter = f"fps={request.fps:g},{crop_filter}"
    return [
        *base,
        "-vf",
        video_filter,
        "-frames:v",
        str(request.frames),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(output_path),
    ]


def export_selection(
    request: ExportRequest,
    settings: Settings,
    *,
    filename_stem: str | None = None,
    output_subdir: str | None = None,
) -> ExportResult:
    source_path = (settings.sources_dir / request.source_filename).resolve()
    sources_root = settings.sources_dir.resolve()
    if source_path.parent != sources_root or not source_path.is_file():
        raise HTTPException(status_code=404, detail="Source media was not found")

    extension = ".png" if request.media_kind == "image" else ".mp4"
    if filename_stem:
        safe_stem = _safe_component(filename_stem, "clip")
    else:
        source_stem = _safe_component(Path(request.original_name).stem, "clip")
        safe_stem = f"{source_stem}_{uuid.uuid4().hex[:8]}"

    output_dir = settings.datasets_dir
    relative_dir = Path()
    if output_subdir:
        safe_subdir = _safe_component(output_subdir, "dataset")
        output_dir = settings.datasets_dir / safe_subdir
        output_dir.mkdir(parents=True, exist_ok=True)
        relative_dir = Path(safe_subdir)

    filename = f"{safe_stem}{extension}"
    output_path = output_dir / filename

    # A persistent selection keeps one deterministic stem. If its media kind
    # changes, remove stale alternate output types rather than leaving ghosts.
    if filename_stem:
        for alternate in (output_dir / f"{safe_stem}.mp4", output_dir / f"{safe_stem}.png"):
            if alternate != output_path:
                alternate.unlink(missing_ok=True)
                alternate.with_suffix(".json").unlink(missing_ok=True)
                alternate.with_suffix(".txt").unlink(missing_ok=True)

    command = build_export_command(request, source_path, output_path, settings)

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="ffmpeg is not installed") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or "FFmpeg export failed"
        output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=detail) from exc

    sidecar = output_path.with_suffix(".json")
    sidecar.write_text(request.model_dump_json(indent=2), encoding="utf-8")

    relative_path = (relative_dir / filename).as_posix()
    return ExportResult(
        filename=relative_path,
        url=f"/files/datasets/{relative_path}",
        command=command,
    )
