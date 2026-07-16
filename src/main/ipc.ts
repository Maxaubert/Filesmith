import { BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import type { FileInfo, JobEvent, JobRequest, ToolId } from '@shared/types'
import { AUDIO_EXTS, IMAGE_EXTS, VIDEO_EXTS } from '@shared/fileKind'
import { JobQueue } from './jobQueue'
import { fileInfoFromPath } from './fileInfo'
import { toolAvailable } from './toolResolver'
import { targetsFor, toolsFor } from './tools/registry'

// Only files Filesmith can actually act on. Everything else (exe, zip, docs, …)
// is hidden from the picker and dropped from drag-and-drop.
const bare = (exts: string[]): string[] => exts.map((e) => e.replace('.', ''))
function isSupported(f: FileInfo): boolean {
  return f.kind === 'image' || f.kind === 'video' || f.kind === 'audio'
}

/** Wire the renderer <-> engine channels for one window. */
export function registerIpc(win: BrowserWindow): void {
  const queue = new JobQueue((e: JobEvent) => win.webContents.send('job:event', e))

  // Custom (frameless) window controls.
  ipcMain.on('window:minimize', () => win.minimize())
  ipcMain.on('window:toggle-maximize', () =>
    win.isMaximized() ? win.unmaximize() : win.maximize()
  )
  ipcMain.on('window:close', () => win.close())

  // Reveal an output file in the OS file manager.
  ipcMain.on('reveal', (_e, p: string) => {
    if (p) shell.showItemInFolder(p)
  })

  // Open a file in its OS-default application (the "Preview" action).
  ipcMain.on('file:open', (_e, p: string) => {
    if (p) void shell.openPath(p)
  })

  // Move a file to the OS recycle bin — reversible, never a hard delete.
  ipcMain.handle('file:trash', async (_e, p: string) => {
    if (!p) return false
    try {
      await shell.trashItem(p)
      return true
    } catch {
      return false
    }
  })

  // Real thumbnails for the queue, via the OS shell (handles images natively).
  ipcMain.handle('thumbnail', async (_e, path: string, size = 128) => {
    try {
      const img = await nativeImage.createThumbnailFromPath(path, { width: size, height: size })
      return img.isEmpty() ? null : img.toDataURL()
    } catch {
      return null
    }
  })

  ipcMain.handle('job:run', (_e, req: JobRequest) => {
    queue.add(req)
    return true
  })
  ipcMain.handle('job:cancel', (_e, id: string) => {
    queue.cancel(id)
    return true
  })
  ipcMain.handle('tool:check', (_e, name: string) => toolAvailable(name))
  ipcMain.handle('files:classify', (_e, paths: string[]) =>
    paths.map(fileInfoFromPath).filter(isSupported)
  )
  ipcMain.handle('files:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All supported', extensions: bare([...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS]) },
        { name: 'Images', extensions: bare(IMAGE_EXTS) },
        { name: 'Video', extensions: bare(VIDEO_EXTS) },
        { name: 'Audio', extensions: bare(AUDIO_EXTS) }
      ]
    })
    return r.canceled ? [] : r.filePaths.map(fileInfoFromPath).filter(isSupported)
  })
  ipcMain.handle('tools:for', (_e, file: FileInfo) => toolsFor(file))
  ipcMain.handle('tool:targets', (_e, id: ToolId, file: FileInfo) => targetsFor(id, file))
}
