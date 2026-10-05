import { parseArgs } from 'node:util'
import { COMMANDS, SUBCOMMANDS, findCommand, type CommandSpec } from './catalog'
import { UsageError } from './exit'

export interface ParsedArgs {
  kind: 'run' | 'help' | 'version'
  command: CommandSpec | null
  group?: 'pdf' | 'skill'
  positionals: string[]
  values: Record<string, string | boolean>
  json: boolean
  dryRun: boolean
}

const GROUPS = new Set(['pdf', 'skill'])
const VERB_ALIASES: Record<string, string> = {
  'remove-bg': 'removebg',
  'remove-background': 'removebg'
}
const GLOBAL_BOOLS = new Set(['--json', '--dry-run', '--version', '--help', '-h'])

/** --json before `--`, case-insensitively: needed before parsing, so a usage
 * error can still be reported as a JSON event. */
export function detectJson(argv: string[]): boolean {
  for (const a of argv) {
    if (a === '--') return false
    if (a.toLowerCase() === '--json') return true
  }
  return false
}

function normalizeFlag(t: string): string {
  if (t.startsWith('--')) {
    const eq = t.indexOf('=')
    return eq === -1 ? t.toLowerCase() : t.slice(0, eq).toLowerCase() + t.slice(eq)
  }
  if (/^-[A-Za-z]$/.test(t)) return t.toLowerCase()
  return t
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
  return d[a.length][b.length]
}

function unknownFlag(flag: string, cmd: CommandSpec): UsageError {
  const name = flag.replace(/^-+/, '')
  const where = `filesmith ${cmd.path.join(' ')}`
  const owners = COMMANDS.filter((c) =>
    c.flags.some((f) => f.name === name || f.aliases?.includes(name))
  ).map((c) => c.path.join(' '))
  if (owners.length)
    return new UsageError(
      `Unknown option --${name} for ${where}. --${name} is an option of: ${owners.join(', ')}.`,
      cmd.path
    )
  const near = cmd.flags
    .map((f) => f.name)
    .filter((n) => distance(n, name) <= 2)
    .sort((a, b) => distance(a, name) - distance(b, name))[0]
  return new UsageError(
    `Unknown option --${name} for ${where}.${near ? ` Did you mean --${near}?` : ''}`,
    cmd.path
  )
}

function translate(e: unknown, cmd: CommandSpec): UsageError {
  const err = e as { code?: string; message?: string }
  const flag = /'(-{1,2}[^' ]+)/.exec(err.message ?? '')?.[1] ?? ''
  if (err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return unknownFlag(flag, cmd)
  if (err.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    if (/argument missing/.test(err.message ?? ''))
      return new UsageError(`${flag} needs a value.`, cmd.path)
    return new UsageError(`${flag} does not take a value.`, cmd.path)
  }
  return new UsageError(err.message ?? String(e), cmd.path)
}

/** Spec 2.1, 2.8, 2.9: verb (or `pdf <tool>` / `skill <sub>`), then inputs and
 * flags in any order, `--` ends flags. Throws UsageError. */
export function parseArgv(argv: string[]): ParsedArgs {
  const dd = argv.indexOf('--')
  const head = (dd === -1 ? argv : argv.slice(0, dd)).map(normalizeFlag)
  const tail = dd === -1 ? [] : argv.slice(dd + 1)
  const base = { positionals: [] as string[], values: {}, json: false, dryRun: false }

  let i = 0
  while (i < head.length && GLOBAL_BOOLS.has(head[i])) i++
  const leading = head.slice(0, i)
  const word = head[i] && !head[i].startsWith('-') ? head[i].toLowerCase() : undefined
  const verb = word ? (VERB_ALIASES[word] ?? word) : undefined

  if (!verb) {
    if (leading.includes('--version')) return { ...base, kind: 'version', command: null }
    const stray = head.slice(i).find((t) => !GLOBAL_BOOLS.has(t))
    if (stray) throw new UsageError(`Missing command before ${stray}.`)
    return { ...base, kind: 'help', command: null }
  }

  if (verb === 'help') {
    const target = head
      .slice(i + 1)
      .filter((t) => !t.startsWith('-'))
      .map((t) => t.toLowerCase())
    if (!target.length) return { ...base, kind: 'help', command: null }
    if (target.length === 1 && GROUPS.has(target[0]))
      return { ...base, kind: 'help', command: null, group: target[0] as 'pdf' | 'skill' }
    const cmd = findCommand([VERB_ALIASES[target[0]] ?? target[0], ...target.slice(1)])
    if (!cmd) throw new UsageError(`Unknown command: ${target.join(' ')}. Run: filesmith --help`)
    return { ...base, kind: 'help', command: cmd }
  }

  let path = [verb]
  let rest = [...leading, ...head.slice(i + 1)]
  if (GROUPS.has(verb)) {
    const group = verb as 'pdf' | 'skill'
    const sub = rest.find((t) => !t.startsWith('-'))
    const firstSubIdx = sub ? rest.indexOf(sub) : -1
    const flagsBefore = firstSubIdx === -1 ? rest : rest.slice(0, firstSubIdx)
    if (!sub || flagsBefore.some((t) => !GLOBAL_BOOLS.has(t))) {
      if (rest.includes('--help') || rest.includes('-h'))
        return { ...base, kind: 'help', command: null, group }
      throw new UsageError(`filesmith ${group} needs a tool: ${SUBCOMMANDS[group].join(', ')}.`, [
        group
      ])
    }
    path = [group, sub.toLowerCase()]
    rest = [...flagsBefore, ...rest.slice(firstSubIdx + 1)]
  }

  const cmd = findCommand(path)
  if (!cmd) throw new UsageError(`Unknown command: ${path.join(' ')}. Run: filesmith --help`)

  type Opt = { type: 'boolean' | 'string'; short?: string }
  const options: Record<string, Opt> = {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean' },
    json: { type: 'boolean' },
    'dry-run': { type: 'boolean' }
  }
  for (const f of cmd.flags)
    for (const n of [f.name, ...(f.aliases ?? [])])
      options[n] = {
        type: f.type === 'bool' ? 'boolean' : 'string',
        ...(f.short && n === f.name ? { short: f.short } : {})
      }

  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: rest,
      options,
      allowPositionals: true,
      strict: true,
      allowNegative: true
    })
  } catch (e) {
    throw translate(e, cmd)
  }

  const values: Record<string, string | boolean> = {}
  for (const f of cmd.flags)
    for (const n of [f.name, ...(f.aliases ?? [])]) {
      const v = parsed.values[n]
      if (typeof v === 'string' || typeof v === 'boolean') values[f.name] = v
    }
  const json = parsed.values.json === true
  const dryRun = parsed.values['dry-run'] === true
  if (parsed.values.version === true) return { ...base, kind: 'version', command: null, json }
  if (parsed.values.help === true) return { ...base, kind: 'help', command: cmd }

  const positionals = [...parsed.positionals, ...tail]
  if (cmd.inputs === 'none' && positionals.length)
    throw new UsageError(`filesmith ${cmd.path.join(' ')} takes no arguments.`, cmd.path)
  return { kind: 'run', command: cmd, positionals, values, json, dryRun }
}
