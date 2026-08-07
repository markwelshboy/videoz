import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ExportBundleBar from './ExportBundleBar'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ExportBundleBar />
  </StrictMode>,
)
