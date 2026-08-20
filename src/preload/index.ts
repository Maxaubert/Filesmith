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
import type { ComfyModel } from '@shared/comfy'
import type { ComfyStatus, PidStatus } from '@shared/ipc'
import type { GenerateOptions } from '@shared/generate'
import type { GenModelScan } from '@shared/genArch'

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
  /** Pick one image to use as a Remove Background backdrop. */
  pickImage: (): Promise<string | null> => ipcRenderer.invoke('image:pick'),
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
  /** Raw file bytes — audio plays from a same-origin blob so Web Audio can read it. */
  readBytes: (path: string): Promise<Uint8Array | null> => ipcRenderer.invoke('file:bytes', path),
  /** A text file's contents (capped at 1 MB) for the text preview. */
  readText: (path: string): Promise<string | null> => ipcRenderer.invoke('file:text', path),
  /** Video pixel dimensions (via ffprobe) for the resolution-preview list. */
  videoDimensions: (path: string): Promise<{ width: number; height: number } | null> =>
    ipcRenderer.invoke('video:dimensions', path),
  /** Image pixel dimensions (via ImageMagick) for the upscale output preview. */
  imageDimensions: (path: string): Promise<{ width: number; height: number } | null> =>
    ipcRenderer.invoke('image:dimensions', path),
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
  updatePreviewList: (files: PreviewItem[]): void => ipcRenderer.send('preview:update-list', files),
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
  /** AI upscale models present on disk (bundled + the user's own overlay). */
  upscaleModels: (): Promise<{ value: string; label: string; user: boolean }[]> =>
    ipcRenderer.invoke('upscale:models'),
  /** Open the folder where the user can drop their own Real-ESRGAN models. */
  upscaleOpenModelsFolder: (): Promise<boolean> => ipcRenderer.invoke('upscale:open-models-folder'),
  targets: (tool: ToolId, file: FileInfo): Promise<ToolTarget[]> =>
    ipcRenderer.invoke('tool:targets', tool, file),

  // PiD Advanced (NVIDIA) upscaler tier
  /** NVIDIA/PiD availability. Typed by the SHARED PidStatus: this wrapper used
   * to re-declare a narrower shape, which silently discarded cudaReason. */
  pidStatus: (): Promise<PidStatus> => ipcRenderer.invoke('pid:status'),
  /** Delete the AI install (repair path for a corrupt/poisoned one). */
  pidRemove: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('pid:remove'),
  /** True while an install is running anywhere in the app. */
  pidInstalling: (): Promise<boolean> => ipcRenderer.invoke('pid:installing'),
  /** Run the one-click PiD download/install; resolves when done. */
  pidInstall: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('pid:install'),
  /** Install progress updates (step label + percent, or null while indeterminate). */
  onPidProgress: (cb: (p: { step: string; pct: number | null }) => void): (() => void) => {
    const listener = (_: unknown, p: { step: string; pct: number | null }): void => cb(p)
    ipcRenderer.on('pid:progress', listener)
    return () => ipcRenderer.removeListener('pid:progress', listener)
  },

  // ComfyUI-imported upscale models
  /** GPU + spandrel-engine readiness + remembered folder + usable models. */
  comfyStatus: (): Promise<ComfyStatus> => ipcRenderer.invoke('comfy:status'),
  /** Build the shared torch env + spandrel (no PiD weights). */
  comfyInstall: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('comfy:install'),
  /** Open a folder picker; resolves to the chosen path or null. */
  comfyPickFolder: (): Promise<string | null> => ipcRenderer.invoke('comfy:pick-folder'),
  // The user's own model registry (add a model with no app release).
  /** Pick a registry entry / ComfyUI API workflow JSON and register it. */
  registryImport: (): Promise<{
    ok: boolean
    error?: string
    ids?: string[]
    path?: string
    notes?: string[]
  }> => ipcRenderer.invoke('registry:import'),
  /** Open the user registry folder in the OS file manager. */
  registryOpenFolder: (): Promise<boolean> => ipcRenderer.invoke('registry:open-folder'),
  /** Every known model entry with its layer + source host (provenance). */
  registryInfo: (): Promise<{
    folder: string | null
    warnings: string[]
    entries: { id: string; kind: string; label: string; source: string; host: string | null }[]
  }> => ipcRenderer.invoke('registry:info'),

  /** Remember where ComfyUI is, without needing the upscale engine installed. */
  comfySetFolder: (folder: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('comfy:set-folder', folder),
  /** Scan a folder for upscale models, classify + remember them. */
  comfyScan: (folder: string): Promise<{ ok: boolean; models?: ComfyModel[]; error?: string }> =>
    ipcRenderer.invoke('comfy:scan', folder),
  /** The remembered, still-on-disk usable models. */
  comfyList: (): Promise<ComfyModel[]> => ipcRenderer.invoke('comfy:list'),
  /** Engine-install progress updates. */
  onComfyProgress: (cb: (p: { step: string; pct: number | null }) => void): (() => void) => {
    const listener = (_: unknown, p: { step: string; pct: number | null }): void => cb(p)
    ipcRenderer.on('comfy:progress', listener)
    return () => ipcRenderer.removeListener('comfy:progress', listener)
  },

  // Text-to-image generation (headless ComfyUI)
  /** Whether generation is available + the models to offer (checkpoints + Flux/
   * Z-Image/Krea, each tagged runnable or with what to download). */
  generateStatus: (): Promise<{ available: boolean } & GenModelScan> =>
    ipcRenderer.invoke('generate:status'),
  /** Run one generation; resolves with the saved image path (or an error). */
  generateRun: (id: string, opts: GenerateOptions): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('generate:run', id, opts),
  /** Cancel an in-flight generation. */
  generateCancel: (id: string): void => ipcRenderer.send('generate:cancel', id),
  /** Download the missing text-encoder/VAE files a model needs. */
  generateDownload: (id: string, model: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('generate:download', id, model),
  /** Progress of an in-flight companion download. */
  onGenerateDownloadProgress: (
    cb: (p: {
      id: string
      index: number
      total: number
      label: string
      filename: string
      pct: number | null
    }) => void
  ): (() => void) => {
    const listener = (
      _: unknown,
      p: {
        id: string
        index: number
        total: number
        label: string
        filename: string
        pct: number | null
      }
    ): void => cb(p)
    ipcRenderer.on('generate:download-progress', listener)
    return () => ipcRenderer.removeListener('generate:download-progress', listener)
  },
  /** Per-image progress (index >= 0) or a status message (index -1). */
  onGenerateProgress: (
    cb: (p: { id: string; index: number; pct?: number; message?: string }) => void
  ): (() => void) => {
    const listener = (
      _: unknown,
      p: { id: string; index: number; pct?: number; message?: string }
    ): void => cb(p)
    ipcRenderer.on('generate:progress', listener)
    return () => ipcRenderer.removeListener('generate:progress', listener)
  },
  /** An image in the batch finished (index + saved path). */
  onGenerateImage: (cb: (p: { id: string; index: number; path: string }) => void): (() => void) => {
    const listener = (_: unknown, p: { id: string; index: number; path: string }): void => cb(p)
    ipcRenderer.on('generate:image', listener)
    return () => ipcRenderer.removeListener('generate:image', listener)
  },

  // Remove Background availability (discloses the AI model + one-time download).
  removebgStatus: (): Promise<{ ready: boolean; uvAvailable: boolean }> =>
    ipcRenderer.invoke('removebg:status'),

  // Session persistence (queues + produced files survive close/reopen)
  sessionLoad: (): Promise<unknown> => ipcRenderer.invoke('session:load'),
  sessionSave: (data: unknown): void => ipcRenderer.send('session:save', data),
  filesExist: (paths: string[]): Promise<boolean[]> => ipcRenderer.invoke('files:exist', paths),

  // window controls (frameless)
  minimize: (): void => ipcRenderer.send('window:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('filesmith', api)

export type FilesmithApi = typeof api
