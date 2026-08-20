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
import type { AudioCodec, ImageFormat, PdfLevel, UpscaleModel, VideoCodec } from '@shared/compress'
import {
  resolveGhostscript,
  resolveRealesrgan,
  resolveRembg,
  resolveSoffice,
  resolveTool,
  toolMissingMessage
} from '../toolResolver'
import { run, ToolMissingError } from '../run'
import { estimateProgress, estimateSecForBytes } from './estimate'
import { reserveOutPath, uniqueOutDir } from '../output'
import { ffmpegProgress, probeDuration, probeImageDimensions } from '../probe'
import { buildUpscaleArgs, needsPreConvert, upscaleProgress } from './upscale'
import { resolveNcnnModel } from './ncnnModels'
import { buildCompositeArgs, buildRembgArgs, rembgPhase } from './removebg'
import { pidSidecar } from '../pid/sidecar'
import { pidInstalled } from '../pid/paths'
import { spandrelSidecar } from '../comfy/sidecar'
import { comfyModelByPath } from '../comfy/store'
import type { ToolContext, ToolModule } from './tool'
import {
  buildFfmpegArgs,
  buildMagickArgs,
  canCompress,
  convertTargets,
  isSameFormat,
  magickExtraFor,
  magickFrame,
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
 * Run a CLI tool that writes to an already-reserved `output` path, and clean up
 * on any failure or cancel. `output` was reserved as an empty placeholder (see
 * reserveOutPath), so success requires the tool to have actually written bytes
 * — a 0-byte result means the tool failed or (for ImageMagick) split a
 * multi-frame source into `output-0.ext`, `output-1.ext` and left the
 * placeholder empty. `requireNonEmpty` is false only for text extraction, where
 * an empty result is legitimate (a PDF with no text layer).
 *
 * `argsFor` builds the tool's argv for the path the tool should write, which is
 * NOT always the reserved path: magick, mutool draw and Ghostscript
 * printf-expand `%` sequences in the output path they are handed
 * (InterpretImageFilename / fz_format_output_path / -sOutputFile), so
 * `100%off (resized).png` silently writes over the unrelated `1000ff
 * (resized).png` and exits 0. When the reserved name contains a `%`, the tool
 * writes to a %-free temp file instead and the bytes are copied onto the
 * reserved name — the same shape the Caesium and LibreOffice branches use.
 */
async function runToOutput(
  tool: string,
  argsFor: (out: string) => string[],
  output: string,
  ctx: ToolContext,
  label: string,
  requireNonEmpty = true,
  onStderr?: (chunk: string) => void,
  estimateSec?: number
): Promise<string> {
  const tmp = output.includes('%') ? mkdtempSync(join(tmpdir(), 'filesmith-out-')) : null
  const toolOut = tmp ? join(tmp, 'out' + extname(output)) : output
  // If the tool reports no real progress (no onStderr parser) but the caller
  // gave an expected duration, drive an estimated bar so the % always moves.
  const est =
    !onStderr && estimateSec ? estimateProgress(estimateSec, (p) => ctx.onProgress(p)) : null
  try {
    const { code, stderr } = await run(tool, argsFor(toolOut), { signal: ctx.signal, onStderr })
    const wrote = existsSync(toolOut) && (!requireNonEmpty || statSync(toolOut).size > 0)
    if (code !== 0 || !wrote) {
      // Exit 0 with nothing at the expected path means the tool wrote somewhere
      // else (a printf expansion we missed) or produced nothing — either way,
      // never report success for it.
      throw new Error(
        code === 0 && !wrote
          ? `${label} reported success but wrote no output`
          : describeToolError(stderr, label, code)
      )
    }
    if (tmp) copyFileSync(toolOut, output)
    return output
  } catch (e) {
    // Remove the placeholder / partial so a failed or canceled job never leaves
    // a half-written (or 0-byte) output next to the source.
    try {
      if (existsSync(output)) rmSync(output, { force: true })
    } catch {
      /* best effort */
    }
    // A binary that never started is a broken install, not a bad input file:
    // say so instead of surfacing Node's raw `spawn gswin64c ENOENT`.
    throw e instanceof ToolMissingError ? new Error(toolMissingMessage(e.tool), { cause: e }) : e
  } finally {
    est?.stop()
    if (tmp) rmSync(tmp, { recursive: true, force: true })
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
        (out) => buildPdfTextArgs(file.path, out),
        output,
        ctx,
        'mutool',
        false,
        undefined,
        estimateSecForBytes(file.size, 0.04)
      )
    }

    // Documents go through LibreOffice, which writes into an --outdir with a
    // fixed name; convert in a temp dir, then copy to a collision-safe path.
    if (kindTool === 'soffice') {
      const tmp = mkdtempSync(join(tmpdir(), 'filesmith-doc-'))
      try {
        // LibreOffice percent-DECODES the input path it is handed (the profile
        // is a file URL, the input is not), so `100%off.txt` fails its load
        // with "source file could not be loaded". Convert a copy under a
        // neutral name and read back the neutral result — which also drops the
        // dependency on LibreOffice naming the output after the input.
        const safeIn = join(tmp, 'in' + extname(file.path))
        copyFileSync(file.path, safeIn)
        let result
        try {
          result = await run(
            resolveSoffice(),
            buildSofficeArgs(safeIn, tmp, join(tmp, 'profile'), targetExt),
            { signal: ctx.signal }
          )
        } catch (e) {
          if (ctx.signal.aborted) throw e
          if (!(e instanceof ToolMissingError)) throw e
          throw new Error(
            "LibreOffice isn't installed. Install it (winget install TheDocumentFoundation.LibreOffice), then restart Filesmith, to convert documents.",
            { cause: e }
          )
        }
        const { code, stderr } = result
        const produced = sofficeOutputPath(safeIn, tmp, targetExt)
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
    if (kindTool === 'ffmpeg') {
      // Real progress for media transcodes (they can run for a long time).
      const duration = await probeDuration(file.path)
      if (duration) ctx.onProgress(0, 'Converting…')
      return runToOutput(
        resolveTool(kindTool),
        (out) => buildFfmpegArgs(file.path, out),
        output,
        ctx,
        kindTool,
        true,
        ffmpegProgress(duration, (pct, eta) => ctx.onProgress(pct, 'Converting…', eta))
      )
    }
    const q = qualityNum(options.quality)
    const extra = [...magickExtraFor(targetExt), ...(q != null ? ['-quality', String(q)] : [])]
    // Single-frame target: read only the first frame so a multi-frame source
    // doesn't split into out-0/out-1/… and leave the exact output path empty.
    const src = MULTIFRAME_TARGETS.includes(normalizeExt(targetExt))
      ? file.path
      : magickFrame(file.path)
    return runToOutput(
      resolveTool(kindTool),
      (out) => buildMagickArgs(src, out, extra),
      output,
      ctx,
      kindTool,
      true,
      undefined,
      estimateSecForBytes(file.size, 0.08)
    )
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
      return runToOutput(
        mutool,
        (out) => buildPdfMergeArgs(inputs, out),
        output,
        ctx,
        'mutool',
        true,
        undefined,
        0.6 + inputs.length * 0.4
      )
    }

    // Split (range): keep only the given pages/ranges in a new PDF.
    if (op === 'split-range') {
      const pages = normalizePageRange(String(options.range ?? ''))
      if (!pages) throw new Error('Enter pages to keep, e.g. 1-3,5')
      const output = reserveOutPath(file.path, '.pdf', 'pages')
      ctx.onProgress(undefined, `Extracting pages ${pages}…`)
      return runToOutput(
        mutool,
        (out) => buildPdfPagesArgs(file.path, out, pages),
        output,
        ctx,
        'mutool',
        true,
        undefined,
        estimateSecForBytes(file.size, 0.04)
      )
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
      const dir = uniqueOutDir(
        dirname(file.path),
        basename(file.path, extname(file.path)) + ' (pages)'
      )
      mkdirSync(dir, { recursive: true })
      // mutool draw's -o is a printf pattern (the `page-%d.png` is the point),
      // so a `%` in the folder name — inherited from the source name — would be
      // expanded too. Render into a neutral temp dir then, and move the pages.
      const renderDir = dir.includes('%') ? mkdtempSync(join(tmpdir(), 'filesmith-pages-')) : dir
      ctx.onProgress(undefined, `Rendering pages @ ${dpi} DPI…`)
      const est = estimateProgress(estimateSecForBytes(file.size, 0.15), (p) => ctx.onProgress(p))
      try {
        const { code, stderr } = await run(mutool, buildPdfImagesArgs(file.path, renderDir, dpi), {
          signal: ctx.signal
        })
        if (code !== 0)
          throw new Error(stderr.trim().split('\n').pop()?.trim() || `mutool exited ${code}`)
        if (renderDir !== dir)
          for (const f of readdirSync(renderDir)) copyFileSync(join(renderDir, f), join(dir, f))
        return dir
      } catch (e) {
        // Never leave a partial folder behind (a corrupt page 138 of 400 would
        // otherwise strand 137 PNGs, and the next run makes "name (pages) (2)").
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* best effort */
        }
        throw e
      } finally {
        est.stop()
        if (renderDir !== dir) rmSync(renderDir, { recursive: true, force: true })
      }
    }

    // extract-text
    const output = reserveOutPath(file.path, '.txt', 'text')
    ctx.onProgress(undefined, 'Extracting text…')
    return runToOutput(
      mutool,
      (out) => buildPdfTextArgs(file.path, out),
      output,
      ctx,
      'mutool',
      false,
      undefined,
      estimateSecForBytes(file.size, 0.04)
    )
  }
}

