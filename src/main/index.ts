import { app, protocol, shell, BrowserWindow } from 'electron'
import { join, extname } from 'path'
import { createReadStream, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { registerIpc } from './ipc'
import { pidSidecar } from './pid/sidecar'
import { spandrelSidecar } from './comfy/sidecar'

// Remove temp dirs orphaned by a previous HARD crash (normal runs delete their
// own in a finally). Guarded by age so a concurrent second instance's in-use
// temp dir (recently touched) is never swept out from under an active job.
// Best-effort; never throws, never blocks startup.
function sweepStaleTempDirs(): void {
  try {
    const dir = tmpdir()
    const cutoff = Date.now() - 60 * 60 * 1000 // 1 hour
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('filesmith-')) continue
      const p = join(dir, name)
      try {
        if (statSync(p).mtimeMs < cutoff) rmSync(p, { recursive: true, force: true })
      } catch {
        /* in use or already gone — leave it */
      }
    }
  } catch {
    /* ignore */
  }
}

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
        'Accept-Ranges': 'bytes',
        // CORS so the renderer's Web Audio analyser can read audio samples.
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
      }
    })
  }
  return new Response(asBody(createReadStream(filePath)), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
    }
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
  // Never let a link click navigate the app window away from its own document;
  // route real page loads to the OS browser. (SPA hash nav doesn't fire this;
  // same-URL reloads — dev HMR — pass through.)
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url === mainWindow.webContents.getURL()) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
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
  sweepStaleTempDirs()

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

// Free the PiD process (and its ~10 GB of VRAM) when the app exits; it's a warm
// long-lived child that won't die with us otherwise.
app.on('before-quit', () => {
  pidSidecar.stop()
  spandrelSidecar.stop()
})
