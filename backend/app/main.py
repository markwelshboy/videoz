from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .ffmpeg import export_selection
from .media import import_media
from .models import ExportRequest, ExportResult, MediaAsset, TrainingProfile
from .profiles import PROFILES

settings = get_settings()
settings.ensure_directories()

app = FastAPI(title="Videoz API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/files", StaticFiles(directory=settings.data_dir), name="files")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/profiles", response_model=list[TrainingProfile])
def list_profiles() -> list[TrainingProfile]:
    return PROFILES


@app.post("/api/media/import", response_model=MediaAsset)
def upload_media(file: UploadFile = File(...)) -> MediaAsset:
    return import_media(file, settings)


@app.post("/api/exports", response_model=ExportResult)
def create_export(request: ExportRequest) -> ExportResult:
    return export_selection(request, settings)


frontend_dir = settings.frontend_dir
if frontend_dir.is_dir():
    assets_dir = frontend_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    def frontend_index() -> FileResponse:
        return FileResponse(frontend_dir / "index.html")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend_fallback(path: str) -> FileResponse:
        candidate = (frontend_dir / path).resolve()
        if candidate.is_file() and frontend_dir.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(frontend_dir / "index.html")