const resizeTool: ToolModule = {
  async run(file, options, ctx) {
    const spec = buildResizeSpec(options)
    if (!isValidResizeSpec(spec))
      throw new Error('Enter a width, height, or percentage to resize by')
    const output = reserveOutPath(file.path, file.ext, 'resized')
    ctx.onProgress(undefined, `Resizing ${spec}…`)
    const animated = normalizeExt(file.ext) === '.gif'
    return runToOutput(
      resolveTool('magick'),
      (out) => buildResizeArgs(file.path, out, spec, animated),
      output,
      ctx,
      'magick',
      true,
      undefined,
      estimateSecForBytes(file.size, 0.08)
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
        return runToOutput(
          resolveTool('mutool'),
          (out) => buildPdfCompressArgs(file.path, out),
          output,
          ctx,
          'mutool',
          true,
          undefined,
          estimateSecForBytes(file.size, 0.08)
        )
      }
      ctx.onProgress(undefined, `Compressing PDF (${level}${gray ? ', gray' : ''})…`)
      return runToOutput(
        resolveGhostscript(),
        (out) => buildGsCompressArgs(file.path, out, level, gray),
        output,
        ctx,
        'ghostscript',
        true,
        undefined,
        estimateSecForBytes(file.size, 0.2)
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
        (out) => buildVideoCompressArgs(file.path, out, { codec, quality, scale }),
        output,
        ctx,
        'ffmpeg',
        true,
        ffmpegProgress(duration, (pct, eta) =>
          ctx.onProgress(pct, `Compressing video (${codec})…`, eta)
        )
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
        (out) => buildAudioCompressArgs(file.path, out, { codec, bitrate, sourceExt: file.ext }),
        output,
        ctx,
        'ffmpeg',
        true,
        ffmpegProgress(duration, (pct, eta) =>
          ctx.onProgress(pct, `Compressing audio (${bitrate}k)…`, eta)
        )
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
      const est = estimateProgress(estimateSecForBytes(file.size, 0.08), (p) => ctx.onProgress(p))
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
        est.stop()
        rmSync(tmp, { recursive: true, force: true })
      }
    }

    // Convert to webp/avif, or re-encode a non-Caesium source format in place —
    // both via ImageMagick, output extension chosen by the target format.
    const outExt = imageFormat === 'keep' ? file.ext : `.${imageFormat}`
    const output = reserveOutPath(file.path, outExt, 'compressed')
    return runToOutput(
      resolveTool('magick'),
      (out) => buildMagickCompressArgs(file.path, out, quality),
      output,
      ctx,
      'magick',
      true,
      undefined,
      estimateSecForBytes(file.size, 0.08)
    )
  }
}

