import type { FileInfo, JobOptions, ToolId } from '@shared/types'
import { canCompress, familyFormats, isSameFormat, routeConvert } from '@shared/convert'
import { needsRar } from '@shared/archive'
import { tabById } from '@shared/tabs'
import { baseName } from '@shared/fileKind'
import { planOutput, type PlannedOutput } from '../main/tools/plan'
import type { Readiness } from '../main/tools/readiness'
import { CliError, type ErrorCode } from './exit'
import type { CommandId } from './catalog'
import type { BuiltOptions, Warning } from './options'

export interface PlannedJob {
  /** 1-based, in input order: stable between a dry run and the real run. */
  id: string
  input: string
  /** pdf merge: every input in page order. */
  inputs?: string[]
  inSize: number
  tool: ToolId
  /** Engine route for the events: convert, archive/repack, pdf/merge, ... */
  op: string
  options: JobOptions
  output?: PlannedOutput
  state: 'ready' | 'skip' | 'error'
  code?: ErrorCode
  message?: string
  hint?: string
}

export interface PlanEnv {
  outDir?: string
  hasRar: boolean
  readiness: Readiness
}

export interface PlanResult {
  jobs: PlannedJob[]
  warnings: Warning[]
  /** Nothing can run: exit 2 after the per-file events (spec 2.7). */
  runError?: CliError
}

const QUALITY_TARGETS = ['.jpg', '.webp', '.avif', '.jxl']
const VERB: Partial<Record<CommandId, string>> = {
  convert: 'convert',
  compress: 'compress',
  resize: 'resize',
  upscale: 'upscale',
  removebg: 'remove the background of'
}

export function acceptsKind(id: CommandId, f: FileInfo): boolean {
  switch (id) {
    case 'convert':
      return tabById('convert').kinds.includes(f.kind)
    case 'compress':
      return canCompress(f.kind, f.ext)
    case 'resize':
    case 'upscale':
    case 'removebg':
      return f.kind === 'image'
    default:
      return f.kind === 'pdf'
  }
}

function toolOf(id: CommandId): ToolId {
  if (id === 'pdf compress') return 'compress'
  if (id.startsWith('pdf ')) return 'pdf'
  return id as ToolId
}

function planOne(
  id: CommandId,
  f: FileInfo,
  index: number,
  built: BuiltOptions,
  env: PlanEnv,
  claimed: Set<string>
): PlannedJob {
  const base = { id: String(index + 1), input: f.path, inSize: f.size }
  const tool = toolOf(id)
  const error = (code: ErrorCode, message: string): PlannedJob => ({
    ...base,
    tool,
    op: tool,
    options: {},
    state: 'error',
    code,
    message
  })
  const ready = (t: ToolId, op: string, options: JobOptions): PlannedJob => {
    const full: JobOptions = env.outDir ? { ...options, outDir: env.outDir } : options
    try {
      return {
        ...base,
        tool: t,
        op,
        options: full,
        output: planOutput(t, f, full, env.outDir, claimed),
        state: 'ready'
      }
    } catch (e) {
      return {
        ...base,
        tool: t,
        op,
        options: full,
        state: 'error',
        code: 'INTERNAL',
        message: (e as Error).message
      }
    }
  }

  if (!acceptsKind(id, f))
    return error('UNSUPPORTED_KIND', `Can't ${VERB[id] ?? id} ${f.ext || 'these'} files.`)

  if (id === 'convert') {
    const o = built.options
    const target = String(o.format)
    if (!familyFormats(f.kind, f.ext).some((x) => x.ext === target))
      return error('UNSUPPORTED_KIND', `Can't convert ${f.ext} to ${target}.`)
    if (isSameFormat(f.ext, target))
      return {
        ...base,
        tool: 'convert',
        op: 'convert',
        options: {},
        state: 'skip',
        code: 'SAME_FORMAT',
        message: `already ${target.slice(1)}`
      }
    const route = routeConvert(f.kind, f.ext, target)
    if (route.tool === 'archive')
      return ready('archive', `archive/${route.op}`, {
        op: route.op ?? 'repack',
        format: target,
        store: o.store,
        dpi: o.dpi,
        pageFormat: o.pageFormat,
        pageQuality: o.pageQuality
      })
    return ready('convert', 'convert', { format: target, quality: o.quality })
  }
  return ready(tool, tool === 'pdf' ? `pdf/${String(built.options.op)}` : tool, {
    ...built.options
  })
}

