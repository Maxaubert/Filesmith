import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import type { PreviewItem, PreviewPayload } from '@shared/types'

// A separate, independently-resizable OS window for media preview. Being a real
// window, it can be sized beyond the main window and resized from any edge or
// corner. It reuses the same renderer bundle, entered via the '#preview' hash.
let win: BrowserWindow | null = null
let payload: PreviewPayload = { files: [], index: 0 }

export function getPreviewPayload(): PreviewPayload {
  return payload
}

/** Push a new file list to the open preview window without changing its index. */
export function updatePreviewFiles(files: PreviewItem[]): void {
  payload = { ...payload, files }
  if (win && !win.isDestroyed()) win.webContents.send('preview:list', files)
}

export function openPreviewWindow(next: PreviewPayload): void {
  payload = next
  if (win && !win.isDestroyed()) {
    win.webContents.send('preview:update', payload)
    if (win.isMinimized()) win.restore()
    win.focus()
    return
  }

  win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 440,
    minHeight: 340,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      plugins: true // Chromium's built-in PDF viewer (for the PDF preview)
    }
  })

  win.on('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  // A markdown/HTML link click must open in the OS browser, never navigate the
  // preview window away from the app. (Hash/SPA nav fires did-navigate-in-page,
  // not will-navigate, so this only catches real page loads; same-URL reloads —
  // dev HMR — are allowed through.)
  win.webContents.setWindowOpenHandler((details) => {
    if (/^https?:/i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url === win?.webContents.getURL()) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}#preview`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'preview' })
}
