# Videoz

Videoz is a model-aware visual editor for preparing image and video training datasets. It keeps source media non-destructive while persisting project, crop, timing, profile, caption and export decisions so a dataset can be assembled over multiple browser or container sessions.

## Workflow

Videoz now has two deliberately decoupled workspaces:

- **Capture** — choose source material, model-aware timing, crop and export geometry.
- **Caption** — review exported clips or separately uploaded already-cropped videos, inspect exact VLM frames, generate/edit captions and package a training dataset.

This separation keeps vision-model inference fungible: Capture does not know or care whether captioning later uses a local Qwen3-VL server, OpenRouter, or another provider.

## Capture capabilities

- Persistent projects backed by SQLite under `data/videoz.sqlite3`.
- Multiple source videos per project with browser-based import and metadata probing.
- Rotation-aware portrait and landscape preview geometry.
- MiniMax H3, Wan 2.1, and SDXL frame-extraction profiles.
- Draggable fixed-aspect crop overlay with coarse slider sizing and fine corner handles.
- Seconds-first capture-duration selection while preserving model/trainer frame-count rules.
- FFmpeg-generated timeline preview filmstrip with 1× through 16× horizontal zoom.
- Selection-aware Play/Pause preview with optional looping at exact capture boundaries.
- Persistent selections with stable sequence numbers and in-place update semantics.
- Deterministic output names such as `character_000001.mp4` with matching JSON sidecars.
- Individual and sequential batch export from the original source using FFmpeg and Lanczos resizing.

## Caption capabilities

- Separate Caption tab operating on project exports rather than capture-time state.
- Add already-cropped caption-only videos without adding them as Capture sources.
- Loop/play each candidate clip and include/exclude arbitrary subsets.
- Filter by `uncaptioned`, `new`, `reviewed`, `edited`, or `failed` state.
- Persistent autosaved caption boxes.
- Dataset trigger phrase stored separately from caption bodies and prepended only to the effective `.txt` caption.
- Exact frame-sampling preview before VLM generation.
- Fixed-frame-count or FPS-based visual sampling.
- Individual sampled frames can be nudged exactly one source frame earlier/later before generation.
- Saved caption recipes containing provider/model, prompt/system prompt, sampling configuration and generation settings.
- Caption generation jobs run independently per asset, allowing cards to complete/update separately.
- New model-generated captions are highlighted for review.
- Regeneration creates caption-version history rather than discarding generation metadata.
- Captioned dataset ZIP export containing paired video + `.txt` files and a manifest.

## Caption providers

The captioning boundary is OpenAI-compatible on purpose.

### Mock provider

Always enabled. It produces a placeholder caption so the complete UI, frame review, job, persistence and ZIP workflow can be tested without a GPU or API key.

### Local / OpenAI-compatible VLM

Set:

```bash
VIDEOZ_VLM_BASE_URL=http://your-vlm-server:8000/v1
VIDEOZ_VLM_DEFAULT_MODEL=Qwen/Qwen3-VL-8B-Instruct
```

Optionally:

```bash
VIDEOZ_VLM_API_KEY=...
```

This is intended for Qwen3-VL behind vLLM or any other server exposing an OpenAI-compatible multimodal `/chat/completions` endpoint.

### OpenRouter

Set:

```bash
VIDEOZ_OPENROUTER_API_KEY=sk-or-v1-...
```

The UI defaults to the current OpenRouter Qwen3-VL 8B Instruct model slug:

```text
qwen/qwen3-vl-8b-instruct
```

The model field remains editable, so any vision-capable OpenRouter model can be used without changing Videoz.

## Caption recipe controls

Recipes currently persist:

- provider
- model
- user prompt
- system prompt
- fixed-frame-count vs FPS sampling
- frame count / sample FPS
- visual-detail tier
- max output tokens
- temperature
- top-p
- optional seed

The current first implementation sends the exact reviewed JPEG frame set displayed in the Caption UI to OpenAI-compatible providers. More provider-specific controls can be added behind the same recipe/provider interface later without coupling the UI to one VLM.

## Project workflow

1. Create/open a project in Capture.
2. Add one or more source videos.
3. Save and export useful selections.
4. Switch to Caption.
5. Select the same project; exported MP4 selections appear automatically.
6. Optionally add already-cropped videos directly to Caption.
7. Choose/adjust a caption recipe and trigger phrase.
8. Inspect the frames to be sent to the VLM; nudge weak/blurry samples when needed.
9. Generate captions for any selected subset.
10. Review/edit captions; edits autosave.
11. Download the selected captioned clips as a paired video/TXT ZIP dataset.

## Run with Docker

```bash
docker compose up --build
```

Open `http://localhost:8000`.

Provider environment values can be placed in a local `.env` file; Docker Compose forwards the Videoz caption-provider variables into the container.

The compose file stores all durable state in `./data`:

```text
data/
├── videoz.sqlite3
├── sources/
├── thumbnails/
├── caption_frames/
└── datasets/
    └── <dataset-prefix>/
        ├── <dataset-prefix>_000001.mp4
        ├── <dataset-prefix>_000001.json
        ├── <dataset-prefix>_000001.txt
        └── ...
```

Because `./data` is bind-mounted into the container, projects, selections, captions, recipes and caption versions survive browser refreshes, container rebuilds and normal restarts.

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

Core project/capture endpoints remain under `/api/projects`, `/api/selections`, and `/api/exports`.

Caption endpoints include:

- `GET /api/caption/providers`
- `GET /api/projects/{project_id}/caption`
- `PUT /api/projects/{project_id}/caption/settings`
- `POST /api/projects/{project_id}/caption/import`
- `PATCH /api/caption/assets/{asset_key}`
- `POST /api/caption/assets/{asset_key}/frames`
- `GET /api/caption/assets/{asset_key}/versions`
- `POST /api/caption/recipes`
- `PUT /api/caption/recipes/{recipe_id}`
- `POST /api/caption/jobs`
- `GET /api/caption/jobs/{job_id}`
- `POST /api/projects/{project_id}/caption/bundle`

Interactive API documentation is available at `/docs`.

## Planned next steps

1. Move caption execution from in-process background threads to a dedicated durable worker/queue while keeping the existing job API.
2. Add dynamic provider/model discovery and provider-specific advanced controls.
3. Make visual-detail presets directly control sampled-frame pixel budgets for each VLM provider.
4. Add blur/sharpness warnings and motion-aware frame suggestions.
5. Add caption version comparison/revert UI.
6. Separate model, task/checkpoint, trainer, and resolution-tier configuration in Capture.
7. Add scene-cut detection, dataset quality checks, optional GPU upscaling, and subject tracking.
