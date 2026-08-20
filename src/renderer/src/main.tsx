import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PreviewWindow } from './components/PreviewWindow'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// The same bundle serves both windows; the preview window is entered via the
// '#preview' hash (see previewWindow.ts in main).
const isPreview = window.location.hash === '#preview'

// Rejected IPC promises otherwise vanish (every call site voids them); at
// least leave a trace for a bug report instead of pure silence.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] unhandled rejection:', e.reason)
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>{isPreview ? <PreviewWindow /> : <App />}</ErrorBoundary>
  </StrictMode>
)
