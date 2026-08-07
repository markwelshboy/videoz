import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createExport, fetchProfiles, importMedia } from './api'
import type { CropRect, ExportResult, MediaAsset, OutputSize, TrainingProfile } from './types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00.000'
  const mins = Math.floor(seconds / 60)
  const secs = seconds - mins * 60
  return `${mins.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`
}

function calculateCrop(asset: MediaAsset, size: OutputSize, scale: number): CropRect {
  const sourceAspect = asset.width / asset.height
  const targetAspect = size.width / size.height
  let width: number
  let height: number

  if (targetAspect >= sourceAspect) {
    width = scale
    height = scale * sourceAspect / targetAspect
  } else {
    height = scale
    width = scale * targetAspect / sourceAspect
  }

  return {
    width,
    height,
    x: (1 - width) / 2,
    y: (1 - height) / 2,
  }
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const [profiles, setProfiles] = useState<TrainingProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [sizeIndex, setSizeIndex] = useState(0)
  const [frameCount, setFrameCount] = useState(1)
  const [asset, setAsset] = useState<MediaAsset | null>(null)
  const [cropScale, setCropScale] = useState(0.9)
  const [crop, setCrop] = useState<CropRect>({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 })
  const [startTime, setStartTime] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ExportResult | null>(null)

  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0]
  const outputSize = profile?.sizes[sizeIndex] ?? profile?.sizes[0]
  const selectionDuration = profile ? frameCount / profile.fps : 0
  const maximumStart = Math.max(0, (asset?.duration ?? 0) - selectionDuration)
  const selectionWidth = asset?.duration ? Math.min(100, selectionDuration / asset.duration * 100) : 0
  const selectionLeft = asset?.duration ? startTime / asset.duration * 100 : 0
  const cropPixels = useMemo(() => {
    if (!asset) return null
    return {
      width: Math.round(asset.width * crop.width),
      height: Math.round(asset.height * crop.height),
    }
  }, [asset, crop])

  useEffect(() => {
    fetchProfiles()
      .then((items) => {
        setProfiles(items)
        if (items[0]) {
          setProfileId(items[0].id)
          setFrameCount(items[0].frame_options[0])
        }
      })
      .catch((reason: Error) => setError(reason.message))
  }, [])

  useEffect(() => {
    if (!profile) return
    setSizeIndex(0)
    setFrameCount(profile.frame_options[0])
    setStartTime(0)
    setPlayhead(0)
  }, [profileId])

  useEffect(() => {
    if (!asset || !outputSize) return
    setCrop(calculateCrop(asset, outputSize, cropScale))
  }, [asset, outputSize, cropScale])

  useEffect(() => {
    if (startTime > maximumStart) setStartTime(maximumStart)
    setPlayhead((current) => clamp(current, startTime, Math.min(asset?.duration ?? 0, startTime + selectionDuration)))
  }, [maximumStart, selectionDuration, startTime, asset?.duration])

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const imported = await importMedia(file)
      setAsset(imported)
      setStartTime(0)
      setPlayhead(0)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  function seek(time: number) {
    const bounded = clamp(time, startTime, Math.min(asset?.duration ?? 0, startTime + selectionDuration))
    setPlayhead(bounded)
    if (videoRef.current) videoRef.current.currentTime = bounded
  }

  function beginCropDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!stageRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const initial = crop
    const bounds = stageRef.current.getBoundingClientRect()

    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / bounds.width
      const dy = (next.clientY - startY) / bounds.height
      setCrop({
        ...initial,
        x: clamp(initial.x + dx, 0, 1 - initial.width),
        y: clamp(initial.y + dy, 0, 1 - initial.height),
      })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function beginTimelineDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!timelineRef.current || !asset) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const initial = startTime
    const startX = event.clientX
    const width = timelineRef.current.getBoundingClientRect().width

    const move = (next: PointerEvent) => {
      const deltaSeconds = (next.clientX - startX) / width * asset.duration
      const nextStart = clamp(initial + deltaSeconds, 0, maximumStart)
      setStartTime(nextStart)
      setPlayhead(nextStart)
      if (videoRef.current) videoRef.current.currentTime = nextStart
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  async function handleExport() {
    if (!asset || !profile || !outputSize) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const exported = await createExport({
        asset,
        profileId: profile.id,
        mediaKind: profile.media_kind,
        startTime: profile.media_kind === 'image' ? playhead : startTime,
        fps: profile.fps,
        frames: frameCount,
        outputWidth: outputSize.width,
        outputHeight: outputSize.height,
        crop,
      })
      setResult(exported)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Dataset clip studio</div>
          <h1>Videoz</h1>
        </div>
        <label className={`import-button ${busy ? 'disabled' : ''}`}>
          <input type="file" accept="video/*" disabled={busy} onChange={(event) => handleFile(event.target.files?.[0])} />
          {busy && !asset ? 'Importing…' : 'Import video'}
        </label>
      </header>

      {error && <div className="message error">{error}</div>}
      {result && (
        <div className="message success">
          Exported <strong>{result.filename}</strong> · <a href={result.url} target="_blank">open file</a>
        </div>
      )}

      <section className="workspace">
        <div className="editor-column">
          <div className="viewer-card">
            {asset ? (
              <div className="video-stage" ref={stageRef} style={{ aspectRatio: `${asset.width} / ${asset.height}` }}>
                <video ref={videoRef} src={asset.url} preload="metadata" playsInline />
                <div className="shade top" style={{ height: `${crop.y * 100}%` }} />
                <div className="shade bottom" style={{ top: `${(crop.y + crop.height) * 100}%` }} />
                <div className="shade left" style={{ top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
                <div className="shade right" style={{ top: `${crop.y * 100}%`, left: `${(crop.x + crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
                <div
                  className="crop-box"
                  onPointerDown={beginCropDrag}
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.width * 100}%`,
                    height: `${crop.height * 100}%`,
                  }}
                >
                  <span>{outputSize?.width}×{outputSize?.height}</span>
                </div>
              </div>
            ) : (
              <div className="empty-viewer">
                <div className="empty-icon">▶</div>
                <h2>Import a source video</h2>
                <p>The original file remains untouched. Videoz stores crop and timeline decisions, then exports from the source.</p>
              </div>
            )}
          </div>

          <div className="timeline-card">
            <div className="timeline-heading">
              <div>
                <span className="label">Selection</span>
                <strong>{formatTime(startTime)} → {formatTime(Math.min(asset?.duration ?? selectionDuration, startTime + selectionDuration))}</strong>
              </div>
              <div className="timeline-stats">
                <span>{frameCount} frame{frameCount === 1 ? '' : 's'}</span>
                <span>{profile?.fps ?? 0} FPS</span>
                <span>{selectionDuration.toFixed(3)} sec</span>
              </div>
            </div>
            <div className="timeline" ref={timelineRef}>
              <div className="timeline-ruler" />
              {asset && (
                <div
                  className="selection-window"
                  onPointerDown={beginTimelineDrag}
                  style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
                >
                  <div className="selection-grip left-grip" />
                  <div className="selection-grip right-grip" />
                  <div
                    className="playhead"
                    style={{ left: `${selectionDuration ? (playhead - startTime) / selectionDuration * 100 : 0}%` }}
                  />
                </div>
              )}
            </div>
            <div className="scrub-row">
              <span>{formatTime(startTime)}</span>
              <input
                aria-label="Scrub selected clip"
                type="range"
                min={startTime}
                max={Math.max(startTime, Math.min(asset?.duration ?? selectionDuration, startTime + selectionDuration))}
                step="0.001"
                value={playhead}
                disabled={!asset}
                onChange={(event) => seek(Number(event.target.value))}
              />
              <span>{formatTime(Math.min(asset?.duration ?? selectionDuration, startTime + selectionDuration))}</span>
            </div>
          </div>
        </div>

        <aside className="controls-card">
          <div className="control-section">
            <div className="section-number">01</div>
            <div className="control-content">
              <label htmlFor="profile">Training profile</label>
              <select id="profile" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                {profiles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              {profile?.notes && <p className="hint">{profile.notes}</p>}
            </div>
          </div>

          <div className="control-section">
            <div className="section-number">02</div>
            <div className="control-content">
              <label htmlFor="size">Output canvas</label>
              <select id="size" value={sizeIndex} onChange={(event) => setSizeIndex(Number(event.target.value))}>
                {profile?.sizes.map((size, index) => <option key={`${size.width}x${size.height}`} value={index}>{size.label}</option>)}
              </select>
              <div className="range-label">
                <label htmlFor="crop-scale">Crop scale</label>
                <span>{Math.round(cropScale * 100)}%</span>
              </div>
              <input id="crop-scale" type="range" min="0.25" max="1" step="0.01" value={cropScale} onChange={(event) => setCropScale(Number(event.target.value))} />
              {cropPixels && asset && (
                <div className="metric-grid">
                  <span>Source crop<strong>{cropPixels.width}×{cropPixels.height}</strong></span>
                  <span>Output<strong>{outputSize?.width}×{outputSize?.height}</strong></span>
                  <span>Scale<strong>{((outputSize?.width ?? 1) / cropPixels.width).toFixed(2)}×</strong></span>
                  <span>Source<strong>{asset.width}×{asset.height}</strong></span>
                </div>
              )}
            </div>
          </div>

          <div className="control-section">
            <div className="section-number">03</div>
            <div className="control-content">
              <label htmlFor="frames">Capture length</label>
              <select id="frames" value={frameCount} onChange={(event) => setFrameCount(Number(event.target.value))}>
                {profile?.frame_options.map((frames) => <option key={frames} value={frames}>{frames} frame{frames === 1 ? '' : 's'}</option>)}
              </select>
              {profile?.frame_rule && <p className="hint">Frame rule: {profile.frame_rule}</p>}
            </div>
          </div>

          <div className="source-summary">
            <span className="label">Source</span>
            <strong>{asset?.original_name ?? 'No video imported'}</strong>
            {asset && <p>{asset.width}×{asset.height} · {asset.fps.toFixed(3)} FPS · {formatTime(asset.duration)}</p>}
          </div>

          <button className="export-button" disabled={!asset || busy} onClick={handleExport}>
            {busy && asset ? 'Processing…' : profile?.media_kind === 'image' ? 'Export frame' : 'Export clip'}
          </button>
        </aside>
      </section>
    </main>
  )
}
