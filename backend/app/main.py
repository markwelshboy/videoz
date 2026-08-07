from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .archive import create_export_bundle
from .config import get_settings
from .database import Database
from .ffmpeg import export_selection
from .media import import_media
from .models import (
    ExportBundleRequest,
    ExportBundleResult,
    ExportRequest,
    ExportResult,
    MediaAsset,
    Project,
    ProjectCreate,
    ProjectUpdate,
    ProjectWorkspace,
    SavedSelection,
    SelectionCreate,
    SelectionUpdate,
    TrainingProfile,
)
from .profiles import PROFILES, PROFILE_BY_ID

settings = get_settings()
settings.ensure_directories()
database = Database(settings)

app = FastAPI(title="Videoz API", version="0.2.0")
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


@app.get("/api/projects", response_model=list[Project])
def list_projects() -> list[Project]:
    return database.list_projects()


@app.post("/api/projects", response_model=Project)
def create_project(request: ProjectCreate) -> Project:
    return database.create_project(request)


@app.get("/api/projects/{project_id}", response_model=ProjectWorkspace)
def get_project_workspace(project_id: str) -> ProjectWorkspace:
    return database.get_workspace(project_id)


@app.patch("/api/projects/{project_id}", response_model=Project)
def update_project(project_id: str, request: ProjectUpdate) -> Project:
    return database.update_project(project_id, request)


@app.post("/api/media/import", response_model=MediaAsset)
def upload_media(file: UploadFile = File(...)) -> MediaAsset:
    # Retained for simple/ad-hoc use. Project-aware imports should use the
    # /api/projects/{project_id}/media/import endpoint below.
    return import_media(file, settings)


@app.post("/api/projects/{project_id}/media/import", response_model=MediaAsset)
def upload_project_media(project_id: str, file: UploadFile = File(...)) -> MediaAsset:
    asset = import_media(file, settings)
    return database.add_asset(project_id, asset)


@app.post("/api/projects/{project_id}/selections", response_model=SavedSelection)
def create_saved_selection(project_id: str, request: SelectionCreate) -> SavedSelection:
    return database.create_selection(project_id, request)


@app.put("/api/selections/{selection_id}", response_model=SavedSelection)
def update_saved_selection(selection_id: str, request: SelectionUpdate) -> SavedSelection:
    return database.update_selection(selection_id, request)


@app.delete("/api/selections/{selection_id}", status_code=204)
def delete_saved_selection(selection_id: str) -> Response:
    database.delete_selection(selection_id)
    return Response(status_code=204)


@app.post("/api/selections/{selection_id}/export", response_model=ExportResult)
def export_saved_selection(selection_id: str) -> ExportResult:
    project, asset, selection = database.selection_context(selection_id)
    profile = PROFILE_BY_ID.get(selection.profile_id)
    if profile is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="Selection training profile is unavailable")
    if selection.size_index >= len(profile.sizes):
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="Selection output size is unavailable")

    output_size = profile.sizes[selection.size_index]
    request = ExportRequest(
        source_filename=asset.stored_name,
        original_name=asset.original_name,
        profile_id=profile.id,
        media_kind=profile.media_kind,
        start_time=selection.start_time,
        fps=profile.fps,
        frames=selection.frame_count,
        output_width=output_size.width,
        output_height=output_size.height,
        crop=selection.crop,
    )
    stem = f"{project.dataset_prefix}_{selection.sequence:06d}"
    result = export_selection(
        request,
        settings,
        filename_stem=stem,
        output_subdir=project.dataset_prefix,
    )
    database.mark_exported(selection_id, result.filename)
    return result


@app.post("/api/exports", response_model=ExportResult)
def create_export(request: ExportRequest) -> ExportResult:
    return export_selection(request, settings)


@app.post("/api/exports/bundle", response_model=ExportBundleResult)
def create_bundle(request: ExportBundleRequest) -> ExportBundleResult:
    return create_export_bundle(request, settings)


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
