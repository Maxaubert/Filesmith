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
}

export interface AppState {
  tool: ToolId
  items: QueueItem[]
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

export const initialState: AppState = { tool: 'convert', items: [], options: DEFAULT_OPTIONS }

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
  | { type: 'removeItem'; id: string }
  | { type: 'clearFinished' }
  | { type: 'markQueued'; ids: string[] }
  | { type: 'jobEvent'; event: JobEvent }

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
      const seen = new Set(state.items.map((i) => i.file.path))
      const add = action.files
        .filter((f) => !seen.has(f.path))
        .map<QueueItem>((f) => ({ id: newId(), file: f, thumb: null, status: 'ready', percent: 0 }))
      return { ...state, items: [...state.items, ...add] }
    }
    case 'setThumb':
      return {
        ...state,
        items: state.items.map((i) => (i.id === action.id ? { ...i, thumb: action.thumb } : i))
      }
    case 'removeItem':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) }
    case 'clearFinished':
      return { ...state, items: state.items.filter((i) => i.status !== 'done') }
    case 'markQueued':
      return {
        ...state,
        items: state.items.map((i) =>
          action.ids.includes(i.id)
            ? { ...i, status: 'queued', percent: 0, error: undefined, outputPath: undefined }
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
