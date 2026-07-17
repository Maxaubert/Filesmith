import { BrowserWindow } from 'electron'
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

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}#preview`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'preview' })
}
