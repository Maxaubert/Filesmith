import { basename } from 'path'
import type { GenerateOptions, DimCaps } from '@shared/generate'
import { clampDim } from '@shared/generate'
import { archInfoFor, type ArchInfo, type GenModel } from '@shared/genArch'
import { planFileInDir } from '../../main/output'
import { slug } from '../../main/generate'
import type { CommandSpec } from '../catalog'
import type { Reporter } from '../events'
import { CliError, EXIT, UsageError, reduceExit } from '../exit'
import type { CliIO } from '../io'
import { buildGenerateFlags, type PathState } from '../options'
import type { ParsedArgs } from '../parse'
import { classifyError } from '../runner'
import { uncreatableReason } from './files'
import { VERSION } from '../version'

export interface GenerateDeps {
  scan(): { models: GenModel[] }
  archInfo(): Record<string, ArchInfo>
  dimCaps(): Record<string, DimCaps>
  available(): Promise<boolean>
  generate(
    opts: GenerateOptions,
    onImage: (i: number, path: string) => void,
    onProgress: (i: number, pct: number) => void,
    onStatus: (m: string) => void,
    signal: AbortSignal
  ): Promise<void>
  /** Stops only a ComfyUI this process launched. */
  stop(): void
  pathState(p: string): PathState
  mkdirp(p: string): void
  outSize(p: string): number | undefined
}

/** Same rule as the app's Generate panel (renderer generate/restore.ts): a
 * restoration/refiner checkpoint is never the default. Pinned by a test. */
export function isRestoreName(label: string): boolean {
  return /supir|refiner|inpaint|upscal|controlnet/i.test(label)
}

export function pickModel(models: GenModel[], wanted?: string): GenModel | undefined {
  if (wanted) {
    const w = wanted.toLowerCase()
    return models.find(
      (m) =>
        m.name.toLowerCase() === w ||
        m.label.toLowerCase() === w ||
        basename(m.name).toLowerCase() === w
    )
  }
  return models.find((m) => m.runnable && !m.notImage && !isRestoreName(m.label))
}

const SETUP_COMFY = 'filesmith setup comfy --folder "<ComfyUI folder>"'

