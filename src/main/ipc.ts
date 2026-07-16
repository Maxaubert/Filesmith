import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { FileInfo, FileKind, JobEvent, JobRequest, PreviewPayload, ToolId } from '@shared/types'
import { AUDIO_EXTS, IMAGE_EXTS, VIDEO_EXTS } from '@shared/fileKind'
import { JobQueue } from './jobQueue'
import { fileInfoFromPath } from './fileInfo'
import { toolAvailable } from './toolResolver'
import { makeThumbnail } from './thumbnail'
import { openPreviewWindow, getPreviewPayload } from './previewWindow'
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

  // Custom (frameless) window controls — act on the sender's window so both the
  // main window and the preview window control themselves.
  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  // Preview window: open/reuse it, and let it fetch its file list on load.
  ipcMain.handle('preview:open', (_e, p: PreviewPayload) => openPreviewWindow(p))
  ipcMain.handle('preview:data', () => getPreviewPayload())

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

  // Real thumbnails for the queue: OS shell first, then a tool-based fallback
  // (magick / ffmpeg) so videos, icons, and exotic image formats also render.
  ipcMain.handle('thumbnail', (_e, path: string, size = 128, kind: FileKind = 'other') =>
    makeThumbnail(path, size, kind)
  )

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
