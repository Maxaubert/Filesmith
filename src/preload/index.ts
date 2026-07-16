import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { FileInfo, JobEvent, JobRequest, ToolId, ToolTarget } from '@shared/types'

// The typed bridge the renderer talks to. The renderer never touches Node/fs/
// child_process directly; every privileged action goes through these channels.
const api = {
  // jobs
  runJob: (req: JobRequest): Promise<boolean> => ipcRenderer.invoke('job:run', req),
  cancelJob: (id: string): Promise<boolean> => ipcRenderer.invoke('job:cancel', id),
  onJobEvent: (cb: (e: JobEvent) => void): (() => void) => {
    const listener = (_: unknown, e: JobEvent): void => cb(e)
    ipcRenderer.on('job:event', listener)
    return () => ipcRenderer.removeListener('job:event', listener)
  },

  // files
  pickFiles: (): Promise<FileInfo[]> => ipcRenderer.invoke('files:pick'),
  classify: (paths: string[]): Promise<FileInfo[]> => ipcRenderer.invoke('files:classify', paths),
  /** Resolve the absolute path of a dropped File (Electron removed File.path). */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  thumbnail: (path: string, size?: number): Promise<string | null> =>
    ipcRenderer.invoke('thumbnail', path, size),
  reveal: (path: string): void => ipcRenderer.send('reveal', path),
  /** Open a file in its OS-default app (Preview). */
  openFile: (path: string): void => ipcRenderer.send('file:open', path),
  /** Move a file to the recycle bin (reversible). */
  trashFile: (path: string): Promise<boolean> => ipcRenderer.invoke('file:trash', path),

  // tools
  checkTool: (name: string): Promise<boolean> => ipcRenderer.invoke('tool:check', name),
  toolsFor: (file: FileInfo): Promise<ToolId[]> => ipcRenderer.invoke('tools:for', file),
  targets: (tool: ToolId, file: FileInfo): Promise<ToolTarget[]> =>
    ipcRenderer.invoke('tool:targets', tool, file),

  // window controls (frameless)
  minimize: (): void => ipcRenderer.send('window:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('filesmith', api)

export type FilesmithApi = typeof api
