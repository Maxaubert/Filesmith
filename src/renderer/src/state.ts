import type { FileInfo, JobEvent, JobOptions, ToolId } from '@shared/types'
import { convertGroup } from '@shared/convert'
import { BG_DEFAULTS } from '@shared/removebg'
import { GEN_DEFAULTS } from '@shared/generate'
import { TABS, engineFor, toolCardById, type TabId } from '@shared/tabs'

/** The batch group a file belongs to (files that convert together). */
export const groupOf = (f: FileInfo): string => convertGroup(f.kind, f.ext)

/** A workspace's queue key: the tab, or the open Tools card's own workspace. */
export type QueueKey = string
export function queueKey(tab: TabId, activeTool: string | null): QueueKey {
  return tab === 'tools' && activeTool ? `tools:${activeTool}` : tab
}

/** Options live per (workspace, convert group): one Convert tab holds an image
 * target and a video target side by side. Keyed by GROUP, not kind, so a pdf
 * and a docx share one option set exactly as they do today. */
export function optionsKey(tab: TabId, activeTool: string | null, group: string): string {
  return `${queueKey(tab, activeTool)}:${group}`
}

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
  /** The verb selected in the left rail. */
  tab: TabId
  /** Which Tools card is open, or null for the Tools grid. Only meaningful
   * while `tab` is 'tools'. */
  activeTool: string | null
  /** One queue per WORKSPACE: a tab, or `tools:<cardId>`. Files belong to the
   * verb you are performing, and a tab's queue may hold several convert groups
   * at once (images and video in the same Convert queue). */
  queues: Partial<Record<QueueKey, QueueState>>
  /** Options are per (workspace, convert group): converting images and
   * converting video are configured separately inside one Convert tab. */
  options: Record<string, JobOptions>
  /** The last Tools card opened, so returning to Tools lands where you were. */
  lastTool: string | null
}

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
  archive: { op: 'repack', format: '.cbz', store: true, dpi: 150, pageFormat: 'jpg', quality: 85 },
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

/** A fresh workspace's options for one convert group: the engine tool's
 * defaults, plus the verb when that tool carries several (pdf and archive both
 * do). The engine is resolved per group because the Convert tab runs the
 * archive tool for a .cbz and the convert tool for everything else. */
export function defaultOptionsFor(
  tab: TabId,
  activeTool: string | null,
  group: string
): JobOptions {
  const card = activeTool ? toolCardById(activeTool) : null
  const { tool, op } = engineFor(tab, group, card)
  const base = DEFAULT_OPTIONS[tool] ?? {}
  return op ? { ...base, op } : { ...base }
}

const FIRST_TAB: TabId = 'convert'

export const initialState: AppState = {
  tab: FIRST_TAB,
  activeTool: null,
  queues: { [FIRST_TAB]: emptyQueue() },
  options: {},
  lastTool: null
}

let counter = 0
export function newId(): string {
  counter += 1
  return `job-${Date.now().toString(36)}-${counter}`
}

export type Action =
  | { type: 'setTab'; tab: TabId }
  | { type: 'setActiveTool'; tool: string | null }
  | { type: 'setOption'; group: string; key: string; value: string | number | boolean }
  | { type: 'addItems'; files: FileInfo[]; key: QueueKey }
  | { type: 'addSources'; items: QueueItem[]; key: QueueKey }
  | { type: 'setThumb'; id: string; thumb: string | null }
  | { type: 'dismiss'; id: string; column: 'input' | 'output' }
  | { type: 'markQueued'; ids: string[]; options?: JobOptions }
  | { type: 'jobEvent'; event: JobEvent }
  | { type: 'select'; id: string; mode: SelectMode }
  | { type: 'clearSelection' }
  | { type: 'hydrate'; state: AppState }

// --- Session persistence ---------------------------------------------------

/** Bump when AppState's persisted shape changes. v1 (category-keyed) is not
 * discarded but MIGRATED: a user mid-batch must not lose their files. */
const SESSION_VERSION = 2

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
    // The tab is deliberately NOT persisted: the app always launches into the
    // first verb. What IS remembered is the last Tools card, so returning to
    // Tools lands where you were.
    lastTool: state.lastTool,
    options: state.options,
    queues,
    genResults: genResults.slice(0, MAX_GEN)
  }
}

/** Structural check on a restored item: a malformed one (hand-edited file,
 * partial write) must be dropped, not rendered. */
function isValidItem(i: unknown): i is QueueItem {
  if (!i || typeof i !== 'object') return false
  const q = i as QueueItem
  return (
    typeof q.id === 'string' &&
    !!q.file &&
    typeof q.file.path === 'string' &&
    typeof q.file.name === 'string' &&
    (!q.isResult || typeof q.outputPath === 'string')
  )
}

interface PersistedSession {
  lastTool: string | null
  options: Record<string, JobOptions>
  queues: AppState['queues']
  genResults: string[]
}

