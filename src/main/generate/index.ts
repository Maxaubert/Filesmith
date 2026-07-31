import { app } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { reserveOutPath } from '../output'
import type { GenerateOptions } from '@shared/generate'
import { GEN_MAX_COUNT } from '@shared/generate'
import { buildWorkflow } from './workflow'
import { findGenerationModel } from './models'
import { resolveAgainstComfy } from './preflight'
import {
  ensureComfyServer,
  fetchImage,
  interruptComfy,
  openProgressSocket,
  queuePrompt,
  waitForImages
} from './comfy'

export { comfyGenerationAvailable, stopComfyServer } from './comfy'
export { downloadCompanions } from './companions'
export { findGenerationModels, scanGenerationModels, registryArchInfo } from './models'

let clientCounter = 0

/** A filename-safe slug from the start of the prompt. */
function slug(prompt: string): string {
  const s = prompt
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'image'
}

/**
 * Text-to-image. Generates the batch ONE image at a time (each its own prompt)
 * so results appear as they finish and each gets live sampler progress. Streams
 * per-image progress + completion through the callbacks.
 */
export async function generateImages(
  opts: GenerateOptions,
  onImage: (index: number, path: string) => void,
  onProgress: (index: number, pct: number) => void,
  onStatus: (message: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!opts.prompt.trim()) throw new Error('Enter a prompt to generate an image.')
  if (!opts.model) throw new Error('Pick a model to generate with.')

  // Resolve the model once so we know which workflow (SDXL checkpoint vs a
  // diffusion arch) to build and, for diffusion models, its loader wiring.
  const gm = findGenerationModel(opts.model)
  if (!gm) throw new Error('That model was not found. Try rescanning your ComfyUI folder.')
  if (!gm.runnable)
    throw new Error(
      gm.missing?.length
        ? `This model needs files first: ${gm.missing.map((m) => m.label).join(', ')}. Use "Download required files".`
        : (gm.reason ?? 'This model is not ready to use.')
    )

  onStatus('Connecting to ComfyUI…')
  const baseUrl = await ensureComfyServer(onStatus)

  // Reconcile names + node availability with the actual ComfyUI before queueing,
  // so a wrong path separator, a model this server can't see, or a too-old ComfyUI
  // fails with a clear message instead of a raw 400 / silent garbage.
  const resolved = await resolveAgainstComfy(baseUrl, gm)
  const clientId = `filesmith-${(clientCounter += 1)}`
  const count = Math.max(1, Math.min(GEN_MAX_COUNT, Math.round(opts.count || 1)))

  // Cancelling must also stop ComfyUI's in-flight job, not just our polling.
  signal?.addEventListener('abort', () => void interruptComfy(baseUrl))

  // Sequential, so only one image is in flight — a single "did this one start
  // sampling" flag drives the start-timeout for a stuck/incompatible checkpoint.
  let sawProgress = false
  const indexByPrompt = new Map<string, number>()
  const sock = openProgressSocket(baseUrl, clientId, (pid, value, max) => {
    const i = indexByPrompt.get(pid)
    if (i != null && max) {
      sawProgress = true
      onProgress(i, Math.round((value / max) * 100))
    }
  })

  try {
    for (let i = 0; i < count; i += 1) {
      if (signal?.aborted) throw new Error('Generation cancelled')
      // batch_size 1 per prompt; vary a fixed seed per image so they differ. Use
      // the names ComfyUI actually reported (resolved), not the filesystem guess.
      const perImage: GenerateOptions = {
        ...opts,
        model: resolved.model,
        count: 1,
        seed: opts.seed < 0 ? -1 : opts.seed + i
      }
      const wf = buildWorkflow(gm, perImage, resolved.wiring)
      sawProgress = false
      const promptId = await queuePrompt(baseUrl, wf, clientId)
      indexByPrompt.set(promptId, i)
      onStatus(count > 1 ? `Generating ${i + 1} of ${count}…` : 'Generating…')

      const imgs = await waitForImages(baseUrl, promptId, signal, () => sawProgress)
      const bytes = await fetchImage(baseUrl, imgs[0])
      const base = join(app.getPath('downloads'), `${slug(opts.prompt)}.png`)
      const out = reserveOutPath(base, '.png', 'generated')
      writeFileSync(out, bytes)
      onProgress(i, 100)
      onImage(i, out)
    }
  } finally {
    sock.close()
  }
}
