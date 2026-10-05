import type { ConsoleCatalog, ConsoleCommand, ConsoleEntry, ConsoleFlag } from './console'
import { splitAtCaret } from './consoleLine'

// Tab completion (spec 8). Pure: the renderer fetches folder entries itself
// when the context asks for files.

export interface CompletionItem {
  value: string
  detail: string
}

export type CompletionCtx =
  | { kind: 'list'; title: string; prefix: string; items: CompletionItem[] }
  | { kind: 'files'; prefix: string; dir: string; name: string }
  | null

const GROUP_TITLE: Record<string, string> = { pdf: 'PDF TOOLS', skill: 'SKILL' }
const starts = (v: string, p: string): boolean => v.toLowerCase().startsWith(p.toLowerCase())

function list(title: string, prefix: string, items: CompletionItem[]): CompletionCtx {
  const hit = items.filter((i) => starts(i.value, prefix))
  return hit.length ? { kind: 'list', title, prefix, items: hit } : null
}

function firstWords(cat: ConsoleCatalog, builtins: readonly CompletionItem[]): CompletionItem[] {
  const seen = new Map<string, string>()
  for (const c of cat.commands) {
    const w = c.path[0]
    if (seen.has(w)) continue
    const subs = cat.commands.filter((x) => x.path[0] === w && x.path.length > 1)
    seen.set(w, subs.length ? subs.map((s) => s.path[1]).join(', ') : c.summary)
  }
  return [...[...seen].map(([value, detail]) => ({ value, detail })), ...builtins]
}

function flagFor(cmd: ConsoleCommand, cat: ConsoleCatalog, word: string): ConsoleFlag | undefined {
  const w = word.toLowerCase()
  const all = [...cmd.flags, ...cat.globals]
  if (/^-[a-z]$/i.test(w)) return all.find((f) => f.short === w.slice(1))
  const n = w.replace(/^--/, '').split('=')[0]
  return all.find((f) => f.name === n || f.aliases.includes(n))
}

export function completionContext(
  before: string,
  cat: ConsoleCatalog,
  builtins: readonly CompletionItem[]
): CompletionCtx {
  const { done: raw, cur } = splitAtCaret(before)
  const done = raw.length && raw[0].toLowerCase() === 'filesmith' ? raw.slice(1) : raw
  if (!done.length) return list('COMMANDS', cur, firstWords(cat, builtins))
  const w0 = done[0].toLowerCase()
  const verb = cat.aliases[w0] ?? w0
  const group = cat.commands.filter((c) => c.path[0] === verb && c.path.length > 1)
  if (group.length && done.length === 1)
    return list(
      GROUP_TITLE[verb] ?? verb.toUpperCase(),
      cur,
      group.map((c) => ({ value: c.path[1], detail: c.summary }))
    )
  const path = group.length ? [verb, (done[1] ?? '').toLowerCase()] : [verb]
  const cmd = cat.commands.find((c) => c.path.join(' ') === path.join(' '))
  if (!cmd) return null
  const prev = done[done.length - 1]
  const pf = prev.startsWith('-') ? flagFor(cmd, cat, prev) : undefined
  if (pf && pf.type !== 'bool' && !prev.includes('=')) {
    if (pf.values.length)
      return list(
        pf.name.toUpperCase(),
        cur,
        pf.values.map((v) => ({ value: v, detail: '' }))
      )
    if (pf.type !== 'path') return null
  } else if (cur.startsWith('-')) {
    const used = new Set(
      done
        .filter((d) => d.startsWith('-'))
        .map((d) => flagFor(cmd, cat, d)?.name)
        .filter(Boolean)
    )
    const flags = [
      ...cmd.flags,
      ...cat.globals.filter((g) => !cmd.flags.some((f) => f.name === g.name))
    ]
      .filter((f) => !used.has(f.name))
      .filter((f) => [f.name, ...f.aliases].some((n) => starts(`--${n}`, cur)))
    return flags.length
      ? {
          kind: 'list',
          title: `${cmd.path.join(' ').toUpperCase()} OPTIONS`,
          prefix: cur,
          items: flags.map((f) => ({ value: `--${f.name}`, detail: f.help }))
        }
      : null
  } else if (cmd.inputs !== 'files') return null
  const cut = Math.max(cur.lastIndexOf('\\'), cur.lastIndexOf('/')) + 1
  return { kind: 'files', prefix: cur, dir: cur.slice(0, cut), name: cur.slice(cut) }
}

export function fileItems(
  entries: readonly ConsoleEntry[],
  name: string,
  fmtSize: (n: number) => string
): CompletionItem[] {
  const hit = entries.filter((e) => starts(e.name, name))
  return [
    ...hit.filter((e) => e.dir).map((e) => ({ value: `${e.name}\\`, detail: 'folder' })),
    ...hit.filter((e) => !e.dir).map((e) => ({ value: e.name, detail: fmtSize(e.size) }))
  ]
}

/** Replace the typed word (`prefix`, ending at the caret) with `value`. */
export function applyCompletion(
  input: string,
  caret: number,
  prefix: string,
  value: string
): { text: string; caret: number } {
  const start = Math.max(0, caret - prefix.length)
  // A quoted word in progress ("My Ph) keeps its opening quote.
  const quoted = input[start - 1] === '"'
  const from = quoted ? start - 1 : start
  const word = /\s/.test(value) || quoted ? `"${value}` : value
  const isDir = value.endsWith('\\')
  const closed = isDir ? word : word.startsWith('"') ? `${word}"` : word
  const rest = input.slice(caret)
  const sep = isDir || rest.startsWith(' ') ? '' : ' '
  const text = input.slice(0, from) + closed + sep + rest
  return { text, caret: from + closed.length + (sep ? 1 : rest.startsWith(' ') && !isDir ? 1 : 0) }
}
