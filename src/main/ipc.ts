import { open, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
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
import { toolAvailable, removebgStatus } from './toolResolver'
import { ensureUserNcnnDir, listNcnnModels, userNcnnDir } from './tools/ncnnModels'
import { probeDimensions, probeImageDimensions } from './probe'
import { makeThumbnail } from './thumbnail'
import { openPreviewWindow, getPreviewPayload, updatePreviewFiles } from './previewWindow'
import { targetsFor, toolsFor } from './tools/registry'
import { cudaTierSupport, detectNvidia } from './pid/gpu'
import { basename } from 'path'
import { pidInstalled, comfyEngineReady, pidEnvMarker, PID_BACKBONES } from './pid/paths'
import { installPid, installComfyEngine, removePidInstall, installInProgress } from './pid/install'
import { scanComfy, guessComfyFolder, findComfyPidWeights } from './comfy/discover'
import { readComfyStore, writeComfyStore, usableComfyModels } from './comfy/store'
import { comfyPythonReady, clearComfyPythonCache } from './comfy/pythonEnv'
import { loadSession, saveSession, filesExist } from './session'
import {
  generateImages,
  comfyGenerationAvailable,
  scanGenerationModels,
  registryArchInfo,
  registryDimCaps,
  downloadCompanions
} from './generate'
import { loadRegistry, layerDir, ensureUserLayers } from './registry/load'
import { importRegistryJson } from './registry/userLayer'
import type { GenerateOptions } from '@shared/generate'

// Only files Filesmith can actually act on. Everything else (exe, zip, docs, …)
// is hidden from the picker and dropped from drag-and-drop.
const bare = (exts: string[]): string[] => exts.map((e) => e.replace('.', ''))
function isSupported(f: FileInfo): boolean {
  return f.kind !== 'other'
}

/** Wire the renderer <-> engine channels for one window. */
export function registerIpc(win: BrowserWindow): JobQueue {
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
  ipcMain.handle('removebg:status', () => removebgStatus())
  // The AI upscalers actually present on disk (bundled + the user's overlay),
  // so the picker reflects what is installed instead of a build-time literal.
  ipcMain.handle('upscale:models', () => {
    ensureUserNcnnDir()
    return listNcnnModels().map((m) => ({ value: `esrgan:${m.name}`, label: m.label, user: m.user }))
  })
  ipcMain.handle('upscale:open-models-folder', async () => {
    ensureUserNcnnDir()
    await shell.openPath(userNcnnDir())
    return true
  })
  ipcMain.handle('files:classify', (_e, paths: string[]) =>
    paths.map(fileInfoFromPath).filter(isSupported)
  )
  // A single image, for the Remove Background backdrop. Separate from
  // files:pick because it feeds an option, not the queue.
  ipcMain.handle('image:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: bare(IMAGE_EXTS) }]
    })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })
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
  // Images go through ImageMagick instead: ffprobe rejects very large ones and
  // can't read svg/jxl/heic at all.
  ipcMain.handle('image:dimensions', (_e, p: string) => probeImageDimensions(p))
  ipcMain.handle('tools:for', (_e, file: FileInfo) => toolsFor(file))
  ipcMain.handle('tool:targets', (_e, id: ToolId, file: FileInfo) => targetsFor(id, file))

  // --- PiD Advanced (NVIDIA) upscaler tier -----------------------------------
  // Status drives the gated model option; install runs the one-click download,
  // streaming progress so the renderer can show a modal.
  // The backbone id comes from the caller (defaulting to the only wired one)
  // rather than being the literal 'flux' at the IPC boundary — that literal
  // appeared in four files and made a second backbone an app-wide edit.
  ipcMain.handle('pid:status', async (_e, backbone = 'flux') => {
    const gpu = await detectNvidia()
    // Report the compute-capability / driver verdict too, so a Pascal card is
    // turned away BEFORE a ~3 GB cu128 torch download rather than after it.
    const support = cudaTierSupport(gpu)
    return {
      nvidia: gpu,
      installed: pidInstalled(backbone),
      backbone,
      cudaOk: support.ok,
      cudaReason: support.reason ?? null
    }
  })
  // A visible way out of a poisoned install. pidInstalled() returns true on mere
  // existsSync, so a corrupt weight was otherwise unrecoverable from the UI.
  ipcMain.handle('pid:remove', () => removePidInstall())
  ipcMain.handle('pid:installing', () => installInProgress())
  ipcMain.handle('pid:install', async (_e, backbone = 'flux') => {
    try {
      await installPid(backbone, (step, pct) => win.webContents.send('pid:progress', { step, pct }))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // --- ComfyUI-imported upscale models ---------------------------------------
  // status: GPU + whether the spandrel engine is ready + the remembered folder
  // and usable model count. install: builds the shared torch env + spandrel (no
  // PiD weights). pick+scan: choose a ComfyUI folder, classify its upscalers,
  // remember them. list: the usable models for the picker.
  ipcMain.handle('comfy:status', async () => {
    // Never reject: a rejected status leaves the renderer's comfy.status null,
    // which would hide the whole "ComfyUI models" option.
    try {
      const gpu = await detectNvidia()
      const support = cudaTierSupport(gpu)
      const store = readComfyStore()
      return {
        // A GPU that cannot run the CUDA tier reads as "no GPU" for gating, and
        // carries the reason so the UI can say why instead of silently hiding.
        nvidia: support.ok ? gpu : null,
        cudaReason: support.ok ? null : (support.reason ?? null),
        // Ready with NO install when the user's ComfyUI Python already has
        // torch+spandrel; otherwise our own env must be built.
        engineReady: comfyEngineReady() || comfyPythonReady(),
        // The heavy torch env already present (e.g. PiD installed, or ComfyUI's
        // Python is usable) means setup is quick or unnecessary.
        envExists: existsSync(pidEnvMarker()) || comfyPythonReady(),
        // Whether the user's ComfyUI has PiD weights we can reuse — the UI only
        // offers PiD when it's reusable (or already installed).
        pidReusable: findComfyPidWeights(basename(PID_BACKBONES.flux.checkpointDir)) != null,
        folder: store?.folder ?? null,
        models: usableComfyModels()
      }
    } catch (e) {
      console.error('[comfy:status] failed:', e)
      return { nvidia: null, engineReady: false, envExists: false, folder: null, models: [] }
    }
  })
  ipcMain.handle('comfy:install', async () => {
    try {
      await installComfyEngine((step, pct) => win.webContents.send('comfy:progress', { step, pct }))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('comfy:pick-folder', async () => {
    // Open at the remembered folder (if it still exists), else the best guess at
    // a ComfyUI install, so a moved folder doesn't drop them in a blank Explorer.
    const stored = readComfyStore()?.folder
    const defaultPath = stored && existsSync(stored) ? stored : guessComfyFolder()
    const r = await dialog.showOpenDialog(win, {
      title: 'Select your ComfyUI folder',
      properties: ['openDirectory'],
      ...(defaultPath ? { defaultPath } : {})
    })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })
  // Record where ComfyUI is WITHOUT running a spandrel scan. The scan needs the
  // torch/spandrel engine, so routing every "here is my ComfyUI" through it made
  // the folder unsettable for anyone who hadn't done the ~3 GB engine download —
  // including generation users, who need no such engine. One pick from anywhere
  // now feeds generate, upscale and companion discovery alike.
  ipcMain.handle('comfy:set-folder', (_e, folder: string) => {
    try {
      if (!folder || !existsSync(folder)) return { ok: false, error: 'That folder no longer exists.' }
      writeComfyStore({ folder, models: readComfyStore()?.models ?? [] })
      clearComfyPythonCache()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('comfy:scan', async (_e, folder: string) => {
    try {
      // A newly-picked folder may bring its own ComfyUI Python into scope.
      writeComfyStore({ folder, models: readComfyStore()?.models ?? [] })
      clearComfyPythonCache()
      const models = await scanComfy(folder)
      writeComfyStore({ folder, models })
      return { ok: true, models }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('comfy:list', () => usableComfyModels())

  // --- Text-to-image generation (via headless ComfyUI) -----------------------
  ipcMain.handle('generate:status', async () => {
    const scan = scanGenerationModels()
    return {
      available: await comfyGenerationAvailable(),
      ...scan,
      archInfo: registryArchInfo(),
      dimCaps: registryDimCaps(),
      comfyFolder: readComfyStore()?.folder ?? null,
      registryWarnings: loadRegistry().warnings
    }
  })
  ipcMain.handle('generate:download', async (_e, id: string, model: string) => {
    try {
      await downloadCompanions(model, (p) => win.webContents.send('generate:download-progress', { id, ...p }))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  const genControllers = new Map<string, AbortController>()
  ipcMain.handle('generate:run', async (_e, id: string, opts: GenerateOptions) => {
    const ctrl = new AbortController()
    genControllers.set(id, ctrl)
    try {
      await generateImages(
        opts,
        (index, path) => win.webContents.send('generate:image', { id, index, path }),
        (index, pct) => win.webContents.send('generate:progress', { id, index, pct }),
        (message) => win.webContents.send('generate:progress', { id, index: -1, message }),
        ctrl.signal
      )
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      genControllers.delete(id)
    }
  })
  ipcMain.on('generate:cancel', (_e, id: string) => genControllers.get(id)?.abort())

  // --- The user's own model registry -----------------------------------------
  // "Add a model without waiting for a release": import a registry entry or a
  // ComfyUI "Export (API)" workflow, or just open the folder and edit by hand.
  ipcMain.handle('registry:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add a model (registry entry or ComfyUI API workflow)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths.length) return { ok: false }
    const path = r.filePaths[0]
    try {
      return importRegistryJson(path, await readFile(path, 'utf-8'))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('registry:open-folder', async () => {
    ensureUserLayers()
    const dir = layerDir('user')
    if (!dir) return false
    await shell.openPath(dir)
    return true
  })
  ipcMain.handle('registry:info', () => {
    const { entries, warnings } = loadRegistry()
    return {
      folder: layerDir('user'),
      warnings,
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        source: e.provenance.source,
        host: e.provenance.host ?? null
      }))
    }
  })

  // --- Session persistence (queues, produced files, options) -----------------
  ipcMain.handle('session:load', () => loadSession())
  ipcMain.on('session:save', (_e, data: unknown) => saveSession(data))
  ipcMain.handle('files:exist', (_e, paths: string[]) => filesExist(paths))

  return queue
}