/**
 * Real-ESRGAN's models are RGB-only: it silently returns a 3-channel PNG, so a
 * logo or a cutout comes back with its transparency flattened. Re-attach the
 * alpha by scaling the source's alpha channel to the result's exact size and
 * compositing it back. The mask is scaled with Lanczos rather than run through
 * the network — an alpha channel is a smooth matte with no detail to invent, and
 * it costs another full GPU pass.
 *
 * Verified by measurement: the raw binary turns srgba into srgb on
 * transparent.png; with this pass the output keeps its 4 channels, and the
 * restored mask's mean matches the source's to 5 decimal places.
 *
 * `src` is the ORIGINAL file, not the pre-converted PNG: converting an .ico to
 * PNG clears the alpha flag, so an icon checked at that stage looks opaque.
 */
async function restoreAlpha(
  src: string,
  output: string,
  ctx: ToolContext,
  tmp: string
): Promise<void> {
  const magick = resolveTool('magick')
  const frame = magickFrame(src) // multi-frame sources (.ico, .gif) match the upscaled frame
  const { code, stdout } = await run(magick, ['identify', '-format', '%A', frame], {
    signal: ctx.signal
  })
  // "Undefined" means no alpha channel; anything else (Blend/On/True) has one.
  if (code !== 0 || /^undefined/i.test(stdout.trim())) return

  // The mask must match the result exactly, so take the size from the result
  // itself rather than recomputing it from the factor.
  const { code: dc, stdout: dim } = await run(magick, ['identify', '-format', '%wx%h', output], {
    signal: ctx.signal
  })
  const size = dim.trim()
  if (dc !== 0 || !/^\d+x\d+$/.test(size)) return

  const merged = join(tmp, 'alpha-merged.png')
  const { code: mc } = await run(
    magick,
    [
      output,
      '(',
      frame,
      '-alpha',
      'extract',
      '-resize',
      // '!' forces the exact pixel size, so the mask can't drift by a
      // rounding pixel against the upscaled RGB.
      `${size}!`,
      ')',
      '-alpha',
      'off',
      '-compose',
      'CopyOpacity',
      '-composite',
      merged
    ],
    { signal: ctx.signal }
  )
  // Best effort: a failure here means a flattened (but otherwise correct)
  // upscale, which beats failing the whole job.
  if (mc === 0 && existsSync(merged) && statSync(merged).size > 0) copyFileSync(merged, output)
}

