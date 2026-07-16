import { BrowserWindow } from 'electron'
import { join } from 'path'
import type { PreviewPayload } from '@shared/types'

// A separate, independently-resizable OS window for media preview. Being a real
// window, it can be sized beyond the main window and resized from any edge or
// corner. It reuses the same renderer bundle, entered via the '#preview' hash.
let win: BrowserWindow | null = null
let payload: PreviewPayload = { files: [], index: 0 }

export function getPreviewPayload(): PreviewPayload {
  return payload
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
      // Preview media should play on open without a click in this window.
      autoplayPolicy: 'no-user-gesture-required'
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
