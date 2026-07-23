import type { FileInfo, JobEvent, JobOptions, ToolId } from '@shared/types'
import { convertGroup } from '@shared/convert'
import { BG_DEFAULTS } from '@shared/removebg'
import { GEN_DEFAULTS } from '@shared/generate'
import {
  defaultOperation,
  findOperation,
  operationsFor,
  workspaceKey,
  type CategoryId,
  type WorkspaceKey
} from '@shared/catalog'

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
  /** The options this item was actually RUN with. The card's subtitle used to
   * render the CURRENT panel options for every row, so two runs at different
   * sizes both claimed the latest one and identical-looking rows hid a real
   * difference (or, worse, made two identical runs look intentional). */
  runOptions?: JobOptions
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
  /** The file type selected in the left rail. */
  category: CategoryId
  /** The operation this workspace performs. Always set: a category opens
   * directly on its default operation, with no intermediate chooser. */
  operation: string
  /** One queue per FILE TYPE, shared across that type's operations. Files added
   * while converting images are still there after switching to compress: the
   * queue belongs to the category, not the operation. */
  queues: Partial<Record<CategoryId, QueueState>>
  /** Options are per (category, operation): converting and compressing images
   * are configured separately even though they share the same files. */
  options: Record<WorkspaceKey, JobOptions>
  /** The last operation chosen in each category, so switching away and back
   * returns to the mode you were using instead of the category default. */
  lastOperation: Partial<Record<CategoryId, string>>
}

/** The queue key (the file type) and the options key (file type + operation). */
export function optionsKey(state: AppState): WorkspaceKey {
  return workspaceKey(state.category, state.operation)
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
  resize: { mode: 'percent', percent: 50, fit: 'contain' },
  upscale: { upscaleFactor: 4, upscaleModel: 'photo' },
  removebg: { ...BG_DEFAULTS },
  pdf: { op: 'extract-text', dpi: 150, range: '' },
  generate: {
    prompt: '',
    model: '',
    negative: GEN_DEFAULTS.negative,
    style: GEN_DEFAULTS.style,
    width: GEN_DEFAULTS.width,
    height: GEN_DEFAULTS.height,
    count: GEN_DEFAULTS.count,
    steps: GEN_DEFAULTS.steps,
    cfg: GEN_DEFAULTS.cfg,
    guidance: GEN_DEFAULTS.guidance ?? 3.5,
    seed: GEN_DEFAULTS.seed
  }
}

export const emptyQueue = (): QueueState => ({ items: [], selected: [], anchor: null })

/** A fresh workspace's options: its tool's defaults, plus the PDF verb when the
 * operation is one of the several the pdf tool carries. */
export function defaultOptionsFor(category: CategoryId, opId: string): JobOptions {
  const op = findOperation(category, opId)
  if (!op) return {}
  const base = DEFAULT_OPTIONS[op.tool] ?? {}
  return op.opKey ? { ...base, op: op.opKey } : { ...base }
}

const FIRST_CATEGORY: CategoryId = 'images'
const FIRST_OPERATION = defaultOperation(FIRST_CATEGORY)

export const initialState: AppState = {
  category: FIRST_CATEGORY,
  operation: FIRST_OPERATION,
  queues: { [FIRST_CATEGORY]: emptyQueue() },
  options: {
    [workspaceKey(FIRST_CATEGORY, FIRST_OPERATION)]: defaultOptionsFor(
      FIRST_CATEGORY,
      FIRST_OPERATION
    )
  },
  lastOperation: {}
}

let counter = 0
export function newId(): string {
  counter += 1
  return `job-${Date.now().toString(36)}-${counter}`
}

export type Action =
  | { type: 'setCategory'; category: CategoryId }
  | { type: 'setOperation'; operation: string }
  | { type: 'setOption'; key: string; value: string | number | boolean }
  | { type: 'addItems'; files: FileInfo[] }
  | { type: 'addSources'; items: QueueItem[] }
  | { type: 'setThumb'; id: string; thumb: string | null }
  | { type: 'dismiss'; id: string; column: 'input' | 'output' }
  | { type: 'markQueued'; ids: string[]; options?: JobOptions }
  | { type: 'jobEvent'; event: JobEvent }
  | { type: 'select'; id: string; mode: SelectMode }
  | { type: 'clearSelection' }
  | { type: 'hydrate'; state: AppState }

