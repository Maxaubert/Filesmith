import { basename, dirname, extname, join } from 'path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import type { FileInfo, ToolId, ToolTarget } from '@shared/types'
import type { AudioCodec, ImageFormat, PdfLevel, VideoCodec } from '@shared/compress'
import { resolveGhostscript, resolveSoffice, resolveTool } from '../toolResolver'
import { run } from '../run'
import { reserveOutPath, uniqueOutDir } from '../output'
import { ffmpegProgress, probeDuration } from '../probe'
import type { ToolContext, ToolModule } from './tool'
import {
  buildFfmpegArgs,
  buildMagickArgs,
  canCompress,
  convertTargets,
  isSameFormat,
  magickExtraFor,
  normalizeExt,
  qualityNum,
  toolForKind
} from './convert'
import { buildResizeArgs, buildResizeSpec, isValidResizeSpec } from './resize'
import {
  audioOutputExt,
  buildAudioCompressArgs,
  buildCompressArgs,
  buildMagickCompressArgs,
  buildVideoCompressArgs,
  CAESIUM_EXTS
} from './compress'
import { buildSofficeArgs, sofficeOutputPath } from './soffice'
import {
  buildGsCompressArgs,
  buildPdfCompressArgs,
  buildPdfExtractArgs,
  buildPdfImagesArgs,
  buildPdfInfoArgs,
  buildPdfMergeArgs,
  buildPdfPagesArgs,
  buildPdfTextArgs,
  normalizePageRange,
  parsePdfPageCount,
  type PdfOp
} from './pdf'

/**
 * Run a CLI tool that writes directly to an already-reserved `output` path, and
 * clean up on any failure or cancel. `output` was reserved as an empty
 * placeholder (see reserveOutPath), so success requires the tool to have
 * actually written bytes — a 0-byte result means the tool failed or (for
 * ImageMagick) split a multi-frame source into `output-0.ext`, `output-1.ext`
 * and left the placeholder empty. `requireNonEmpty` is false only for text
 * extraction, where an empty result is legitimate (a PDF with no text layer).
 */
async function runToOutput(
  tool: string,
  args: string[],
  output: string,
  ctx: ToolContext,
  label: string,
  requireNonEmpty = true,
  onStderr?: (chunk: string) => void
): Promise<string> {
  try {
    const { code, stderr } = await run(tool, args, { signal: ctx.signal, onStderr })
    const wrote = existsSync(output) && (!requireNonEmpty || statSync(output).size > 0)
    if (code !== 0 || !wrote) {
      throw new Error(describeToolError(stderr, label, code))
    }
    return output
  } catch (e) {
    // Remove the placeholder / partial so a failed or canceled job never leaves
    // a half-written (or 0-byte) output next to the source.
    try {
      if (existsSync(output)) rmSync(output, { force: true })
    } catch {
      /* best effort */
    }
    throw e
  }
}

// Generic trailing lines tools end with that say nothing useful on their own
// ("Conversion failed!"), and the lines that actually explain what went wrong.
const NOISE_LINE =
  /^(conversion failed|error opening output file|task finished with error|terminating thread|exiting normally)/i
const USEFUL_LINE =
  /(invalid data found|moov atom not found|no such file|permission denied|unknown encoder|could not open encoder|received no packets|does not contain any stream|unsupported|not supported|decoder .* not found|invalid argument|no space left)/i

/**
 * Turn a tool's stderr into a message worth showing. Prefers the line that
 * explains the failure over the generic last line, and rewrites the common
 * "this file is broken" case into plain language.
 */
export function describeToolError(stderr: string, label: string, code: number): string {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const useful = [...lines].reverse().find((l) => USEFUL_LINE.test(l))
  if (useful) {
    if (/received no packets|could not open encoder/i.test(useful))
      return 'This file looks incomplete or corrupt (a stream had no data).'
    if (/invalid data found|moov atom not found/i.test(useful))
      return 'This file could not be read (invalid or truncated data).'
    if (/no space left/i.test(useful)) return 'Ran out of disk space.'
    if (/permission denied/i.test(useful)) return 'Permission denied writing the output.'
    return useful
  }
  const last = [...lines].reverse().find((l) => !NOISE_LINE.test(l))
  return last || `${label} exited ${code}`
}