/** Old category ids and the verb each one's operations mapped to. Used only by
 * the v1 migration. */
const V1_OP_TO_TAB: Record<string, TabId> = {
  convert: 'convert',
  compress: 'compress',
  resize: 'resize',
  upscale: 'upscale',
  removebg: 'removebg',
  generate: 'generate',
  // Every PDF and archive verb became a Tools card.
  'extract-text': 'tools',
  'pages-to-images': 'tools',
  merge: 'tools',
  'split-range': 'tools',
  'split-pages': 'tools',
  'extract-images': 'tools',
  'to-cbz': 'tools',
  extract: 'tools',
  'to-pdf': 'tools'
}

/**
 * Move a v1 (category-keyed) session into the tab-keyed shape. Files are the
 * valuable part of a session and must survive the upgrade; options are dropped
 * because they were keyed by an axis that no longer exists, and re-deriving
 * them per group would guess wrong more often than it would help.
 */
export function migrateV1Queues(raw: Record<string, unknown>): AppState['queues'] {
  const lastOperation = (raw.lastOperation ?? {}) as Record<string, string>
  const oldQueues = (raw.queues ?? {}) as Record<string, { items?: unknown[] }>
  const out: AppState['queues'] = {}
  for (const [cat, q] of Object.entries(oldQueues)) {
    if (!q) continue
    const verb = lastOperation[cat]
    // A Tools verb has no single home queue, so its files land in Convert
    // rather than being dropped on the floor.
    const mapped = verb ? V1_OP_TO_TAB[verb] : undefined
    const tab: TabId = mapped && mapped !== 'tools' ? mapped : 'convert'
    const items = (q.items ?? []).filter(isValidItem).map(normalizeItem)
    const cur = out[tab] ?? emptyQueue()
    const have = new Set(cur.items.map((i) => (i.isResult ? (i.outputPath ?? i.id) : i.file.path)))
    const extra = items.filter((i) => !have.has(i.isResult ? (i.outputPath ?? i.id) : i.file.path))
    out[tab] = { ...cur, items: [...cur.items, ...extra] }
  }
  return out
}

/** Parse a persisted blob into an AppState + genResults, or null if unusable.
 * Trusts nothing: falls back to defaults on any missing/mismatched field. */
