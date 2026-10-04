import { formatBytes } from '@shared/compress'
import type { QueueItem } from '../../state'
import { formatPct, pctChange } from '../queue/rowModel'

export interface InfoRow {
  k: string
  v: string
  reveal?: string
  selectable?: boolean
}

type Dims = { width: number; height: number } | null

const extOf = (p: string): string => {
  const b = p.split(/[\\/]/).pop() ?? p
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toLowerCase() : ''
}
const pixels = (d: Dims): string => (d ? `${d.width} × ${d.height}` : 'unknown')

export function previewRows(item: QueueItem, dims: Dims): InfoRow[] {
  const src = item.file.size
  const out = item.status === 'done' ? item.outputSize : undefined
  const rows: InfoRow[] = [
    { k: 'size', v: out != null ? `${formatBytes(src)} to ${formatBytes(out)}` : formatBytes(src) }
  ]
  if (out != null) {
    const pct = pctChange(src, out)
    rows.push({
      k: 'saved',
      v: `${formatBytes(Math.max(0, src - out))}${pct != null ? `, ${formatPct(pct)}` : ''}`
    })
  }
  rows.push({ k: 'pixels', v: pixels(dims) })
  return rows
}

export function infoRows(item: QueueItem, dims: Dims, target: string | null): InfoRow[] {
  const src = item.file.ext.replace(/^\./, '').toLowerCase()
  const to =
    item.status === 'done' && item.outputPath
      ? extOf(item.outputPath)
      : target
        ? target.replace(/^\./, '').toLowerCase()
        : ''
  const rows: InfoRow[] = [
    { k: 'format', v: to && to !== src ? `${src} to ${to}` : src },
    { k: 'pixels', v: pixels(dims) },
    {
      k: 'size',
      v:
        item.status === 'done' && item.outputSize != null
          ? `${formatBytes(item.file.size)} to ${formatBytes(item.outputSize)}`
          : formatBytes(item.file.size)
    }
  ]
  if (item.status === 'done' && item.outputPath)
    rows.push({ k: 'output', v: item.outputPath, reveal: item.outputPath })
  if (item.status === 'failed' && item.error)
    rows.push({ k: 'error', v: item.error, selectable: true })
  return rows
}

export function wipeStep(key: string, pct: number): number | null {
  const clamp = (n: number): number => Math.max(0, Math.min(100, n))
  if (key === 'ArrowLeft') return clamp(pct - 5)
  if (key === 'ArrowRight') return clamp(pct + 5)
  if (key === 'Home') return 0
  if (key === 'End') return 100
  return null
}
