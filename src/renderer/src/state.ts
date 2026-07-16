import type { FileInfo, JobEvent, JobOptions, ToolId } from '@shared/types'

export type ItemStatus = 'ready' | 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface QueueItem {
  id: string
  file: FileInfo
  thumb: string | null
  status: ItemStatus
  percent: number
  message?: string
  outputPath?: string
  error?: string
  /** Dismissed from the Input column (its result may still show in Output). */
  hiddenInput?: boolean
  /** Result dismissed from the Output column (the input row may still show). */
  hiddenOutput?: boolean
}

/** Whether an item is currently shown in the Input column. */
export const inInput = (i: QueueItem): boolean => !i.hiddenInput
/** Whether an item's result is currently shown in the Output column. */
export const inOutput = (i: QueueItem): boolean =>
  i.status === 'done' && !!i.outputPath && !i.hiddenOutput

export type SelectMode = 'single' | 'toggle' | 'range'

export interface AppState {
  tool: ToolId
  items: QueueItem[]
  /** Ids of selected input items. */
  selected: string[]
  /** Last item clicked without a modifier, for shift-range selection. */
  anchor: string | null
  options: Record<ToolId, JobOptions>
}

export const DEFAULT_OPTIONS: Record<ToolId, JobOptions> = {
  convert: { format: '.webp', quality: 'balanced' },
  compress: { quality: 80 },
  resize: { mode: 'percent', percent: 50 },
  upscale: {},
  removebg: {},
  pdf: {}
}

export const initialState: AppState = {
  tool: 'convert',
  items: [],
  selected: [],
  anchor: null,
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
  | { type: 'setThumb'; id: string; thumb: string | null }
  | { type: 'dismiss'; id: string; column: 'input' | 'output' }
  | { type: 'markQueued'; ids: string[] }
  | { type: 'jobEvent'; event: JobEvent }
  | { type: 'select'; id: string; mode: SelectMode }
  | { type: 'clearSelection' }

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
      // Ignore input-dismissed items so re-dropping a removed file re-adds it.
      const seen = new Set(state.items.filter(inInput).map((i) => i.file.path))
      const add = action.files
        .filter((f) => !seen.has(f.path))
        .map<QueueItem>((f) => ({ id: newId(), file: f, thumb: null, status: 'ready', percent: 0 }))
      if (add.length === 0) return state
      // Dropped/added files become the current selection, constrained to one
      // kind (the first added file's) so a batch is never cross-category.
      const firstKind = add[0].file.kind
      const ids = add.filter((i) => i.file.kind === firstKind).map((i) => i.id)
      return {
        ...state,
        items: [...state.items, ...add],
        selected: ids,
        anchor: ids[ids.length - 1]
      }
    }
    case 'setThumb':
      return {
        ...state,
        items: state.items.map((i) => (i.id === action.id ? { ...i, thumb: action.thumb } : i))
      }
    case 'dismiss': {
      // Input and Output cards are two views of one item. Dismissing one hides
      // only that view; the item is dropped entirely once neither view remains.
      const items = state.items.map((i) =>
        i.id === action.id
          ? action.column === 'input'
            ? { ...i, hiddenInput: true }
            : { ...i, hiddenOutput: true }
          : i
      )
      const kept = items.filter((i) => inInput(i) || inOutput(i))
      const selectable = new Set(kept.filter(inInput).map((i) => i.id))
      return {
        ...state,
        items: kept,
        selected: state.selected.filter((s) => selectable.has(s)),
        anchor: state.anchor && selectable.has(state.anchor) ? state.anchor : null
      }
    }
    case 'markQueued':
      return {
        ...state,
        items: state.items.map((i) =>
          action.ids.includes(i.id)
            ? {
                ...i,
                status: 'queued',
                percent: 0,
                error: undefined,
                outputPath: undefined,
                hiddenOutput: false
              }
            : i
        )
      }
    case 'jobEvent': {
      const e = action.event
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === e.id
            ? {
                ...i,
                status: e.status as ItemStatus,
                percent: e.percent ?? i.percent,
                message: e.message,
                outputPath: e.outputPath ?? i.outputPath,
                error: e.error
              }
            : i
        )
      }
    }
    case 'select': {
      const order = state.items.map((i) => i.id)
      if (action.mode === 'toggle') {
        const has = state.selected.includes(action.id)
        return {
          ...state,
          selected: has
            ? state.selected.filter((s) => s !== action.id)
            : [...state.selected, action.id],
          anchor: action.id
        }
      }
      if (action.mode === 'range' && state.anchor) {
        const a = order.indexOf(state.anchor)
        const b = order.indexOf(action.id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          // Range selection stays within the anchor's kind (no cross-category batch).
          const anchorKind = state.items.find((i) => i.id === state.anchor)?.file.kind
          const range = order
            .slice(lo, hi + 1)
            .filter((id) => state.items.find((i) => i.id === id)?.file.kind === anchorKind)
          return { ...state, selected: range }
        }
      }
      return { ...state, selected: [action.id], anchor: action.id }
    }
    case 'clearSelection':
      return { ...state, selected: [], anchor: null }
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

export function formatBytes(n: number): string {
  if (n <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / Math.pow(1024, i)
  return `${i === 0 ? Math.round(v) : v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`
}