/**
 * Upscale via the PiD diffusion sidecar (NVIDIA only). Pre-converts exotic
 * inputs to PNG, then hands the warm sidecar the image. The first run of a
 * session is slow (model load + one-time kernel compile); every one after is
 * warm. A missing install throws a clear error here as a backstop; the UI's own
 * pid:status check (not this error) is what drives the one-click download prompt.
 */
async function upscaleWithPid(file: FileInfo, factor: number, ctx: ToolContext): Promise<string> {
  if (!pidInstalled('flux'))
    throw new Error('PiD is not installed. Pick PiD in the options panel and click Download first.')
  const tmp = mkdtempSync(join(tmpdir(), 'filesmith-pid-'))
  let output: string | undefined
  // PiD reports phases, not a percentage, so drive an estimated bar whose pace
  // matches the phase: the slow first-run model load, then sampling (cold first
  // run compiles kernels; warm is ~1s). `lastPct` carries the % across phase
  // changes so the bar never jumps backward. See [[filesmith-pid-upscaler]].
  let est: ReturnType<typeof estimateProgress> | null = null
  let lastPct = 0
  const drive = (expectedSec: number): void => {
    est?.stop()
    est = estimateProgress(
      expectedSec,
      (p) => {
        lastPct = p
        ctx.onProgress(p)
      },
      { startPct: lastPct }
    )
  }
  const stopEst = (): void => est?.stop()
  try {
    let src = file.path
    if (needsPreConvert(file.ext)) {
      src = join(tmp, 'src.png')
      const { code, stderr } = await run(resolveTool('magick'), [magickFrame(file.path), src], {
        signal: ctx.signal
      })
      if (code !== 0 || !existsSync(src)) throw new Error(describeToolError(stderr, 'magick', code))
    }
    output = reserveOutPath(file.path, '.png', 'upscaled')
    ctx.onProgress(undefined, 'Starting PiD…')
    const { output: out } = await pidSidecar.upscale(
      src,
      output,
      factor,
      (phase, detail) => {
        if (phase === 'starting' || phase === 'loading') {
          ctx.onProgress(undefined, 'Loading PiD (first run of the session is slow)…')
          drive(18)
        } else if (phase === 'running') {
          const cold = detail === 'cold'
          ctx.onProgress(
            undefined,
            cold
              ? 'Upscaling with PiD (first run compiles GPU kernels, this is slow)…'
              : 'Upscaling with PiD…'
          )
          drive(cold ? 6 : 1.5)
        }
      },
      ctx.signal
    )
    stopEst()
    if (!existsSync(out) || statSync(out).size === 0) throw new Error('PiD produced no output')
    // Diffusion output is RGB; carry the source's transparency across like the
    // Real-ESRGAN path does, so a transparent PNG doesn't come back opaque.
    await restoreAlpha(file.path, out, ctx, tmp)
    return out
  } catch (e) {
    try {
      if (output && existsSync(output)) rmSync(output, { force: true })
    } catch {
      /* best effort */
    }
    throw e
  } finally {
    stopEst()
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * Upscale with a user-imported ComfyUI model via the spandrel sidecar (NVIDIA).
 * Pre-converts exotic inputs to PNG, runs a tiled upscale at the model's native
 * scale (resampling to the requested factor if different), restores alpha, and
 * reports MEASURED per-tile progress.
 */
async function upscaleWithComfy(
  file: FileInfo,
  modelPath: string,
  factor: number,
  background: boolean,
  ctx: ToolContext
): Promise<string> {
  const model = comfyModelByPath(modelPath)
  if (!model)
    throw new Error('That imported model is no longer available. Rescan your ComfyUI folder.')
  const tmp = mkdtempSync(join(tmpdir(), 'filesmith-comfy-'))
  let output: string | undefined
  try {
    let src = file.path
    if (needsPreConvert(file.ext)) {
      src = join(tmp, 'src.png')
      const { code, stderr } = await run(resolveTool('magick'), [magickFrame(file.path), src], {
        signal: ctx.signal
      })
      if (code !== 0 || !existsSync(src)) throw new Error(describeToolError(stderr, 'magick', code))
    }
    output = reserveOutPath(file.path, '.png', 'upscaled')
    const label = background
      ? `Upscaling with ${model.name} (background)…`
      : `Upscaling with ${model.name}…`
    ctx.onProgress(0, label)
    // Background: smaller tiles + a VRAM cap + inter-tile pacing so the GPU stays
    // free for other apps, at the cost of speed.
    const { output: out } = await spandrelSidecar.upscale(model.path, src, output, factor, {
      tile: background ? 256 : 512,
      memFraction: background ? 0.3 : 0,
      paceMs: background ? 150 : 0,
      onProgress: (pct) => ctx.onProgress(pct, label),
      signal: ctx.signal
    })
    if (!existsSync(out) || statSync(out).size === 0)
      throw new Error('The upscaler produced no output')
    await restoreAlpha(file.path, out, ctx, tmp)
    return out
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

/**
 * AI image upscaling via Real-ESRGAN. Deliberately separate from Resize: it
 * reconstructs detail rather than interpolating, needs a Vulkan GPU, and costs
 * seconds per image. Formats the binary can't read are converted to PNG in a
 * temp dir first, so the tool accepts any image Filesmith recognises.
 */
const upscaleTool: ToolModule = {
  async run(file, options, ctx) {
    if (file.kind !== 'image') throw new Error(`Can't upscale ${file.kind} files`)
    const model = String(options.upscaleModel ?? 'photo') as UpscaleModel
    const factor = Number(options.upscaleFactor ?? 4)
    // Background mode leaves GPU headroom for other apps (tiled engines only).
    const background = String(options.gpuMode ?? 'full') === 'background'

    // The PiD flagship is a separate NVIDIA-only diffusion engine served by a
    // resident sidecar, not the bundled Real-ESRGAN binary. (PiD's diffusion
    // can't be paced, so background mode doesn't apply to it.)
    if (model === 'pid') return upscaleWithPid(file, factor, ctx)
    // The ComfyUI category with no specific model chosen yet.
    if (model === 'comfy') throw new Error('Pick one of your ComfyUI models from the list first.')
    // A user-imported ComfyUI model, keyed by its absolute path.
    if (model.startsWith('comfy:'))
      return upscaleWithComfy(file, model.slice(6), factor, background, ctx)

    // No size ceiling: an absurdly large upscale is the user's call to make, and
    // the UI warns them with an estimated output size before it gets here.
    const tmp = mkdtempSync(join(tmpdir(), 'filesmith-up-'))
    let output: string | undefined
    try {
      // Real-ESRGAN reads png/jpg/webp; anything else goes through magick first.
      let src = file.path
      if (needsPreConvert(file.ext)) {
        src = join(tmp, 'src.png')
        const { code, stderr } = await run(resolveTool('magick'), [magickFrame(file.path), src], {
          signal: ctx.signal
        })
        if (code !== 0 || !existsSync(src))
          throw new Error(describeToolError(stderr, 'magick', code))
      }

      // Which ncnn model to run, and which folder it lives in, both come from
      // disk: the bundled models/ dir OR the user's own overlay in userData. The
      // binary runs any .param/.bin pair, so a new upscaler is a file drop.
      const ncnn = resolveNcnnModel(model)
      if (!ncnn)
        throw new Error(
          'No AI upscale models are installed. Reinstall Filesmith, or add a Real-ESRGAN .param/.bin pair to your models folder.'
        )
      output = reserveOutPath(file.path, '.png', 'upscaled')
      const label = background
        ? `Upscaling ${factor}× (${ncnn.label}, background)…`
        : `Upscaling ${factor}× (${ncnn.label})…`
      ctx.onProgress(0, label)
      // Background: a small tile caps peak VRAM so other GPU apps keep their
      // memory (ncnn can't be duty-cycled, so this is the lever we have).
      const args = [
        ...buildUpscaleArgs(src, output, { model: ncnn.name, factor, tile: background ? 128 : 0 }),
        '-m',
        ncnn.dir
      ]
      const { code, stderr } = await run(resolveRealesrgan(), args, {
        signal: ctx.signal,
        onStderr: upscaleProgress((pct) => ctx.onProgress(pct, label))
      })
      if (code !== 0 || !existsSync(output) || statSync(output).size === 0) {
        // The usual cause is no usable Vulkan device.
        const msg = describeToolError(stderr, 'realesrgan', code)
        throw new Error(
          /vulkan|device|gpu/i.test(msg)
            ? 'No compatible GPU found. AI upscaling needs a Vulkan-capable graphics card with up-to-date drivers.'
            : msg
        )
      }
      await restoreAlpha(file.path, output, ctx, tmp)
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
}

/**
 * AI background removal via rembg. Output is always PNG (a cutout needs an alpha
 * channel), except when compositing onto a solid colour, which still writes PNG
 * for consistency.
 *
 * Unlike the bundled binaries, rembg is fetched on demand through uv, so a
 * missing toolchain is an expected state that has to produce an actionable
 * message rather than a spawn error.
 */
const removebgTool: ToolModule = {
  async run(file, options, ctx) {
    if (file.kind !== 'image') throw new Error(`Can't remove the background of ${file.kind} files`)
    const rembg = resolveRembg()
    if (!rembg) {
      throw new Error(
        'Background removal needs uv (which installs the AI model on first use). Install it with: winget install astral-sh.uv, then restart Filesmith.'
      )
    }

    const tmp = mkdtempSync(join(tmpdir(), 'filesmith-bg-'))
    let output: string | undefined
    // rembg emits phase labels but no percentage; drive an estimated bar under
    // them (model inference is a few seconds; the phase text keeps the label).
    let est: ReturnType<typeof estimateProgress> | null = null
    try {
      // rembg reads common raster formats but not svg/heic/jxl; normalise
      // anything exotic to PNG first so the tool accepts any image.
      let src = file.path
      if (needsPreConvert(file.ext)) {
        src = join(tmp, 'src.png')
        const { code, stderr } = await run(resolveTool('magick'), [magickFrame(file.path), src], {
          signal: ctx.signal
        })
        if (code !== 0 || !existsSync(src))
          throw new Error(describeToolError(stderr, 'magick', code))
      }

      output = reserveOutPath(file.path, '.png', 'no-bg')
      // The first run of a model pays a download; every run pays a load. Say so,
      // because a silent multi-second wait reads as a hang.
      ctx.onProgress(undefined, 'Loading model…')
      est = estimateProgress(6, (p) => ctx.onProgress(p))
      const { code, stderr } = await run(
        rembg.cmd,
        [...rembg.prefix, ...buildRembgArgs(src, output, options)],
        {
          signal: ctx.signal,
          onStderr: rembgPhase((message) => ctx.onProgress(undefined, message))
        }
      )
      if (code !== 0 || !existsSync(output) || statSync(output).size === 0) {
        throw new Error(describeRembgError(stderr, code))
      }

      // A backdrop image is a second pass: rembg can only fill with a solid
      // colour, so the cutout comes back transparent and ImageMagick puts the
      // chosen image behind it.
      const bgImage = String(options.bgImagePath ?? '')
      if (options.bgFill === 'image' && bgImage) {
        if (!existsSync(bgImage)) throw new Error('The chosen background image no longer exists.')
        ctx.onProgress(undefined, 'Adding background…')
        const dims = await probeImageDimensions(output)
        if (!dims) throw new Error('Could not read the cutout to size the background.')
        const merged = join(tmp, 'composited.png')
        const { code: cc, stderr: cerr } = await run(
          resolveTool('magick'),
          buildCompositeArgs(bgImage, output, merged, dims.width, dims.height),
          { signal: ctx.signal }
        )
        if (cc !== 0 || !existsSync(merged) || statSync(merged).size === 0)
          throw new Error(describeToolError(cerr, 'magick', cc))
        copyFileSync(merged, output)
      }
      return output
    } catch (e) {
      try {
        if (output && existsSync(output)) rmSync(output, { force: true })
      } catch {
        /* best effort */
      }
      throw e
    } finally {
      est?.stop()
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

/** Turn rembg/uv failures into something a user can act on. */
function describeRembgError(stderr: string, code: number): string {
  if (/No onnxruntime backend found/i.test(stderr))
    return 'The background-removal engine is missing its runtime. Reinstall it, or report this.'
  if (/Cannot install on Python version|Failed to build/i.test(stderr))
    return "The background-removal engine couldn't be installed on this machine's Python."
  if (/ConnectError|failed to fetch|Network|getaddrinfo/i.test(stderr))
    return 'Could not download the background-removal model. Check your internet connection (only the first run needs it).'
  if (/No such file|cannot identify image/i.test(stderr)) return 'This image could not be read.'
  return describeToolError(stderr, 'rembg', code)
}

const TOOLS: Partial<Record<ToolId, ToolModule>> = {
  convert: convertTool,
  compress: compressTool,
  resize: resizeTool,
  upscale: upscaleTool,
  removebg: removebgTool,
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