// ImageMagick target formats that hold multiple frames/pages; every other raster
// target is single-frame, so a multi-frame source (animated GIF, multi-page
// TIFF, MPO) is read as `input[0]` — otherwise magick writes `out-0.jpg`,
// `out-1.jpg`, … and the exact output path never appears.
const MULTIFRAME_TARGETS = ['.gif', '.tiff', '.webp', '.avif']

const convertTool: ToolModule = {
  async run(file, options, ctx) {
    const targetExt = String(options.format ?? '').toLowerCase()
    if (!targetExt) throw new Error('No target format selected')
    if (isSameFormat(file.ext, targetExt)) throw new Error('Source is already that format')
    const kindTool = toolForKind(file.kind)
    if (!kindTool) throw new Error(`Can't convert ${file.kind} files`)
    ctx.onProgress(undefined, 'Converting…')

    // PDF -> plain text extracts reliably via mutool, no LibreOffice required.
    if (file.kind === 'pdf' && isSameFormat(targetExt, '.txt')) {
      const output = reserveOutPath(file.path, '.txt', 'converted')
      return runToOutput(
        resolveTool('mutool'),
        buildPdfTextArgs(file.path, output),
        output,
        ctx,
        'mutool',
        false
      )
    }

    // Documents go through LibreOffice, which writes into an --outdir with a
    // fixed name; convert in a temp dir, then copy to a collision-safe path.
    if (kindTool === 'soffice') {
      const tmp = mkdtempSync(join(tmpdir(), 'filesmith-doc-'))
      try {
        let result
        try {
          result = await run(
            resolveSoffice(),
            buildSofficeArgs(file.path, tmp, join(tmp, 'profile'), targetExt),
            { signal: ctx.signal }
          )
        } catch (e) {
          if (ctx.signal.aborted) throw e
          throw new Error(
            "LibreOffice isn't installed. Install it (winget install TheDocumentFoundation.LibreOffice), then restart Filesmith, to convert documents.",
            { cause: e }
          )
        }
        const { code, stderr } = result
        const produced = sofficeOutputPath(file.path, tmp, targetExt)
        if (code !== 0 || !existsSync(produced)) {
          const last = stderr.trim().split('\n').pop()?.trim()
          throw new Error(
            last || `LibreOffice couldn't convert to ${targetExt.replace('.', '').toUpperCase()}`
          )
        }
        const output = reserveOutPath(file.path, targetExt, 'converted')
        try {
          if (isSameFormat(targetExt, '.txt')) {
            // Drop the UTF-8 BOM the encoded-Text filter prepends.
            let buf = readFileSync(produced)
            if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
              buf = buf.subarray(3)
            writeFileSync(output, buf)
          } else {
            copyFileSync(produced, output)
          }
          return output
        } catch (e) {
          // Remove the reserved placeholder if the copy/write fails, or it's
          // orphaned as a 0-byte file next to the source.
          try {
            if (existsSync(output)) rmSync(output, { force: true })
          } catch {
            /* best effort */
          }
          throw e
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }

    const output = reserveOutPath(file.path, targetExt, 'converted')
    let args: string[]
    if (kindTool === 'ffmpeg') {
      // Real progress for media transcodes (they can run for a long time).
      const duration = await probeDuration(file.path)
      args = buildFfmpegArgs(file.path, output)
      if (duration) ctx.onProgress(0, 'Converting…')
      return runToOutput(
        resolveTool(kindTool),
        args,
        output,
        ctx,
        kindTool,
        true,
        ffmpegProgress(duration, (pct, eta) => ctx.onProgress(pct, 'Converting…', eta))
      )
    } else {
      const q = qualityNum(options.quality)
      const extra = [...magickExtraFor(targetExt), ...(q != null ? ['-quality', String(q)] : [])]
      // Single-frame target: read only the first frame so a multi-frame source
      // doesn't split into out-0/out-1/… and leave the exact output path empty.
      const src = MULTIFRAME_TARGETS.includes(normalizeExt(targetExt))
        ? file.path
        : `${file.path}[0]`
      args = buildMagickArgs(src, output, extra)
    }
    return runToOutput(resolveTool(kindTool), args, output, ctx, kindTool)
  }
}

// PDF-native ops via mutool: extract text, render pages to images, compress,
// merge, split (by range or every page), extract embedded images.
const pdfTool: ToolModule = {
  async run(file, options, ctx) {
    const op = String(options.op ?? 'extract-text') as PdfOp
    const mutool = resolveTool('mutool')

    // Merge: concatenate all selected PDFs (queue order) into one new PDF next
    // to the first. The ordered path list rides in options.mergeInputs.
    if (op === 'merge') {
      const inputs = Array.isArray(options.mergeInputs) ? options.mergeInputs : [file.path]
      if (inputs.length < 2) throw new Error('Select at least two PDFs to merge')
      const output = reserveOutPath(file.path, '.pdf', 'merged')
      ctx.onProgress(undefined, `Merging ${inputs.length} PDFs…`)
      return runToOutput(mutool, buildPdfMergeArgs(inputs, output), output, ctx, 'mutool')
    }

    // Split (range): keep only the given pages/ranges in a new PDF.
    if (op === 'split-range') {
      const pages = normalizePageRange(String(options.range ?? ''))
      if (!pages) throw new Error('Enter pages to keep, e.g. 1-3,5')
      const output = reserveOutPath(file.path, '.pdf', 'pages')
      ctx.onProgress(undefined, `Extracting pages ${pages}…`)
      return runToOutput(mutool, buildPdfPagesArgs(file.path, output, pages), output, ctx, 'mutool')
    }

    // Split (every page): one single-page PDF per page in a new folder.
    if (op === 'split-pages') {
      const info = await run(mutool, buildPdfInfoArgs(file.path), { signal: ctx.signal })
      const count = parsePdfPageCount(info.stdout)
      if (count < 1)
        throw new Error(info.stderr.trim().split('\n').pop()?.trim() || 'Could not read the PDF')
      const base = basename(file.path, extname(file.path))
      const dir = uniqueOutDir(dirname(file.path), base + ' (split)')
      mkdirSync(dir, { recursive: true })
      const width = String(count).length
      try {
        for (let n = 1; n <= count; n++) {
          if (ctx.signal.aborted) throw new Error('Canceled')
          ctx.onProgress(Math.round(((n - 1) / count) * 100), `Splitting page ${n}/${count}…`)
          const out = join(dir, `${base}-${String(n).padStart(width, '0')}.pdf`)
          const { code, stderr } = await run(mutool, buildPdfPagesArgs(file.path, out, String(n)), {
            signal: ctx.signal
          })
          if (code !== 0)
            throw new Error(stderr.trim().split('\n').pop()?.trim() || `mutool exited ${code}`)
        }
        return dir
      } catch (e) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* best effort */
        }
        throw e
      }
    }

    // Extract images: dump embedded image resources into a new folder. mutool
    // writes into its CWD, so run it with cwd set to the fresh folder; it also
    // emits font-* files, which we drop so the folder is images-only.
    if (op === 'extract-images') {
      const base = basename(file.path, extname(file.path))
      const dir = uniqueOutDir(dirname(file.path), base + ' (images)')
      mkdirSync(dir, { recursive: true })
      ctx.onProgress(undefined, 'Extracting images…')
      const { code, stderr } = await run(mutool, buildPdfExtractArgs(file.path), {
        signal: ctx.signal,
        cwd: dir
      })
      const cleanup = (): void => {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* best effort */
        }
      }
      if (code !== 0) {
        cleanup()
        throw new Error(stderr.trim().split('\n').pop()?.trim() || `mutool exited ${code}`)
      }
      let images = 0
      for (const f of readdirSync(dir)) {
        if (/^image-/i.test(f)) images++
        else {
          try {
            rmSync(join(dir, f), { force: true })
          } catch {
            /* best effort */
          }
        }
      }
      if (images === 0) {
        cleanup()
        throw new Error('No embedded images found in this PDF')
      }
      return dir
    }

    if (op === 'pages-to-images') {
      const dpi = Math.max(36, Math.min(600, Number(options.dpi ?? 150)))
      const dir = uniqueOutDir(dirname(file.path), basename(file.path, extname(file.path)) + ' (pages)')
      mkdirSync(dir, { recursive: true })
      ctx.onProgress(undefined, `Rendering pages @ ${dpi} DPI…`)
      const { code, stderr } = await run(mutool, buildPdfImagesArgs(file.path, dir, dpi), {
        signal: ctx.signal
      })
      if (code !== 0) throw new Error(stderr.trim().split('\n').pop()?.trim() || `mutool exited ${code}`)
      return dir
    }

    // extract-text
    const output = reserveOutPath(file.path, '.txt', 'text')
    ctx.onProgress(undefined, 'Extracting text…')
    return runToOutput(mutool, buildPdfTextArgs(file.path, output), output, ctx, 'mutool', false)
  }
}

