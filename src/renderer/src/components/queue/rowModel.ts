// src/renderer/src/components/queue/rowModel.ts
import type { JobOptions } from '@shared/types'
import { formatBytes } from '@shared/compress'
import { groupOf, inInput, type ItemStatus, type QueueItem } from '../../state'

// Pure view model for one table row (spec 4.3) and the totals row (spec 4.4).
// Kept apart from the .tsx files so React Fast Refresh and Vitest both work.

export function formatEtaCompact(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return ''
  const s = Math.round(sec)
  if (s < 60) return `(${Math.max(1, s)}s)`
  const m = Math.round(sec / 60)
  if (m < 60) return `(${m}m)`
  return `(${Math.floor(m / 60)}h ${m % 60}m)`
}

export function progressParts(pct: number, etaSec?: number | null): { pct: string; eta: string } {
  const n = pct > 0 && pct < 10 ? pct.toFixed(1) : String(Math.round(pct))
  return { pct: `${n}%`, eta: formatEtaCompact(etaSec) }
}

export function formatProgress(pct: number, etaSec?: number | null): string {
  const p = progressParts(pct, etaSec)
  return p.pct + p.eta
}

export function kindLabel(ext: string): string {
  return ext.replace(/^\./, '').toUpperCase()
}

export function pctChange(src: number, out: number): number | null {
  if (!(src > 0) || !Number.isFinite(out)) return null
  return Math.round(((out - src) / src) * 100)
}

export function formatPct(n: number): string {
  return n > 0 ? `+${n}%` : `${n}%`
}

const KNOWN_ERRORS: [RegExp, string][] = [
  [/unsupported compression/i, 'Unsupported compression'],
  [/winrar|rar\.exe/i, 'WinRAR not found'],
  [/password/i, 'Password-protected'],
  [/no (en|de)code delegate|missing encoder/i, 'Missing encoder'],
  [/not installed|could not be found|enoent|tool missing/i, 'Tool missing']
]
const MAX_ERROR = 32

export function shortError(message: string | undefined): string {
  const m = (message ?? '').trim()
  if (!m) return 'Failed'
  for (const [re, label] of KNOWN_ERRORS) if (re.test(m)) return label
  const first = m.split(/[.:;\n]|,\s/)[0].trim() || m
  return first.length > MAX_ERROR ? first.slice(0, MAX_ERROR - 1).trimEnd() + '…' : first
}

export type RowActionKind = 'reveal' | 'remove' | 'cancel' | 'retry'
export interface ResultView {
  text: string
  pct: string | null
  estimate: boolean
  grew: boolean
}
export interface StatusView {
  kind: ItemStatus
  text: string
  pct?: string
  eta?: string
  title?: string
}
export interface RowActionView {
  kind: RowActionKind
  icon: 'folder' | 'close' | 'retry'
  label: string
  ghost: boolean
}
export interface RowView {
  kind: string
  size: string
  result: ResultView | null
  status: StatusView
  action: RowActionView
}

function resultFor(item: QueueItem, estimateBytes?: number | null): ResultView | null {
  const src = item.file.size
  if (item.status === 'done') {
    if (item.outputSize != null) {
      const pct = pctChange(src, item.outputSize)
      return {
        text: formatBytes(item.outputSize),
        pct: pct == null ? null : formatPct(pct),
        estimate: false,
        grew: pct != null && pct > 0
      }
    }
    return item.outputPath ? { text: 'folder', pct: null, estimate: false, grew: false } : null
  }
  if (item.status === 'running' && estimateBytes != null && estimateBytes > 0) {
    const pct = pctChange(src, estimateBytes)
    return {
      text: `~${formatBytes(estimateBytes)}`,
      pct: pct == null ? null : formatPct(pct),
      estimate: true,
      grew: pct != null && pct > 0
    }
  }
  return null
}

function statusFor(item: QueueItem): StatusView {
  switch (item.status) {
    case 'done':
      return { kind: 'done', text: 'Done' }
    case 'queued':
      return { kind: 'queued', text: 'Queued' }
    case 'running': {
      if (!item.hasProgress) return { kind: 'running', text: '', pct: '…', eta: '' }
      const p = progressParts(item.percent, item.etaSec)
      return { kind: 'running', text: '', pct: p.pct, eta: p.eta }
    }
    case 'failed':
      return { kind: 'failed', text: shortError(item.error), title: item.error ?? 'Failed' }
    case 'canceled':
      return { kind: 'canceled', text: 'Canceled' }
    default:
      return { kind: 'ready', text: '' }
  }
}

function actionFor(status: ItemStatus): RowActionView {
  switch (status) {
    case 'done':
      return { kind: 'reveal', icon: 'folder', label: 'Show in folder', ghost: true }
    case 'running':
      return { kind: 'cancel', icon: 'close', label: 'Cancel', ghost: true }
    case 'failed':
      return { kind: 'retry', icon: 'retry', label: 'Retry', ghost: false }
    case 'canceled':
      return { kind: 'retry', icon: 'retry', label: 'Retry', ghost: true }
    default:
      return { kind: 'remove', icon: 'close', label: 'Remove', ghost: true }
  }
}

export function rowView(item: QueueItem, estimateBytes?: number | null): RowView {
  return {
    kind: kindLabel(item.file.ext),
    size: formatBytes(item.file.size),
    result: resultFor(item, estimateBytes),
    status: statusFor(item),
    action: actionFor(item.status)
  }
}

export interface Totals {
  files: number
  bytes: number
  doneSrc: number
  doneOut: number
  done: number
  failed: number
  inFlight: number
}

export function queueTotals(items: QueueItem[]): Totals {
  const t: Totals = { files: 0, bytes: 0, doneSrc: 0, doneOut: 0, done: 0, failed: 0, inFlight: 0 }
  for (const i of items) {
    if (!inInput(i)) continue
    t.files += 1
    t.bytes += i.file.size
    if (i.status === 'done') {
      t.done += 1
      if (i.outputSize != null) {
        t.doneSrc += i.file.size
        t.doneOut += i.outputSize
      }
    } else if (i.status === 'failed') t.failed += 1
    else if (i.status === 'queued' || i.status === 'running') t.inFlight += 1
  }
  return t
}

function sameOptions(a: JobOptions | undefined, b: JobOptions): boolean {
  if (!a) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false
  return true
}

export function doneSamples(
  items: QueueItem[],
  group: string,
  options: JobOptions
): { source: number; output: number }[] {
  return items
    .filter(
      (i) =>
        inInput(i) &&
        i.status === 'done' &&
        i.outputSize != null &&
        groupOf(i.file) === group &&
        sameOptions(i.runOptions, options)
    )
    .map((i) => ({ source: i.file.size, output: i.outputSize as number }))
}
