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

    @property
    def sources_dir(self) -> Path:
        return self.data_dir / "sources"

    @property
    def datasets_dir(self) -> Path:
        return self.data_dir / "datasets"

    @property
    def thumbnails_dir(self) -> Path:
        return self.data_dir / "thumbnails"

    def ensure_directories(self) -> None:
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.datasets_dir.mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
