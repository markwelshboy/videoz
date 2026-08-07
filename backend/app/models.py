from typing import Literal

from pydantic import BaseModel, Field, model_validator


class OutputSize(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    label: str


class TrainingProfile(BaseModel):
    id: str
    architecture: str
    trainer: str
    label: str
    media_kind: Literal["video", "image"]
    fps: float = Field(gt=0)
    frame_options: list[int]
    sizes: list[OutputSize]
    dimension_multiple: int = Field(default=1, gt=0)
    frame_rule: str | None = None
    notes: str | None = None


class MediaAsset(BaseModel):
    id: str
    original_name: str
    stored_name: str
    url: str
    duration: float = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: float = Field(gt=0)
    frame_count: int | None = None
    has_audio: bool = False
    thumbnails: list[str] = Field(default_factory=list)


class CropRect(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def remains_inside_source(self) -> "CropRect":
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("Crop rectangle must remain inside the source frame")
        return self


class ExportRequest(BaseModel):
    source_filename: str
    original_name: str
    profile_id: str
    media_kind: Literal["video", "image"]
    start_time: float = Field(ge=0)
    fps: float = Field(gt=0)
    frames: int = Field(gt=0)
    output_width: int = Field(gt=0)
    output_height: int = Field(gt=0)
    crop: CropRect


class ExportResult(BaseModel):
    filename: str
    url: str
    command: list[str]
