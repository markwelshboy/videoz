import zipfile

from app.archive import create_export_bundle
from app.config import Settings
from app.models import ExportBundleRequest


def test_export_bundle_includes_media_sidecars_caption_and_manifest(tmp_path):
    settings = Settings(data_dir=tmp_path, frontend_dir=tmp_path / "frontend")
    settings.ensure_directories()

    media = settings.datasets_dir / "clip_1234.mp4"
    sidecar = settings.datasets_dir / "clip_1234.json"
    caption = settings.datasets_dir / "clip_1234.txt"
    media.write_bytes(b"video")
    sidecar.write_text('{"profile":"test"}', encoding="utf-8")
    caption.write_text("a training caption", encoding="utf-8")

    result = create_export_bundle(
        ExportBundleRequest(filenames=[media.name], name="Source Video.mp4"),
        settings,
    )

    assert result.filename.startswith("Source_Video_videoz_")
    assert result.filename.endswith(".zip")
    bundle = settings.datasets_dir / result.filename
    assert bundle.is_file()

    with zipfile.ZipFile(bundle) as archive:
        names = set(archive.namelist())

    assert {media.name, sidecar.name, caption.name, "manifest.json"} <= names
