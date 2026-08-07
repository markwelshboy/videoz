import json
import math
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


def _display_dimensions(video_stream: dict) -> tuple[int, int]:
    width = int(video_stream["width"])
    height = int(video_stream["height"])
    rotation = 0

    tags = video_stream.get("tags") or {}
    try:
        rotation = int(float(tags.get("rotate", 0)))
    except (TypeError, ValueError):
        rotation = 0

    for side_data in video_stream.get("side_data_list") or []:
        if "rotation" in side_data:
            try:
                rotation = int(float(side_data["rotation"]))
            except (TypeError, ValueError):
                pass
            break

    if abs(rotation) % 180 == 90:
        return height, width
    return width, height


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


def generate_thumbnails(path: Path, asset_id: str, duration: float, settings: Settings) -> list[str]:
    if duration <= 0:
        return []

    # Roughly one visual sample every 1.5 seconds, with sensible bounds for
    # short and very long source videos. Timeline zoom stretches the complete
    # strip, so these samples remain useful without creating thousands of files.
    count = min(120, max(12, math.ceil(duration / 1.5)))
    thumbnail_dir = settings.thumbnails_dir / asset_id
    thumbnail_dir.mkdir(parents=True, exist_ok=True)
    output_pattern = thumbnail_dir / "%04d.jpg"
    sample_fps = count / duration

    command = [
        settings.ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(path),
        "-vf",
        f"fps={sample_fps:.8f},scale=240:-2:flags=lanczos",
        "-frames:v",
        str(count),
        "-q:v",
        "5",
        str(output_pattern),
    ]

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        shutil.rmtree(thumbnail_dir, ignore_errors=True)
        return []

    return [
        f"/files/thumbnails/{asset_id}/{thumbnail.name}"
        for thumbnail in sorted(thumbnail_dir.glob("*.jpg"))
    ]


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
    width, height = _display_dimensions(video_stream)
    thumbnails = generate_thumbnails(destination, asset_id, duration, settings)

    return MediaAsset(
        id=asset_id,
        original_name=upload.filename or stored_name,
        stored_name=stored_name,
        url=f"/files/sources/{stored_name}",
        duration=duration,
        width=width,
        height=height,
        fps=fps or 1.0,
        frame_count=frame_count,
        has_audio=any(stream.get("codec_type") == "audio" for stream in streams),
        thumbnails=thumbnails,
    )
