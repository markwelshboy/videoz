from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.ffmpeg import build_export_command
from app.models import CropRect, ExportRequest


def make_request(media_kind: str = "video") -> ExportRequest:
    return ExportRequest(
        source_filename="source.mp4",
        original_name="source.mp4",
        profile_id="wan-2-1-general",
        media_kind=media_kind,
        start_time=1.25,
        fps=16,
        frames=81,
        output_width=832,
        output_height=480,
        crop=CropRect(x=0.1, y=0.2, width=0.8, height=0.6),
    )


def test_video_command_enforces_frame_count_and_dimensions() -> None:
    command = build_export_command(
        make_request(),
        Path("/data/sources/source.mp4"),
        Path("/data/datasets/out.mp4"),
        Settings(),
    )

    filter_value = command[command.index("-vf") + 1]
    assert "fps=16" in filter_value
    assert "scale=832:480" in filter_value
    assert command[command.index("-frames:v") + 1] == "81"
    assert command[-1].endswith("out.mp4")


def test_image_command_exports_one_frame() -> None:
    command = build_export_command(
        make_request("image"),
        Path("source.mp4"),
        Path("out.png"),
        Settings(),
    )
    assert command[command.index("-frames:v") + 1] == "1"
    assert "-c:v" not in command


def test_crop_must_remain_inside_source() -> None:
    with pytest.raises(ValidationError):
        CropRect(x=0.5, y=0.0, width=0.6, height=1.0)
