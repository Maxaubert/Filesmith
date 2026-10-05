import { extname, resolve } from 'path'
import type { JobOptions } from '@shared/types'
import { normalizeExt } from '@shared/convert'
import { BG_DEFAULTS, hexToRgb } from '@shared/removebg'
import { fileKind } from '@shared/fileKind'
import { normalizePageRange } from '../main/tools/pdf'
import { VIDEO_CODEC_VALUES, flagOf, type CommandSpec, type FlagSpec } from './catalog'
import { UsageError } from './exit'

export type RawFlags = Record<string, string | boolean>
export interface Warning {
  code: string
  message: string
}
export type PathState = 'file' | 'dir' | 'missing'
export interface BuildContext {
  cwd: string
  pathState(p: string): PathState
}
export interface BuiltOptions {
  options: JobOptions
  warnings: Warning[]
  outDir?: string
  /** Flag names the user actually typed (some warnings only apply then). */
  explicit: Set<string>
  /** Which kind a bare --codec addressed (spec 3.2). */
  codecFor?: 'video' | 'audio'
}
type Value = string | number | boolean

function validList(f: FlagSpec): string {
  if (f.values)
    return f.values.join(', ') + (f.type === 'enumOrInt' ? `, or ${f.min}-${f.max}` : '')
  if (f.min !== undefined && f.max !== undefined)
    return `${f.min}-${f.max}${f.step ? ` in steps of ${f.step}` : ''}`
  return ''
}

/** One flag value -> the typed value the app stores (spec 2.3). */
export function coerce(f: FlagSpec, raw: string | boolean, cmdPath: string[] = []): Value {
  const flag = `--${f.name}`
  const bad = (why = ''): never => {
    const list = validList(f)
    throw new UsageError(
      `Invalid value '${String(raw)}' for ${flag}.${why ? ` ${why}` : ''}${list ? ` Valid: ${list}.` : ''}`,
      cmdPath
    )
  }
  if (f.type === 'bool') return typeof raw === 'boolean' ? raw : bad()
  if (typeof raw !== 'string') throw new UsageError(`${flag} needs a value.`, cmdPath)
  let v = raw.trim()
  if (f.suffix && v.toLowerCase().endsWith(f.suffix)) v = v.slice(0, -f.suffix.length).trim()
  const num = (int: boolean): number => {
    const n = Number(v)
    if (v === '' || !Number.isFinite(n)) return bad()
    if (int && !Number.isInteger(n)) return bad('Use a whole number.')
    if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) return bad()
    if (f.step) {
      const k = (n - (f.min ?? 0)) / f.step
      if (Math.abs(k - Math.round(k)) > 1e-9) return bad()
    }
    return n
  }
  const pick = (): string | undefined => f.values?.find((x) => x.toLowerCase() === v.toLowerCase())
  switch (f.type) {
    case 'format': {
      const ext = normalizeExt(v)
      return f.values?.includes(ext.slice(1)) ? ext : bad()
    }
    case 'enum': {
      const hit = pick()
      if (hit === undefined) return bad()
      const mapped = f.map?.[hit] ?? hit
      return f.numeric ? Number(mapped) : mapped
    }
    case 'enumOrInt':
      return pick() ?? num(true)
    case 'int':
      return num(true)
    case 'number':
      return num(false)
    case 'text':
    case 'path':
      return v ? v : bad()
  }
}

/** Fold alias keys (--dpi, --grayscale) onto the flag's own name, as the parser does. */
function canonical(cmd: CommandSpec, raw: RawFlags): RawFlags {
  const out: RawFlags = {}
  for (const [k, v] of Object.entries(raw)) {
    const f = cmd.flags.find((x) => x.name === k || x.aliases?.includes(k))
    out[f ? f.name : k] = v
  }
  return out
}

function reader(cmd: CommandSpec, raw: RawFlags) {
  const get = (name: string): Value | undefined =>
    raw[name] === undefined ? undefined : coerce(flagOf(cmd, name), raw[name], cmd.path)
  const def = (name: string): Value => {
    const f = flagOf(cmd, name)
    const d = typeof f.def === 'string' && f.map?.[f.def] ? f.map[f.def] : f.def
    return (f.numeric && d !== undefined ? Number(d) : d) as Value
  }
  return { get, val: (name: string): Value => get(name) ?? def(name) }
}

