import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PreviewWindow } from './components/PreviewWindow'
import './index.css'

// The same bundle serves both windows; the preview window is entered via the
// '#preview' hash (see previewWindow.ts in main).
const isPreview = window.location.hash === '#preview'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>{isPreview ? <PreviewWindow /> : <App />}</StrictMode>
)
