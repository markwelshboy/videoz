# Videoz

Videoz is a model-aware visual editor for preparing image and video training datasets. It keeps source media non-destructive while persisting project, crop, timing, profile and export decisions so a dataset can be assembled over multiple browser or container sessions.

## Current capabilities

- Persistent projects backed by SQLite under `data/videoz.sqlite3`.
- Multiple source videos per project with browser-based import and metadata probing.
- Rotation-aware portrait and landscape preview geometry.
- MiniMax H3, Wan 2.1, and SDXL frame-extraction profiles.
- Automatic initial output-canvas orientation based on the source.
- Draggable, fixed-aspect crop overlay with coarse slider sizing and fine corner handles.
- Selected-source pixel dimensions shown directly on the crop overlay.
- Seconds-first capture-duration selection while preserving model/trainer frame-count rules.
- MiniMax shorter-duration choices aligned to the `17n+5` frame rule, while keeping 124 frames / 5.17 seconds as the default.
- FFmpeg-generated timeline preview filmstrip with 1× through 16× horizontal zoom.
- Selection-aware Play/Pause preview with optional looping at exact capture boundaries.
- Fast scrubbing inside the selected time range.
- Persistent project selections with stable sequence numbers.
- Load a saved selection, tweak it non-destructively, and update it in place only when explicitly requested.
- Active saved selection highlighting and dirty-state detection for unsaved edits.
- Loading another selection discards uncommitted editor tweaks without changing the saved record.
- Saved-selection markers on the active source timeline.
- Deterministic dataset output names such as `character_000001.mp4`, `character_000002.mp4`, and matching JSON sidecars.
- Per-project dataset directories under `data/datasets/<dataset-prefix>/`.
- Individual and sequential batch export from the original source using FFmpeg and Lanczos resizing.
- Browser-downloadable ZIP dataset packet containing exported media, JSON sidecars, future same-stem TXT captions, and a manifest.
- Docker image that builds the React UI and serves it from FastAPI.

## Project workflow

1. Create or open a project.
2. Choose a dataset prefix before saving the first selection.
3. Add one or more source videos to the project.
4. Position the crop and temporal selection, preview/loop it, then save the selection.
5. Continue creating selections across any source in the project.
6. Load a saved selection to review it. If you alter timing, crop, profile or output settings, Videoz marks it modified and exposes `Update selection`.
7. Choose `Update selection` to commit the changes, or simply load another selection to discard the temporary edit.
8. Export selections individually or with `Export all`.
9. Download the exported project dataset as a ZIP packet in the browser.

Saved selection sequence numbers are stable. Updating selection 12 keeps it as selection 12, and its deterministic export remains `<dataset-prefix>_000012.mp4`. Deleting a selection does not renumber later selections.

The dataset prefix is locked after the first selection is saved so existing sequence identities remain stable.

## Run with Docker

```bash
docker compose up --build
```

Open `http://localhost:8000`.

The compose file stores all durable state in `./data`:

```text
data/
├── videoz.sqlite3
├── sources/
├── thumbnails/
└── datasets/
    └── <dataset-prefix>/
        ├── <dataset-prefix>_000001.mp4
        ├── <dataset-prefix>_000001.json
        ├── <dataset-prefix>_000002.mp4
        └── <dataset-prefix>_000002.json
```

Because `./data` is bind-mounted into the container, projects and selections survive browser refreshes, container rebuilds and normal restarts.

## Local development

Requirements:

- Python 3.11+
- Node.js 22+
- FFmpeg and FFprobe

Backend:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

The Vite development server proxies `/api` and `/files` to FastAPI.

## API

- `GET /api/health`
- `GET /api/profiles`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`
- `PATCH /api/projects/{project_id}`
- `POST /api/projects/{project_id}/media/import`
- `POST /api/projects/{project_id}/selections`
- `PUT /api/selections/{selection_id}`
- `DELETE /api/selections/{selection_id}`
- `POST /api/selections/{selection_id}/export`
- `POST /api/exports`
- `POST /api/exports/bundle`

Interactive API documentation is available at `/docs`.

## Planned next steps

1. Add asynchronous preprocessing/export jobs with progress reporting.
2. Separate model, task/checkpoint, trainer, and resolution-tier configuration.
3. Add cropped-clip captioning with Qwen3-VL and editable persistent captions.
4. Add scene-cut detection and dataset quality checks.
5. Add optional GPU upscaling and subject tracking.
