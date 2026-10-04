import { mkdirSync } from 'fs'
import { basename, extname, resolve } from 'path'
import { JobQueue } from '../main/jobQueue'
import { fileInfoFromPath } from '../main/fileInfo'
import { resolveRar } from '../main/toolResolver'
import { usableComfyModels } from '../main/comfy/store'
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

export function defaultDeps(): CliDeps {
  return { clock: Date.now, files: defaultFileDeps(), generate: defaultGenerateDeps() }
}
