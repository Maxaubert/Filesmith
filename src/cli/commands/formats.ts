import { basename } from 'path'
import { COMPRESSIBLE_IMAGE_EXTS, familyFormats } from '@shared/convert'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  IMAGE_FORMATS as COMPRESS_FORMATS,
  PDF_LEVELS,
  UPSCALE_FACTORS,
  VIDEO_CODECS
} from '@shared/compress'
import { RESIZE_FITS } from '@shared/resize'
import { BG_FILLS } from '@shared/removebg'
import { GEN_SIZES, GEN_STYLES } from '@shared/generate'
import { ARCHIVE_EXTS, AUDIO_EXTS, IMAGE_EXTS, TEXT_EXTS, VIDEO_EXTS } from '@shared/fileKind'
import type { ComfyModel } from '@shared/comfy'
import type { GenModel } from '@shared/genArch'
import { SUBCOMMANDS } from '../catalog'
import type { Reporter } from '../events'
import { UsageError } from '../exit'
import { wrap } from '../help'
import type { ParsedArgs } from '../parse'

export interface FormatsDeps {
  hasRar(): boolean
  ncnnModels(): { name: string; label: string; user: boolean }[]
  comfyModels(): ComfyModel[]
  comfyReady(): boolean
  pidInstalled(): boolean
  cudaOk(): Promise<boolean>
  rembgReady(): boolean
  generationModels(): GenModel[]
}

const bare = (exts: string[]): string[] => exts.map((e) => e.replace(/^\./, ''))
const targets = (kind: Parameters<typeof familyFormats>[0], ext: string): string[] =>
  bare(familyFormats(kind, ext).map((f) => f.ext))
const SHIPPED_ALIAS: Record<string, string> = {
  'realesrgan-x4plus': 'photo',
  'realesrgan-x4plus-anime': 'anime'
}

/** Everything a `--to`, `--model` or option value can be, with readiness
 * (spec 3.8). Data first: the human view renders the same object. */
export async function buildFormats(
  deps: FormatsDeps
): Promise<Record<string, Record<string, unknown>>> {
  const cuda = await deps.cudaOk()
  return {
    convert: {
      groups: [
        { group: 'image', from: bare(IMAGE_EXTS), to: targets('image', '.png') },
        { group: 'video', from: bare(VIDEO_EXTS), to: targets('video', '.mp4') },
        { group: 'audio', from: bare(AUDIO_EXTS), to: targets('audio', '.mp3') },
        {
          group: 'doc',
          from: ['pdf', 'docx', 'doc', 'odt', 'rtf', ...bare(TEXT_EXTS)],
          to: targets('document', '.docx'),
          note: 'a .pdf also converts to cbz, cbr, cb7, cbt'
        },
        {
          group: 'sheet',
          from: ['xlsx', 'xls', 'ods', 'csv', 'tsv'],
          to: targets('document', '.xlsx')
        },
        { group: 'slide', from: ['pptx', 'ppt', 'odp'], to: targets('document', '.pptx') },
        { group: 'archive', from: bare(ARCHIVE_EXTS), to: targets('archive', '.zip') }
      ],
      rar: deps.hasRar()
    },
    compress: {
      images: bare(COMPRESSIBLE_IMAGE_EXTS),
      format: COMPRESS_FORMATS.map((f) => f.value),
      videoCodecs: VIDEO_CODECS.map((c) => c.value),
      audioCodecs: AUDIO_CODECS.map((c) => c.value),
      bitrates: [...AUDIO_BITRATES],
      levels: PDF_LEVELS.map((l) => l.value)
    },
    resize: { fits: RESIZE_FITS.map((f) => f.value) },
    upscale: {
      factors: [...UPSCALE_FACTORS],
      gpu: ['full', 'balanced'],
      models: [
        ...deps.ncnnModels().map((m) => ({
          value: SHIPPED_ALIAS[m.name] ?? m.name,
          label: m.label,
          engine: 'realesrgan',
          ready: true,
          ...(m.user ? { user: true } : {})
        })),
        { value: 'pid', label: 'PiD, 4x only', engine: 'pid', ready: cuda && deps.pidInstalled() },
        ...deps.comfyModels().map((m) => ({
          value: `comfy:${basename(m.path)}`,
          label: m.name,
          engine: 'comfy',
          ready: cuda && deps.comfyReady(),
          badge: m.badge
        }))
      ]
    },
    removebg: { fills: BG_FILLS.map((f) => f.value), ready: deps.rembgReady() },
    generate: {
      styles: GEN_STYLES.map((s) => s.id),
      sizes: GEN_SIZES.map((s) => `${s.width}x${s.height}`),
      models: deps.generationModels().map((m) => ({
        name: m.name,
        label: m.label,
        arch: m.arch,
        runnable: m.runnable,
        ...(m.missing?.length ? { missing: m.missing.map((f) => f.label) } : {}),
        ...(!m.runnable && m.reason ? { reason: m.reason } : {})
      }))
    },
    pdf: { tools: SUBCOMMANDS.pdf }
  }
}

function describeItem(o: Record<string, unknown>): string {
  const id = String(o.value ?? o.name ?? o.group ?? '')
  const rest = Object.entries(o)
    .filter(([k]) => !['value', 'name', 'group'].includes(k))
    .map(([k, v]) =>
      typeof v === 'boolean'
        ? v
          ? k
          : `not ${k}`
        : Array.isArray(v)
          ? `${k}: ${v.join(', ')}`
          : `${k}: ${String(v)}`
    )
  return `${id}: ${rest.join('; ')}`
}

export function renderFormats(data: Record<string, Record<string, unknown>>): string {
  const out: string[] = []
  for (const [section, body] of Object.entries(data)) {
    out.push(section.toUpperCase())
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v) && v.some((x) => typeof x === 'object')) {
        out.push(`  ${k}:`)
        for (const item of v)
          out.push(
            ...wrap(describeItem(item as Record<string, unknown>), 80, 8).map((l, i) =>
              i ? l : `    ${l}`
            )
          )
      } else if (Array.isArray(v))
        out.push(...wrap(`${k}: ${v.join(', ')}`, 80, 4).map((l, i) => (i ? l : `  ${l}`)))
      else out.push(`  ${k}: ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}`)
    }
    out.push('')
  }
  return out.join('\n')
}

export async function runFormats(
  args: ParsedArgs,
  reporter: Reporter,
  deps: FormatsDeps
): Promise<number> {
  const all = await buildFormats(deps)
  const word = args.positionals[0]?.toLowerCase()
  const key = word === 'remove-bg' ? 'removebg' : word
  if (key && !(key in all))
    throw new UsageError(
      `Unknown verb for formats: ${word}. One of: ${Object.keys(all).join(', ')}.`,
      ['formats']
    )
  const data = key ? { [key]: all[key] } : all
  reporter.emit({ event: 'formats', data })
  reporter.text(renderFormats(data))
  return 0
}
