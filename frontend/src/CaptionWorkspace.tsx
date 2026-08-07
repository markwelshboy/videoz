import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createCaptionDatasetBundle,
  createCaptionRecipe,
  fetchCaptionFrames,
  fetchCaptionJob,
  fetchCaptionProviders,
  fetchCaptionWorkspace,
  fetchProjects,
  generateCaptions,
  importCaptionVideo,
  patchCaptionAsset,
  updateCaptionRecipe,
  updateCaptionSettings,
} from './api'
import type {
  CaptionAsset,
  CaptionFrame,
  CaptionJob,
  CaptionProviderInfo,
  CaptionRecipe,
  CaptionRecipeInput,
  CaptionStatus,
  CaptionWorkspaceData,
  Project,
} from './types'

const LAST_CAPTION_PROJECT_KEY = 'videoz.caption-project'

type CaptionFilter = 'all' | CaptionStatus

function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return '0.00s'
  return `${value.toFixed(2)}s`
}

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function recipeToInput(recipe: CaptionRecipe, projectId?: string): CaptionRecipeInput {
  return {
    project_id: projectId,
    name: recipe.name,
    provider_id: recipe.provider_id,
    model: recipe.model,
    prompt: recipe.prompt,
    system_prompt: recipe.system_prompt,
    sample_mode: recipe.sample_mode,
    frame_count: recipe.frame_count,
    sample_fps: recipe.sample_fps,
    visual_detail: recipe.visual_detail,
    max_tokens: recipe.max_tokens,
    temperature: recipe.temperature,
    top_p: recipe.top_p,
    seed: recipe.seed,
  }
}

