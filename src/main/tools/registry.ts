import { basename, join } from 'path'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import type { FileInfo, ToolId, ToolTarget } from '@shared/types'
import { resolveTool } from '../toolResolver'
import { run } from '../run'
import { uniqueOutPath } from '../output'
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

const convertTool: ToolModule = {
  async run(file, options, ctx) {
    const targetExt = String(options.format ?? '').toLowerCase()
    if (!targetExt) throw new Error('No target format selected')
    if (isSameFormat(file.ext, targetExt)) throw new Error('Source is already that format')
    const kindTool = toolForKind(file.kind)
    if (!kindTool) throw new Error(`Can't convert ${file.kind} files`)

    const output = uniqueOutPath(file.path, targetExt, 'converted')
    ctx.onProgress(undefined, 'Converting…')

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
  resize: resizeTool
}

export function getTool(id: ToolId): ToolModule | undefined {
  return TOOLS[id]
}

/** Which tools apply to a file (drives the UI's tool highlighting). */
export function toolsFor(file: FileInfo): ToolId[] {
  if (file.kind === 'image') return ['convert', 'compress', 'resize']
  if (file.kind === 'video' || file.kind === 'audio') return ['convert']
  return []
}

/** Target options a tool offers for a file (the options panel). */
export function targetsFor(id: ToolId, file: FileInfo): ToolTarget[] {
  if (id === 'convert')
    return convertTargets(file.kind, file.ext).map(({ label, ext }) => ({ label, ext }))
  return []
}
