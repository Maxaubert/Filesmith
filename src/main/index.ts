import { app, net, protocol, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { registerIpc } from './ipc'

// A private scheme the renderer uses to load local media for the in-app
// preview. Registered as a standard, streaming scheme so <video>/<audio> can
// seek — the renderer can't touch file:// directly under web security.
const MEDIA_SCHEME = 'fsmedia'
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])

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
  // net.fetch on a file URL streams and honours Range requests (video seeking).
  protocol.handle(MEDIA_SCHEME, (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname).slice(1)
    return net.fetch(pathToFileURL(filePath).toString())
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
