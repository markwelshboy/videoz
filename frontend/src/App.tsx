import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createExport, fetchProfiles, importMedia } from './api'
import type { CropRect, ExportResult, MediaAsset, OutputSize, TrainingProfile } from './types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const TIMELINE_ZOOM_LEVELS = [1, 2, 4, 8, 16]
const MIN_CROP_SCALE = 0.25

type CropHandle = 'nw' | 'ne' | 'sw' | 'se'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00.000'
  const mins = Math.floor(seconds / 60)
  const secs = seconds - mins * 60
  return `${mins.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`
}

function formatDurationChoice(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0 sec'
  if (Math.abs(seconds - Math.round(seconds)) < 0.005) return `${Math.round(seconds)} sec`
  return `${seconds.toFixed(2)} sec`
}

function defaultFrameCount(profile: TrainingProfile): number {
  return profile.default_frames ?? profile.frame_options[0] ?? 1
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

function cropAtScale(asset: MediaAsset, size: OutputSize, current: CropRect, scale: number): CropRect {
  const dimensions = calculateCrop(asset, size, scale)
  const centerX = current.x + current.width / 2
  const centerY = current.y + current.height / 2

  return {
    ...dimensions,
    x: clamp(centerX - dimensions.width / 2, 0, 1 - dimensions.width),
    y: clamp(centerY - dimensions.height / 2, 0, 1 - dimensions.height),
  }
}

function closestSizeIndex(profile: TrainingProfile, asset: MediaAsset): number {
  const sourceAspect = asset.width / asset.height
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  profile.sizes.forEach((size, index) => {
    const targetAspect = size.width / size.height
    const distance = Math.abs(Math.log(targetAspect / sourceAspect))
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })

  return bestIndex
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineViewportRef = useRef<HTMLDivElement>(null)
  const [profiles, setProfiles] = useState<TrainingProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [sizeIndex, setSizeIndex] = useState(0)
  const [frameCount, setFrameCount] = useState(1)
  const [asset, setAsset] = useState<MediaAsset | null>(null)
  const [cropScale, setCropScale] = useState(1)
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 })
  const [startTime, setStartTime] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [timelineZoom, setTimelineZoom] = useState(1)
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
  const resizeFactor = cropPixels && outputSize ? outputSize.width / cropPixels.width : null
  const resizeLabel = resizeFactor === null
    ? ''
    : resizeFactor > 1.005
      ? `↑ ${resizeFactor.toFixed(2)}×`
      : resizeFactor < 0.995
        ? `↓ ${resizeFactor.toFixed(2)}×`
        : '1.00×'

  useEffect(() => {
    fetchProfiles()
      .then((items) => {
        setProfiles(items)
        if (items[0]) {
          setProfileId(items[0].id)
          setFrameCount(defaultFrameCount(items[0]))
        }
      })
      .catch((reason: Error) => setError(reason.message))
  }, [])

  useEffect(() => {
    if (!profile) return
    setSizeIndex(asset ? closestSizeIndex(profile, asset) : 0)
    setFrameCount(defaultFrameCount(profile))
    setStartTime(0)
    setPlayhead(0)
    setTimelineZoom(1)
  }, [profileId])

  useEffect(() => {
    if (!asset || !outputSize) return
    setCropScale(1)
    setCrop(calculateCrop(asset, outputSize, 1))
  }, [asset?.id, outputSize?.width, outputSize?.height])

  useEffect(() => {
    if (startTime > maximumStart) setStartTime(maximumStart)
    setPlayhead((current) => clamp(current, startTime, Math.min(asset?.duration ?? 0, startTime + selectionDuration)))
  }, [maximumStart, selectionDuration, startTime, asset?.duration])

  useEffect(() => {
    if (!asset || !timelineViewportRef.current || !timelineRef.current) return
    const frame = window.requestAnimationFrame(() => {
      const viewport = timelineViewportRef.current
      const content = timelineRef.current
      if (!viewport || !content || asset.duration <= 0) return
      const centerTime = startTime + selectionDuration / 2
      const centerRatio = clamp(centerTime / asset.duration, 0, 1)
      const target = centerRatio * content.getBoundingClientRect().width - viewport.clientWidth / 2
      const maxScroll = Math.max(0, content.getBoundingClientRect().width - viewport.clientWidth)
      viewport.scrollLeft = clamp(target, 0, maxScroll)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [timelineZoom, asset?.id])

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const imported = await importMedia(file)
      setAsset(imported)
      if (profile) setSizeIndex(closestSizeIndex(profile, imported))
      setStartTime(0)
      setPlayhead(0)
      setTimelineZoom(1)
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

  function handleCropScaleChange(nextScale: number) {
    const bounded = clamp(nextScale, MIN_CROP_SCALE, 1)
    setCropScale(bounded)
    if (!asset || !outputSize) return
    setCrop((current) => cropAtScale(asset, outputSize, current, bounded))
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

  function beginCropResize(event: ReactPointerEvent<HTMLDivElement>, handle: CropHandle) {
    if (!stageRef.current || !asset || !outputSize) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const bounds = stageRef.current.getBoundingClientRect()
    const initial = crop
    const growsRight = handle === 'ne' || handle === 'se'
    const growsDown = handle === 'sw' || handle === 'se'
    const anchorX = growsRight ? initial.x : initial.x + initial.width
    const anchorY = growsDown ? initial.y : initial.y + initial.height
    const sourceAspect = asset.width / asset.height
    const targetAspect = outputSize.width / outputSize.height
    const normalizedAspect = targetAspect / sourceAspect
    const fullCrop = calculateCrop(asset, outputSize, 1)
    const minimumHeight = fullCrop.height * MIN_CROP_SCALE
    const maximumWidth = growsRight ? 1 - anchorX : anchorX
    const maximumHeight = growsDown ? 1 - anchorY : anchorY
    const maximumAspectHeight = Math.min(maximumHeight, maximumWidth / normalizedAspect)

    const move = (next: PointerEvent) => {
      const pointerX = clamp((next.clientX - bounds.left) / bounds.width, 0, 1)
      const pointerY = clamp((next.clientY - bounds.top) / bounds.height, 0, 1)
      const desiredWidth = Math.abs(pointerX - anchorX)
      const desiredHeight = Math.abs(pointerY - anchorY)
      const projectedHeight = (normalizedAspect * desiredWidth + desiredHeight) / (normalizedAspect * normalizedAspect + 1)
      const height = clamp(projectedHeight, minimumHeight, maximumAspectHeight)
      const width = height * normalizedAspect
      const nextCrop: CropRect = {
        x: growsRight ? anchorX : anchorX - width,
        y: growsDown ? anchorY : anchorY - height,
        width,
        height,
      }
      setCrop(nextCrop)
      setCropScale(clamp(width / fullCrop.width, MIN_CROP_SCALE, 1))
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
    event.stopPropagation()
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

  function positionSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!timelineRef.current || !asset || asset.duration <= 0) return
    const bounds = timelineRef.current.getBoundingClientRect()
    const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1)
    const nextStart = clamp(ratio * asset.duration - selectionDuration / 2, 0, maximumStart)
    setStartTime(nextStart)
    setPlayhead(nextStart)
    if (videoRef.current) videoRef.current.currentTime = nextStart
  }

  function adjustTimelineZoom(direction: -1 | 1) {
    const currentIndex = TIMELINE_ZOOM_LEVELS.indexOf(timelineZoom)
    const nextIndex = clamp(currentIndex + direction, 0, TIMELINE_ZOOM_LEVELS.length - 1)
    setTimelineZoom(TIMELINE_ZOOM_LEVELS[nextIndex])
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
              <div
                className="video-stage"
                ref={stageRef}
                style={{
                  aspectRatio: `${asset.width} / ${asset.height}`,
                  width: `min(100%, calc(68vh * ${asset.width / asset.height}))`,
                }}
              >
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
                  <span>{cropPixels ? `${cropPixels.width}×${cropPixels.height}` : 'Selected pixels'}</span>
                  <div className="crop-handle nw" onPointerDown={(event) => beginCropResize(event, 'nw')} />
                  <div className="crop-handle ne" onPointerDown={(event) => beginCropResize(event, 'ne')} />
                  <div className="crop-handle sw" onPointerDown={(event) => beginCropResize(event, 'sw')} />
                  <div className="crop-handle se" onPointerDown={(event) => beginCropResize(event, 'se')} />
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
                <span>{selectionDuration.toFixed(3)} sec</span>
                <span>{frameCount} frame{frameCount === 1 ? '' : 's'}</span>
                <span>{profile?.fps ?? 0} FPS</span>
              </div>
            </div>

            <div className="timeline-toolbar">
              <span>{asset?.thumbnails.length ? `${asset.thumbnails.length} source previews` : 'Timeline preview'}</span>
              <div className="zoom-control">
                <button type="button" disabled={!asset || timelineZoom === TIMELINE_ZOOM_LEVELS[0]} onClick={() => adjustTimelineZoom(-1)} aria-label="Zoom timeline out">−</button>
                <strong>{timelineZoom}×</strong>
                <button type="button" disabled={!asset || timelineZoom === TIMELINE_ZOOM_LEVELS[TIMELINE_ZOOM_LEVELS.length - 1]} onClick={() => adjustTimelineZoom(1)} aria-label="Zoom timeline in">+</button>
              </div>
            </div>

            <div className="timeline-viewport" ref={timelineViewportRef}>
              <div
                className="timeline"
                ref={timelineRef}
                style={{ width: `${timelineZoom * 100}%` }}
                onPointerDown={positionSelection}
              >
                <div className="timeline-thumbnails" aria-hidden="true">
                  {asset?.thumbnails.map((thumbnail, index) => (
                    <img key={`${thumbnail}-${index}`} src={thumbnail} draggable={false} alt="" />
                  ))}
                </div>
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
            </div>
            <p className="timeline-hint">Click the filmstrip to jump the capture window. Drag the green window to refine it; zoom in for longer sources.</p>
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
          <div className="source-summary source-summary-top">
            <span className="label">Source</span>
            <strong>{asset?.original_name ?? 'No video imported'}</strong>
            {asset && <p>{asset.width}×{asset.height} · {asset.fps.toFixed(3)} FPS · {formatTime(asset.duration)}</p>}
          </div>

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
                <label htmlFor="crop-scale">Crop size</label>
                <span>{Math.round(cropScale * 100)}%</span>
              </div>
              <input
                id="crop-scale"
                type="range"
                min={MIN_CROP_SCALE}
                max="1"
                step="0.01"
                value={cropScale}
                onChange={(event) => handleCropScaleChange(Number(event.target.value))}
              />
              <p className="hint">100% is the largest crop at this output aspect ratio that fits the source. Use the slider for coarse sizing, then drag a corner for fine adjustment.</p>
              {cropPixels && asset && (
                <div className="metric-grid">
                  <span>Source<strong>{asset.width}×{asset.height}</strong></span>
                  <span>Selected<strong>{cropPixels.width}×{cropPixels.height}</strong></span>
                  <span>Output<strong>{outputSize?.width}×{outputSize?.height}</strong></span>
                  <span>Scale<strong>{resizeLabel}</strong></span>
                </div>
              )}
            </div>
          </div>

          <div className="control-section">
            <div className="section-number">03</div>
            <div className="control-content">
              <label htmlFor="frames">Capture duration</label>
              <select id="frames" value={frameCount} onChange={(event) => setFrameCount(Number(event.target.value))}>
                {profile?.frame_options.map((frames) => (
                  <option key={frames} value={frames}>
                    {profile.media_kind === 'image' ? 'Single frame' : `${formatDurationChoice(frames / profile.fps)} · ${frames} frames`}
                  </option>
                ))}
              </select>
              {profile?.frame_rule
                ? <p className="hint">Seconds-first selection; exact duration snaps to valid {profile.frame_rule} frame counts at {profile.fps} FPS.</p>
                : profile?.media_kind === 'video' && <p className="hint">Seconds are derived from the exact exported frame count at {profile.fps} FPS.</p>}
            </div>
          </div>

          <button className="export-button" disabled={!asset || busy} onClick={handleExport}>
            {busy && asset ? 'Processing…' : profile?.media_kind === 'image' ? 'Export frame' : 'Export clip'}
          </button>
        </aside>
      </section>
    </main>
  )
}
