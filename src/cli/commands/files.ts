import type { FileInfo, JobOptions } from '@shared/types'
import type { Readiness } from '../../main/tools/readiness'
import type { CommandId, CommandSpec } from '../catalog'
import type { Reporter } from '../events'
import { dirname } from 'path'
import { CliError, EXIT, UsageError, reduceExit } from '../exit'
import { expandInputs } from '../inputs'
import type { CliIO } from '../io'
import { buildOptions, type PathState, type Warning } from '../options'
import type { ParsedArgs } from '../parse'
import { acceptsKind, planJobs, type PlanEnv, type PlanResult } from '../plan'
import { planPdfJobs } from '../planPdf'
import { emitNotReady, runPlanned, type QueueFactory, type RunTotals } from '../runner'
import { VERSION } from '../version'

export interface FileCommandDeps {
  queue: QueueFactory
  hasRar(): boolean
  readiness(id: CommandId, options: JobOptions): Promise<Readiness>
  /** comfy:<name or path> -> comfy:<absolute path of a scanned model>. */
  resolveUpscaleModel(value: string): string
  fileInfo(path: string): FileInfo
  statOutput(path: string): { outSize?: number; files?: number }
  pathState(path: string): PathState
  mkdirp(path: string): void
}

/** Why a missing --out folder could not be created, or undefined when it can
 * be: the nearest existing ancestor must be a folder (spec 2.4, so a dry run
 * and a real run end the same way). A missing drive has no such ancestor. */
export function uncreatableReason(
  outDir: string,
  pathState: (p: string) => PathState
): string | undefined {
  let p = outDir
  for (;;) {
    const parent = dirname(p)
    if (parent === p) return `the drive ${p} does not exist`
    const state = pathState(parent)
    if (state === 'dir') return undefined
    if (state === 'file') return `${parent} is a file, not a folder`
    p = parent
  }
}

function planAny(
  id: CommandId,
  files: FileInfo[],
  built: ReturnType<typeof buildOptions>,
  env: PlanEnv
): PlanResult {
  return id.startsWith('pdf ') && id !== 'pdf compress'
    ? planPdfJobs(id, files, built, env)
    : planJobs(id, files, built, env)
}

/** convert, compress, resize, upscale, removebg and the pdf tools. */
export async function runFileCommand(
  args: ParsedArgs,
  io: CliIO,
  reporter: Reporter,
  deps: FileCommandDeps,
  clock: () => number
): Promise<number> {
  const t0 = clock()
  const cmd = args.command as CommandSpec
  const id = cmd.id
  const built = buildOptions(cmd, args.values, { cwd: io.cwd, pathState: deps.pathState })
  if (id === 'upscale')
    built.options.upscaleModel = deps.resolveUpscaleModel(String(built.options.upscaleModel))
  if (!args.positionals.length)
    throw new UsageError(`filesmith ${cmd.path.join(' ')} needs at least one file.`, cmd.path)

  const outDir = built.outDir
  const outState = outDir ? deps.pathState(outDir) : 'dir'
  if (outState === 'file')
    throw new CliError('OUT_DIR_MISSING', `--out is a file, not a folder: ${outDir}`)
  if (outDir && outState === 'missing') {
    const why = uncreatableReason(outDir, deps.pathState)
    if (why)
      throw new CliError('OUT_DIR_MISSING', `Could not create the output folder ${outDir}: ${why}`)
  }
  if (outState === 'missing' && args.dryRun)
    built.warnings.push({
      code: 'OUT_DIR_CREATE',
      message: `Would create the output folder ${outDir}`
    })

  const expanded = await expandInputs(args.positionals, {
    cwd: io.cwd,
    recursive: args.values.recursive === true,
    accepts: (f) => acceptsKind(id, f),
    fileInfo: deps.fileInfo,
    readStdin: io.readStdin
  })
  const files = expanded.files.map((p) => deps.fileInfo(p))
  reporter.emit({
    event: 'run',
    command: cmd.path.join(' '),
    version: VERSION,
    dryRun: args.dryRun,
    inputs: files.length,
    options: built.options
  })

  const totals: RunTotals = { ok: 0, failed: 0, skipped: 0, canceled: 0, inBytes: 0, outBytes: 0 }
  const summary = (exitCode: number): number => {
    reporter.emit({ event: 'summary', ...totals, ms: clock() - t0, exitCode })
    return exitCode
  }
  // From here on events are out: a run-level failure (readiness, RAR, the
  // output folder) still ends with one summary whose counts match them.
  try {
    const readiness: Readiness = files.length
      ? await deps.readiness(id, built.options)
      : { ok: true }
    const plan = planAny(id, files, built, { outDir, hasRar: deps.hasRar(), readiness })
    const warnings: Warning[] = [...built.warnings, ...plan.warnings]
    for (const w of warnings) reporter.emit({ event: 'warning', ...w })

    for (const s of expanded.skipped) {
      reporter.emit({ event: 'skipped', input: s.path, code: s.code, message: s.message })
      totals.skipped++
    }
    for (const i of expanded.issues) {
      reporter.emit({ event: 'error', input: i.arg, code: i.code, message: i.message })
      totals.failed++
    }

    if (plan.runError || plan.jobs.length === 0) {
      for (const j of plan.jobs) totals[emitNotReady(j, reporter)]++
      const err =
        plan.runError ??
        (expanded.issues.length
          ? new CliError(expanded.issues[0].code, 'Nothing to run: no input was found.')
          : new CliError(
              'USAGE',
              `Nothing to run: no input is a file filesmith ${cmd.path.join(' ')} can take.`
            ))
      reporter.emit({ event: 'error', code: err.code, message: err.message, hint: err.hint })
      return summary(EXIT.USAGE)
    }

    if (args.dryRun) {
      for (const j of plan.jobs) {
        if (j.state === 'skip') {
          totals[emitNotReady(j, reporter)]++
          continue
        }
        reporter.emit({
          event: 'plan',
          id: j.id,
          input: j.inputs ?? j.input,
          inSize: j.inSize,
          op: j.op,
          output: j.output?.path,
          outputKind: j.output?.kind,
          ready: j.state === 'ready',
          code: j.code,
          message: j.message,
          hint: j.hint
        })
        if (j.state === 'ready') {
          totals.ok++
          totals.inBytes += j.inSize
        } else totals.failed++
      }
      return summary(totals.failed ? EXIT.FAILED : EXIT.OK)
    }

    if (outDir && outState === 'missing') {
      try {
        deps.mkdirp(outDir)
      } catch (e) {
        throw new CliError(
          'OUT_DIR_MISSING',
          `Could not create the output folder ${outDir}: ${(e as Error).message}`
        )
      }
    }
    const run = await runPlanned(
      plan.jobs,
      reporter,
      { queue: deps.queue, clock, statOutput: deps.statOutput },
      io.signal
    )
    for (const k of Object.keys(totals) as (keyof RunTotals)[]) totals[k] += run[k]
    return summary(reduceExit(totals))
  } catch (e) {
    if (!(e instanceof CliError)) throw e
    reporter.emit({ event: 'error', code: e.code, message: e.message, hint: e.hint })
    return summary(EXIT.USAGE)
  }
}
