import { familyFormats } from '@shared/convert'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  IMAGE_FORMATS as COMPRESS_FORMATS,
  PDF_LEVELS,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  UPSCALE_FACTORS,
  VIDEO_CODECS
} from '@shared/compress'
import { RESIZE_FITS } from '@shared/resize'
import { BG_DEFAULTS, BG_FILLS } from '@shared/removebg'
import { GEN_DEFAULTS, GEN_MAX_COUNT, GEN_STYLES } from '@shared/generate'
import { TABS, TOOL_CARDS } from '@shared/tabs'

// The single table every part of the CLI reads: the parser (which flags exist),
// the option builder (values, ranges, defaults, app keys) and the help pages.
// Values come from the same @shared catalogs the app's option panels use, so
// the CLI cannot drift from the app (spec 2.3, 2.9).

export type FlagType = 'bool' | 'enum' | 'int' | 'number' | 'text' | 'path' | 'format' | 'enumOrInt'

export interface FlagSpec {
  name: string
  aliases?: string[]
  short?: string
  type: FlagType
  values?: readonly string[]
  /** enum values that are numbers (factor, bitrate) become numbers. */
  numeric?: boolean
  min?: number
  max?: number
  step?: number
  /** A unit the app shows that the CLI also accepts: '4x', '192k', '50%'. */
  suffix?: string
  /** The app's JobOptions key. Absent for CLI-only flags. */
  key?: string
  /** Shown word -> stored value, where the app stores a different word. */
  map?: Readonly<Record<string, string>>
  def?: string | number | boolean
  required?: boolean
  /** Help group title, the app's own (FORMAT, IMAGE, VIDEO, ...). */
  group?: string
  valueName?: string
  help: string
}

export type CommandId =
  | 'convert'
  | 'compress'
  | 'resize'
  | 'upscale'
  | 'removebg'
  | 'generate'
  | 'pdf merge'
  | 'pdf split'
  | 'pdf burst'
  | 'pdf extract-text'
  | 'pdf to-images'
  | 'pdf extract-images'
  | 'pdf compress'
  | 'formats'
  | 'doctor'
  | 'setup'
  | 'skill install'
  | 'skill status'

export interface CommandSpec {
  id: CommandId
  path: string[]
  args: string
  summary: string
  inputs: 'files' | 'prompt' | 'words' | 'none'
  flags: FlagSpec[]
  examples: string[]
}

const exts = (list: { ext: string }[]): string[] => list.map((f) => f.ext.slice(1))

/** Every --to value any source can reach. */
export const CONVERT_TARGETS: readonly string[] = [
  ...new Set([
    ...exts(familyFormats('image', '.png')),
    ...exts(familyFormats('video', '.mp4')),
    ...exts(familyFormats('audio', '.mp3')),
    ...exts(familyFormats('pdf', '.pdf')),
    ...exts(familyFormats('document', '.xlsx')),
    ...exts(familyFormats('document', '.pptx')),
    ...exts(familyFormats('archive', '.zip'))
  ])
]
export const VIDEO_CODEC_VALUES: readonly string[] = VIDEO_CODECS.map((c) => c.value)
export const AUDIO_CODEC_VALUES: readonly string[] = AUDIO_CODECS.map((c) => c.value)

const OUT: FlagSpec = {
  name: 'out',
  short: 'o',
  type: 'path',
  valueName: '<folder>',
  help: 'Output folder, created if missing (default: next to each file)'
}
const RECURSIVE: FlagSpec = {
  name: 'recursive',
  type: 'bool',
  help: 'With a folder input, also take files in its subfolders'
}
const DRY: FlagSpec = {
  name: 'dry-run',
  type: 'bool',
  help: 'Show what would happen, write nothing'
}
const JSON_FLAG: FlagSpec = {
  name: 'json',
  type: 'bool',
  help: 'Machine-readable events on stdout'
}
const FILE_COMMON = [OUT, RECURSIVE, DRY, JSON_FLAG]

