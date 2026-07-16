import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  FileInfo,
  FileKind,
  JobEvent,
  JobRequest,
  PreviewItem,
  PreviewPayload,
  ToolId,
  ToolTarget
} from '@shared/types'

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
  thumbnail: (path: string, size?: number, kind?: FileKind): Promise<string | null> =>
    ipcRenderer.invoke('thumbnail', path, size, kind),
  reveal: (path: string): void => ipcRenderer.send('reveal', path),
  /** Open a file in its OS-default app. */
  openFile: (path: string): void => ipcRenderer.send('file:open', path),
  /** A streamable URL for a local file, for the in-app preview. */
  mediaUrl: (path: string): string => `fsmedia://local/${encodeURIComponent(path)}`,
  /** Open (or reuse + refocus) the standalone preview window. */
  openPreviewWindow: (files: PreviewItem[], index: number): Promise<void> =>
    ipcRenderer.invoke('preview:open', { files, index }),
  /** The preview window fetches its file list on load. */
  getPreviewData: (): Promise<PreviewPayload> => ipcRenderer.invoke('preview:data'),
  /** The preview window listens for a new file list when reused. */
  onPreviewUpdate: (cb: (p: PreviewPayload) => void): (() => void) => {
    const listener = (_: unknown, p: PreviewPayload): void => cb(p)
    ipcRenderer.on('preview:update', listener)
    return () => ipcRenderer.removeListener('preview:update', listener)
  },
  /** Push a fresh file list to an open preview window (keeps its position). */
  updatePreviewList: (files: PreviewItem[]): void =>
    ipcRenderer.send('preview:update-list', files),
  /** The preview window listens for live list changes. */
  onPreviewList: (cb: (files: PreviewItem[]) => void): (() => void) => {
    const listener = (_: unknown, files: PreviewItem[]): void => cb(files)
    ipcRenderer.on('preview:list', listener)
    return () => ipcRenderer.removeListener('preview:list', listener)
  },
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