// --- Session persistence ---------------------------------------------------

/** Bump when AppState's persisted shape changes so old sessions are discarded. */
const SESSION_VERSION = 1

/** Normalize a queue item for persistence/restore: drop the (reloadable) thumb
 * and settle any in-flight status, since a run doesn't survive a restart. */
function normalizeItem(i: QueueItem): QueueItem {
  const settled =
    i.status === 'running' || i.status === 'queued' ? { status: 'ready' as const, percent: 0 } : {}
  return {
    ...i,
    thumb: null,
    hasProgress: false,
    etaSec: undefined,
    message: undefined,
    ...settled
  }
}

/** How many produced results / generated images to keep per queue when saving,
 * so a heavy user's history can't grow the session file (and startup) without
 * bound. Source (input) items are always kept. */
const MAX_RESULTS = 100
const MAX_GEN = 100

/** A serializable snapshot of the session to persist. Selection/anchor are
 * intentionally omitted (not restored), and produced history is capped. */
export function sessionSnapshot(state: AppState, genResults: string[]): unknown {
  const queues: Record<string, { items: QueueItem[] }> = {}
  for (const [cat, q] of Object.entries(state.queues)) {
    if (!q) continue
    // Keep every source item; keep only the most recent MAX_RESULTS results.
    const sources = q.items.filter((i) => !i.isResult)
    const results = q.items.filter((i) => i.isResult).slice(-MAX_RESULTS)
    const kept = q.items.filter((i) => sources.includes(i) || results.includes(i))
    queues[cat] = { items: kept.map(normalizeItem) }
  }
  return {
    version: SESSION_VERSION,
    category: state.category,
    operation: state.operation,
    lastOperation: state.lastOperation,
    options: state.options,
    queues,
    genResults: genResults.slice(0, MAX_GEN)
  }
}

interface PersistedSession {
  category: CategoryId
  operation: string
  lastOperation: Partial<Record<CategoryId, string>>
  options: Record<WorkspaceKey, JobOptions>
  queues: AppState['queues']
  genResults: string[]
}

/** Parse a persisted blob into an AppState + genResults, or null if unusable.
 * Trusts nothing: falls back to defaults on any missing/mismatched field. */
export function parseSession(raw: unknown): { state: AppState; genResults: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.version !== SESSION_VERSION) return null
  const p = r as unknown as PersistedSession
  try {
    const validCat = (c: string): boolean => {
      try {
        return operationsFor(c as CategoryId).length > 0
      } catch {
        return false
      }
    }
    const category = validCat(p.category) && findOperation(p.category, p.operation) ? p.category : FIRST_CATEGORY
    const operation = findOperation(category, p.operation) ? p.operation : defaultOperation(category)
    // Drop queues for categories no longer in the catalog (a removed/renamed tool).
    const queues: AppState['queues'] = {}
    for (const [cat, q] of Object.entries(p.queues ?? {})) {
      if (!q || !validCat(cat)) continue
      queues[cat as CategoryId] = {
        items: (q.items ?? []).map(normalizeItem),
        selected: [],
        anchor: null
      }
    }
    // Keep only options whose (category:operation) key still resolves to a real op.
    const options: Record<WorkspaceKey, JobOptions> = {}
    for (const [k, v] of Object.entries(p.options ?? {})) {
      const idx = k.indexOf(':')
      const c = idx >= 0 ? k.slice(0, idx) : ''
      const o = idx >= 0 ? k.slice(idx + 1) : ''
      if (validCat(c) && findOperation(c as CategoryId, o)) options[k as WorkspaceKey] = v as JobOptions
    }
    const key = workspaceKey(category, operation)
    if (!options[key]) options[key] = defaultOptionsFor(category, operation)
    // Keep only valid lastOperation entries.
    const lastOperation: Partial<Record<CategoryId, string>> = {}
    for (const [c, o] of Object.entries(p.lastOperation ?? {}))
      if (validCat(c) && o && findOperation(c as CategoryId, o)) lastOperation[c as CategoryId] = o
    const state: AppState = { category, operation, lastOperation, queues, options }
    return { state, genResults: Array.isArray(p.genResults) ? p.genResults.filter((x) => typeof x === 'string') : [] }
  } catch {
    return null
  }
}

