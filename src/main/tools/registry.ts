import { basename, dirname, extname, join } from 'path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import type { FileInfo, ToolId, ToolTarget } from '@shared/types'
import { resolveSoffice, resolveTool } from '../toolResolver'
import { run } from '../run'
import { reserveOutPath, uniqueOutDir } from '../output'
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
  buildAudioCompressArgs,
  buildCompressArgs,
  buildMagickCompressArgs,
  buildVideoCompressArgs,
  CAESIUM_EXTS
} from './compress'
import { buildSofficeArgs, sofficeOutputPath } from './soffice'
import { buildPdfCompressArgs, buildPdfImagesArgs, buildPdfTextArgs, type PdfOp } from './pdf'

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
  requireNonEmpty = true
): Promise<string> {
  try {
    const { code, stderr } = await run(tool, args, { signal: ctx.signal })
    const wrote = existsSync(output) && (!requireNonEmpty || statSync(output).size > 0)
    if (code !== 0 || !wrote) {
      throw new Error(stderr.trim().split('\n').pop()?.trim() || `${label} exited ${code}`)
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
      args = buildFfmpegArgs(file.path, output)
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

// PDF-native ops via mutool: extract text, render pages to images, compress.
const pdfTool: ToolModule = {
  async run(file, options, ctx) {
    const op = String(options.op ?? 'extract-text') as PdfOp
    const mutool = resolveTool('mutool')

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

    if (op === 'compress') {
      const output = reserveOutPath(file.path, '.pdf', 'compressed')
      ctx.onProgress(undefined, 'Compressing PDF…')
      return runToOutput(mutool, buildPdfCompressArgs(file.path, output), output, ctx, 'mutool')
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
    ctx.onProgress(undefined, `Compressing (q${quality})…`)

    // PDF: mutool re-writes the object streams smaller (clean -gggg -z).
    if (file.kind === 'pdf') {
      const output = reserveOutPath(file.path, '.pdf', 'compressed')
      return runToOutput(resolveTool('mutool'), buildPdfCompressArgs(file.path, output), output, ctx, 'mutool')
    }

    // Video: ffmpeg CRF re-encode with FIXED encoders, so the OUTPUT container
    // follows the codec, not the source. WebM stays WebM (VP9/Opus); everything
    // else is written as .mp4 (H.264/AAC + faststart) — H.264/AAC can't mux into
    // .vob/.ogv and the +faststart flag is mov/mp4-only, so keeping the source
    // ext would fail for those containers.
    if (file.kind === 'video') {
      const webm = normalizeExt(file.ext) === '.webm'
      const output = reserveOutPath(file.path, webm ? '.webm' : '.mp4', 'compressed')
      return runToOutput(
        resolveTool('ffmpeg'),
        buildVideoCompressArgs(file.path, output, quality, webm),
        output,
        ctx,
        'ffmpeg'
      )
    }

    // Audio: ffmpeg bitrate re-encode (only reached for lossy formats — canCompress
    // rejects flac/wav/… where a bitrate target is meaningless).
    if (file.kind === 'audio') {
      const output = reserveOutPath(file.path, file.ext, 'compressed')
      return runToOutput(
        resolveTool('ffmpeg'),
        buildAudioCompressArgs(file.path, output, quality, file.ext),
        output,
        ctx,
        'ffmpeg'
      )
    }

    // Image via CaesiumCLT for the formats it decodes; CaesiumCLT mirrors the
    // input filename into -o, so run into a temp dir and copy the single result
    // to a collision-safe name next to the source.
    if (CAESIUM_EXTS.includes(normalizeExt(file.ext))) {
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

    // Other raster image formats (avif/jxl/heic/bmp) — ImageMagick re-encode at
    // the quality target. canCompress keeps vector/exotic exts (svg/xcf/…) out,
    // so this never rasterizes a vector into a silently-broken same-ext file.
    const output = reserveOutPath(file.path, file.ext, 'compressed')
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
