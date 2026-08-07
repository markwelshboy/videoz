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


def export_selection(request: ExportRequest, settings: Settings) -> ExportResult:
    source_path = (settings.sources_dir / request.source_filename).resolve()
    sources_root = settings.sources_dir.resolve()
    if source_path.parent != sources_root or not source_path.is_file():
        raise HTTPException(status_code=404, detail="Source media was not found")

    extension = ".png" if request.media_kind == "image" else ".mp4"
    safe_stem = Path(request.original_name).stem.replace(" ", "_")[:80] or "clip"
    filename = f"{safe_stem}_{uuid.uuid4().hex[:8]}{extension}"
    output_path = settings.datasets_dir / filename
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

    return ExportResult(
        filename=filename,
        url=f"/files/datasets/{filename}",
        command=command,
    )