/** Flag values -> the app's JobOptions for one file command (spec 3.1-3.7). */
export function buildOptions(cmd: CommandSpec, given: RawFlags, ctx: BuildContext): BuiltOptions {
  const raw = canonical(cmd, given)
  const { get, val } = reader(cmd, raw)
  const explicit = new Set(Object.keys(raw))
  const warnings: Warning[] = []
  const usage = (m: string): never => {
    throw new UsageError(m, cmd.path)
  }
  const out = cmd.flags.some((f) => f.name === 'out') ? get('out') : undefined
  const outDir = typeof out === 'string' ? resolve(ctx.cwd, out) : undefined
  let options: JobOptions
  let codecFor: BuiltOptions['codecFor']

  switch (cmd.id) {
    case 'convert': {
      const to = get('to')
      if (to === undefined) usage('filesmith convert needs --to <format>, e.g. --to webp.')
      options = {
        format: to as string,
        quality: val('quality') as string | number,
        store: val('compression') === 'store',
        dpi: val('resolution') as number,
        pageFormat: val('page-format') as string,
        pageQuality: val('page-quality') as number
      }
      break
    }
    case 'compress': {
      const codec = get('codec') as string | undefined
      let videoCodec = val('video-codec') as string
      let audioCodec = val('audio-codec') as string
      if (codec !== undefined) {
        if (VIDEO_CODEC_VALUES.includes(codec)) {
          if (explicit.has('video-codec')) usage('Use --codec or --video-codec, not both.')
          videoCodec = codec
          codecFor = 'video'
        } else {
          if (explicit.has('audio-codec')) usage('Use --codec or --audio-codec, not both.')
          audioCodec = codec
          codecFor = 'audio'
        }
      }
      const pdfLevel = val('level') as string
      const pdfGray = val('greyscale') as boolean
      if (pdfGray && pdfLevel === 'lossless')
        warnings.push({
          code: 'GREYSCALE_IGNORED',
          message: '--greyscale has no effect with --level lossless.'
        })
      options = {
        quality: val('quality') as number,
        imageFormat: val('format') as string,
        videoCodec,
        scale: val('scale') as number,
        audioCodec,
        audioBitrate: val('bitrate') as number,
        pdfLevel,
        pdfGray
      }
      break
    }
    case 'pdf compress': {
      const pdfLevel = val('level') as string
      const pdfGray = val('greyscale') as boolean
      if (pdfGray && pdfLevel === 'lossless')
        warnings.push({
          code: 'GREYSCALE_IGNORED',
          message: '--greyscale has no effect with --level lossless.'
        })
      options = { pdfLevel, pdfGray }
      break
    }
    case 'resize': {
      const pct = get('percent')
      const w = get('width') as number | undefined
      const h = get('height') as number | undefined
      const mode = get('mode')
      const hasDim = w !== undefined || h !== undefined
      if ((pct !== undefined || mode === 'percent') && hasDim)
        usage('Use --percent or --width/--height, not both.')
      const dims = hasDim || mode === 'dimensions'
      if (dims && !hasDim) usage('--mode dimensions needs --width or --height.')
      const fit = val('fit') as string
      if (w !== undefined && h !== undefined && fit === 'contain')
        warnings.push({
          code: 'DIMENSION_MAY_BE_IGNORED',
          message:
            'With --fit contain and both --width and --height the image keeps its aspect, so one of them may have no effect. Use --fit stretch to force both.'
        })
      options = dims
        ? { mode: 'dimensions', percent: 50, width: w ?? '', height: h ?? '', fit }
        : { mode: 'percent', percent: val('percent') as number, width: '', height: '', fit }
      break
    }
    case 'upscale': {
      const given = String(val('model'))
      const lower = given.toLowerCase()
      let model: string
      if (lower === 'photo' || lower === 'anime' || lower === 'pid') model = lower
      else if (lower === 'comfy') return usage('Name a ComfyUI model: --model comfy:<model file>.')
      else if (lower.startsWith('comfy:')) model = `comfy:${given.slice(6)}`
      else if (lower.startsWith('esrgan:')) model = `esrgan:${given.slice(7)}`
      else model = `esrgan:${given}`
      let factor = get('factor') as number | undefined
      if (model === 'pid') {
        if (factor !== undefined && factor !== 4)
          usage('--model pid upscales 4x only; leave out --factor or use --factor 4.')
        factor = 4
      }
      options = {
        upscaleFactor: factor ?? (val('factor') as number),
        upscaleModel: model,
        gpuMode: val('gpu') as string
      }
      break
    }
    case 'removebg': {
      const color = get('color') as string | undefined
      const image = get('image') as string | undefined
      let fill = get('fill') as string | undefined
      if (color !== undefined) {
        if (!hexToRgb(color))
          usage(`Invalid value '${color}' for --color. Use #rrggbb, e.g. #00b140.`)
        if (fill === undefined) fill = 'custom'
        else if (fill !== 'custom') usage('--color needs --fill custom (or leave out --fill).')
      }
      let bgImagePath = ''
      if (image !== undefined) {
        const abs = resolve(ctx.cwd, image)
        if (ctx.pathState(abs) !== 'file' || fileKind(extname(abs)) !== 'image')
          usage(`--image must be an existing image file: ${abs}`)
        bgImagePath = abs
        if (fill === undefined) fill = 'image'
        else if (fill !== 'image') usage('--image needs --fill image (or leave out --fill).')
      }
      fill = fill ?? (val('fill') as string)
      if (fill === 'image' && !bgImagePath) usage('--fill image needs --image <path>.')
      const hex = color
        ? (color.startsWith('#') ? color : `#${color}`).toLowerCase()
        : BG_DEFAULTS.bgCustomColor
      options = { ...BG_DEFAULTS, bgFill: fill, bgCustomColor: hex, bgImagePath }
      break
    }
    case 'pdf merge':
      options = { op: 'merge' }
      break
    case 'pdf split': {
      const pages = get('pages') as string | undefined
      if (pages === undefined) usage('filesmith pdf split needs --pages, e.g. --pages 1-3,5.')
      const range = normalizePageRange(pages as string)
      if (!range)
        usage(`Invalid value '${pages}' for --pages. Use page numbers and ranges, e.g. 1-3,5,8-10.`)
      options = { op: 'split-range', range: range as string }
      break
    }
    case 'pdf burst':
      options = { op: 'split-pages' }
      break
    case 'pdf extract-text':
      options = { op: 'extract-text' }
      break
    case 'pdf to-images':
      options = { op: 'pages-to-images', dpi: val('resolution') as number }
      break
    case 'pdf extract-images':
      options = { op: 'extract-images' }
      break
    default:
      throw new Error(`buildOptions does not handle ${cmd.id}`)
  }
  return { options, warnings, outDir, explicit, codecFor }
}