/** Every on-disk file path referenced by the state (for existence pruning). */
export function sessionPaths(state: AppState, genResults: string[]): string[] {
  const paths = new Set<string>()
  for (const q of Object.values(state.queues)) {
    if (!q) continue
    for (const it of q.items) {
      if (it.isResult) {
        if (it.outputPath) paths.add(it.outputPath)
      } else if (it.file?.path) paths.add(it.file.path)
    }
  }
  for (const p of genResults) paths.add(p)
  return [...paths]
}

/** Drop queue items and generated results whose backing file is gone. */
export function pruneMissing(
  state: AppState,
  genResults: string[],
  exists: Set<string>
): { state: AppState; genResults: string[] } {
  const queues: AppState['queues'] = {}
  for (const [cat, q] of Object.entries(state.queues)) {
    if (!q) continue
    const items = q.items.filter((it) =>
      it.isResult ? !!it.outputPath && exists.has(it.outputPath) : !!it.file?.path && exists.has(it.file.path)
    )
    queues[cat as CategoryId] = { items, selected: [], anchor: null }
  }
  return {
    state: { ...state, queues },
    genResults: genResults.filter((p) => exists.has(p))
  }
}

/** Replace the current workspace's queue via `fn`. A no-op on the operation
 * grid, where no workspace is open. */
function mapQueue(state: AppState, fn: (q: QueueState) => QueueState): AppState {
  const key = state.category
  return { ...state, queues: { ...state.queues, [key]: fn(state.queues[key] ?? emptyQueue()) } }
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
  for (const [k, q] of Object.entries(queues) as [CategoryId, QueueState][]) {
    if (q.items.some((i) => i.id === id)) {
      queues[k] = { ...q, items: q.items.map((i) => (i.id === id ? fn(i) : i)) }
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
    case 'hydrate':
      return action.state
    case 'setCategory': {
      // Return to the mode last used in this category (if still valid), so
      // Images→Video→Images lands back on your chosen operation, not the default.
      const remembered = state.lastOperation[action.category]
      const opId =
        remembered && findOperation(action.category, remembered) ? remembered : defaultOperation(action.category)
      const key = workspaceKey(action.category, opId)
      return {
        ...state,
        category: action.category,
        operation: opId,
        queues: { ...state.queues, [action.category]: state.queues[action.category] ?? emptyQueue() },
        options: {
          ...state.options,
          [key]: state.options[key] ?? defaultOptionsFor(action.category, opId)
        }
      }
    }
    case 'setOperation': {
      const key = workspaceKey(state.category, action.operation)
      return {
        ...state,
        operation: action.operation,
        lastOperation: { ...state.lastOperation, [state.category]: action.operation },
        options: {
          ...state.options,
          [key]: state.options[key] ?? defaultOptionsFor(state.category, action.operation)
        }
      }
    }
    case 'setOption': {
      const key = optionsKey(state)
      return {
        ...state,
        options: { ...state.options, [key]: { ...state.options[key], [action.key]: action.value } }
      }
    }
    case 'addItems': {
      const q = state.queues[state.category] ?? emptyQueue()
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
                runOptions: action.options ?? i.runOptions,
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
        for (const [k, q] of Object.entries(queues) as [CategoryId, QueueState][]) {
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
          queues[k] = {
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
        // Keep the last label on a percent-only update: the estimated-progress
        // ticker drives the % without resending the message every tick.
        message: e.message ?? i.message,
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
