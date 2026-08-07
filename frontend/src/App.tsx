import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  createExport,
  createProject as createProjectApi,
  createSavedSelection,
  deleteSavedSelection,
  exportSavedSelection,
  fetchProfiles,
  fetchProjects,
  fetchProjectWorkspace,
  importProjectMedia,
  syncExportSession,
  updateProject as updateProjectApi,
  updateSavedSelection,
} from './api'
import type {
  CropRect,
  ExportResult,
  MediaAsset,
  OutputSize,
  Project,
  ProjectWorkspace,
  SavedSelection,
  SelectionInput,
  TrainingProfile,
} from './types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const TIMELINE_ZOOM_LEVELS = [1, 2, 4, 8, 16]
const MIN_CROP_SCALE = 0.25
const EPSILON = 0.00001

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

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON
}

function sameCrop(a: CropRect, b: CropRect): boolean {
  return closeEnough(a.x, b.x)
    && closeEnough(a.y, b.y)
    && closeEnough(a.width, b.width)
    && closeEnough(a.height, b.height)
}

function selectionMatchesInput(saved: SavedSelection, input: SelectionInput | null): boolean {
  if (!input) return false
  return saved.asset_id === input.asset_id
    && closeEnough(saved.start_time, input.start_time)
    && saved.frame_count === input.frame_count
    && saved.profile_id === input.profile_id
    && saved.size_index === input.size_index
    && closeEnough(saved.crop_scale, input.crop_scale)
    && sameCrop(saved.crop, input.crop)
}

