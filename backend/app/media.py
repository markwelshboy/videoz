import json
import shutil
import subprocess
import uuid
from fractions import Fraction
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .config import Settings
from .models import MediaAsset


def _parse_rate(value: str | None) -> float:
    if not value or value in {"0/0", "N/A"}:
        return 0.0
    try:
        return float(Fraction(value))
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe_media(path: Path, settings: Settings) -> dict:
    command = [
        settings.ffprobe_bin,
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(path),
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="ffprobe is not installed") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or "Unable to probe uploaded media"
        raise HTTPException(status_code=422, detail=detail) from exc
    return json.loads(result.stdout)


def import_media(upload: UploadFile, settings: Settings) -> MediaAsset:
    suffix = Path(upload.filename or "source.mp4").suffix.lower() or ".mp4"
    asset_id = uuid.uuid4().hex
    stored_name = f"{asset_id}{suffix}"
    destination = settings.sources_dir / stored_name

    with destination.open("wb") as output:
        shutil.copyfileobj(upload.file, output)

    try:
        metadata = probe_media(destination, settings)
        streams = metadata.get("streams", [])
        video_stream = next(stream for stream in streams if stream.get("codec_type") == "video")
    except (StopIteration, KeyError) as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="The uploaded file has no video stream") from exc

    format_info = metadata.get("format", {})
    duration = float(video_stream.get("duration") or format_info.get("duration") or 0)
    fps = _parse_rate(video_stream.get("avg_frame_rate")) or _parse_rate(video_stream.get("r_frame_rate"))
    frame_count_value = video_stream.get("nb_frames")
    frame_count = int(frame_count_value) if frame_count_value and frame_count_value != "N/A" else None

    return MediaAsset(
        id=asset_id,
        original_name=upload.filename or stored_name,
        stored_name=stored_name,
        url=f"/files/sources/{stored_name}",
        duration=duration,
        width=int(video_stream["width"]),
        height=int(video_stream["height"]),
        fps=fps or 1.0,
        frame_count=frame_count,
        has_audio=any(stream.get("codec_type") == "audio" for stream in streams),
    )
