# Videoz

Videoz is a model-aware visual editor for preparing image and video training datasets. The first vertical slice supports importing a source video, probing its metadata, selecting a trainer profile, positioning a fixed-aspect crop, moving a model-sized temporal window, scrubbing within it, and exporting through FFmpeg.

## Current capabilities

- Browser-based video import and metadata probing.
- MiniMax H3, Wan 2.1, and SDXL frame-extraction profiles.
- Draggable, fixed-aspect crop overlay with adjustable crop scale.
- Fixed-frame timeline window derived from target FPS and frame count.
- Fast scrubbing inside the selected time range.
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

Interactive API documentation is available at `/docs`.

## Planned next steps

1. Persist projects and multiple selections per source.
2. Generate browser proxies and timeline thumbnail sprites.
3. Add asynchronous export jobs and progress reporting.
4. Add scene-cut detection and dataset quality checks.
5. Add cropped-clip captioning with Qwen3-VL.
6. Add optional GPU upscaling and subject tracking.