const tabDesc = (id: string): string => TABS.find((t) => t.id === id)?.desc ?? ''
const cardDesc = (op: string): string => TOOL_CARDS.find((c) => c.opKey === op)?.desc ?? ''

const LEVEL: FlagSpec = {
  name: 'level',
  type: 'enum',
  values: PDF_LEVELS.map((l) => l.value),
  def: 'balanced',
  key: 'pdfLevel',
  group: 'PDF',
  help: 'PDF compression level'
}
const GREYSCALE: FlagSpec = {
  name: 'greyscale',
  aliases: ['grayscale'],
  type: 'bool',
  def: false,
  key: 'pdfGray',
  group: 'PDF',
  help: 'Convert to greyscale (not with --level lossless)'
}
const DPI: FlagSpec = {
  name: 'resolution',
  aliases: ['dpi'],
  type: 'int',
  min: 36,
  max: 600,
  def: 150,
  key: 'dpi',
  group: 'PAGES',
  valueName: '<dpi>',
  help: 'Page render resolution, 36-600'
}

export const COMMANDS: CommandSpec[] = [
  {
    id: 'convert',
    path: ['convert'],
    args: '<files...> --to <format> [options]',
    summary: `${tabDesc('convert')}. Images, video, audio, documents, PDF and archives.`,
    inputs: 'files',
    flags: [
      {
        name: 'to',
        type: 'format',
        values: CONVERT_TARGETS,
        required: true,
        key: 'format',
        group: 'FORMAT',
        valueName: '<format>',
        help: 'Target format, e.g. webp, jpg, mp4, pdf, cbz (jpeg, tif and a leading dot are fine)'
      },
      {
        name: 'quality',
        type: 'enumOrInt',
        values: ['smaller', 'balanced', 'best'],
        min: 1,
        max: 100,
        def: 'balanced',
        key: 'quality',
        group: 'FORMAT',
        valueName: '<preset|1-100>',
        help: 'Image quality for jpg, webp, avif and jxl targets: smaller, balanced, best or 1-100'
      },
      {
        name: 'compression',
        type: 'enum',
        values: ['store', 'normal'],
        def: 'store',
        key: 'store',
        group: 'FORMAT',
        help: 'Archive to archive: store (fast, no recompression) or normal'
      },
      DPI,
      {
        name: 'page-format',
        type: 'enum',
        values: ['jpg', 'png'],
        def: 'jpg',
        key: 'pageFormat',
        group: 'PAGES',
        help: 'PDF to comic: page image format'
      },
      {
        name: 'page-quality',
        type: 'int',
        min: 1,
        max: 100,
        def: 100,
        key: 'pageQuality',
        group: 'PAGES',
        help: 'PDF to comic: jpg page quality'
      },
      ...FILE_COMMON
    ],
    examples: [
      'filesmith convert *.heic --to jpg',
      'filesmith convert book.pdf --to cbz --resolution 200 --page-format png',
      'filesmith convert comics\\ --to cbz --compression normal --out D:\\Out'
    ]
  },
  {
    id: 'compress',
    path: ['compress'],
    args: '<files...> [options]',
    summary: `${tabDesc('compress')}. Images, video, audio and PDF.`,
    inputs: 'files',
    flags: [
      {
        name: 'format',
        type: 'enum',
        values: COMPRESS_FORMATS.map((f) => f.value),
        def: 'keep',
        key: 'imageFormat',
        group: 'IMAGE',
        help: 'Image format: keep, webp or avif'
      },
      {
        name: 'quality',
        type: 'int',
        min: 10,
        max: 100,
        def: 80,
        key: 'quality',
        group: 'IMAGE',
        help: 'Image and video quality, higher keeps more detail'
      },
      {
        name: 'codec',
        type: 'enum',
        values: [...VIDEO_CODEC_VALUES, ...AUDIO_CODEC_VALUES],
        group: 'VIDEO',
        valueName: '<codec>',
        help: 'Video codec (h264, h265, av1) or audio codec (keep, mp3, aac, opus), checked per file (default h264 / keep)'
      },
      {
        name: 'video-codec',
        type: 'enum',
        values: VIDEO_CODEC_VALUES,
        def: 'h264',
        key: 'videoCodec',
        group: 'VIDEO',
        help: 'Video codec, unambiguous form of --codec'
      },
      {
        name: 'scale',
        type: 'int',
        min: SCALE_MIN,
        max: SCALE_MAX,
        step: SCALE_STEP,
        suffix: '%',
        def: 100,
        key: 'scale',
        group: 'VIDEO',
        valueName: '<percent>',
        help: `Video size in percent of the source, ${SCALE_MIN}-${SCALE_MAX} in steps of ${SCALE_STEP}`
      },
      {
        name: 'audio-codec',
        type: 'enum',
        values: AUDIO_CODEC_VALUES,
        def: 'keep',
        key: 'audioCodec',
        group: 'AUDIO',
        help: 'Audio codec, unambiguous form of --codec'
      },
      {
        name: 'bitrate',
        type: 'enum',
        values: AUDIO_BITRATES.map(String),
        numeric: true,
        suffix: 'k',
        def: 192,
        key: 'audioBitrate',
        group: 'AUDIO',
        valueName: '<kbps>',
        help: `Audio bitrate in kbps: ${AUDIO_BITRATES.join(', ')} (192k is fine)`
      },
      LEVEL,
      GREYSCALE,
      ...FILE_COMMON
    ],
    examples: [
      'filesmith compress *.jpg --quality 70',
      'filesmith compress lecture.mov --codec h265 --scale 50',
      'filesmith compress report.pdf --level smallest --greyscale'
    ]
  },
  {
    id: 'resize',
    path: ['resize'],
    args: '<images...> [options]',
    summary: `${tabDesc('resize')}. Images only.`,
    inputs: 'files',
    flags: [
      {
        name: 'percent',
        type: 'number',
        min: 0.01,
        max: 10000,
        suffix: '%',
        def: 50,
        key: 'percent',
        group: 'SIZE',
        valueName: '<n>',
        help: 'Scale by percent (50 or 50%)'
      },
      {
        name: 'width',
        type: 'int',
        min: 1,
        max: 100000,
        key: 'width',
        group: 'SIZE',
        valueName: '<px>',
        help: 'Width in pixels; leave out to scale by the height'
      },
      {
        name: 'height',
        type: 'int',
        min: 1,
        max: 100000,
        key: 'height',
        group: 'SIZE',
        valueName: '<px>',
        help: 'Height in pixels; leave out to scale by the width'
      },
      {
        name: 'fit',
        type: 'enum',
        values: RESIZE_FITS.map((f) => f.value),
        def: 'contain',
        key: 'fit',
        group: 'SIZE',
        help: 'contain keeps the aspect (the app\'s "Keep aspect"); stretch uses both sizes'
      },
      {
        name: 'mode',
        type: 'enum',
        values: ['percent', 'dimensions'],
        key: 'mode',
        group: 'SIZE',
        help: 'Inferred from --percent or --width/--height; rarely needed'
      },
      ...FILE_COMMON
    ],
    examples: ['filesmith resize *.png --percent 25', 'filesmith resize hero.jpg --width 1920']
  },
  {
    id: 'upscale',
    path: ['upscale'],
    args: '<images...> [options]',
    summary: `${tabDesc('upscale')}. Output is always PNG; one image at a time.`,
    inputs: 'files',
    flags: [
      {
        name: 'factor',
        type: 'enum',
        values: UPSCALE_FACTORS.map(String),
        numeric: true,
        suffix: 'x',
        def: 4,
        key: 'upscaleFactor',
        group: 'MODEL',
        valueName: '<2|3|4>',
        help: 'Scale factor (4x is fine)'
      },
      {
        name: 'model',
        type: 'text',
        def: 'photo',
        key: 'upscaleModel',
        group: 'MODEL',
        valueName: '<model>',
        help: 'photo, anime, a Real-ESRGAN model name, pid, or comfy:<model file>; list them with: filesmith formats upscale'
      },
      {
        name: 'gpu',
        type: 'enum',
        values: ['full', 'balanced'],
        map: { full: 'full', balanced: 'background' },
        def: 'full',
        key: 'gpuMode',
        group: 'PERFORMANCE',
        help: 'GPU mode: full, or balanced to leave room for other apps'
      },
      ...FILE_COMMON
    ],
    examples: [
      'filesmith upscale old.jpg --factor 2',
      'filesmith upscale frame.png --model pid --dry-run'
    ]
  },
  {
    id: 'removebg',
    path: ['removebg'],
    args: '<images...> [options]',
    summary: `${tabDesc('removebg')}. Output is always PNG. Needs: filesmith setup removebg.`,
    inputs: 'files',
    flags: [
      {
        name: 'fill',
        type: 'enum',
        values: BG_FILLS.map((f) => f.value),
        def: BG_DEFAULTS.bgFill,
        key: 'bgFill',
        group: 'BACKGROUND',
        valueName: '<fill>',
        help: 'Background: transparent, white, black, green, custom or image'
      },
      {
        name: 'color',
        type: 'text',
        def: BG_DEFAULTS.bgCustomColor,
        key: 'bgCustomColor',
        group: 'BACKGROUND',
        valueName: '<#hex>',
        help: 'Custom colour as #rrggbb; implies --fill custom'
      },
      {
        name: 'image',
        type: 'path',
        key: 'bgImagePath',
        group: 'BACKGROUND',
        valueName: '<image>',
        help: 'Background image, cover fit; implies --fill image'
      },
      ...FILE_COMMON
    ],
    examples: [
      'filesmith removebg product.jpg --fill white',
      'filesmith removebg portrait.png --image beach.jpg'
    ]
  },
  {
    id: 'generate',
    path: ['generate'],
    args: '"<prompt>" [options]',
    summary: `${tabDesc('generate')} with your ComfyUI models. Writes to the current folder unless --out is given.`,
    inputs: 'prompt',
    flags: [
      {
        name: 'model',
        type: 'text',
        key: 'model',
        group: 'MODEL',
        valueName: '<name>',
        help: 'A model from: filesmith formats generate (default: the first runnable one)'
      },
      {
        name: 'negative',
        type: 'text',
        def: GEN_DEFAULTS.negative,
        key: 'negative',
        group: 'PROMPT',
        valueName: '<text>',
        help: 'Negative prompt'
      },
      {
        name: 'style',
        type: 'enum',
        values: GEN_STYLES.map((s) => s.id),
        def: GEN_DEFAULTS.style,
        key: 'style',
        group: 'PROMPT',
        valueName: '<style>',
        help: `Style: ${GEN_STYLES.map((s) => s.id).join(', ')}`
      },
      {
        name: 'count',
        type: 'int',
        min: 1,
        max: GEN_MAX_COUNT,
        def: GEN_DEFAULTS.count,
        key: 'count',
        group: 'OUTPUT',
        help: 'How many images'
      },
      {
        name: 'size',
        type: 'text',
        def: '1024x1024',
        group: 'OUTPUT',
        valueName: '<WxH>',
        help: 'Image size, e.g. 1216x832 (clamped to what the model supports)'
      },
      {
        name: 'width',
        type: 'int',
        min: 64,
        max: 8192,
        key: 'width',
        group: 'OUTPUT',
        valueName: '<px>',
        help: 'Custom width, overrides --size'
      },
      {
        name: 'height',
        type: 'int',
        min: 64,
        max: 8192,
        key: 'height',
        group: 'OUTPUT',
        valueName: '<px>',
        help: 'Custom height, overrides --size'
      },
      {
        name: 'steps',
        type: 'int',
        min: 1,
        max: 50,
        key: 'steps',
        group: 'ADVANCED',
        def: 'model default',
        help: 'Sampling steps'
      },
      {
        name: 'cfg',
        type: 'number',
        min: 1,
        max: 15,
        step: 0.5,
        key: 'cfg',
        group: 'ADVANCED',
        def: 'model default',
        help: 'Guidance (CFG), SDXL models'
      },
      {
        name: 'guidance',
        type: 'number',
        min: 1,
        max: 10,
        step: 0.5,
        key: 'guidance',
        group: 'ADVANCED',
        def: 'model default',
        help: 'Guidance, Flux models'
      },
      {
        name: 'seed',
        type: 'int',
        min: 0,
        max: 2 ** 53 - 1,
        key: 'seed',
        group: 'ADVANCED',
        def: 'random',
        help: 'Seed; a fixed seed gives repeatable images'
      },
      {
        name: 'try-anyway',
        type: 'bool',
        key: 'tryAnyway',
        group: 'ADVANCED',
        help: 'Run a model Filesmith does not recognise, where allowed'
      },
      OUT,
      DRY,
      JSON_FLAG
    ],
    examples: [
      'filesmith generate "a lighthouse at dusk" --count 4 --size 1216x832',
      'filesmith generate "a red kettle" --model flux1-dev --seed 42 --json'
    ]
  },
  {
    id: 'pdf merge',
    path: ['pdf', 'merge'],
    args: '<a.pdf> <b.pdf>... [options]',
    summary: `${cardDesc('merge')}, in argument order. Writes "<first> (merged).pdf".`,
    inputs: 'files',
    flags: [...FILE_COMMON],
    examples: ['filesmith pdf merge cover.pdf body.pdf appendix.pdf']
  },
  {
    id: 'pdf split',
    path: ['pdf', 'split'],
    args: '<files.pdf...> --pages <range> [options]',
    summary: `${cardDesc('split-range')}. Writes "<name> (pages).pdf".`,
    inputs: 'files',
    flags: [
      {
        name: 'pages',
        type: 'text',
        required: true,
        key: 'range',
        group: 'PAGES',
        valueName: '<range>',
        help: 'Pages to keep, e.g. 1-3,5,8-10'
      },
      ...FILE_COMMON
    ],
    examples: ['filesmith pdf split thesis.pdf --pages 1-3,10']
  },
  {
    id: 'pdf burst',
    path: ['pdf', 'burst'],
    args: '<files.pdf...> [options]',
    summary: `${cardDesc('split-pages')}, into a "<name> (split)" folder.`,
    inputs: 'files',
    flags: [...FILE_COMMON],
    examples: ['filesmith pdf burst scan.pdf']
  },
  {
    id: 'pdf extract-text',
    path: ['pdf', 'extract-text'],
    args: '<files.pdf...> [options]',
    summary: `${cardDesc('extract-text')}.`,
    inputs: 'files',
    flags: [...FILE_COMMON],
    examples: ['filesmith pdf extract-text *.pdf --json']
  },
  {
    id: 'pdf to-images',
    path: ['pdf', 'to-images'],
    args: '<files.pdf...> [options]',
    summary: `${cardDesc('pages-to-images')} (PNG), into a "<name> (pages)" folder.`,
    inputs: 'files',
    flags: [DPI, ...FILE_COMMON],
    examples: ['filesmith pdf to-images slides.pdf --resolution 200 --out D:\\Frames']
  },
  {
    id: 'pdf extract-images',
    path: ['pdf', 'extract-images'],
    args: '<files.pdf...> [options]',
    summary: `${cardDesc('extract-images')}, into a "<name> (images)" folder.`,
    inputs: 'files',
    flags: [...FILE_COMMON],
    examples: ['filesmith pdf extract-images brochure.pdf']
  },
  {
    id: 'pdf compress',
    path: ['pdf', 'compress'],
    args: '<files.pdf...> [options]',
    summary: 'Shrink PDFs. The same as filesmith compress for PDF files.',
    inputs: 'files',
    flags: [LEVEL, GREYSCALE, ...FILE_COMMON],
    examples: ['filesmith pdf compress report.pdf --level smallest']
  },
  {
    id: 'formats',
    path: ['formats'],
    args: '[verb]',
    summary: 'List every target format, option value and model, with what is ready. Read-only.',
    inputs: 'words',
    flags: [JSON_FLAG],
    examples: ['filesmith formats', 'filesmith formats upscale --json']
  },
  {
    id: 'doctor',
    path: ['doctor'],
    args: '[options]',
    summary: 'Check the bundled tools, GPU, AI tools and setup. Read-only.',
    inputs: 'none',
    flags: [
      {
        name: 'deep',
        type: 'bool',
        help: 'Also run a tiny Real-ESRGAN upscale to prove the GPU path'
      },
      {
        name: 'verify',
        type: 'bool',
        help: 'Also hash downloaded model files against integrity.json'
      },
      JSON_FLAG
    ],
    examples: ['filesmith doctor', 'filesmith doctor --json']
  },
  {
    id: 'setup',
    path: ['setup'],
    args: '<tool> [options]',
    summary:
      'Download and set up an AI tool: removebg, pid, spandrel, comfy, generate, realesrgan, or remove <tool>. The only command that downloads.',
    inputs: 'words',
    flags: [
      {
        name: 'model',
        type: 'text',
        valueName: '<name>',
        help: 'setup generate: the model whose missing files to fetch'
      },
      {
        name: 'folder',
        type: 'path',
        valueName: '<path>',
        help: 'setup comfy: your ComfyUI folder'
      },
      {
        name: 'url',
        type: 'text',
        valueName: '<url>',
        help: 'setup comfy: a running ComfyUI, e.g. http://127.0.0.1:8188'
      },
      {
        name: 'comfy',
        type: 'path',
        valueName: '<folder>',
        help: 'setup spandrel: record and scan this ComfyUI folder'
      },
      {
        name: 'permanent',
        type: 'bool',
        help: 'setup remove: delete folders too large for the Recycle Bin'
      },
      DRY,
      JSON_FLAG
    ],
    examples: [
      'filesmith setup removebg',
      'filesmith setup pid --dry-run',
      'filesmith setup comfy --folder "D:\\ComfyUI"'
    ]
  },
  {
    id: 'skill install',
    path: ['skill', 'install'],
    args: '[options]',
    summary: 'Install the Filesmith skill for Claude Code into your .claude\\skills folder.',
    inputs: 'none',
    flags: [DRY, JSON_FLAG],
    examples: ['filesmith skill install']
  },
  {
    id: 'skill status',
    path: ['skill', 'status'],
    args: '[options]',
    summary: 'Show whether the Claude Code skill is installed and its version.',
    inputs: 'none',
    flags: [JSON_FLAG],
    examples: ['filesmith skill status --json']
  }
]

export const SUBCOMMANDS: Record<'pdf' | 'skill', string[]> = {
  pdf: COMMANDS.filter((c) => c.path[0] === 'pdf').map((c) => c.path[1]),
  skill: COMMANDS.filter((c) => c.path[0] === 'skill').map((c) => c.path[1])
}

export function findCommand(path: string[]): CommandSpec | undefined {
  const key = path.join(' ')
  return COMMANDS.find((c) => c.path.join(' ') === key)
}

export function flagOf(cmd: CommandSpec, name: string): FlagSpec {
  const f = cmd.flags.find((x) => x.name === name)
  if (!f) throw new Error(`${cmd.id} has no flag --${name}`)
  return f
}
