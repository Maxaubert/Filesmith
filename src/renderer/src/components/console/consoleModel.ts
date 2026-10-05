import type { ConsoleCliEvent } from '@shared/console'

// The console's scrollback (spec 7). Pure: text lines come from the CLI's
// human output, progress and output paths from its events.

export type LineStyle = 'ok' | 'skip' | 'fail' | 'stop' | 'plan' | 'hint' | 'sum' | 'err' | 'text'
export interface OutLine {
  text: string
  style: LineStyle
}
export interface Progress {
  label: string
  pct: number | null
  etaSec?: number
  elapsedSec?: number
}
export type Block =
  | { kind: 'note'; id: string; text: string }
  | {
      kind: 'cmd'
      id: string
      cwd: string
      line: string
      lines: OutLine[]
      status: 'running' | 'done' | 'refused' | 'builtin'
      refusal?: string
      code?: number
      startedAt: number
      ms?: number
      outputs: string[]
      progress: Progress | null
      total: number
      index: number
      stopping: boolean
    }
export interface ConsoleState {
  blocks: Block[]
}
export const INITIAL: ConsoleState = { blocks: [] }
export const MAX_LINES = 5000

export type ConsoleAction =
  | { type: 'note'; id: string; text: string }
  | { type: 'start'; id: string; cwd: string; line: string; at: number }
  | { type: 'refuse'; id: string; cwd: string; line: string; text: string }
  | { type: 'builtin'; id: string; cwd: string; line: string; lines: string[] }
  | { type: 'out'; id: string; text: string }
  | { type: 'event'; id: string; ev: ConsoleCliEvent }
  | { type: 'exit'; id: string; code: number; at: number }
  | { type: 'stopping'; id: string }
  | { type: 'clear' }

export function styleOf(t: string): LineStyle {
  const m = /^(ok|skip|fail|stop|plan)\s{2,}/.exec(t)
  if (m) return m[1] as LineStyle
  if (/^\s*(hint|fix):/.test(t)) return 'hint'
  if (/^\d+ files?: /.test(t)) return 'sum'
  if (/^filesmith: /.test(t)) return 'err'
  return 'text'
}

const baseName = (p: string): string =>
  p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1)

export function fmtEta(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function fmtSize(n: number): string {
  const KB = 1024
  const MB = KB * 1024
  return n >= 1024 * MB
    ? `${(n / 1024 / MB).toFixed(1)} GB`
    : n >= MB
      ? `${(n / MB).toFixed(1)} MB`
      : `${Math.max(1, Math.round(n / KB))} KB`
}

export function progressText(p: Progress): string {
  if (p.pct == null) return p.elapsedSec != null ? `${p.label} (${fmtEta(p.elapsedSec)})` : p.label
  return `${p.label} ${Math.round(p.pct)}%${p.etaSec != null ? ` (${fmtEta(p.etaSec)})` : ''}`
}

/** The full output path of an `ok` row (its text shows base names only). */
export function outputForLine(text: string, outputs: readonly string[]): string | null {
  if (styleOf(text) !== 'ok') return null
  const arrow = text.indexOf(' -> ')
  if (arrow === -1) return outputs.length === 1 ? outputs[0] : null
  const after = text.slice(arrow + 4)
  return outputs.find((o) => after.startsWith(baseName(o))) ?? null
}

type Cmd = Extract<Block, { kind: 'cmd' }>

function onEvent(b: Cmd, ev: ConsoleCliEvent): Cmd {
  const num = (k: string): number | undefined =>
    typeof ev[k] === 'number' ? (ev[k] as number) : undefined
  switch (ev.event) {
    case 'run':
      return { ...b, total: num('inputs') ?? 0 }
    case 'start': {
      const index = b.index + 1
      const input = Array.isArray(ev.input) ? String(ev.input[0] ?? '') : String(ev.input ?? '')
      const count = b.total > 1 ? `[${index}/${b.total}]  ` : ''
      return { ...b, index, progress: { label: `${count}${baseName(input)}`, pct: 0 } }
    }
    case 'progress':
      return b.progress
        ? {
            ...b,
            progress: {
              ...b.progress,
              pct: (ev.pct as number | null) ?? null,
              etaSec: num('etaSec')
            }
          }
        : b
    case 'step':
      return {
        ...b,
        progress: {
          label: String(ev.step),
          pct: (ev.pct as number | null) ?? null,
          etaSec: num('etaSec')
        }
      }
    case 'heartbeat':
      return {
        ...b,
        progress: { label: String(ev.step), pct: null, elapsedSec: num('elapsedSec') }
      }
    case 'done':
      return {
        ...b,
        progress: null,
        outputs: typeof ev.output === 'string' ? [...b.outputs, ev.output] : b.outputs
      }
    case 'canceled':
    case 'error':
    case 'skipped':
      return { ...b, progress: null }
    default:
      return b
  }
}

const lineCount = (b: Block): number => (b.kind === 'note' ? 1 : b.lines.length + 2)

function cap(blocks: Block[]): Block[] {
  let total = blocks.reduce((n, b) => n + lineCount(b), 0)
  const out = [...blocks]
  while (total > MAX_LINES && out.length > 1) {
    const i = out.findIndex((b) => !(b.kind === 'cmd' && b.status === 'running'))
    if (i === -1) break
    total -= lineCount(out[i])
    out.splice(i, 1)
  }
  return out
}

function update(s: ConsoleState, id: string, f: (b: Cmd) => Cmd): ConsoleState {
  return { blocks: s.blocks.map((b) => (b.kind === 'cmd' && b.id === id ? f(b) : b)) }
}

const newCmd = (id: string, cwd: string, line: string, at: number): Cmd => ({
  kind: 'cmd',
  id,
  cwd,
  line,
  lines: [],
  status: 'running',
  startedAt: at,
  outputs: [],
  progress: null,
  total: 0,
  index: 0,
  stopping: false
})

export function consoleReducer(s: ConsoleState, a: ConsoleAction): ConsoleState {
  switch (a.type) {
    case 'note':
      return { blocks: cap([...s.blocks, { kind: 'note', id: a.id, text: a.text }]) }
    case 'start':
      return { blocks: cap([...s.blocks, newCmd(a.id, a.cwd, a.line, a.at)]) }
    case 'refuse':
      return {
        blocks: cap([
          ...s.blocks,
          { ...newCmd(a.id, a.cwd, a.line, 0), status: 'refused', refusal: a.text }
        ])
      }
    case 'builtin':
      return {
        blocks: cap([
          ...s.blocks,
          {
            ...newCmd(a.id, a.cwd, a.line, 0),
            status: 'builtin',
            lines: a.lines.map((text) => ({ text, style: styleOf(text) }))
          }
        ])
      }
    case 'out':
      return {
        blocks: cap(
          update(s, a.id, (b) => ({
            ...b,
            lines: [...b.lines, { text: a.text, style: styleOf(a.text) }]
          })).blocks
        )
      }
    case 'event':
      return update(s, a.id, (b) => onEvent(b, a.ev))
    case 'exit':
      return update(s, a.id, (b) => ({
        ...b,
        status: 'done',
        code: a.code,
        ms: a.at - b.startedAt,
        progress: null,
        stopping: false
      }))
    case 'stopping':
      return update(s, a.id, (b) => ({ ...b, stopping: true }))
    case 'clear':
      return { blocks: s.blocks.filter((b) => b.kind === 'cmd' && b.status === 'running') }
  }
}
