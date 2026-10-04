// test/row-model.test.ts
import { describe, expect, it } from 'vitest'
import {
  doneSamples,
  formatEtaCompact,
  formatPct,
  formatProgress,
  kindLabel,
  pctChange,
  queueTotals,
  rowView,
  shortError
} from '../src/renderer/src/components/queue/rowModel'
import type { QueueItem } from '../src/renderer/src/state'

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: over.id ?? 'a',
  file: { path: 'C:/x/a.heic', name: 'a.heic', ext: '.heic', kind: 'image', size: 3_200_000 },
  thumb: null,
  status: 'ready',
  percent: 0,
  ...over
})

describe('compact progress', () => {
  it('formats the mockup string', () => {
    expect(formatProgress(62, 4)).toBe('62%(4s)')
  })
  it('drops the bracket without an ETA', () => {
    expect(formatProgress(62.4, undefined)).toBe('62%')
    expect(formatProgress(62.4, null)).toBe('62%')
  })
  it('keeps one decimal below 10%', () => {
    expect(formatProgress(5.5, 120)).toBe('5.5%(2m)')
    expect(formatProgress(0, 3)).toBe('0%(3s)')
  })
  it('formats minutes and hours', () => {
    expect(formatEtaCompact(59)).toBe('(59s)')
    expect(formatEtaCompact(90)).toBe('(2m)')
    expect(formatEtaCompact(3900)).toBe('(1h 5m)')
    expect(formatEtaCompact(-1)).toBe('')
    expect(formatEtaCompact(Number.NaN)).toBe('')
  })
})

describe('labels', () => {
  it('derives the kind from the extension', () => {
    expect(kindLabel('.heic')).toBe('HEIC')
    expect(kindLabel('')).toBe('')
  })
  it('signs the percentage with a plain hyphen', () => {
    expect(pctChange(1000, 200)).toBe(-80)
    expect(formatPct(-80)).toBe('-80%')
    expect(formatPct(12)).toBe('+12%')
    expect(formatPct(0)).toBe('0%')
  })
  it('has no percentage for a zero-byte source', () => {
    expect(pctChange(0, 10)).toBeNull()
  })
})

describe('shortError', () => {
  it('maps known failures to a short label', () => {
    expect(shortError('magick: Unsupported compression method (5)')).toBe('Unsupported compression')
    expect(shortError('RAR output needs WinRAR (Rar.exe) installed')).toBe('WinRAR not found')
    expect(shortError('The archive is password protected')).toBe('Password-protected')
  })
  it('falls back to the first clause, capped at 32 characters', () => {
    expect(shortError('Disk full. Free some space and retry')).toBe('Disk full')
    const long = shortError('Something very long happened while encoding the frames')
    expect(long).toHaveLength(32)
    expect(long.endsWith('…')).toBe(true)
  })
  it('says Failed when there is no message', () => {
    expect(shortError(undefined)).toBe('Failed')
  })
})

