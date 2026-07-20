import type { FileInfo, JobEvent, JobOptions, ToolId } from '@shared/types'
import { convertGroup } from '@shared/convert'

/** The batch group a file belongs to (files that convert together). */
export const groupOf = (f: FileInfo): string => convertGroup(f.kind, f.ext)

export type ItemStatus = 'ready' | 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface QueueItem {
  id: string
  file: FileInfo
  thumb: string | null
  status: ItemStatus
  percent: number
  message?: string
  /** True once the job has reported a REAL percentage. Distinguishes "running
   * at 0%" (determinate, show a real bar) from "running, no progress info"
   * (indeterminate, show the animated bar). Checking `!percent` conflated the
   * two and made long encodes show the fake fill for their first minutes. */
  hasProgress?: boolean
  /** Seconds remaining for a long job, when the tool can estimate it. */
  etaSec?: number
  outputPath?: string
  /** Size of the produced file, for the Output card's size + reduction. */
  outputSize?: number
  error?: string
  /** True for a produced result (Output column) vs a source file (Input column).
   * A source item is re-runnable and stays put; each successful run appends a
   * fresh result item, so running one source twice yields two results. */
  isResult?: boolean
  /** Dismissed from the Input column. */
  hiddenInput?: boolean
  /** Result dismissed from the Output column. */
  hiddenOutput?: boolean
}

/** Whether an item is a source shown in the Input column. */
export const inInput = (i: QueueItem): boolean => !i.isResult && !i.hiddenInput
/** Whether an item is a finished result shown in the Output column. */
export const inOutput = (i: QueueItem): boolean =>
  !!i.isResult && i.status === 'done' && !!i.outputPath && !i.hiddenOutput

export type SelectMode = 'single' | 'toggle' | 'range'

/** One tool tab's independent queue: its own files, selection, and anchor. */
export interface QueueState {
  items: QueueItem[]
  /** Ids of selected input items. */
  selected: string[]
  /** Last item clicked without a modifier, for shift-range selection. */
  anchor: string | null
}

export interface AppState {
  tool: ToolId
  /** Each tool tab keeps its own input/output history. */
  queues: Record<ToolId, QueueState>
  options: Record<ToolId, JobOptions>
}

export const TOOL_IDS: ToolId[] = ['convert', 'compress', 'resize', 'upscale', 'removebg', 'pdf']

export const DEFAULT_OPTIONS: Record<ToolId, JobOptions> = {
  convert: { format: '.webp', quality: 'balanced' },
  compress: {
    quality: 80,
    imageFormat: 'keep',
    videoCodec: 'h264',
    scale: 100,
    audioCodec: 'keep',
    audioBitrate: 192,
    pdfLevel: 'balanced',
    pdfGray: false
  },
  resize: { mode: 'percent', percent: 50 },
  upscale: {},
  removebg: {},
  pdf: { op: 'extract-text', dpi: 150, range: '' }
}

const emptyQueue = (): QueueState => ({ items: [], selected: [], anchor: null })

export const initialState: AppState = {
  tool: 'convert',
  queues: Object.fromEntries(TOOL_IDS.map((t) => [t, emptyQueue()])) as Record<ToolId, QueueState>,
  options: DEFAULT_OPTIONS
}

let counter = 0
export function newId(): string {
  counter += 1
  return `job-${Date.now().toString(36)}-${counter}`
}

export type Action =
  | { type: 'setTool'; tool: ToolId }
  | { type: 'setOption'; tool: ToolId; key: string; value: string | number | boolean }
  | { type: 'addItems'; files: FileInfo[] }
  | { type: 'addSources'; items: QueueItem[] }
  | { type: 'setThumb'; id: string; thumb: string | null }
  | { type: 'dismiss'; id: string; column: 'input' | 'output' }
  | { type: 'markQueued'; ids: string[] }
  | { type: 'jobEvent'; event: JobEvent }
  | { type: 'select'; id: string; mode: SelectMode }
  | { type: 'clearSelection' }

/** Replace the current tool's queue via `fn`. */
function mapQueue(state: AppState, fn: (q: QueueState) => QueueState): AppState {
  return { ...state, queues: { ...state.queues, [state.tool]: fn(state.queues[state.tool]) } }
}

/**
 * Update an item by id in whichever tool queue holds it. Job/thumbnail events
 * arrive asynchronously and may land after the user has switched tabs, so we
 * can't assume the item lives in the current tool's queue.
 */
function mapItemById(
  state: AppState,
  id: string,
  fn: (i: QueueItem) => QueueItem
): AppState {
  const queues = { ...state.queues }
  for (const t of TOOL_IDS) {
    const q = queues[t]
    if (q.items.some((i) => i.id === id)) {
      queues[t] = { ...q, items: q.items.map((i) => (i.id === id ? fn(i) : i)) }
    }
  }
  return { ...state, queues }
}

