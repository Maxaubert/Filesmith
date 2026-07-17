import { basename, dirname, extname, join } from 'path'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import type { FileInfo, ToolId, ToolTarget } from '@shared/types'
import { resolveSoffice, resolveTool } from '../toolResolver'
import { run } from '../run'
import { uniqueOutDir, uniqueOutPath } from '../output'
import type { ToolModule } from './tool'
import {
  buildFfmpegArgs,
  buildMagickArgs,
  convertTargets,
  isSameFormat,
  magickExtraFor,
  qualityNum,
  toolForKind
} from './convert'
import { buildResizeArgs, buildResizeSpec } from './resize'
import { buildCompressArgs } from './compress'
import { buildSofficeArgs, sofficeOutputPath } from './soffice'
import { buildPdfCompressArgs, buildPdfImagesArgs, buildPdfTextArgs, type PdfOp } from './pdf'

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
      const output = uniqueOutPath(file.path, '.txt', 'converted')
      const { code, stderr } = await run(resolveTool('mutool'), buildPdfTextArgs(file.path, output), {
        signal: ctx.signal
      })
      if (code !== 0)
        throw new Error(stderr.trim().split('\n').pop()?.trim() || `mutool exited ${code}`)
      return output
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
        const output = uniqueOutPath(file.path, targetExt, 'converted')
        copyFileSync(produced, output)
        return output
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }

    const output = uniqueOutPath(file.path, targetExt, 'converted')
    let args: string[]
    if (kindTool === 'ffmpeg') {
      args = buildFfmpegArgs(file.path, output)
    } else {
      const q = qualityNum(options.quality)
      const extra = [...magickExtraFor(targetExt), ...(q != null ? ['-quality', String(q)] : [])]
      args = buildMagickArgs(file.path, output, extra)
    }
    const { code, stderr } = await run(resolveTool(kindTool), args, { signal: ctx.signal })
    if (code !== 0) {
      const last = stderr.trim().split('\n').pop()?.trim()
      throw new Error(last || `${kindTool} exited ${code}`)
    }
    return output
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
      const output = uniqueOutPath(file.path, '.pdf', 'compressed')
      ctx.onProgress(undefined, 'Compressing PDF…')
      const { code, stderr } = await run(mutool, buildPdfCompressArgs(file.path, output), {
        signal: ctx.signal
      })
      if (code !== 0) throw new Error(stderr.trim().split('\n').pop()?.trim() || `mutool exited ${code}`)
      return output
    }

    // extract-text
    const output = uniqueOutPath(file.path, '.txt', 'text')
    ctx.onProgress(undefined, 'Extracting text…')
    const { code, stderr } = await run(mutool, buildPdfTextArgs(file.path, output), {
      signal: ctx.signal
    })
    if (code !== 0) throw new Error(stderr.trim().split('\n').pop()?.trim() || `mutool exited ${code}`)
    return output
  }
}

const resizeTool: ToolModule = {
  async run(file, options, ctx) {
    const spec = buildResizeSpec(options)
    const output = uniqueOutPath(file.path, file.ext, 'resized')
    ctx.onProgress(undefined, `Resizing ${spec}…`)
    const { code, stderr } = await run(
      resolveTool('magick'),
      buildResizeArgs(file.path, output, spec),
      {
        signal: ctx.signal
      }
    )
    if (code !== 0) throw new Error(stderr.trim() || `magick exited ${code}`)
    return output
  }
}

const compressTool: ToolModule = {
  async run(file, options, ctx) {
    const quality = Number(options.quality ?? 80)
    // CaesiumCLT mirrors the input filename into -o, so write to a temp dir and
    // then copy the single result to a collision-safe name next to the source.
    const tmp = mkdtempSync(join(tmpdir(), 'filesmith-'))
    try {
      ctx.onProgress(undefined, `Compressing (q${quality})…`)
      const { code, stderr } = await run(
        resolveTool('caesiumclt'),
        buildCompressArgs(file.path, tmp, quality),
        { signal: ctx.signal }
      )
      const produced = join(tmp, basename(file.path))
      if (code !== 0 || !existsSync(produced)) {
        throw new Error(stderr.trim() || `caesiumclt exited ${code}`)
      }
      const output = uniqueOutPath(file.path, file.ext, 'compressed')
      copyFileSync(produced, output)
      return output
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
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
  if (file.kind === 'image') return ['convert', 'compress', 'resize']
  if (file.kind === 'video' || file.kind === 'audio') return ['convert']
  if (file.kind === 'pdf') return ['convert', 'pdf']
  if (file.kind === 'document' || file.kind === 'text') return ['convert']
  return []
}

/** Target options a tool offers for a file (the options panel). */
export function targetsFor(id: ToolId, file: FileInfo): ToolTarget[] {
  if (id === 'convert')
    return convertTargets(file.kind, file.ext).map(({ label, ext }) => ({ label, ext }))
  return []
}