export interface GenerateFlags {
  prompt: string
  model?: string
  negative: string
  style: string
  count: number
  width: number
  height: number
  /** True when --size, --width or --height was typed (clamping then warns). */
  sizeExplicit: boolean
  steps?: number
  cfg?: number
  guidance?: number
  seed: number
  tryAnyway: boolean
  outDir?: string
}

/** Flag values for `filesmith generate` (spec 3.6). Model-dependent defaults
 * (steps, cfg, guidance, size caps) are applied by the command once the model
 * is known. */
export function buildGenerateFlags(
  cmd: CommandSpec,
  given: RawFlags,
  positionals: string[],
  ctx: BuildContext
): GenerateFlags {
  const raw = canonical(cmd, given)
  const { get, val } = reader(cmd, raw)
  const prompt = positionals.join(' ').trim()
  if (!prompt)
    throw new UsageError(
      'filesmith generate needs a prompt, e.g. filesmith generate "a red kettle".',
      cmd.path
    )
  const size = String(val('size'))
  const m = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(size)
  if (!m)
    throw new UsageError(`Invalid value '${size}' for --size. Use WxH, e.g. 1216x832.`, cmd.path)
  const out = get('out')
  return {
    prompt,
    model: get('model') as string | undefined,
    negative: val('negative') as string,
    style: val('style') as string,
    count: val('count') as number,
    width: (get('width') as number | undefined) ?? Number(m[1]),
    height: (get('height') as number | undefined) ?? Number(m[2]),
    sizeExplicit: ['size', 'width', 'height'].some((k) => raw[k] !== undefined),
    steps: get('steps') as number | undefined,
    cfg: get('cfg') as number | undefined,
    guidance: get('guidance') as number | undefined,
    seed: (get('seed') as number | undefined) ?? -1,
    tryAnyway: get('try-anyway') === true,
    outDir: typeof out === 'string' ? resolve(ctx.cwd, out) : undefined
  }
}
