from pathlib import Path

from app.captions import CaptionService
from app.config import Settings
from app.database import Database
from app.models import (
    CaptionProjectSettingsUpdate,
    CaptionRecipeCreate,
    CropRect,
    MediaAsset,
    ProjectCreate,
    SelectionCreate,
)


def make_service(tmp_path: Path) -> tuple[Database, CaptionService]:
    settings = Settings(data_dir=tmp_path / "data", frontend_dir=tmp_path / "frontend")
    settings.ensure_directories()
    database = Database(settings)
    return database, CaptionService(database, settings)


def test_caption_workspace_seeds_global_recipe(tmp_path: Path):
    database, captions = make_service(tmp_path)
    project = database.create_project(ProjectCreate(name="Character dataset", dataset_prefix="subject"))

    workspace = captions.get_workspace(project.id)

    assert workspace.project.id == project.id
    assert workspace.assets == []
    assert workspace.settings.trigger_phrase == ""
    assert len(workspace.recipes) >= 1
    assert workspace.recipes[0].project_id is None


def test_trigger_phrase_is_persistent_and_separate(tmp_path: Path):
    database, captions = make_service(tmp_path)
    project = database.create_project(ProjectCreate(name="Character dataset", dataset_prefix="subject"))

    captions.update_settings(project.id, CaptionProjectSettingsUpdate(trigger_phrase="sH1VX woman"))

    assert captions.get_settings(project.id).trigger_phrase == "sH1VX woman"
    assert captions._effective_caption(project.id, "walking beside a window") == "sH1VX woman walking beside a window"


def test_project_recipe_round_trip(tmp_path: Path):
    database, captions = make_service(tmp_path)
    project = database.create_project(ProjectCreate(name="Character dataset", dataset_prefix="subject"))

    recipe = captions.create_recipe(
        CaptionRecipeCreate(
            project_id=project.id,
            name="Qwen concise",
            provider_id="openrouter",
            model="qwen/qwen3-vl-8b-instruct",
            prompt="Describe the action and setting only.",
            frame_count=6,
            max_tokens=120,
            temperature=0.35,
            top_p=0.8,
        )
    )

    saved = captions.get_recipe(recipe.id)
    assert saved.project_id == project.id
    assert saved.model == "qwen/qwen3-vl-8b-instruct"
    assert saved.frame_count == 6
    assert saved.max_tokens == 120


def test_provider_registry_exposes_fungible_backends(tmp_path: Path):
    _, captions = make_service(tmp_path)
    providers = {provider.id: provider for provider in captions.list_providers()}

    assert providers["mock"].available is True
    assert providers["openrouter"].available is False
    assert providers["local-openai"].available is False


def test_caption_asset_resolves_deterministic_selection_export_without_duplicate_prefix(tmp_path: Path):
    settings = Settings(data_dir=tmp_path / "data", frontend_dir=tmp_path / "frontend")
    settings.ensure_directories()
    database = Database(settings)
    captions = CaptionService(database, settings)
    project = database.create_project(ProjectCreate(name="Character dataset", dataset_prefix="subject"))
    asset = database.add_asset(
        project.id,
        MediaAsset(
            id="source-1",
            original_name="source.mp4",
            stored_name="source-1.mp4",
            url="/files/sources/source-1.mp4",
            duration=20.0,
            width=1920,
            height=1080,
            fps=30.0,
            frame_count=600,
            has_audio=False,
            thumbnails=[],
        ),
    )
    selection = database.create_selection(
        project.id,
        SelectionCreate(
            asset_id=asset.id,
            start_time=1.0,
            frame_count=124,
            profile_id="minimax-h3-diffsynth-fl2va",
            size_index=0,
            crop=CropRect(x=0.0, y=0.0, width=1.0, height=1.0),
            crop_scale=1.0,
        ),
    )

    filename = "subject_000001.mp4"
    export_path = settings.datasets_dir / project.dataset_prefix / filename
    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_path.write_bytes(b"fake mp4 for path resolution")

    # Simulate records written by the earlier implementation, which stored a
    # dataset-relative path instead of only the export filename.
    with database.connect() as db:
        db.execute(
            "UPDATE selections SET export_filename = ? WHERE id = ?",
            (f"{project.dataset_prefix}/{filename}", selection.id),
        )

    workspace = captions.get_workspace(project.id)
    assert len(workspace.assets) == 1
    caption_asset = workspace.assets[0]
    assert caption_asset.url == f"/files/datasets/{project.dataset_prefix}/{filename}"
    assert captions._asset_path(caption_asset) == export_path.resolve()
