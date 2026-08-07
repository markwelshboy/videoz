from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VIDEOZ_", env_file=".env", extra="ignore")

    data_dir: Path = Path("data")
    frontend_dir: Path = Path("frontend/dist")
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    max_upload_gb: int = Field(default=20, ge=1)

    # Caption providers are deliberately OpenAI-compatible at the boundary so
    # local Qwen/vLLM and hosted services can use the same job contract.
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    vlm_base_url: str | None = None
    vlm_api_key: str | None = None
    vlm_default_model: str = "Qwen/Qwen3-VL-8B-Instruct"

    @property
    def sources_dir(self) -> Path:
        return self.data_dir / "sources"

    @property
    def datasets_dir(self) -> Path:
        return self.data_dir / "datasets"

    @property
    def thumbnails_dir(self) -> Path:
        return self.data_dir / "thumbnails"

    @property
    def caption_frames_dir(self) -> Path:
        return self.data_dir / "caption_frames"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "videoz.sqlite3"

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.datasets_dir.mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir.mkdir(parents=True, exist_ok=True)
        self.caption_frames_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