/** `filesmith generate "<prompt>"` (spec 3.6): one job per image. */
export async function runGenerate(
  args: ParsedArgs,
  io: CliIO,
  reporter: Reporter,
  deps: GenerateDeps,
  clock: () => number
): Promise<number> {
  const t0 = clock()
  const cmd = args.command as CommandSpec
  const flags = buildGenerateFlags(cmd, args.values, args.positionals, {
    cwd: io.cwd,
    pathState: deps.pathState
  })
  const outDir = flags.outDir ?? io.cwd
  const outState = deps.pathState(outDir)
  if (outState === 'file')
    throw new CliError('OUT_DIR_MISSING', `--out is a file, not a folder: ${outDir}`)
  if (outState === 'missing') {
    const why = uncreatableReason(outDir, deps.pathState)
    if (why)
      throw new CliError('OUT_DIR_MISSING', `Could not create the output folder ${outDir}: ${why}`)
  }

  const { models } = deps.scan()
  if (!models.length)
    throw new CliError(
      'SETUP_REQUIRED',
      'No image generation model was found in your ComfyUI folders.',
      SETUP_COMFY
    )
  const model = pickModel(models, flags.model)
  if (!model) {
    if (flags.model)
      throw new UsageError(
        `No generation model named "${flags.model}". See: filesmith formats generate`,
        cmd.path
      )
    throw new CliError(
      'SETUP_REQUIRED',
      'None of your generation models is ready to run.',
      'filesmith formats generate'
    )
  }
  if (!model.runnable) {
    if (model.missing?.length)
      throw new CliError(
        'SETUP_REQUIRED',
        `${model.label} needs files first: ${model.missing.map((m) => m.label).join(', ')}.`,
        `filesmith setup generate --model "${model.name}"`
      )
    if (!(flags.tryAnyway && model.tryAnyway))
      throw new CliError(
        'USAGE',
        model.reason ?? `${model.label} is not ready to use.`,
        model.tryAnyway ? 'add --try-anyway' : undefined
      )
  }
  if (!(await deps.available()))
    throw new CliError('SETUP_REQUIRED', 'ComfyUI was not found and is not running.', SETUP_COMFY)

  const info = deps.archInfo()[model.arch] ?? archInfoFor(model.arch)
  const caps = deps.dimCaps()[model.arch]
  const width = clampDim(flags.width, caps)
  const height = clampDim(flags.height, caps)
  const opts: GenerateOptions = {
    model: model.name,
    prompt: flags.prompt,
    negative: flags.negative,
    style: flags.style,
    width,
    height,
    count: flags.count,
    steps: flags.steps ?? info.steps,
    cfg: flags.cfg ?? info.cfg,
    guidance: flags.guidance ?? info.guidance,
    // Spec 3.6: done carries the seed, so a random one is picked here (same
    // range as the engine's) rather than per image deep in the workflow. Each
    // image then uses seed + i, exactly as with an explicit --seed.
    seed: flags.seed >= 0 || args.dryRun ? flags.seed : Math.floor(Math.random() * 1_000_000_000),
    tryAnyway: flags.tryAnyway,
    outDir
  }
  const op = `generate/${model.arch}`
  reporter.emit({
    event: 'run',
    command: 'generate',
    version: VERSION,
    dryRun: args.dryRun,
    inputs: flags.count,
    options: { ...opts }
  })
  if (flags.sizeExplicit && (width !== flags.width || height !== flags.height))
    reporter.emit({
      event: 'warning',
      code: 'SIZE_CLAMPED',
      message: `${model.label} supports ${width}x${height} here, not ${flags.width}x${flags.height}.`
    })
  if (flags.guidance !== undefined && !info.hasGuidance)
    reporter.emit({
      event: 'warning',
      code: 'GUIDANCE_IGNORED',
      message: `--guidance has no effect on ${model.label}; use --cfg.`
    })
  if (outState === 'missing' && args.dryRun)
    reporter.emit({
      event: 'warning',
      code: 'OUT_DIR_CREATE',
      message: `Would create the output folder ${outDir}`
    })

  const ids = Array.from({ length: flags.count }, (_, i) => String(i + 1))
  const totals = { ok: 0, failed: 0, skipped: 0, canceled: 0, inBytes: 0, outBytes: 0 }
  const summary = (exitCode: number): number => {
    reporter.emit({ event: 'summary', ...totals, ms: clock() - t0, exitCode })
    return exitCode
  }

  if (args.dryRun) {
    const claimed = new Set<string>()
    for (const id of ids)
      reporter.emit({
        event: 'plan',
        id,
        input: flags.prompt,
        inSize: 0,
        op,
        output: planFileInDir(outDir, slug(flags.prompt), '.png', 'generated', claimed),
        outputKind: 'file',
        ready: true
      })
    totals.ok = ids.length
    return summary(EXIT.OK)
  }

  if (outState === 'missing') {
    try {
      deps.mkdirp(outDir)
    } catch (e) {
      throw new CliError(
        'OUT_DIR_MISSING',
        `Could not create the output folder ${outDir}: ${(e as Error).message}`
      )
    }
  }
  const startedAt = new Map<number, number>()
  let current = 0
  const start = (i: number): void => {
    if (startedAt.has(i)) return
    startedAt.set(i, clock())
    reporter.emit({ event: 'start', id: ids[i], input: flags.prompt, inSize: 0, op })
  }
  try {
    await deps.generate(
      opts,
      (i, path) => {
        start(i)
        const size = deps.outSize(path)
        totals.ok++
        totals.outBytes += size ?? 0
        reporter.emit({
          event: 'done',
          id: ids[i],
          input: flags.prompt,
          output: path,
          outputKind: 'file',
          inSize: 0,
          outSize: size,
          ms: clock() - (startedAt.get(i) ?? clock()),
          seed: opts.seed >= 0 ? opts.seed + i : undefined
        })
        current = i + 1
      },
      (i, pct) => {
        start(i)
        current = i
        reporter.emit({ event: 'progress', id: ids[i], pct })
      },
      (message) => {
        if (current >= ids.length) return
        start(current)
        reporter.emit({ event: 'progress', id: ids[current], pct: null, message })
      },
      io.signal
    )
  } catch (e) {
    const left = ids.slice(totals.ok)
    if (io.signal.aborted) {
      for (const id of left) {
        reporter.emit({ event: 'canceled', id, input: flags.prompt })
        totals.canceled++
      }
    } else {
      const message = e instanceof Error ? e.message : String(e)
      const c = classifyError(message)
      left.forEach((id, k) => {
        reporter.emit({
          event: 'error',
          id,
          input: flags.prompt,
          code: c.code,
          message: k === 0 ? message : 'Not generated: an earlier image failed.',
          hint: k === 0 ? c.hint : undefined
        })
        totals.failed++
      })
    }
  } finally {
    deps.stop()
  }
  return summary(reduceExit(totals))
}