export function parseSession(raw: unknown): { state: AppState; genResults: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  try {
    const genResults = Array.isArray(r.genResults)
      ? (r.genResults as unknown[]).filter((x): x is string => typeof x === 'string')
      : []

    // v1 was keyed by file-type category. Migrate rather than discard: the
    // files are a user's in-flight work, and losing them to an upgrade is a
    // worse failure than resetting their format settings.
    if (r.version !== SESSION_VERSION) {
      return {
        state: { ...initialState, queues: migrateV1Queues(r), options: {} },
        genResults
      }
    }

    const p = r as unknown as PersistedSession
    const validKey = (k: string): boolean => {
      if (k.startsWith('tools:')) return !!toolCardById(k.slice(6))
      return TABS.some((t) => t.id === k)
    }
    // Always launch into the FIRST verb: coming back to the remembered one
    // felt wrong (owner decision, carried over from the category rail).
    const queues: AppState['queues'] = {}
    for (const [k, q] of Object.entries(p.queues ?? {})) {
      if (!q || !validKey(k)) continue
      queues[k] = {
        items: (q.items ?? []).filter(isValidItem).map(normalizeItem),
        selected: [],
        anchor: null
      }
    }
    // Keep only options whose workspace still exists.
    const options: Record<string, JobOptions> = {}
    for (const [k, v] of Object.entries(p.options ?? {})) {
      const cut = k.lastIndexOf(':')
      if (cut < 0) continue
      if (validKey(k.slice(0, cut))) options[k] = v as JobOptions
    }
    const lastTool = typeof p.lastTool === 'string' && toolCardById(p.lastTool) ? p.lastTool : null
    const state: AppState = {
      ...initialState,
      lastTool,
      queues: { ...queues, [FIRST_TAB]: queues[FIRST_TAB] ?? emptyQueue() },
      options
    }
    return { state, genResults }
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
  for (const [k, q] of Object.entries(state.queues)) {
    if (!q) continue
    const items = q.items.filter((it) =>
      it.isResult
        ? !!it.outputPath && exists.has(it.outputPath)
        : !!it.file?.path && exists.has(it.file.path)
    )
    queues[k] = { items, selected: [], anchor: null }
  }
  return {
    state: { ...state, queues },
    genResults: genResults.filter((p) => exists.has(p))
  }
}

/** Replace the current workspace's queue via `fn`. */
function mapQueue(state: AppState, fn: (q: QueueState) => QueueState): AppState {
  return mapQueueIn(state, queueKey(state.tab, state.activeTool), fn)
}

/** Replace a SPECIFIC workspace's queue - for actions dispatched after an
 * await, which must land where they were initiated, not where the user is. */
function mapQueueIn(state: AppState, key: QueueKey, fn: (q: QueueState) => QueueState): AppState {
  return { ...state, queues: { ...state.queues, [key]: fn(state.queues[key] ?? emptyQueue()) } }
}

/**
 * Update an item by id in whichever tool queue holds it. Job/thumbnail events
 * arrive asynchronously and may land after the user has switched tabs, so we
 * can't assume the item lives in the current tool's queue.
 */
function mapItemById(state: AppState, id: string, fn: (i: QueueItem) => QueueItem): AppState {
  const queues = { ...state.queues }
  for (const [k, q] of Object.entries(queues) as [QueueKey, QueueState][]) {
    if (q.items.some((i) => i.id === id)) {
      queues[k] = { ...q, items: q.items.map((i) => (i.id === id ? fn(i) : i)) }
    }
  }
  return { ...state, queues }
}

function selectInQueue(q: QueueState, id: string, mode: SelectMode): QueueState {
  const order = q.items.map((i) => i.id)
  if (mode === 'toggle') {
    const clicked = q.items.find((i) => i.id === id)
    const first = q.selected.length ? q.items.find((i) => i.id === q.selected[0]) : null
    // One convert group at a time. The options panel describes exactly one
    // target set, so ctrl+clicking another group MOVES the selection instead of
    // extending it into something Run could not honour. Range already did this;
    // toggle did not, which only stayed invisible while a queue held one
    // file type.
    if (clicked && first && groupOf(clicked.file) !== groupOf(first.file))
      return { ...q, selected: [id], anchor: id }
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
    case 'hydrate': {
      // Merge, never replace: the window is interactive while the session
      // restore round-trips, so files dropped in that gap must survive it.
      const merged = { ...action.state, queues: { ...action.state.queues } }
      for (const [k, q] of Object.entries(state.queues) as [QueueKey, QueueState][]) {
        if (!q?.items.length) continue
        const restored = merged.queues[k]
        if (!restored) {
          merged.queues[k] = q
          continue
        }
        const key = (i: QueueItem): string => (i.isResult ? (i.outputPath ?? i.id) : i.file.path)
        const have = new Set(restored.items.map(key))
        const extra = q.items.filter((i) => !have.has(key(i)))
        if (extra.length) merged.queues[k] = { ...restored, items: [...restored.items, ...extra] }
      }
      return merged
    }
    case 'setTab': {
      // Returning to Tools lands on the card you last had open; every other
      // verb is a single workspace, so there is nothing to remember.
      const activeTool = action.tab === 'tools' ? state.lastTool : null
      const key = queueKey(action.tab, activeTool)
      return {
        ...state,
        tab: action.tab,
        activeTool,
        queues: { ...state.queues, [key]: state.queues[key] ?? emptyQueue() }
      }
    }
    case 'setActiveTool': {
      const key = queueKey('tools', action.tool)
      return {
        ...state,
        activeTool: action.tool,
        lastTool: action.tool ?? state.lastTool,
        queues: { ...state.queues, [key]: state.queues[key] ?? emptyQueue() }
      }
    }
    case 'setOption': {
      const key = optionsKey(state.tab, state.activeTool, action.group)
      const base =
        state.options[key] ?? defaultOptionsFor(state.tab, state.activeTool, action.group)
      return {
        ...state,
        options: { ...state.options, [key]: { ...base, [action.key]: action.value } }
      }
    }
    case 'addItems': {
      // The workspace key rides ON the action: these are dispatched after an
      // await (files:classify), and the user can switch tabs during the round
      // trip - reducing against the current tab filed images into whatever
      // queue was open when the reply landed.
      const cat = action.key
      const q = state.queues[cat] ?? emptyQueue()
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
      const here = cat === queueKey(state.tab, state.activeTool)
      return mapQueueIn(state, cat, (cur) => ({
        items: [...cur.items, ...add],
        // Only steer the selection when the user is still LOOKING at this
        // workspace; a background add must not clobber another queue's state.
        selected: here ? ids : cur.selected,
        anchor: here ? ids[ids.length - 1] : cur.anchor
      }))
    }
    case 'addSources': {
      // Append pre-built source items (an output promoted back to input, so its
      // origin is visible) and select them. The caller (run) already reuses an
      // existing input for a path that's already present, so no dedup here.
      if (!action.items.length) return state
      return mapQueueIn(state, action.key, (cur) => ({
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
        for (const [k, q] of Object.entries(queues) as [QueueKey, QueueState][]) {
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
                  ? {
                      ...i,
                      status: 'done' as ItemStatus,
                      percent: 100,
                      message: undefined,
                      error: undefined
                    }
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

// One byte formatter for the whole app: this file used to carry its own copy
// (clamped at GB, different rounding) that rendered different strings on the
// same screen as the shared one.
export { formatBytes } from '@shared/compress'
