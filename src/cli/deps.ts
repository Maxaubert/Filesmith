import { existsSync, mkdirSync, rmSync } from 'fs'
import { basename, extname, join, resolve } from 'path'
import { formatBytes } from '@shared/compress'
import { JobQueue } from '../main/jobQueue'
import { fileInfoFromPath } from '../main/fileInfo'
import { resolveRar } from '../main/toolResolver'
import { mergeComfyStore, usableComfyModels } from '../main/comfy/store'
import { cudaTierSupport, detectNvidia } from '../main/pid/gpu'
import { comfyEngineReady, pidInstalled, pidRoot } from '../main/pid/paths'
import { installComfyEngine, installPid } from '../main/pid/install'
import { clearComfyPythonCache, comfyPythonReady } from '../main/comfy/pythonEnv'
import { scanComfy } from '../main/comfy/discover'
import { downloadCompanions } from '../main/generate/companions'
import { listNcnnModels, userNcnnDir } from '../main/tools/ncnnModels'
import {
  installedRembgExe,
  rembgModelDir,
  rembgModelPresent,
  rembgToolDir
} from '../main/rembg/paths'
import { setupRembg } from '../main/rembg/setup'
import { isStale, readLock } from '../main/locks'
import { folderStats, freeBytesAt, moveToRecycleBin, tooBigForRecycleBin } from '../main/recycle'
import { engineEnv } from '../main/env'
import { defaultReadinessDeps, removebgReadiness, upscaleReadiness } from '../main/tools/readiness'
import {
  comfyGenerationAvailable,
  generateImages,
  registryArchInfo,
  registryDimCaps,
  scanGenerationModels,
  stopComfyServer
} from '../main/generate'
import type { FileCommandDeps } from './commands/files'
import type { GenerateDeps } from './commands/generate'
import type { SetupDeps } from './commands/setup'
import { UsageError } from './exit'
import { pathState } from './inputs'
import type { CliDeps } from './main'
import { statOutput } from './runner'

/** comfy:<model file name, stem or path> -> comfy:<absolute path> (spec 3.4). */
export function resolveUpscaleModel(value: string): string {
  if (!value.startsWith('comfy:')) return value
  const want = value.slice('comfy:'.length)
  const models = usableComfyModels()
  const lower = want.toLowerCase()
  const hit =
    models.find((m) => m.path.toLowerCase() === resolve(want).toLowerCase()) ??
    models.find(
      (m) =>
        basename(m.path).toLowerCase() === lower ||
        basename(m.path, extname(m.path)).toLowerCase() === lower
    )
  if (!hit)
    throw new UsageError(
      `No scanned ComfyUI upscaler matches "${want}". See: filesmith formats upscale`,
      ['upscale'],
      models.length
        ? 'filesmith formats upscale'
        : 'filesmith setup spandrel --comfy "<ComfyUI folder>"'
    )
  return `comfy:${hit.path}`
}

export function defaultFileDeps(): FileCommandDeps {
  return {
    // allowDownload false: a job that would fetch a model or runtime fails with
    // "Run: filesmith setup <tool>" instead (spec M5).
    queue: (emit) => new JobQueue(emit, undefined, { allowDownload: false }),
    hasRar: () => resolveRar() != null,
    readiness: async (id, options) =>
      id === 'upscale'
        ? upscaleReadiness(options, defaultReadinessDeps)
        : id === 'removebg'
          ? removebgReadiness(options, defaultReadinessDeps)
          : { ok: true },
    resolveUpscaleModel,
    fileInfo: fileInfoFromPath,
    statOutput,
    pathState,
    mkdirp: (p) => {
      mkdirSync(p, { recursive: true })
    }
  }
}

export function defaultGenerateDeps(): GenerateDeps {
  return {
    scan: () => scanGenerationModels(),
    archInfo: () => registryArchInfo(),
    dimCaps: () => registryDimCaps(),
    available: () => comfyGenerationAvailable(),
    generate: (opts, onImage, onProgress, onStatus, signal) =>
      generateImages(opts, onImage, onProgress, onStatus, signal),
    stop: () => stopComfyServer(),
    pathState,
    mkdirp: (p) => {
      mkdirSync(p, { recursive: true })
    },
    outSize: (p) => statOutput(p).outSize
  }
}

async function removeTool(
  target: 'pid' | 'removebg',
  o: { permanent: boolean; dryRun: boolean }
): Promise<string> {
  const lock = readLock(target === 'pid' ? 'pid-env' : 'rembg')
  if (lock && !isStale(lock))
    throw new Error(
      `Another Filesmith (${lock.host}, pid ${lock.pid}) is installing right now. Wait for it to finish.`
    )
  const paths = (
    target === 'pid' ? [pidRoot()] : [join(rembgToolDir(), 'rembg'), rembgModelDir()]
  ).filter((p) => existsSync(p))
  if (!paths.length) return 'nothing, it is not installed'
  const items = paths.map((p) => ({ p, ...folderStats(p) }))
  const desc = items.map((i) => `${i.p} (${formatBytes(i.bytes)})`).join(', ')
  const big = items.filter(tooBigForRecycleBin)
  if (o.dryRun)
    return big.length && !o.permanent
      ? `${desc}; too large for the Recycle Bin, needs --permanent`
      : desc
  if (big.length && !o.permanent)
    throw new Error(
      `${big[0].p} is ${formatBytes(big[0].bytes)}, too large for the Recycle Bin. Run again with --permanent to delete it for good.`
    )
  for (const i of items) {
    if (tooBigForRecycleBin(i)) rmSync(i.p, { recursive: true, force: true })
    else await moveToRecycleBin(i.p)
  }
  return desc
}

export function defaultSetupDeps(): SetupDeps {
  return {
    cuda: async () => cudaTierSupport(await detectNvidia()),
    pidInstalled: () => pidInstalled('flux'),
    installPid: (p, o) => installPid('flux', p, o),
    comfyReady: () => comfyEngineReady() || comfyPythonReady(),
    installComfyEngine: (p, o) => installComfyEngine(p, o),
    setComfy: (patch) => {
      mergeComfyStore(patch)
      clearComfyPythonCache()
    },
    scanComfy: async (folder) => {
      const models = await scanComfy(folder)
      mergeComfyStore({ folder, models })
      return models
    },
    generationModels: () => scanGenerationModels().models,
    rembgReady: (m) => installedRembgExe() != null && rembgModelPresent(m),
    setupRembg,
    downloadCompanions,
    ncnnModels: () => listNcnnModels().map((m) => ({ name: m.name, label: m.label, user: m.user })),
    userNcnnDir,
    pathState,
    removeTool,
    freeBytes: () => freeBytesAt(engineEnv().userData),
    userData: () => engineEnv().userData
  }
}

export function defaultDeps(): CliDeps {
  return {
    clock: Date.now,
    files: defaultFileDeps(),
    generate: defaultGenerateDeps(),
    setup: defaultSetupDeps()
  }
}
