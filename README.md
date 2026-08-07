# Videoz

Videoz is a model-aware visual editor for preparing image and video training datasets. The current vertical slice supports importing a source video, probing its metadata, selecting a trainer profile, positioning and resizing a fixed-aspect crop, moving a model-sized temporal window, previewing that exact selection, saving multiple clip decisions, and exporting through FFmpeg.

## Current capabilities

- Browser-based video import and metadata probing.
- Rotation-aware portrait and landscape preview geometry.
- MiniMax H3, Wan 2.1, and SDXL frame-extraction profiles.
- Automatic initial output-canvas orientation based on the source.
- Draggable, fixed-aspect crop overlay with coarse slider sizing and fine corner handles.
- Selected-source pixel dimensions shown directly on the crop overlay.
- Seconds-first capture-duration selection while preserving model/trainer frame-count rules.
- MiniMax shorter-duration choices aligned to the `17n+5` frame rule, while keeping 124 frames / 5.17 seconds as the default.
- Fixed-frame timeline window derived from target FPS and frame count.
- FFmpeg-generated timeline preview filmstrip.
- 1× through 16× timeline zoom with horizontal scrolling.
- Selection-aware Play/Pause preview with optional looping at the exact capture boundaries.
- Fast scrubbing inside the selected time range.
- Session clip queue for saving multiple crops/time windows from one source.
- Saved-selection markers on the source timeline.
- Load, remove, individual export, and sequential batch export for queued clips.
- Browser-downloadable ZIP export packet containing exported media, JSON sidecars, any same-stem TXT captions, and a manifest.
- FFmpeg export from the original source.
- Docker image that builds the React UI and serves it from FastAPI.

## Run with Docker

```bash
docker compose up --build
```

Open `http://localhost:8000`.

The compose file stores source media and exports in `./data`:

```text
data/
├── sources/
├── thumbnails/
└── datasets/
```

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
- `POST /api/media/import`
- `POST /api/exports`
- `POST /api/exports/bundle`

Interactive API documentation is available at `/docs`.

## Planned next steps

1. Persist projects and clip selections across browser/server sessions.
2. Add dataset/project naming, destination management, and resumable editing.
3. Add asynchronous preprocessing/export jobs and progress reporting.
4. Separate model, task/checkpoint, trainer, and resolution-tier configuration.
5. Add scene-cut detection and dataset quality checks.
6. Add cropped-clip captioning with Qwen3-VL.
7. Add optional GPU upscaling and subject tracking.
