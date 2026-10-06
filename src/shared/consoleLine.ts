import type { ConsoleCatalog } from './console'

// What a console line is (spec 6, 10). Pure, used by the renderer for the
// message and by main again before anything is started.

export const MAX_LINE = 8000

interface Scan {
  done: string[]
  cur: string
  inWord: boolean
}

function scan(line: string): Scan {
  const done: string[] = []
  let cur = ''
  let inWord = false
  let quoted = false
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted
      inWord = true
      continue
    }
    if (!quoted && /\s/.test(ch)) {
      if (inWord) done.push(cur)
      cur = ''
      inWord = false
      continue
    }
    cur += ch
    inWord = true
  }
  return { done, cur, inWord }
}

/** Words of a line: whitespace splits, double quotes group, backslashes are literal. */
export function tokenize(line: string): string[] {
  const s = scan(line)
  return s.inWord ? [...s.done, s.cur] : s.done
}

/** The finished words before the caret and the word being typed ('' after a space). */
export function splitAtCaret(before: string): { done: string[]; cur: string } {
  const s = scan(before)
  return { done: s.done, cur: s.inWord ? s.cur : '' }
}

/** Words that start a CLI run: the catalog's first words and the aliases. */
export function cliVerbs(cat: ConsoleCatalog): Set<string> {
  return new Set([...cat.commands.map((c) => c.path[0]), ...Object.keys(cat.aliases)])
}

/** The CLI's global flags, allowed before the command (src/cli/parse.ts GLOBAL_BOOLS). */
const GLOBAL_FLAGS = new Set(['--json', '--dry-run', '--version', '--help', '-h'])
/** A pasted prefix: `filesmith`, `filesmith.exe`, `filesmith.cmd`, any case. */
const PREFIX = /^filesmith(\.exe|\.cmd)?$/i

export type LineKind =
  | { kind: 'empty' }
  | { kind: 'builtin'; name: 'cd' | 'clear' | 'help' | 'history'; args: string[] }
  | { kind: 'cli'; argv: string[] }
  | { kind: 'refuse'; word: string; reason: 'unknown' | 'stdin' | 'too-long' }

const BUILTIN: Record<string, 'cd' | 'clear' | 'help' | 'history'> = {
  cd: 'cd',
  clear: 'clear',
  cls: 'clear',
  help: 'help',
  history: 'history'
}

// The one gate of the limited console (spec 6, 10). A line runs only when its
// first word after the optional prefix and any global flags is a catalog
// command or alias. Everything else, including every program name, path,
// operator or empty first word, is refused. Main runs this same function on
// the raw line again before it forks (Task 4, validate.ts).
export function classifyLine(line: string, verbs: ReadonlySet<string>): LineKind {
  if (typeof line !== 'string') return { kind: 'refuse', word: '', reason: 'unknown' }
  if (line.length > MAX_LINE) return { kind: 'refuse', word: line.slice(0, 20), reason: 'too-long' }
  const all = tokenize(line)
  if (!all.length) return { kind: 'empty' }
  const prefixed = PREFIX.test(all[0])
  const words = prefixed ? all.slice(1) : all
  // A bare `filesmith` is the CLI's own help, as in a terminal.
  if (!words.length) return { kind: 'cli', argv: ['--help'] }
  const first = words[0].toLowerCase()
  if (!prefixed) {
    if (first === 'help' && words.length > 1 && verbs.has(words[1].toLowerCase()))
      return { kind: 'cli', argv: [...words.slice(1), '--help'] }
    const builtin = BUILTIN[first]
    if (builtin) return { kind: 'builtin', name: builtin, args: words.slice(1) }
  } else if (first === 'help') return { kind: 'cli', argv: words } // `filesmith help [cmd]`
  let i = 0
  while (i < words.length && GLOBAL_FLAGS.has(words[i].toLowerCase())) i++
  if (i < words.length && !verbs.has(words[i].toLowerCase()))
    return { kind: 'refuse', word: words[i], reason: 'unknown' }
  if (words.includes('-')) return { kind: 'refuse', word: '-', reason: 'stdin' }
  return { kind: 'cli', argv: words }
}

export function refusalText(k: Extract<LineKind, { kind: 'refuse' }>): string {
  if (k.reason === 'stdin')
    return 'Reading file names from stdin is not available here. Use a terminal for that.'
  if (k.reason === 'too-long') return `The line is longer than ${MAX_LINE} characters.`
  return `\`${k.word}\` is not a filesmith command. Only filesmith commands run here. Use a terminal for anything else.`
}

/** Split text on `backtick` spans so the UI can draw them as code. Odd
 *  indexes are code; an unmatched trailing backtick stays plain text. */
export function codeSegments(text: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = []
  const re = /`([^`]+)`/g
  let at = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), code: false })
    out.push({ text: m[1], code: true })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), code: false })
  return out
}
