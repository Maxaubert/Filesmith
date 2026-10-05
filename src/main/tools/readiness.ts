import { existsSync } from 'fs'
import type { JobOptions } from '@shared/types'
import { engineEnv } from '../env'
import { resolveRealesrgan, toolMissingMessage } from '../toolResolver'
import { cudaTierSupport, detectNvidia } from '../pid/gpu'
import { comfyEngineReady, pidInstalled } from '../pid/paths'
import { comfyPythonReady } from '../comfy/pythonEnv'
import { comfyModelByPath } from '../comfy/store'
import { listNcnnModels } from './ncnnModels'
import { bgModelOf } from './removebg'
import { installedRembgExe, rembgModelPresent } from '../rembg/paths'

export type ReadinessCode = 'SETUP_REQUIRED' | 'GPU_UNSUPPORTED' | 'TOOL_MISSING' | 'USAGE'
export type Readiness =
  { ok: true } | { ok: false; code: ReadinessCode; message: string; hint?: string }
export type SetupTool = 'pid' | 'spandrel' | 'removebg'

const CLI_WORDING: Record<SetupTool, string> = {
  pid: 'PiD is not installed.',
  spandrel: 'The ComfyUI upscaler engine (spandrel) is not set up.',
  removebg: 'Background removal is not set up yet.'
}
const APP_WORDING: Record<SetupTool, string> = {
  pid: 'PiD is not installed. Pick PiD in the options panel and click Download first.',
  spandrel: 'The ComfyUI upscaler engine is not set up yet. Set it up from the Upscale options.',
  removebg: 'Background removal is not set up yet.'
}

export function setupHint(tool: SetupTool): string {
  return `filesmith setup ${tool}`
}

/** The job-time message when an AI tool is missing: the CLI names its exact
 * setup command (the runner lifts it into the event's `hint`). */
export function notReadyMessage(tool: SetupTool): string {
  return engineEnv().host === 'cli'
    ? `${CLI_WORDING[tool]} Run: ${setupHint(tool)}.`
    : APP_WORDING[tool]
}

export interface ReadinessDeps {
  pidInstalled(): boolean
  cuda(): Promise<{ ok: boolean; reason?: string }>
  comfyEngineReady(): boolean
  comfyModelKnown(path: string): boolean
  realesrganPresent(): boolean
  ncnnNames(): string[]
  rembgInstalled(): boolean
  rembgModelPresent(model: string): boolean
}

const setup = (tool: SetupTool): Readiness => ({
  ok: false,
  code: 'SETUP_REQUIRED',
  message: CLI_WORDING[tool],
  hint: setupHint(tool)
})

/** Pre-flight for upscale (spec 5.1). Never downloads. */
export async function upscaleReadiness(
  options: JobOptions,
  deps: ReadinessDeps
): Promise<Readiness> {
  const model = String(options.upscaleModel ?? 'photo')
  if (model === 'pid' || model.startsWith('comfy:')) {
    const gpu = await deps.cuda()
    if (!gpu.ok)
      return {
        ok: false,
        code: 'GPU_UNSUPPORTED',
        message: gpu.reason ?? 'This GPU cannot run the CUDA upscalers.'
      }
    if (model === 'pid') return deps.pidInstalled() ? { ok: true } : setup('pid')
    if (!deps.comfyEngineReady()) return setup('spandrel')
    if (!deps.comfyModelKnown(model.slice('comfy:'.length)))
      return {
        ok: false,
        code: 'SETUP_REQUIRED',
        message: 'That ComfyUI model is not in the scanned list.',
        hint: 'filesmith setup spandrel --comfy "<ComfyUI folder>"'
      }
    return { ok: true }
  }
  if (model === 'comfy')
    return {
      ok: false,
      code: 'USAGE',
      message: 'Name a ComfyUI model: --model comfy:<model file>.',
      hint: 'filesmith formats upscale'
    }
  if (!deps.realesrganPresent())
    return {
      ok: false,
      code: 'TOOL_MISSING',
      message: toolMissingMessage('realesrgan-ncnn-vulkan'),
      hint: 'filesmith doctor'
    }
  const names = deps.ncnnNames()
  const wanted = model.startsWith('esrgan:') ? model.slice('esrgan:'.length) : null
  if (wanted && !names.some((n) => n.toLowerCase() === wanted.toLowerCase()))
    return {
      ok: false,
      code: 'USAGE',
      message: `No Real-ESRGAN model named "${wanted}". Installed: ${names.join(', ') || 'none'}.`,
      hint: 'filesmith formats upscale'
    }
  return { ok: true }
}

/** Pre-flight for removebg: the installed tool AND the chosen model file. */
export function removebgReadiness(options: JobOptions, deps: ReadinessDeps): Readiness {
  const model = bgModelOf(options)
  return deps.rembgInstalled() && deps.rembgModelPresent(model) ? { ok: true } : setup('removebg')
}

export const defaultReadinessDeps: ReadinessDeps = {
  pidInstalled: () => pidInstalled('flux'),
  cuda: async () => cudaTierSupport(await detectNvidia()),
  comfyEngineReady: () => comfyEngineReady() || comfyPythonReady(),
  comfyModelKnown: (p) => comfyModelByPath(p) != null,
  realesrganPresent: () => existsSync(resolveRealesrgan()),
  ncnnNames: () => listNcnnModels().map((m) => m.name),
  rembgInstalled: () => installedRembgExe() != null,
  rembgModelPresent
}