describe('rowView', () => {
  it('done: actual result, percentage, reveal action as ghost', () => {
    const v = rowView(item({ status: 'done', outputPath: 'C:/x/a.webp', outputSize: 640_000 }))
    expect(v.status).toMatchObject({ kind: 'done', text: 'Done' })
    expect(v.result).toEqual({ text: '625 KB', pct: '-80%', estimate: false, grew: false })
    expect(v.action).toEqual({
      kind: 'reveal',
      icon: 'folder',
      label: 'Show in folder',
      ghost: true
    })
  })
  it('done with a folder output: no size, no percentage', () => {
    const v = rowView(item({ status: 'done', outputPath: 'C:/x/a (pages)' }))
    expect(v.result).toEqual({ text: 'folder', pct: null, estimate: false, grew: false })
  })
  it('done from an old session without a link: empty result, no crash', () => {
    const v = rowView(item({ status: 'done' }))
    expect(v.result).toBeNull()
    expect(v.status.text).toBe('Done')
  })
  it('growth is flagged so the cell can use weight instead of amber', () => {
    const v = rowView(item({ status: 'done', outputPath: 'C:/x/a.png', outputSize: 6_400_000 }))
    expect(v.result).toMatchObject({ pct: '+100%', grew: true })
  })
  it('running: progress, compact ETA, grey estimate, cancel ghost', () => {
    const v = rowView(
      item({ status: 'running', percent: 62, hasProgress: true, etaSec: 4 }),
      410_000
    )
    expect(v.status).toMatchObject({ kind: 'running', pct: '62%', eta: '(4s)' })
    expect(v.result).toMatchObject({ text: '~400 KB', estimate: true })
    expect(v.action).toMatchObject({ kind: 'cancel', icon: 'close', ghost: true })
  })
  it('running without real progress shows an ellipsis and no estimate cell', () => {
    const v = rowView(item({ status: 'running', hasProgress: false }), null)
    expect(v.status.pct).toBe('…')
    expect(v.result).toBeNull()
  })
  it('queued: no result, remove ghost', () => {
    const v = rowView(item({ status: 'queued' }), 999)
    expect(v.result).toBeNull()
    expect(v.status.text).toBe('Queued')
    expect(v.action).toMatchObject({ kind: 'remove', ghost: true })
  })
  it('failed: short label, full tooltip, retry always visible', () => {
    const v = rowView(
      item({ status: 'failed', error: 'Unsupported compression in TIFF. Try PNG.' })
    )
    expect(v.status).toMatchObject({
      text: 'Unsupported compression',
      title: 'Unsupported compression in TIFF. Try PNG.'
    })
    expect(v.result).toBeNull()
    expect(v.action).toEqual({ kind: 'retry', icon: 'retry', label: 'Retry', ghost: false })
  })
  it('ready: blank status, remove ghost', () => {
    const v = rowView(item())
    expect(v.status.text).toBe('')
    expect(v.action.kind).toBe('remove')
  })
  it('canceled: Canceled, retry ghost', () => {
    const v = rowView(item({ status: 'canceled' }))
    expect(v.status.text).toBe('Canceled')
    expect(v.action).toMatchObject({ kind: 'retry', ghost: true })
  })
  it('kind and size columns', () => {
    const v = rowView(item())
    expect(v.kind).toBe('HEIC')
    expect(v.size).toBe('3.1 MB')
  })
})

describe('queueTotals', () => {
  it('sums inputs, counts statuses, and only adds done rows with a file output', () => {
    const t = queueTotals([
      item({ id: '1', status: 'done', outputPath: 'o1', outputSize: 1_000_000 }),
      item({ id: '2', status: 'done', outputPath: 'C:/x/folder' }),
      item({ id: '3', status: 'running' }),
      item({ id: '4', status: 'queued' }),
      item({ id: '5', status: 'failed' }),
      item({ id: 'r', isResult: true, status: 'done', outputPath: 'o1', outputSize: 1_000_000 }),
      item({ id: 'h', hiddenInput: true })
    ])
    expect(t).toEqual({
      files: 5,
      bytes: 16_000_000,
      doneSrc: 3_200_000,
      doneOut: 1_000_000,
      done: 2,
      failed: 1,
      inFlight: 2
    })
  })
})

describe('doneSamples', () => {
  it('uses done rows of the same group run with the same options', () => {
    const opts = { format: '.webp', quality: 'balanced' }
    const s = doneSamples(
      [
        item({ id: '1', status: 'done', outputSize: 800_000, runOptions: opts }),
        item({
          id: '2',
          status: 'done',
          outputSize: 100,
          runOptions: { ...opts, quality: 'best' }
        }),
        item({ id: '3', status: 'running', runOptions: opts })
      ],
      'image',
      { quality: 'balanced', format: '.webp' }
    )
    expect(s).toEqual([{ source: 3_200_000, output: 800_000 }])
  })
})
