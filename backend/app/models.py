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
    default_frames: int | None = Field(default=None, gt=0)
    sizes: list[OutputSize]
    dimension_multiple: int = Field(default=1, gt=0)
    frame_rule: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def default_frame_count_is_selectable(self) -> "TrainingProfile":
        if self.default_frames is not None and self.default_frames not in self.frame_options:
            raise ValueError("default_frames must be present in frame_options")
        return self


class MediaAsset(BaseModel):
    id: str
    project_id: str | None = None
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


class ExportBundleRequest(BaseModel):
    filenames: list[str] = Field(min_length=1)
    name: str | None = None


class ExportBundleResult(BaseModel):
    filename: str
    url: str
    files: list[str]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    dataset_prefix: str | None = Field(default=None, max_length=80)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    dataset_prefix: str | None = Field(default=None, min_length=1, max_length=80)


class Project(BaseModel):
    id: str
    name: str
    dataset_prefix: str
    created_at: str
    updated_at: str


class SelectionCreate(BaseModel):
    asset_id: str
    start_time: float = Field(ge=0)
    frame_count: int = Field(gt=0)
    profile_id: str
    size_index: int = Field(ge=0)
    crop: CropRect
    crop_scale: float = Field(gt=0, le=1)


class SelectionUpdate(BaseModel):
    asset_id: str
    start_time: float = Field(ge=0)
    frame_count: int = Field(gt=0)
    profile_id: str
    size_index: int = Field(ge=0)
    crop: CropRect
    crop_scale: float = Field(gt=0, le=1)


class SavedSelection(BaseModel):
    id: str
    project_id: str
    asset_id: str
    sequence: int = Field(gt=0)
    start_time: float = Field(ge=0)
    frame_count: int = Field(gt=0)
    profile_id: str
    size_index: int = Field(ge=0)
    crop: CropRect
    crop_scale: float = Field(gt=0, le=1)
    export_filename: str | None = None
    created_at: str
    updated_at: str


class ProjectWorkspace(BaseModel):
    project: Project
    sources: list[MediaAsset]
    selections: list[SavedSelection]
