import { app, nativeTheme, net, protocol, screen, shell, BrowserWindow } from 'electron'
import { join, extname } from 'path'
import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { registerGlobalIpc, cancelActiveGenerations } from './ipc'
import { pidSidecar } from './pid/sidecar'
import { spandrelSidecar } from './comfy/sidecar'
import { stopComfyServer } from './generate'
import { scheduleChannelRefresh } from './registry/channel'
import { initialWindowSize, MIN_WINDOW } from './windowSize'
import { setEngineEnv } from './env'
import { bootEngine } from './boot'

// Test hook (spec M4): e2e points userData at a temp folder to seed a session.
// Read only when set, so a normal launch is unaffected.
const userDataOverride = process.env['FILESMITH_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

// Test hook: e2e runs the window hidden so a test run never shows a window or
// steals focus. It still paints (screenshots work) and is never shown/focused.
const e2eHidden = process.env['FILESMITH_E2E_HIDDEN'] === '1'

// The engine's view of its host (spec M1). Read after the e2e userData override
// so tests that seed a session still get their temp folder.
setEngineEnv({
  userData: app.getPath('userData'),
  resourcesDir: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
  downloadsDir: app.getPath('downloads'),
  fetch: (url, init) => net.fetch(url, init),
  host: 'app'
})

// A private scheme the renderer uses to load local media (generated-image
// thumbnails) without a file:// origin
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
  let filePath: string
  try {
    filePath = decodeURIComponent(new URL(request.url).pathname).slice(1)
  } catch {
    // Malformed percent-encoding must yield a Response, not throw out of the handler.
    return new Response(null, { status: 400 })
  }
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return new Response(null, { status: 404 })
  }
  const type = mimeFor(filePath)
  // A read stream that errors mid-flight (file deleted while streaming) must not
  // crash the process; destroy quietly so the request just ends.
  const openStream = (opts?: { start: number; end: number }): NodeJS.ReadableStream => {
    const s = createReadStream(filePath, opts)
    s.on('error', () => s.destroy())
    return s
  }
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
    return new Response(asBody(openStream({ start, end })), {
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
  return new Response(asBody(openStream()), {
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
  // Dark only: native scrollbars, dialogs and the pre-paint fill follow the app.
  nativeTheme.themeSource = 'dark'
  const size = initialWindowSize(screen.getPrimaryDisplay().workAreaSize)
  const mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    show: false,
    // Frameless: the renderer draws the 32px title bar and window controls.
    frame: false,
    backgroundColor: '#0a0a0a',
    ...(e2eHidden ? { paintWhenInitiallyHidden: true, skipTaskbar: true } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      ...(e2eHidden ? { backgroundThrottling: false } : {})
    }
  })

  if (!e2eHidden) mainWindow.on('ready-to-show', () => mainWindow.show())

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Scheme allowlist: shell.openExternal will happily launch a file:// or a
    // registered protocol handler; not
    // reachable today (the CSP is script-src 'self' and this window renders no
    // untrusted markup) but it costs one line to keep it that way.
    if (/^https?:/i.test(details.url)) void shell.openExternal(details.url)
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

// The running job queue, so app quit can cancel in-flight tool runs.
let jobQueue: import('./jobQueue').JobQueue | null = null

// Single-instance: a second launch must not spawn a rival process that races the
// same session.json and duplicates windows. Hand focus to the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !e2eHidden) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // Magick env, stale temp sweep, registry user layers (shared with the CLI).
    bootEngine()
    // Background, non-blocking, at most once a day, silent-fail-to-cache: the
    // lever that fixes a dead model URL for every install without a release.
    scheduleChannelRefresh()

    // Serve local files to the renderer: fsmedia://local/<encoded-abs-path>.
    protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request))

    // ONCE per process, before any window: handlers are process-global, and
    // registering from inside createWindow made a second createWindow (macOS
    // dock activate) stack duplicate listeners and throw on the first
    // duplicate handle().
    jobQueue = registerGlobalIpc()

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // On quit, cancel in-flight jobs (so ffmpeg/magick/etc. don't keep running
  // headless) and free the warm AI sidecars (PiD holds ~10 GB of VRAM).
  app.on('before-quit', () => {
    jobQueue?.cancelAll()
    cancelActiveGenerations()
    pidSidecar.stop()
    spandrelSidecar.stop()
    stopComfyServer()
  })
}
