import { useEffect, useState } from 'react'
import { createExportBundle, EXPORT_SESSION_EVENT, getExportSession } from './api'
import type { ExportSessionState } from './api'

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export default function ExportBundleBar() {
  const [session, setSession] = useState<ExportSessionState | null>(() => getExportSession())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const update = (event: Event) => {
      const custom = event as CustomEvent<ExportSessionState>
      setSession(custom.detail)
      setError('')
    }
    window.addEventListener(EXPORT_SESSION_EVENT, update)
    return () => window.removeEventListener(EXPORT_SESSION_EVENT, update)
  }, [])

  if (!session || session.filenames.length === 0) return null

  async function downloadZip() {
    if (!session) return
    setBusy(true)
    setError('')
    try {
      const bundle = await createExportBundle(session.filenames, session.sourceName)
      triggerDownload(bundle.url, bundle.filename)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create ZIP')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bundle-bar" role="status">
      <div className="bundle-copy">
        <span>Export packet</span>
        <strong>{session.filenames.length} exported clip{session.filenames.length === 1 ? '' : 's'} ready</strong>
        {error && <small>{error}</small>}
      </div>
      <button type="button" disabled={busy} onClick={() => void downloadZip()}>
        {busy ? 'Packing…' : 'Download ZIP'}
      </button>
    </div>
  )
}
