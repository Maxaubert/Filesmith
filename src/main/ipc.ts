import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { FileInfo, JobEvent, JobRequest, ToolId } from '@shared/types'
import { JobQueue } from './jobQueue'
import { fileInfoFromPath } from './fileInfo'
import { toolAvailable } from './toolResolver'
import { targetsFor, toolsFor } from './tools/registry'

/** Wire the renderer <-> engine channels for one window. */
export function registerIpc(win: BrowserWindow): void {
  const queue = new JobQueue((e: JobEvent) => win.webContents.send('job:event', e))

  ipcMain.handle('job:run', (_e, req: JobRequest) => {
    queue.add(req)
    return true
  })
  ipcMain.handle('job:cancel', (_e, id: string) => {
    queue.cancel(id)
    return true
  })
  ipcMain.handle('tool:check', (_e, name: string) => toolAvailable(name))
  ipcMain.handle('files:classify', (_e, paths: string[]) => paths.map(fileInfoFromPath))
  ipcMain.handle('files:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections']
    })
    return r.canceled ? [] : r.filePaths.map(fileInfoFromPath)
  })
  ipcMain.handle('tools:for', (_e, file: FileInfo) => toolsFor(file))
  ipcMain.handle('tool:targets', (_e, id: ToolId, file: FileInfo) => targetsFor(id, file))
}