const count = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`

/** Up to three base names, then "+N more". */
function names(jobs: PlannedJob[]): string {
  const base = jobs.map((j) => baseName(j.input))
  const shown = base.slice(0, 3).join(', ')
  return base.length > 3 ? `${shown}, +${base.length - 3} more` : shown
}

function nothingToRun(
  id: CommandId,
  files: FileInfo[],
  jobs: PlannedJob[],
  options: JobOptions
): string {
  if (id !== 'convert') return `Nothing to run: no input is a file filesmith ${id} can take.`
  const target = String(options.format).slice(1)
  const skipped = jobs.filter((j) => j.state === 'skip')
  const failed = jobs.filter((j) => j.state === 'error')
  const parts: string[] = []
  if (skipped.length) parts.push(`${count(skipped.length)} skipped (already ${target})`)
  parts.push(`${count(failed.length)} cannot become ${target} (${names(failed)})`)
  const lists = files
    .filter((f) => f.kind !== 'other')
    .map((f) => familyFormats(f.kind, f.ext).map((x) => x.ext.slice(1)))
  const shared = lists.length ? lists.reduce((a, b) => a.filter((x) => b.includes(x))) : []
  const tail = shared.length
    ? ` Formats these inputs share: ${shared.join(', ')}.`
    : files.length > 1
      ? ' These inputs share no target format.'
      : ''
  return `Nothing to convert: ${parts.join(', ')}.${tail}`
}

/** Spec 2.7 and 4.4: decide everything before any file is touched. */
export function planJobs(
  id: CommandId,
  files: FileInfo[],
  built: BuiltOptions,
  env: PlanEnv
): PlanResult {
  if (!env.readiness.ok)
    throw new CliError(env.readiness.code, env.readiness.message, env.readiness.hint)
  const o = built.options
  if (id === 'convert' && needsRar(String(o.format)) && !env.hasRar)
    throw new CliError(
      'RAR_MISSING',
      'WinRAR not found. CBR and RAR output need WinRAR installed.',
      'filesmith doctor'
    )

  const claimed = new Set<string>()
  const jobs = files.map((f, i) => planOne(id, f, i, built, env, claimed))

  const warnings: Warning[] = []
  if (built.codecFor === 'video' && files.some((f) => f.kind === 'audio'))
    warnings.push({
      code: 'CODEC_IGNORED',
      message: `--codec ${String(o.videoCodec)} applies to video; audio files use --audio-codec ${String(o.audioCodec)}.`
    })
  if (built.codecFor === 'audio' && files.some((f) => f.kind === 'video'))
    warnings.push({
      code: 'CODEC_IGNORED',
      message: `--codec ${String(o.audioCodec)} applies to audio; video files use --video-codec ${String(o.videoCodec)}.`
    })
  if (
    id === 'convert' &&
    built.explicit.has('quality') &&
    !QUALITY_TARGETS.includes(String(o.format))
  )
    warnings.push({
      code: 'QUALITY_IGNORED',
      message: `--quality only affects jpg, webp, avif and jxl targets, not ${String(o.format).slice(1)}.`
    })

  const runnable = jobs.some((j) => j.state === 'ready')
  const failing = jobs.some((j) => j.state === 'error')
  return {
    jobs,
    warnings,
    runError:
      jobs.length && !runnable && failing
        ? new CliError('USAGE', nothingToRun(id, files, jobs, o))
        : undefined
  }
}
