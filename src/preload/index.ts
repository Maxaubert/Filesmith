import { contextBridge, ipcRenderer } from 'electron'
import type { FileInfo, JobEvent, JobRequest, ToolId, ToolTarget } from '@shared/types'

// The typed bridge the renderer talks to. The renderer never touches Node/fs/
// child_process directly — every privileged action goes through these channels.
const api = {
  runJob: (req: JobRequest): Promise<boolean> => ipcRenderer.invoke('job:run', req),
  cancelJob: (id: string): Promise<boolean> => ipcRenderer.invoke('job:cancel', id),
  pickFiles: (): Promise<FileInfo[]> => ipcRenderer.invoke('files:pick'),
  classify: (paths: string[]): Promise<FileInfo[]> => ipcRenderer.invoke('files:classify', paths),
  checkTool: (name: string): Promise<boolean> => ipcRenderer.invoke('tool:check', name),
  toolsFor: (file: FileInfo): Promise<ToolId[]> => ipcRenderer.invoke('tools:for', file),
  targets: (tool: ToolId, file: FileInfo): Promise<ToolTarget[]> =>
    ipcRenderer.invoke('tool:targets', tool, file),
  /** Subscribe to job progress/terminal events. Returns an unsubscribe fn. */
  onJobEvent: (cb: (e: JobEvent) => void): (() => void) => {
    const listener = (_: unknown, e: JobEvent): void => cb(e)
    ipcRenderer.on('job:event', listener)
    return () => ipcRenderer.removeListener('job:event', listener)
  }
}

contextBridge.exposeInMainWorld('filesmith', api)

export type FilesmithApi = typeof api
