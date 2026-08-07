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


CaptionStatus = Literal["uncaptioned", "new", "reviewed", "edited", "failed"]
CaptionAssetKind = Literal["selection", "standalone"]
CaptionSampleMode = Literal["fixed_count", "fps"]
CaptionVisualDetail = Literal["low", "standard", "high"]
CaptionJobStatus = Literal["queued", "running", "completed", "failed"]


class CaptionProviderInfo(BaseModel):
    id: str
    label: str
    available: bool
    reason: str | None = None
    default_model: str | None = None
    model_hint: str | None = None


class CaptionRecipeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    project_id: str | None = None
    provider_id: str = "mock"
    model: str = Field(default="videoz/mock-vlm", min_length=1, max_length=200)
    prompt: str = Field(min_length=1)
    system_prompt: str = ""
    sample_mode: CaptionSampleMode = "fixed_count"
    frame_count: int = Field(default=8, ge=1, le=64)
    sample_fps: float = Field(default=2, gt=0, le=30)
    visual_detail: CaptionVisualDetail = "standard"
    max_tokens: int = Field(default=160, ge=16, le=4096)
    temperature: float = Field(default=0.4, ge=0, le=2)
    top_p: float = Field(default=0.8, gt=0, le=1)
    seed: int | None = None


class CaptionRecipeUpdate(CaptionRecipeCreate):
    pass


class CaptionRecipe(CaptionRecipeCreate):
    id: str
    created_at: str
    updated_at: str


class CaptionFrameRequest(BaseModel):
    count: int = Field(default=8, ge=1, le=64)
    times: list[float] | None = None


class CaptionFrame(BaseModel):
    index: int = Field(ge=0)
    time: float = Field(ge=0)
    url: str


class CaptionAssetPatch(BaseModel):
    caption_body: str | None = None
    status: CaptionStatus | None = None
    selected: bool | None = None
    frame_times: list[float] | None = None


class CaptionAsset(BaseModel):
    key: str
    project_id: str
    kind: CaptionAssetKind
    selection_id: str | None = None
    sequence: int | None = None
    display_name: str
    url: str
    duration: float = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: float = Field(gt=0)
    caption_body: str = ""
    status: CaptionStatus = "uncaptioned"
    selected: bool = True
    current_recipe_id: str | None = None
    frame_times: list[float] = Field(default_factory=list)
    updated_at: str | None = None


class CaptionProjectSettingsUpdate(BaseModel):
    trigger_phrase: str = Field(default="", max_length=200)


class CaptionProjectSettings(BaseModel):
    project_id: str
    trigger_phrase: str = ""


class CaptionWorkspace(BaseModel):
    project: Project
    settings: CaptionProjectSettings
    assets: list[CaptionAsset]
    recipes: list[CaptionRecipe]


class CaptionGenerationRequest(BaseModel):
    project_id: str
    asset_keys: list[str] = Field(min_length=1)
    recipe_id: str


class CaptionJob(BaseModel):
    id: str
    project_id: str
    asset_key: str
    recipe_id: str
    status: CaptionJobStatus
    progress: float = Field(default=0, ge=0, le=1)
    error: str | None = None
    created_at: str
    updated_at: str


class CaptionGenerationResult(BaseModel):
    jobs: list[CaptionJob]


class CaptionVersion(BaseModel):
    id: str
    asset_key: str
    recipe_id: str
    provider_id: str
    model: str
    prompt: str
    frame_times: list[float]
    caption_body: str
    created_at: str