const resizeTool: ToolModule = {
  async run(file, options, ctx) {
    const spec = buildResizeSpec(options)
    if (!isValidResizeSpec(spec)) throw new Error('Enter a width, height, or percentage to resize by')
    const output = reserveOutPath(file.path, file.ext, 'resized')
    ctx.onProgress(undefined, `Resizing ${spec}…`)
    const animated = normalizeExt(file.ext) === '.gif'
    return runToOutput(
      resolveTool('magick'),
      buildResizeArgs(file.path, output, spec, animated),
      output,
      ctx,
      'magick'
    )
  }
}

const compressTool: ToolModule = {
  async run(file, options, ctx) {
    const quality = Number(options.quality ?? 80)
    if (!canCompress(file.kind, file.ext)) throw new Error(`Can't compress ${file.kind} files`)

    // PDF: 'lossless' level = mutool clean (streams + GC, no image change);
    // every other level = Ghostscript, which downsamples the embedded images.
    if (file.kind === 'pdf') {
      const level = String(options.pdfLevel ?? 'balanced') as PdfLevel
      const gray = Boolean(options.pdfGray)
      const output = reserveOutPath(file.path, '.pdf', 'compressed')
      if (level === 'lossless') {
        ctx.onProgress(undefined, 'Compressing PDF (lossless)…')
        return runToOutput(resolveTool('mutool'), buildPdfCompressArgs(file.path, output), output, ctx, 'mutool')
      }
      ctx.onProgress(undefined, `Compressing PDF (${level}${gray ? ', gray' : ''})…`)
      return runToOutput(
        resolveGhostscript(),
        buildGsCompressArgs(file.path, output, level, gray),
        output,
        ctx,
        'ghostscript'
      )
    }

    // Video: ffmpeg re-encode with the chosen codec (H.264/H.265/AV1). Output is
    // always .mp4 (all three mux there); resolution presets downscale to fit.
    if (file.kind === 'video') {
      const codec = String(options.videoCodec ?? 'h264') as VideoCodec
      const scale = Number(options.scale ?? 100)
      const output = reserveOutPath(file.path, '.mp4', 'compressed')
      // Real progress: ffmpeg's `time=` against the source duration. Long
      // re-encodes (a full movie) otherwise look stuck on an indeterminate bar.
      const duration = await probeDuration(file.path)
      ctx.onProgress(duration ? 0 : undefined, `Compressing video (${codec})…`)
      return runToOutput(
        resolveTool('ffmpeg'),
        buildVideoCompressArgs(file.path, output, { codec, quality, scale }),
        output,
        ctx,
        'ffmpeg',
        true,
        ffmpegProgress(duration, (pct, eta) => ctx.onProgress(pct, `Compressing video (${codec})…`, eta))
      )
    }

    // Audio: ffmpeg re-encode to the chosen codec + bitrate (only lossy formats
    // reach here — canCompress rejects flac/wav/… where a bitrate is meaningless).
    if (file.kind === 'audio') {
      const codec = String(options.audioCodec ?? 'keep') as AudioCodec
      const bitrate = Number(options.audioBitrate ?? 192)
      const output = reserveOutPath(file.path, audioOutputExt(codec, file.ext), 'compressed')
      const duration = await probeDuration(file.path)
      ctx.onProgress(duration ? 0 : undefined, `Compressing audio (${bitrate}k)…`)
      return runToOutput(
        resolveTool('ffmpeg'),
        buildAudioCompressArgs(file.path, output, { codec, bitrate, sourceExt: file.ext }),
        output,
        ctx,
        'ffmpeg',
        true,
        ffmpegProgress(duration, (pct, eta) => ctx.onProgress(pct, `Compressing audio (${bitrate}k)…`, eta))
      )
    }

    // Images: 'keep' re-encodes in the source format (CaesiumCLT for its formats,
    // else ImageMagick); 'webp'/'avif' converts (lossy) to that format via magick.
    const imageFormat = String(options.imageFormat ?? 'keep') as ImageFormat
    ctx.onProgress(undefined, `Compressing image (q${quality})…`)

    if (imageFormat === 'keep' && CAESIUM_EXTS.includes(normalizeExt(file.ext))) {
      const tmp = mkdtempSync(join(tmpdir(), 'filesmith-'))
      // Declared outside try so the catch can clean the placeholder; reserved
      // INSIDE try so a throw there still hits the finally that removes tmp.
      let output: string | undefined
      try {
        output = reserveOutPath(file.path, file.ext, 'compressed')
        const { code, stderr } = await run(
          resolveTool('caesiumclt'),
          buildCompressArgs(file.path, tmp, quality),
          { signal: ctx.signal }
        )
        const produced = join(tmp, basename(file.path))
        if (code !== 0 || !existsSync(produced)) {
          throw new Error(stderr.trim().split('\n').pop()?.trim() || `caesiumclt exited ${code}`)
        }
        copyFileSync(produced, output)
        return output
      } catch (e) {
        try {
          if (output && existsSync(output)) rmSync(output, { force: true })
        } catch {
          /* best effort */
        }
        throw e
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }

    // Convert to webp/avif, or re-encode a non-Caesium source format in place —
    // both via ImageMagick, output extension chosen by the target format.
    const outExt = imageFormat === 'keep' ? file.ext : `.${imageFormat}`
    const output = reserveOutPath(file.path, outExt, 'compressed')
    return runToOutput(
      resolveTool('magick'),
      buildMagickCompressArgs(file.path, output, quality),
      output,
      ctx,
      'magick'
    )
  }
}

const TOOLS: Partial<Record<ToolId, ToolModule>> = {
  convert: convertTool,
  compress: compressTool,
  resize: resizeTool,
  pdf: pdfTool
}

export function getTool(id: ToolId): ToolModule | undefined {
  return TOOLS[id]
}

/** Which tools apply to a file (drives the UI's tool highlighting). */
export function toolsFor(file: FileInfo): ToolId[] {
  const compress = canCompress(file.kind, file.ext) ? (['compress'] as ToolId[]) : []
  if (file.kind === 'image') return ['convert', ...compress, 'resize']
  if (file.kind === 'video' || file.kind === 'audio') return ['convert', ...compress]
  if (file.kind === 'pdf') return ['convert', ...compress, 'pdf']
  if (file.kind === 'document' || file.kind === 'text') return ['convert']
  return []
}

/** Target options a tool offers for a file (the options panel). */
export function targetsFor(id: ToolId, file: FileInfo): ToolTarget[] {
  if (id === 'convert')
    return convertTargets(file.kind, file.ext).map(({ label, ext }) => ({ label, ext }))
  return []
}