function CaptionCard(props: {
  asset: CaptionAsset
  triggerPhrase: string
  recipe?: CaptionRecipe
  job?: CaptionJob
  onChanged: (asset: CaptionAsset) => void
  onError: (message: string) => void
}) {
  const { asset, triggerPhrase, recipe, job, onChanged, onError } = props
  const [caption, setCaption] = useState(asset.caption_body)
  const [frames, setFrames] = useState<CaptionFrame[]>([])
  const [framesBusy, setFramesBusy] = useState(false)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    setCaption(asset.caption_body)
  }, [asset.caption_body])

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
  }, [])

  function queueCaptionSave(value: string) {
    setCaption(value)
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void patchCaptionAsset(asset.key, { caption_body: value })
        .then(onChanged)
        .catch((reason: Error) => onError(reason.message))
    }, 650)
  }

  async function loadFrames(times?: number[]) {
    setFramesBusy(true)
    try {
      const next = await fetchCaptionFrames(asset.key, {
        count: recipe?.sample_mode === 'fixed_count' ? recipe.frame_count : Math.max(1, Math.min(64, Math.round(asset.duration * (recipe?.sample_fps ?? 2)))),
        times,
      })
      setFrames(next)
      onChanged(await patchCaptionAsset(asset.key, { frame_times: next.map((frame) => frame.time) }))
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Could not sample caption frames')
    } finally {
      setFramesBusy(false)
    }
  }

  async function nudgeFrame(index: number, direction: -1 | 1) {
    const current = frames.length ? frames : await fetchCaptionFrames(asset.key, { count: recipe?.frame_count ?? 8 })
    const frameStep = 1 / Math.max(asset.fps, 1)
    const times = current.map((frame, frameIndex) => frameIndex === index
      ? Math.max(0, Math.min(asset.duration - 0.001, frame.time + direction * frameStep))
      : frame.time)
    await loadFrames(times)
  }

  const effectiveCaption = [triggerPhrase.trim(), caption.trim()].filter(Boolean).join(' ')

  return (
    <article className={`caption-card status-${asset.status} ${asset.selected ? 'selected' : ''}`}>
      <div className="caption-card-header">
        <label className="caption-select">
          <input
            type="checkbox"
            checked={asset.selected}
            onChange={(event) => void patchCaptionAsset(asset.key, { selected: event.target.checked }).then(onChanged).catch((reason: Error) => onError(reason.message))}
          />
          Include
        </label>
        <span className={`caption-status ${asset.status}`}>{asset.status}</span>
      </div>

      <video src={asset.url} controls loop preload="metadata" playsInline />

      <div className="caption-meta">
        <strong>{asset.display_name}</strong>
        <span>{asset.width}×{asset.height} · {formatSeconds(asset.duration)} · {asset.fps.toFixed(2)} FPS</span>
      </div>

      <div className="caption-frame-controls">
        <button type="button" disabled={framesBusy} onClick={() => void loadFrames()}>
          {framesBusy ? 'Sampling…' : frames.length ? 'Resample frames' : 'Inspect model frames'}
        </button>
        {asset.frame_times.length > 0 && frames.length === 0 && (
          <button type="button" disabled={framesBusy} onClick={() => void loadFrames(asset.frame_times)}>Reload reviewed frames</button>
        )}
      </div>

      {frames.length > 0 && (
        <div className="caption-frames">
          {frames.map((frame) => (
            <div className="caption-frame" key={`${asset.key}-${frame.index}-${frame.time}`}>
              <img src={frame.url} alt={`Caption sample at ${frame.time.toFixed(2)} seconds`} />
              <div className="caption-frame-footer">
                <button type="button" title="One source frame earlier" onClick={() => void nudgeFrame(frame.index, -1)}>‹</button>
                <span>{frame.time.toFixed(2)}s</span>
                <button type="button" title="One source frame later" onClick={() => void nudgeFrame(frame.index, 1)}>›</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="caption-editor">
        {triggerPhrase.trim() && <span className="trigger-chip">{triggerPhrase.trim()}</span>}
        <textarea
          value={caption}
          placeholder="Caption will appear here…"
          onChange={(event) => queueCaptionSave(event.target.value)}
        />
        <div className="caption-effective" title="Exact text written to the training .txt file">{effectiveCaption || 'No caption yet'}</div>
      </div>

      <div className="caption-card-footer">
        {job && (
          <div className={`caption-job ${job.status}`}>
            <span>{job.status === 'running' ? `Generating ${Math.round(job.progress * 100)}%` : job.status}</span>
            {job.error && <small>{job.error}</small>}
          </div>
        )}
        {asset.caption_body && asset.status !== 'reviewed' && (
          <button
            type="button"
            className="review-button"
            onClick={() => void patchCaptionAsset(asset.key, { status: 'reviewed' }).then(onChanged).catch((reason: Error) => onError(reason.message))}
          >
            Mark reviewed
          </button>
        )}
      </div>
    </article>
  )
}

export default function CaptionWorkspace() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState(() => window.localStorage.getItem(LAST_CAPTION_PROJECT_KEY) ?? '')
  const [workspace, setWorkspace] = useState<CaptionWorkspaceData | null>(null)
  const [providers, setProviders] = useState<CaptionProviderInfo[]>([])
  const [recipeId, setRecipeId] = useState('')
  const [recipeDraft, setRecipeDraft] = useState<CaptionRecipeInput | null>(null)
  const [triggerDraft, setTriggerDraft] = useState('')
  const [filter, setFilter] = useState<CaptionFilter>('all')
  const [jobs, setJobs] = useState<Record<string, CaptionJob>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void Promise.all([fetchProjects(), fetchCaptionProviders()])
      .then(([projectList, providerList]) => {
        setProjects(projectList)
        setProviders(providerList)
        const preferred = projectList.find((item) => item.id === projectId) ?? projectList[0]
        if (preferred) setProjectId(preferred.id)
      })
      .catch((reason: Error) => setError(reason.message))
  }, [])

  useEffect(() => {
    if (!projectId) return
    window.localStorage.setItem(LAST_CAPTION_PROJECT_KEY, projectId)
    void reloadWorkspace(projectId)
  }, [projectId])

  useEffect(() => {
    if (!workspace) return
    const chosen = workspace.recipes.find((item) => item.id === recipeId) ?? workspace.recipes[0]
    if (chosen) {
      setRecipeId(chosen.id)
      setRecipeDraft(recipeToInput(chosen, chosen.project_id))
    }
    setTriggerDraft(workspace.settings.trigger_phrase)
  }, [workspace?.project.id])

  useEffect(() => {
    const active = Object.values(jobs).filter((job) => job.status === 'queued' || job.status === 'running')
    if (active.length === 0) return
    const timer = window.setInterval(() => {
      void Promise.all(active.map((job) => fetchCaptionJob(job.id)))
        .then((latest) => {
          setJobs((current) => {
            const next = { ...current }
            latest.forEach((job) => { next[job.asset_key] = job })
            return next
          })
          if (latest.some((job) => job.status === 'completed' || job.status === 'failed')) {
            void reloadWorkspace(projectId)
          }
        })
        .catch((reason: Error) => setError(reason.message))
    }, 900)
    return () => window.clearInterval(timer)
  }, [jobs, projectId])

  async function reloadWorkspace(id = projectId) {
    if (!id) return
    try {
      const data = await fetchCaptionWorkspace(id)
      setWorkspace(data)
      setTriggerDraft(data.settings.trigger_phrase)
      if (!recipeId || !data.recipes.some((item) => item.id === recipeId)) {
        const first = data.recipes[0]
        if (first) {
          setRecipeId(first.id)
          setRecipeDraft(recipeToInput(first, first.project_id))
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load caption workspace')
    }
  }

  function replaceAsset(updated: CaptionAsset) {
    setWorkspace((current) => current
      ? { ...current, assets: current.assets.map((item) => item.key === updated.key ? updated : item) }
      : current)
  }

  function chooseRecipe(id: string) {
    if (!workspace) return
    const recipe = workspace.recipes.find((item) => item.id === id)
    if (!recipe) return
    setRecipeId(id)
    setRecipeDraft(recipeToInput(recipe, recipe.project_id))
  }

  async function saveRecipe() {
    if (!workspace || !recipeDraft) return
    setBusy(true)
    setError('')
    try {
      const selectedRecipe = workspace.recipes.find((item) => item.id === recipeId)
      let saved: CaptionRecipe
      if (selectedRecipe?.project_id === workspace.project.id) {
        saved = await updateCaptionRecipe(selectedRecipe.id, { ...recipeDraft, project_id: workspace.project.id })
      } else {
        saved = await createCaptionRecipe({ ...recipeDraft, project_id: workspace.project.id, name: `${recipeDraft.name} copy` })
      }
      await reloadWorkspace()
      setRecipeId(saved.id)
      setRecipeDraft(recipeToInput(saved, saved.project_id))
      setNotice(`Saved recipe “${saved.name}”.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save recipe')
    } finally {
      setBusy(false)
    }
  }

  async function saveTrigger() {
    if (!workspace) return
    try {
      const settings = await updateCaptionSettings(workspace.project.id, triggerDraft)
      setWorkspace({ ...workspace, settings })
      setNotice('Trigger phrase saved. Existing caption bodies were not modified.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save trigger phrase')
    }
  }

  async function handleStandaloneUpload(file?: File) {
    if (!file || !workspace) return
    setBusy(true)
    setError('')
    try {
      await importCaptionVideo(workspace.project.id, file)
      await reloadWorkspace()
      setNotice(`Added ${file.name} to the caption workspace only.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Caption video import failed')
    } finally {
      setBusy(false)
    }
  }

  async function setVisibleSelection(value: boolean) {
    const visible = filteredAssets
    await Promise.all(visible.map((asset) => patchCaptionAsset(asset.key, { selected: value })))
    await reloadWorkspace()
  }

  async function generateSelected() {
    if (!workspace || !recipeId) return
    const selected = workspace.assets.filter((asset) => asset.selected)
    if (selected.length === 0) {
      setError('Select at least one caption asset first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await generateCaptions(workspace.project.id, selected.map((asset) => asset.key), recipeId)
      setJobs((current) => {
        const next = { ...current }
        result.jobs.forEach((job) => { next[job.asset_key] = job })
        return next
      })
      setNotice(`Queued ${result.jobs.length} caption job${result.jobs.length === 1 ? '' : 's'}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not queue captions')
    } finally {
      setBusy(false)
    }
  }

  async function downloadDatasetZip() {
    if (!workspace) return
    const included = workspace.assets.filter((asset) => asset.selected && asset.caption_body.trim())
    if (included.length === 0) {
      setError('Select at least one captioned clip for the dataset ZIP.')
      return
    }
    setBusy(true)
    try {
      const bundle = await createCaptionDatasetBundle(workspace.project.id, included.map((asset) => asset.key))
      triggerDownload(bundle.url, bundle.filename)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not build captioned dataset ZIP')
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo(() => {
    const assets = workspace?.assets ?? []
    return {
      all: assets.length,
      uncaptioned: assets.filter((asset) => asset.status === 'uncaptioned').length,
      new: assets.filter((asset) => asset.status === 'new').length,
      reviewed: assets.filter((asset) => asset.status === 'reviewed').length,
      edited: assets.filter((asset) => asset.status === 'edited').length,
      failed: assets.filter((asset) => asset.status === 'failed').length,
    }
  }, [workspace?.assets])

  const filteredAssets = useMemo(() => {
    const assets = workspace?.assets ?? []
    return filter === 'all' ? assets : assets.filter((asset) => asset.status === filter)
  }, [workspace?.assets, filter])

  const selectedRecipe = workspace?.recipes.find((item) => item.id === recipeId)
  const selectedProvider = providers.find((item) => item.id === recipeDraft?.provider_id)

  return (
    <main className="caption-shell">
      <header className="caption-topbar">
        <div>
          <div className="eyebrow">Dataset caption studio</div>
          <h1>Caption</h1>
          <p>Review the exact frames a fungible vision model will receive, generate captions in batches, edit them, and package paired clips + TXT files.</p>
        </div>
        <div className="caption-project-picker">
          <label htmlFor="caption-project">Project</label>
          <select id="caption-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </div>
      </header>

      {error && <div className="message error">{error}</div>}
      {notice && <div className="message neutral">{notice}</div>}

      {!workspace ? (
        <div className="caption-empty">Create a project in Capture first, then return here to caption its exported clips.</div>
      ) : (
        <>
          <section className="caption-settings-grid">
            <div className="caption-settings-card">
              <div className="caption-settings-title">
                <div>
                  <span className="label">Caption recipe</span>
                  <strong>Model + prompt + visual sampling</strong>
                </div>
                <button type="button" disabled={busy || !recipeDraft} onClick={() => void saveRecipe()}>
                  {selectedRecipe?.project_id === workspace.project.id ? 'Save recipe' : 'Save as project recipe'}
                </button>
              </div>

              <div className="caption-form-grid">
                <label>Saved recipe
                  <select value={recipeId} onChange={(event) => chooseRecipe(event.target.value)}>
                    {workspace.recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}{recipe.project_id ? '' : ' · global'}</option>)}
                  </select>
                </label>
                <label>Recipe name
                  <input value={recipeDraft?.name ?? ''} onChange={(event) => setRecipeDraft((current) => current ? { ...current, name: event.target.value } : current)} />
                </label>
                <label>Provider
                  <select
                    value={recipeDraft?.provider_id ?? 'mock'}
                    onChange={(event) => {
                      const provider = providers.find((item) => item.id === event.target.value)
                      setRecipeDraft((current) => current ? {
                        ...current,
                        provider_id: event.target.value,
                        model: provider?.default_model ?? current.model,
                      } : current)
                    }}
                  >
                    {providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.label}{provider.available ? '' : ' · unavailable'}</option>)}
                  </select>
                  {selectedProvider?.model_hint && <small>{selectedProvider.model_hint}</small>}
                  {selectedProvider?.reason && <small className="warning-copy">{selectedProvider.reason}</small>}
                </label>
                <label>Model
                  <input value={recipeDraft?.model ?? ''} onChange={(event) => setRecipeDraft((current) => current ? { ...current, model: event.target.value } : current)} />
                </label>
                <label>Frame sampling
                  <select value={recipeDraft?.sample_mode ?? 'fixed_count'} onChange={(event) => setRecipeDraft((current) => current ? { ...current, sample_mode: event.target.value as 'fixed_count' | 'fps' } : current)}>
                    <option value="fixed_count">Fixed frame count</option>
                    <option value="fps">Frames per second</option>
                  </select>
                </label>
                {recipeDraft?.sample_mode === 'fps' ? (
                  <label>Sample FPS
                    <input type="number" min="0.1" max="30" step="0.1" value={recipeDraft.sample_fps} onChange={(event) => setRecipeDraft({ ...recipeDraft, sample_fps: Number(event.target.value) })} />
                  </label>
                ) : (
                  <label>Frames per clip
                    <input type="number" min="1" max="64" value={recipeDraft?.frame_count ?? 8} onChange={(event) => recipeDraft && setRecipeDraft({ ...recipeDraft, frame_count: Number(event.target.value) })} />
                  </label>
                )}
                <label>Visual detail
                  <select value={recipeDraft?.visual_detail ?? 'standard'} onChange={(event) => setRecipeDraft((current) => current ? { ...current, visual_detail: event.target.value as 'low' | 'standard' | 'high' } : current)}>
                    <option value="low">Low</option>
                    <option value="standard">Standard</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>Max tokens
                  <input type="number" min="16" max="4096" value={recipeDraft?.max_tokens ?? 160} onChange={(event) => recipeDraft && setRecipeDraft({ ...recipeDraft, max_tokens: Number(event.target.value) })} />
                </label>
                <label>Temperature
                  <input type="number" min="0" max="2" step="0.05" value={recipeDraft?.temperature ?? 0.4} onChange={(event) => recipeDraft && setRecipeDraft({ ...recipeDraft, temperature: Number(event.target.value) })} />
                </label>
                <label>Top P
                  <input type="number" min="0.05" max="1" step="0.05" value={recipeDraft?.top_p ?? 0.8} onChange={(event) => recipeDraft && setRecipeDraft({ ...recipeDraft, top_p: Number(event.target.value) })} />
                </label>
                <label>Seed
                  <input type="number" placeholder="random" value={recipeDraft?.seed ?? ''} onChange={(event) => recipeDraft && setRecipeDraft({ ...recipeDraft, seed: event.target.value === '' ? undefined : Number(event.target.value) })} />
                </label>
              </div>

              <label className="caption-prompt-field">Prompt
                <textarea value={recipeDraft?.prompt ?? ''} onChange={(event) => setRecipeDraft((current) => current ? { ...current, prompt: event.target.value } : current)} />
              </label>
              <details className="caption-advanced">
                <summary>Advanced instruction</summary>
                <label>System prompt
                  <textarea value={recipeDraft?.system_prompt ?? ''} onChange={(event) => setRecipeDraft((current) => current ? { ...current, system_prompt: event.target.value } : current)} />
                </label>
              </details>
            </div>

            <div className="caption-settings-card compact">
              <span className="label">Dataset caption prefix</span>
              <strong>Trigger phrase</strong>
              <p>Stored separately from generated caption bodies and prepended only in the effective training caption.</p>
              <input value={triggerDraft} placeholder="e.g. sH1VX" onChange={(event) => setTriggerDraft(event.target.value)} />
              <button type="button" disabled={triggerDraft === workspace.settings.trigger_phrase} onClick={() => void saveTrigger()}>Save trigger</button>

              <div className="caption-settings-divider" />
              <span className="label">Caption-only media</span>
              <strong>Add already-cropped clip</strong>
              <p>This video is added to Caption without becoming a Capture source.</p>
              <label className={`import-button caption-upload ${busy ? 'disabled' : ''}`}>
                <input type="file" accept="video/*" disabled={busy} onChange={(event) => void handleStandaloneUpload(event.target.files?.[0])} />
                + Add cropped video
              </label>
            </div>
          </section>

          <section className="caption-toolbar">
            <div className="caption-filters">
              {(['all', 'uncaptioned', 'new', 'reviewed', 'edited', 'failed'] as CaptionFilter[]).map((name) => (
                <button type="button" key={name} className={filter === name ? 'active' : ''} onClick={() => setFilter(name)}>
                  {name} <span>{counts[name]}</span>
                </button>
              ))}
            </div>
            <div className="caption-batch-actions">
              <button type="button" onClick={() => void setVisibleSelection(true)}>Select visible</button>
              <button type="button" onClick={() => void setVisibleSelection(false)}>Clear visible</button>
              <button type="button" className="caption-generate" disabled={busy || !recipeId} onClick={() => void generateSelected()}>Generate selected</button>
              <button type="button" className="caption-download" disabled={busy} onClick={() => void downloadDatasetZip()}>Download clips + captions ZIP</button>
            </div>
          </section>

          {workspace.assets.length === 0 ? (
            <div className="caption-empty">
              No captionable videos yet. Export one or more Capture selections, or add an already-cropped video above.
            </div>
          ) : (
            <section className="caption-grid">
              {filteredAssets.map((asset) => (
                <CaptionCard
                  key={asset.key}
                  asset={asset}
                  triggerPhrase={workspace.settings.trigger_phrase}
                  recipe={selectedRecipe}
                  job={jobs[asset.key]}
                  onChanged={replaceAsset}
                  onError={setError}
                />
              ))}
            </section>
          )}
        </>
      )}
    </main>
  )
}