function exportedFilenames(workspace: ProjectWorkspace): string[] {
  return workspace.selections
    .map((selection) => selection.export_filename)
    .filter((filename): filename is string => Boolean(filename))
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineViewportRef = useRef<HTMLDivElement>(null)
  const skipProfileResetRef = useRef(false)
  const skipCropResetRef = useRef(false)

  const [profiles, setProfiles] = useState<TrainingProfile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null)
  const [asset, setAsset] = useState<MediaAsset | null>(null)
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(null)

  const [profileId, setProfileId] = useState('')
  const [sizeIndex, setSizeIndex] = useState(0)
  const [frameCount, setFrameCount] = useState(1)
  const [cropScale, setCropScale] = useState(1)
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 })
  const [startTime, setStartTime] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [timelineZoom, setTimelineZoom] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loopSelection, setLoopSelection] = useState(true)

  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [projectPrefixDraft, setProjectPrefixDraft] = useState('')
  const [showProjectCreator, setShowProjectCreator] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectPrefix, setNewProjectPrefix] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ExportResult | null>(null)
  const [queueNotice, setQueueNotice] = useState('')

  const project = workspace?.project ?? null
  const savedSelections = workspace?.selections ?? []
  const activeSelection = activeSelectionId
    ? savedSelections.find((item) => item.id === activeSelectionId) ?? null
    : null
  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0]
  const outputSize = profile?.sizes[sizeIndex] ?? profile?.sizes[0]
  const selectionDuration = profile ? frameCount / profile.fps : 0
  const selectionEnd = Math.min(asset?.duration ?? selectionDuration, startTime + selectionDuration)
  const maximumStart = Math.max(0, (asset?.duration ?? 0) - selectionDuration)
  const selectionWidth = asset?.duration ? Math.min(100, selectionDuration / asset.duration * 100) : 0
  const selectionLeft = asset?.duration ? startTime / asset.duration * 100 : 0
  const sourceSelections = asset ? savedSelections.filter((item) => item.asset_id === asset.id) : []

  const currentSelectionInput = useMemo<SelectionInput | null>(() => {
    if (!asset || !profile || !outputSize) return null
    return {
      asset_id: asset.id,
      start_time: startTime,
      frame_count: frameCount,
      profile_id: profile.id,
      size_index: sizeIndex,
      crop: { ...crop },
      crop_scale: cropScale,
    }
  }, [asset, profile, outputSize, startTime, frameCount, sizeIndex, crop, cropScale])

  const activeSelectionDirty = Boolean(
    activeSelection && !selectionMatchesInput(activeSelection, currentSelectionInput),
  )

  const projectSettingsDirty = Boolean(
    project && (project.name !== projectNameDraft.trim() || project.dataset_prefix !== projectPrefixDraft.trim()),
  )

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
    void initialize()
  }, [])

  useEffect(() => {
    if (!profile) return
    if (skipProfileResetRef.current) {
      skipProfileResetRef.current = false
      return
    }
    pausePlayback()
    setSizeIndex(asset ? closestSizeIndex(profile, asset) : 0)
    setFrameCount(defaultFrameCount(profile))
    setStartTime(0)
    setPlayhead(0)
    setTimelineZoom(1)
  }, [profileId])

  useEffect(() => {
    if (!asset || !outputSize) return
    if (skipCropResetRef.current) {
      skipCropResetRef.current = false
      return
    }
    setCropScale(1)
    setCrop(calculateCrop(asset, outputSize, 1))
  }, [asset?.id, outputSize?.width, outputSize?.height])

  useEffect(() => {
    if (startTime > maximumStart) setStartTime(maximumStart)
    setPlayhead((current) => clamp(current, startTime, selectionEnd))
  }, [maximumStart, selectionDuration, startTime, selectionEnd])

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

  useEffect(() => {
    if (!isPlaying || !asset) return
    let animationFrame = 0

    const tick = () => {
      const video = videoRef.current
      if (!video || video.paused) return

      if (video.currentTime >= selectionEnd - 0.01) {
        if (loopSelection) {
          video.currentTime = startTime
          setPlayhead(startTime)
        } else {
          video.pause()
          video.currentTime = selectionEnd
          setPlayhead(selectionEnd)
          setIsPlaying(false)
          return
        }
      } else {
        setPlayhead(clamp(video.currentTime, startTime, selectionEnd))
      }

      animationFrame = window.requestAnimationFrame(tick)
    }

    animationFrame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [isPlaying, loopSelection, startTime, selectionEnd, asset?.id])

  useEffect(() => {
    if (!workspace) return
    syncExportSession(workspace.project, exportedFilenames(workspace))
  }, [workspace])

  async function initialize() {
    setBusy(true)
    setError('')
    try {
      const [profileItems, projectItems] = await Promise.all([fetchProfiles(), fetchProjects()])
      setProfiles(profileItems)
      if (profileItems[0]) {
        setProfileId(profileItems[0].id)
        setFrameCount(defaultFrameCount(profileItems[0]))
      }
      setProjects(projectItems)
      if (projectItems[0]) {
        await openProject(projectItems[0].id)
      } else {
        setShowProjectCreator(true)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not initialize Videoz')
    } finally {
      setBusy(false)
    }
  }

  async function openProject(projectId: string) {
    pausePlayback()
    setError('')
    setResult(null)
    setQueueNotice('')
    const nextWorkspace = await fetchProjectWorkspace(projectId)
    setWorkspace(nextWorkspace)
    setProjectNameDraft(nextWorkspace.project.name)
    setProjectPrefixDraft(nextWorkspace.project.dataset_prefix)
    setActiveSelectionId(null)
    const nextAsset = nextWorkspace.sources[0] ?? null
    setAsset(nextAsset)
    setStartTime(0)
    setPlayhead(0)
    setTimelineZoom(1)
    if (nextAsset && profile) setSizeIndex(closestSizeIndex(profile, nextAsset))
  }

  async function handleProjectChange(projectId: string) {
    setBusy(true)
    try {
      await openProject(projectId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open project')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateProject() {
    const name = newProjectName.trim()
    if (!name) return
    setBusy(true)
    setError('')
    try {
      const created = await createProjectApi(name, newProjectPrefix.trim() || undefined)
      const projectItems = await fetchProjects()
      setProjects(projectItems)
      setNewProjectName('')
      setNewProjectPrefix('')
      setShowProjectCreator(false)
      await openProject(created.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create project')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveProject() {
    if (!project || !projectSettingsDirty) return
    setBusy(true)
    setError('')
    try {
      const updated = await updateProjectApi(project.id, {
        name: projectNameDraft.trim(),
        dataset_prefix: projectPrefixDraft.trim(),
      })
      const nextWorkspace = await fetchProjectWorkspace(project.id)
      setWorkspace(nextWorkspace)
      setProjectNameDraft(updated.name)
      setProjectPrefixDraft(updated.dataset_prefix)
      setProjects(await fetchProjects())
      setQueueNotice('Project settings saved. Dataset export status was refreshed.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save project')
    } finally {
      setBusy(false)
    }
  }

  function activateAsset(nextAsset: MediaAsset) {
    pausePlayback()
    setActiveSelectionId(null)
    setAsset(nextAsset)
    setStartTime(0)
    setPlayhead(0)
    setTimelineZoom(1)
    if (profile) setSizeIndex(closestSizeIndex(profile, nextAsset))
    setQueueNotice('Source changed. Any unsaved selection edits were discarded.')
  }

  async function handleFile(file: File | undefined) {
    if (!file || !project || !workspace) return
    pausePlayback()
    setBusy(true)
    setError('')
    setResult(null)
    setQueueNotice('')
    try {
      const imported = await importProjectMedia(project.id, file)
      const nextWorkspace = await fetchProjectWorkspace(project.id)
      setWorkspace(nextWorkspace)
      setAsset(imported)
      setActiveSelectionId(null)
      if (profile) setSizeIndex(closestSizeIndex(profile, imported))
      setStartTime(0)
      setPlayhead(0)
      setTimelineZoom(1)
      setQueueNotice(`Added ${imported.original_name} to ${project.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  function pausePlayback() {
    videoRef.current?.pause()
    setIsPlaying(false)
  }

  async function togglePlayback() {
    const video = videoRef.current
    if (!asset || !video) return

    if (!video.paused) {
      video.pause()
      setIsPlaying(false)
      return
    }

    if (video.currentTime < startTime || video.currentTime >= selectionEnd - 0.01) {
      video.currentTime = startTime
      setPlayhead(startTime)
    }

    try {
      await video.play()
      setIsPlaying(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to play this source video')
    }
  }

  function seek(time: number) {
    const bounded = clamp(time, startTime, selectionEnd)
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
    pausePlayback()
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
    pausePlayback()
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

  async function addCurrentSelection() {
    if (!project || !currentSelectionInput) return
    setBusy(true)
    setError('')
    setQueueNotice('')
    try {
      const saved = await createSavedSelection(project.id, currentSelectionInput)
      setWorkspace((current) => current
        ? { ...current, selections: [...current.selections, saved] }
        : current)
      // New additions intentionally stay out of edit mode so the normal fast
      // workflow remains: move the window/crop and add the next selection.
      setActiveSelectionId(null)
      setQueueNotice(`Saved selection #${saved.sequence}. Move on and add another, or load it later to edit.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save selection')
    } finally {
      setBusy(false)
    }
  }

  async function updateActiveSelection() {
    if (!activeSelection || !currentSelectionInput || !activeSelectionDirty) return
    setBusy(true)
    setError('')
    setQueueNotice('')
    try {
      const updated = await updateSavedSelection(activeSelection.id, currentSelectionInput)
      setWorkspace((current) => current
        ? {
            ...current,
            selections: current.selections.map((item) => item.id === updated.id ? updated : item),
          }
        : current)
      setQueueNotice(`Updated selection #${updated.sequence}. Its sequence number and dataset filename are unchanged.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update selection')
    } finally {
      setBusy(false)
    }
  }

  async function removeSavedSelection(saved: SavedSelection) {
    setBusy(true)
    setError('')
    try {
      await deleteSavedSelection(saved.id)
      setWorkspace((current) => current
        ? { ...current, selections: current.selections.filter((item) => item.id !== saved.id) }
        : current)
      if (activeSelectionId === saved.id) setActiveSelectionId(null)
      setQueueNotice(`Removed selection #${saved.sequence}. Existing sequence numbers are not renumbered.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove selection')
    } finally {
      setBusy(false)
    }
  }

  function loadSavedSelection(saved: SavedSelection) {
    if (!workspace) return
    const savedProfile = profiles.find((item) => item.id === saved.profile_id)
    const savedAsset = workspace.sources.find((item) => item.id === saved.asset_id)
    if (!savedProfile || !savedAsset) return
    const savedSize = savedProfile.sizes[saved.size_index] ?? savedProfile.sizes[0]
    const profileWillChange = saved.profile_id !== profileId
    const outputWillChange = !outputSize || outputSize.width !== savedSize.width || outputSize.height !== savedSize.height

    pausePlayback()
    if (profileWillChange) skipProfileResetRef.current = true
    if (outputWillChange || savedAsset.id !== asset?.id) skipCropResetRef.current = true
    setActiveSelectionId(saved.id)
    setAsset(savedAsset)
    setProfileId(saved.profile_id)
    setSizeIndex(saved.size_index)
    setFrameCount(saved.frame_count)
    setCrop({ ...saved.crop })
    setCropScale(saved.crop_scale)
    setStartTime(saved.start_time)
    setPlayhead(saved.start_time)
    setTimelineZoom(1)
    if (videoRef.current && savedAsset.id === asset?.id) videoRef.current.currentTime = saved.start_time
    setQueueNotice(`Loaded selection #${saved.sequence}. Unsaved tweaks only persist if you choose Update selection.`)
  }

  function leaveEditMode() {
    setActiveSelectionId(null)
    setQueueNotice('Returned to new-selection mode. The current editor values are unchanged.')
  }

  function savedDuration(saved: SavedSelection): number {
    const savedProfile = profiles.find((item) => item.id === saved.profile_id)
    return savedProfile ? saved.frame_count / savedProfile.fps : 0
  }

  function markExported(selectionId: string, exported: ExportResult) {
    setWorkspace((current) => current
      ? {
          ...current,
          selections: current.selections.map((item) => item.id === selectionId
            ? { ...item, export_filename: exported.filename }
            : item),
        }
      : current)
  }

  async function handleExportCurrent() {
    if (!asset || !profile || !outputSize) return
    if (activeSelection && !activeSelectionDirty && project) {
      await handleExportSaved(activeSelection)
      return
    }
    pausePlayback()
    setBusy(true)
    setError('')
    setResult(null)
    setQueueNotice('')
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
      setQueueNotice('Exported an unsaved preview clip. Save the selection for deterministic dataset naming.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleExportSaved(saved: SavedSelection) {
    if (!project) return
    pausePlayback()
    setBusy(true)
    setError('')
    setResult(null)
    setQueueNotice('')
    try {
      const exported = await exportSavedSelection(project, saved.id)
      setResult(exported)
      markExported(saved.id, exported)
      setQueueNotice(`Exported selection #${saved.sequence} as ${exported.filename}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleExportAll() {
    if (!project || savedSelections.length === 0) return
    pausePlayback()
    setBusy(true)
    setError('')
    setResult(null)
    setQueueNotice('')
    try {
      let lastResult: ExportResult | null = null
      const exportedById = new Map<string, string>()
      for (const saved of savedSelections) {
        lastResult = await exportSavedSelection(project, saved.id)
        exportedById.set(saved.id, lastResult.filename)
      }
      setWorkspace((current) => current
        ? {
            ...current,
            selections: current.selections.map((item) => ({
              ...item,
              export_filename: exportedById.get(item.id) ?? item.export_filename,
            })),
          }
        : current)
      if (lastResult) setResult(lastResult)
      setQueueNotice(`Exported ${savedSelections.length} persistent selection${savedSelections.length === 1 ? '' : 's'} in sequence order.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Batch export failed')
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
        <button type="button" className="project-new-button" onClick={() => setShowProjectCreator(true)}>
          + New project
        </button>
      </header>

      {error && <div className="message error">{error}</div>}
      {result && (
        <div className="message success">
          Exported <strong>{result.filename}</strong> · <a href={result.url} target="_blank">open file</a>
        </div>
      )}
      {queueNotice && <div className="message neutral">{queueNotice}</div>}

      <section className="project-card">
        {showProjectCreator || !project ? (
          <div className="project-create-row">
            <div className="project-create-copy">
              <span className="label">New project</span>
              <strong>Create a persistent dataset workspace</strong>
            </div>
            <input
              aria-label="Project name"
              placeholder="Project name, e.g. sH1VX MiniMax"
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
            />
            <input
              aria-label="Dataset prefix"
              placeholder="Dataset prefix (optional)"
              value={newProjectPrefix}
              onChange={(event) => setNewProjectPrefix(event.target.value)}
            />
            <button type="button" className="queue-primary" disabled={busy || !newProjectName.trim()} onClick={() => void handleCreateProject()}>
              Create project
            </button>
            {project && (
              <button type="button" className="queue-secondary" disabled={busy} onClick={() => setShowProjectCreator(false)}>
                Cancel
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="project-main-row">
              <div className="project-picker">
                <label htmlFor="project-select">Project</label>
                <select id="project-select" value={project.id} disabled={busy} onChange={(event) => void handleProjectChange(event.target.value)}>
                  {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <div className="project-field">
                <label htmlFor="project-name">Project name</label>
                <input id="project-name" value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} />
              </div>
              <div className="project-field">
                <label htmlFor="project-prefix">Dataset prefix</label>
                <input id="project-prefix" value={projectPrefixDraft} onChange={(event) => setProjectPrefixDraft(event.target.value)} />
              </div>
              <button type="button" className="queue-primary" disabled={busy || !projectSettingsDirty || !projectNameDraft.trim() || !projectPrefixDraft.trim()} onClick={() => void handleSaveProject()}>
                Save project
              </button>
            </div>

            <div className="project-source-row">
              <div className="source-picker-wide">
                <label htmlFor="source-select">Source video</label>
                <select
                  id="source-select"
                  value={asset?.id ?? ''}
                  disabled={busy || workspace.sources.length === 0}
                  onChange={(event) => {
                    const next = workspace.sources.find((item) => item.id === event.target.value)
                    if (next) activateAsset(next)
                  }}
                >
                  {workspace.sources.length === 0 && <option value="">No source videos yet</option>}
                  {workspace.sources.map((item) => <option key={item.id} value={item.id}>{item.original_name}</option>)}
                </select>
              </div>
              <label className={`import-button ${busy ? 'disabled' : ''}`}>
                <input type="file" accept="video/*" disabled={busy} onChange={(event) => handleFile(event.target.files?.[0])} />
                {busy ? 'Working…' : '+ Add source video'}
              </label>
              <div className="dataset-path">
                <span>Dataset output</span>
                <strong>/data/datasets/{project.dataset_prefix}/</strong>
                <small>{project.dataset_prefix}_000001.mp4 · _000002.mp4 · …</small>
              </div>
            </div>
          </>
        )}
      </section>

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
                <video
                  ref={videoRef}
                  src={asset.url}
                  preload="metadata"
                  playsInline
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onLoadedMetadata={() => {
                    if (videoRef.current) videoRef.current.currentTime = playhead
                  }}
                />
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
                <h2>{project ? 'Add a source video' : 'Create or open a project'}</h2>
                <p>Projects persist source references, crop decisions, timing, sequence numbers and export state in SQLite under /data.</p>
              </div>
            )}
          </div>

          <div className="timeline-card">
            <div className="timeline-heading">
              <div>
                <span className="label">Selection</span>
                <strong>{formatTime(startTime)} → {formatTime(selectionEnd)}</strong>
              </div>
              <div className="timeline-stats">
                {activeSelection && <span className={activeSelectionDirty ? 'dirty-stat' : 'active-stat'}>#{activeSelection.sequence} {activeSelectionDirty ? 'modified' : 'loaded'}</span>}
                <span>{selectionDuration.toFixed(3)} sec</span>
                <span>{frameCount} frame{frameCount === 1 ? '' : 's'}</span>
                <span>{profile?.fps ?? 0} FPS</span>
              </div>
            </div>

            <div className="playback-toolbar">
              <button type="button" className="playback-button" disabled={!asset} onClick={() => void togglePlayback()}>
                {isPlaying ? '❚❚ Pause' : '▶ Play selection'}
              </button>
              <label className="loop-toggle">
                <input type="checkbox" checked={loopSelection} disabled={!asset} onChange={(event) => setLoopSelection(event.target.checked)} />
                Loop selection
              </label>
              <span className="playback-time">{formatTime(playhead)}</span>
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
                {asset && sourceSelections.map((saved) => {
                  const duration = savedDuration(saved)
                  return (
                    <div
                      key={saved.id}
                      className={`saved-selection-marker ${saved.id === activeSelectionId ? 'active' : ''}`}
                      style={{
                        left: `${saved.start_time / asset.duration * 100}%`,
                        width: `${Math.min(100, duration / asset.duration * 100)}%`,
                      }}
                    />
                  )
                })}
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
            <p className="timeline-hint">Click the filmstrip to jump the capture window. Drag the green window to refine it; zoom in for longer sources. Persistent saved clips appear as markers along the bottom.</p>
            <div className="scrub-row">
              <span>{formatTime(startTime)}</span>
              <input
                aria-label="Scrub selected clip"
                type="range"
                min={startTime}
                max={Math.max(startTime, selectionEnd)}
                step="0.001"
                value={playhead}
                disabled={!asset}
                onPointerDown={pausePlayback}
                onChange={(event) => seek(Number(event.target.value))}
              />
              <span>{formatTime(selectionEnd)}</span>
            </div>
          </div>

          <div className="queue-card">
            <div className="queue-heading">
              <div>
                <span className="label">Project selections</span>
                <strong>{savedSelections.length} persistent selection{savedSelections.length === 1 ? '' : 's'}</strong>
              </div>
              <div className="queue-edit-controls">
                {activeSelection ? (
                  <>
                    {activeSelectionDirty ? (
                      <button type="button" className="queue-update" disabled={busy} onClick={() => void updateActiveSelection()}>
                        Update selection #{activeSelection.sequence}
                      </button>
                    ) : (
                      <span className="loaded-badge">Selection #{activeSelection.sequence} loaded</span>
                    )}
                    <button type="button" className="queue-secondary" disabled={busy} onClick={leaveEditMode}>New selection</button>
                  </>
                ) : (
                  <button type="button" className="queue-primary" disabled={!asset || busy || !project} onClick={() => void addCurrentSelection()}>
                    + Add current selection
                  </button>
                )}
              </div>
            </div>

            {savedSelections.length === 0 ? (
              <p className="queue-empty">Find a useful crop and time window, then save it here. Selections now survive browser reloads, container restarts, and returning to the project later.</p>
            ) : (
              <div className="queue-list">
                {savedSelections.map((saved) => {
                  const savedProfile = profiles.find((item) => item.id === saved.profile_id)
                  const savedSize = savedProfile?.sizes[saved.size_index]
                  const sourceAsset = workspace?.sources.find((item) => item.id === saved.asset_id)
                  const duration = savedDuration(saved)
                  const selectedWidth = sourceAsset ? Math.round(sourceAsset.width * saved.crop.width) : 0
                  const selectedHeight = sourceAsset ? Math.round(sourceAsset.height * saved.crop.height) : 0
                  const isActive = saved.id === activeSelectionId
                  return (
                    <div className={`queue-item ${isActive ? 'active' : ''}`} key={saved.id}>
                      <div className="queue-index">{String(saved.sequence).padStart(2, '0')}</div>
                      <div className="queue-details">
                        <strong>{formatTime(saved.start_time)} → {formatTime(saved.start_time + duration)}</strong>
                        <span>{formatDurationChoice(duration)} · {saved.frame_count} frames · {selectedWidth}×{selectedHeight} → {savedSize?.width ?? '?'}×{savedSize?.height ?? '?'}</span>
                        <small>{sourceAsset?.original_name ?? 'Missing source'} · {savedProfile?.label ?? saved.profile_id}</small>
                        <small className={saved.export_filename ? 'export-ready' : 'export-pending'}>
                          {saved.export_filename ? `Exported: ${saved.export_filename}` : `${project?.dataset_prefix ?? 'dataset'}_${String(saved.sequence).padStart(6, '0')} · not exported`}
                        </small>
                      </div>
                      <div className="queue-actions">
                        <button type="button" disabled={busy || isActive} onClick={() => loadSavedSelection(saved)}>{isActive ? 'Loaded' : 'Load'}</button>
                        <button type="button" disabled={busy} onClick={() => void handleExportSaved(saved)}>Export</button>
                        <button type="button" className="danger-action" disabled={busy} onClick={() => void removeSavedSelection(saved)}>Remove</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {savedSelections.length > 0 && (
              <div className="queue-footer">
                <span>Exports use stable sequence names inside the project dataset directory. Updating a selection preserves its sequence and invalidates its previous export status until re-exported.</span>
                <button type="button" className="queue-primary" disabled={busy} onClick={() => void handleExportAll()}>
                  {busy ? 'Processing…' : `Export all ${savedSelections.length}`}
                </button>
              </div>
            )}
          </div>
        </div>

        <aside className="controls-card">
          <div className="source-summary source-summary-top">
            <span className="label">Source</span>
            <strong>{asset?.original_name ?? 'No source selected'}</strong>
            {asset && <p>{asset.width}×{asset.height} · {asset.fps.toFixed(3)} FPS · {formatTime(asset.duration)}</p>}
            {activeSelection && <p className={activeSelectionDirty ? 'dirty-copy' : 'active-copy'}>Editing selection #{activeSelection.sequence}{activeSelectionDirty ? ' · unsaved changes' : ''}</p>}
          </div>

          <div className="control-section">
            <div className="section-number">01</div>
            <div className="control-content">
              <label htmlFor="profile">Training profile</label>
              <select id="profile" value={profileId} disabled={!asset} onChange={(event) => setProfileId(event.target.value)}>
                {profiles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              {profile?.notes && <p className="hint">{profile.notes}</p>}
            </div>
          </div>

          <div className="control-section">
            <div className="section-number">02</div>
            <div className="control-content">
              <label htmlFor="size">Output canvas</label>
              <select id="size" value={sizeIndex} disabled={!asset} onChange={(event) => setSizeIndex(Number(event.target.value))}>
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
                disabled={!asset}
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
              <select
                id="frames"
                value={frameCount}
                disabled={!asset}
                onChange={(event) => {
                  pausePlayback()
                  setFrameCount(Number(event.target.value))
                }}
              >
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

          <button
            className="export-button"
            disabled={!asset || busy || Boolean(activeSelection && activeSelectionDirty)}
            onClick={() => void handleExportCurrent()}
          >
            {activeSelection && activeSelectionDirty
              ? 'Update selection before export'
              : busy && asset
                ? 'Processing…'
                : activeSelection
                  ? `Export selection #${activeSelection.sequence}`
                  : profile?.media_kind === 'image'
                    ? 'Export current frame preview'
                    : 'Export current clip preview'}
          </button>
          {!activeSelection && asset && <p className="hint export-hint">Save a selection to give it a stable project sequence filename and include it in persistent dataset export state.</p>}
        </aside>
      </section>
    </main>
  )
}
