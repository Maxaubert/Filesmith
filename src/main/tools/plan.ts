import { basename, dirname, extname } from 'path'
import type { FileInfo, JobOptions, ToolId } from '@shared/types'
import type { AudioCodec } from '@shared/compress'
import { isSameFormat, normalizeExt } from '@shared/convert'
import { planFileInDir, planOutDir } from '../output'
import { audioOutputExt } from './compress'

export interface PlannedOutput {
  path: string
  kind: 'file' | 'dir'
}

/**
 * The output a tool's run() would produce, predicted without touching disk
 * (spec M4). Mirrors the reserveOutPath / uniqueOutDir call in each branch of
 * tools/registry.ts; test/plan-output.test.ts pins every branch, and the CLI
 * e2e suite checks a dry run against the real run's names.
 */
export function planOutput(
  tool: ToolId,
  file: FileInfo,
  options: JobOptions,
  outDir: string | undefined,
  claimed: Set<string>
): PlannedOutput {
  const dir = outDir ?? dirname(file.path)
  const name = basename(file.path, extname(file.path))
  const f = (ext: string, tag: string): PlannedOutput => ({
    path: planFileInDir(dir, name, ext, tag, claimed),
    kind: 'file'
  })
  const d = (suffix: string): PlannedOutput => ({
    path: planOutDir(dir, `${name} (${suffix})`, claimed),
    kind: 'dir'
  })

  switch (tool) {
    case 'convert': {
      // convertTool lower-cases the target but does not normalize it (`.jpeg` stays `.jpeg`).
      const format = String(options.format ?? '').toLowerCase()
      return f(file.kind === 'pdf' && isSameFormat(format, '.txt') ? '.txt' : format, 'converted')
    }
    case 'archive': {
      const op = String(options.op ?? 'repack')
      if (op === 'to-pdf') return f('.pdf', 'converted')
      if (op === 'repack' || op === 'from-pdf')
        return f(normalizeExt(String(options.format ?? '.cbz')), 'converted')
      if (op === 'extract') return d('extracted')
      throw new Error(`Unknown archive operation: ${op}`)
    }
    case 'compress': {
      if (file.kind === 'pdf') return f('.pdf', 'compressed')
      if (file.kind === 'video') return f('.mp4', 'compressed')
      if (file.kind === 'audio')
        return f(
          audioOutputExt(String(options.audioCodec ?? 'keep') as AudioCodec, file.ext),
          'compressed'
        )
      const fmt = String(options.imageFormat ?? 'keep')
      return f(fmt === 'keep' ? file.ext : `.${fmt}`, 'compressed')
    }
    case 'resize':
      return f(file.ext, 'resized')
    case 'upscale':
      return f('.png', 'upscaled')
    case 'removebg':
      return f('.png', 'no-bg')
    case 'pdf': {
      const op = String(options.op ?? 'extract-text')
      if (op === 'merge') return f('.pdf', 'merged')
      if (op === 'split-range') return f('.pdf', 'pages')
      if (op === 'extract-text') return f('.txt', 'text')
      if (op === 'split-pages') return d('split')
      if (op === 'extract-images') return d('images')
      if (op === 'pages-to-images') return d('pages')
      throw new Error(`Unknown pdf operation: ${op}`)
    }
    default:
      throw new Error(`No output planner for ${tool}`)
  }
}
