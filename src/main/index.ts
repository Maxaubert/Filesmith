import { app, protocol, shell, BrowserWindow } from 'electron'
import { join, extname } from 'path'
import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { registerIpc } from './ipc'

// A private scheme the renderer uses to load local media for the preview
// window. Registered as a standard, streaming scheme so <video>/<audio> can
// seek — the renderer can't touch file:// directly under web security.
const MEDIA_SCHEME = 'fsmedia'
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}
const mimeFor = (p: string): string => MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'

// Serve a local file, honouring Range requests. Without a 206 partial response
// (and Accept-Ranges), the browser can't seek within large videos — it registers
// the timeline click but the seek never completes.
function serveMedia(request: Request): Response {
  const filePath = decodeURIComponent(new URL(request.url).pathname).slice(1)
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return new Response(null, { status: 404 })
  }
  const type = mimeFor(filePath)
  const asBody = (s: NodeJS.ReadableStream): ReadableStream =>
    Readable.toWeb(s as Readable) as unknown as ReadableStream

  const range = request.headers.get('range')
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0
    let end = m[2] ? parseInt(m[2], 10) : size - 1
    if (!Number.isFinite(start) || start < 0) start = 0
    if (!Number.isFinite(end) || end >= size) end = size - 1
    if (start > end) start = end
    return new Response(asBody(createReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  }
  return new Response(asBody(createReadStream(filePath)), {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 900,
    minHeight: 580,
    show: false,
    // Frameless: the app draws its own top strip + window controls (RCMM-style).
    frame: false,
    backgroundColor: '#f4f4f6',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  registerIpc(mainWindow)

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite injects ELECTRON_RENDERER_URL in dev; load the built file in prod.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Serve local files for the preview: fsmedia://local/<encoded-abs-path>.
  protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
