from pathlib import Path

from app.config import Settings
from app.database import Database
from app.models import CropRect, MediaAsset, ProjectCreate, SelectionCreate, SelectionUpdate


def make_settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path, frontend_dir=tmp_path / "frontend")


def make_asset() -> MediaAsset:
    return MediaAsset(
        id="asset-1",
        original_name="source.mp4",
        stored_name="asset-1.mp4",
        url="/files/sources/asset-1.mp4",
        duration=30.0,
        width=2160,
        height=3840,
        fps=30.0,
        frame_count=900,
        has_audio=True,
        thumbnails=["/files/thumbnails/asset-1/0001.jpg"],
    )


def test_project_selection_persists_and_updates_in_place(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    database = Database(settings)
    project = database.create_project(ProjectCreate(name="My Character Dataset"))
    assert project.dataset_prefix == "my_character_dataset"

    asset = database.add_asset(project.id, make_asset())
    selection = database.create_selection(
        project.id,
        SelectionCreate(
            asset_id=asset.id,
            start_time=4.25,
            frame_count=124,
            profile_id="minimax-h3-diffsynth-fl2va",
            size_index=1,
            crop=CropRect(x=0.05, y=0.1, width=0.9, height=0.8),
            crop_scale=0.9,
        ),
    )
    assert selection.sequence == 1

    # Re-open the same SQLite file as a fresh Database instance: the project,
    # source and selection should all survive process/browser restarts.
    reopened = Database(settings)
    workspace = reopened.get_workspace(project.id)
    assert workspace.project.name == "My Character Dataset"
    assert workspace.sources[0].id == asset.id
    assert workspace.selections[0].start_time == 4.25

    updated = reopened.update_selection(
        selection.id,
        SelectionUpdate(
            asset_id=asset.id,
            start_time=4.5,
            frame_count=124,
            profile_id="minimax-h3-diffsynth-fl2va",
            size_index=1,
            crop=CropRect(x=0.075, y=0.1, width=0.85, height=0.75555556),
            crop_scale=0.85,
        ),
    )
    assert updated.id == selection.id
    assert updated.sequence == 1
    assert updated.start_time == 4.5
    assert updated.crop_scale == 0.85

    second = reopened.create_selection(
        project.id,
        SelectionCreate(
            asset_id=asset.id,
            start_time=12.0,
            frame_count=90,
            profile_id="minimax-h3-diffsynth-fl2va",
            size_index=1,
            crop=CropRect(x=0.0, y=0.0, width=1.0, height=1.0),
            crop_scale=1.0,
        ),
    )
    assert second.sequence == 2


def test_project_prefixes_are_safe_and_unique(tmp_path: Path) -> None:
    database = Database(make_settings(tmp_path))
    first = database.create_project(ProjectCreate(name="Maeve / Dataset"))
    second = database.create_project(ProjectCreate(name="Maeve / Dataset"))

    assert first.dataset_prefix == "maeve_dataset"
    assert second.dataset_prefix == "maeve_dataset_2"
