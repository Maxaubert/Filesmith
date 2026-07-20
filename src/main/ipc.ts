import { open, readFile, stat } from 'fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type {
  FileInfo,
  FileKind,
  JobEvent,
  JobRequest,
  PreviewItem,
  PreviewPayload,
  ToolId
} from '@shared/types'
import { AUDIO_EXTS, DOC_EXTS, IMAGE_EXTS, TEXT_EXTS, VIDEO_EXTS } from '@shared/fileKind'
import { JobQueue } from './jobQueue'
import { fileInfoFromPath } from './fileInfo'
import { toolAvailable } from './toolResolver'
import { probeDimensions } from './probe'
import { makeThumbnail } from './thumbnail'
import { openPreviewWindow, getPreviewPayload, updatePreviewFiles } from './previewWindow'
import { targetsFor, toolsFor } from './tools/registry'

// Only files Filesmith can actually act on. Everything else (exe, zip, docs, …)
// is hidden from the picker and dropped from drag-and-drop.
const bare = (exts: string[]): string[] => exts.map((e) => e.replace('.', ''))
function isSupported(f: FileInfo): boolean {
  return f.kind !== 'other'
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
  ipcMain.on('preview:update-list', (_e, files: PreviewItem[]) => updatePreviewFiles(files))

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
        {
          name: 'All supported',
          extensions: bare([
            ...IMAGE_EXTS,
            ...VIDEO_EXTS,
            ...AUDIO_EXTS,
            '.pdf',
            ...DOC_EXTS,
            ...TEXT_EXTS
          ])
        },
        { name: 'Images', extensions: bare(IMAGE_EXTS) },
        { name: 'Video', extensions: bare(VIDEO_EXTS) },
        { name: 'Audio', extensions: bare(AUDIO_EXTS) },
        { name: 'Documents', extensions: bare(['.pdf', ...DOC_EXTS]) },
        { name: 'Text', extensions: bare(TEXT_EXTS) }
      ]
    })
    return r.canceled ? [] : r.filePaths.map(fileInfoFromPath).filter(isSupported)
  })
  // Read a file's bytes so the renderer can play audio / show a PDF from a
  // same-origin blob URL (Web Audio needs no CORS taint). Guard the size first:
  // a whole-file read into a Uint8Array over IPC would OOM on a huge input, so
  // reject it and let the renderer fall back to "open in default app".
  ipcMain.handle('file:bytes', async (_e, p: string) => {
    try {
      const st = await stat(p)
      const MAX = 256 * 1024 * 1024 // 256 MB — generous for media/PDF, bounded
      if (st.size > MAX) return null
      return new Uint8Array(await readFile(p))
    } catch {
      return null
    }
  })
  // Read the first slice of a text file for the preview. Read ONLY the cap via a
  // file handle — never load a multi-GB log fully into memory just to truncate.
  ipcMain.handle('file:text', async (_e, p: string) => {
    let fh
    try {
      fh = await open(p, 'r')
      const cap = 1024 * 1024 // 1 MB — enough for preview
      const buf = Buffer.alloc(cap)
      const { bytesRead } = await fh.read(buf, 0, cap, 0)
      return buf.subarray(0, bytesRead).toString('utf8')
    } catch {
      return null
    } finally {
      await fh?.close()
    }
  })
  // Video DISPLAY dimensions (rotation-aware) for the compress scale preview.
  ipcMain.handle('video:dimensions', (_e, p: string) => probeDimensions(p))
  ipcMain.handle('tools:for', (_e, file: FileInfo) => toolsFor(file))
  ipcMain.handle('tool:targets', (_e, id: ToolId, file: FileInfo) => targetsFor(id, file))
}
