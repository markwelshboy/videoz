import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CaptionWorkspace from './CaptionWorkspace'
import ExportBundleBar from './ExportBundleBar'
import './styles.css'
import './caption.css'

type WorkspaceTab = 'capture' | 'caption'
const TAB_KEY = 'videoz.workspace-tab'

function VideozRoot() {
  const [tab, setTab] = useState<WorkspaceTab>(() => {
    const stored = window.localStorage.getItem(TAB_KEY)
    return stored === 'caption' ? 'caption' : 'capture'
  })

  function chooseTab(next: WorkspaceTab) {
    setTab(next)
    window.localStorage.setItem(TAB_KEY, next)
  }

  return (
    <>
      <nav className="app-tabs" aria-label="Videoz workflow">
        <button type="button" className={tab === 'capture' ? 'active' : ''} onClick={() => chooseTab('capture')}>Capture</button>
        <button type="button" className={tab === 'caption' ? 'active' : ''} onClick={() => chooseTab('caption')}>Caption</button>
      </nav>
      {tab === 'capture' ? (
        <>
          <App />
          <ExportBundleBar />
        </>
      ) : (
        <CaptionWorkspace />
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VideozRoot />
  </StrictMode>,
)