function selectInQueue(q: QueueState, id: string, mode: SelectMode): QueueState {
  const order = q.items.map((i) => i.id)
  if (mode === 'toggle') {
    const has = q.selected.includes(id)
    return {
      ...q,
      selected: has ? q.selected.filter((s) => s !== id) : [...q.selected, id],
      anchor: id
    }
  }
  if (mode === 'range' && q.anchor) {
    const a = order.indexOf(q.anchor)
    const b = order.indexOf(id)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      // Range selection stays within the anchor's convert group (docs/text/pdf
      // batch together; no cross-category batch).
      const anchorItem = q.items.find((i) => i.id === q.anchor)
      const anchorGroup = anchorItem ? groupOf(anchorItem.file) : null
      const range = order.slice(lo, hi + 1).filter((rid) => {
        const it = q.items.find((i) => i.id === rid)
        return it != null && groupOf(it.file) === anchorGroup
      })
      return { ...q, selected: range }
    }
  }
  return { ...q, selected: [id], anchor: id }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setTool':
      return { ...state, tool: action.tool }
    case 'setOption':
      return {
        ...state,
        options: {
          ...state.options,
          [action.tool]: { ...state.options[action.tool], [action.key]: action.value }
        }
      }
    case 'addItems': {
      const q = state.queues[state.tool]
      // Ignore input-dismissed items so re-dropping a removed file re-adds it.
      const seen = new Set(q.items.filter(inInput).map((i) => i.file.path))
      const add = action.files
        .filter((f) => !seen.has(f.path))
        .map<QueueItem>((f) => ({ id: newId(), file: f, thumb: null, status: 'ready', percent: 0 }))
      if (add.length === 0) return state
      // Dropped/added files become the current selection, constrained to one
      // convert group (the first added file's) so a batch is never cross-category.
      const firstGroup = groupOf(add[0].file)
      const ids = add.filter((i) => groupOf(i.file) === firstGroup).map((i) => i.id)
      return mapQueue(state, (cur) => ({
        items: [...cur.items, ...add],
        selected: ids,
        anchor: ids[ids.length - 1]
      }))
    }
    case 'addSources': {
      // Append pre-built source items (an output promoted back to input, so its
      // origin is visible) and select them. The caller (run) already reuses an
      // existing input for a path that's already present, so no dedup here.
      if (!action.items.length) return state
      return mapQueue(state, (cur) => ({
        items: [...cur.items, ...action.items],
        selected: action.items.map((i) => i.id),
        anchor: action.items[action.items.length - 1].id
      }))
    }
    case 'setThumb':
      return mapItemById(state, action.id, (i) => ({ ...i, thumb: action.thumb }))
    case 'dismiss':
      // Input and Output cards are two views of one item. Dismissing one hides
      // only that view; the item is dropped entirely once neither view remains.
      return mapQueue(state, (q) => {
        const items = q.items.map((i) =>
          i.id === action.id
            ? action.column === 'input'
              ? { ...i, hiddenInput: true }
              : { ...i, hiddenOutput: true }
            : i
        )
        const kept = items.filter((i) => inInput(i) || inOutput(i))
        const selectable = new Set(kept.filter(inInput).map((i) => i.id))
        return {
          items: kept,
          selected: q.selected.filter((s) => selectable.has(s)),
          anchor: q.anchor && selectable.has(q.anchor) ? q.anchor : null
        }
      })
    case 'markQueued':
      return mapQueue(state, (q) => ({
        ...q,
        items: q.items.map((i) =>
          action.ids.includes(i.id)
            ? {
                ...i,
                status: 'queued',
                percent: 0,
                hasProgress: false,
                error: undefined,
                outputPath: undefined,
                hiddenOutput: false
              }
            : i
        )
      }))
    case 'jobEvent': {
      const e = action.event
      // A finished job doesn't turn its source into an output — it appends a
      // separate result item and marks the source done (checkmark). The source
      // stays re-runnable; each further run appends another result and the
      // checkmark persists until the next run replaces it with a progress bar.
      if (e.status === 'done' && e.outputPath) {
        const queues = { ...state.queues }
        for (const t of TOOL_IDS) {
          const q = queues[t]
          const src = q.items.find((i) => i.id === e.id && !i.isResult)
          if (!src) continue
          const result: QueueItem = {
            id: newId(),
            file: src.file,
            thumb: null,
            status: 'done',
            percent: 100,
            outputPath: e.outputPath,
            outputSize: e.outputSize,
            isResult: true
          }
          queues[t] = {
            ...q,
            items: [
              ...q.items.map((i) =>
                i.id === e.id
                  ? { ...i, status: 'done' as ItemStatus, percent: 100, message: undefined, error: undefined }
                  : i
              ),
              result
            ]
          }
          return { ...state, queues }
        }
        return state
      }
      return mapItemById(state, e.id, (i) => ({
        ...i,
        status: e.status as ItemStatus,
        percent: e.percent ?? i.percent,
        // Only a real reported percentage flips the bar to determinate.
        hasProgress: e.percent != null || i.hasProgress,
        etaSec: e.etaSec ?? i.etaSec,
        message: e.message,
        outputPath: e.outputPath ?? i.outputPath,
        error: e.error
      }))
    }
    case 'select':
      return mapQueue(state, (q) => selectInQueue(q, action.id, action.mode))
    case 'clearSelection':
      return mapQueue(state, (q) => ({ ...q, selected: [], anchor: null }))
    default:
      return state
  }
}

/** Items eligible to (re)run: everything except in-flight or already done. */
export function processable(items: QueueItem[]): QueueItem[] {
  return items.filter(
    (i) => i.status === 'ready' || i.status === 'failed' || i.status === 'canceled'
  )
}

/** "45s left" / "12m left" / "1h 22m left" — what actually reassures a user
 * during a long encode that sits below 1% for minutes. */
export function formatEta(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return ''
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s left`
  const m = Math.round(sec / 60)
  if (m < 60) return `${m}m left`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m left`
}

export function formatBytes(n: number): string {
  if (n <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / Math.pow(1024, i)
  return `${i === 0 ? Math.round(v) : v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`
}
