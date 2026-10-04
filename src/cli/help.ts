import { COMMANDS, SUBCOMMANDS, findCommand, type CommandSpec, type FlagSpec } from './catalog'

const WIDTH = 80
const COL = 28

/** Word-wrap to `width`, continuation lines indented by `indent`. */
export function wrap(text: string, width: number, indent: number): string[] {
  const max = width - indent
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > max) {
      lines.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  return lines.map((l, i) => (i === 0 ? l : ' '.repeat(indent) + l))
}

function valueName(f: FlagSpec): string {
  if (f.valueName) return f.valueName
  if (f.type === 'enum' && f.values) {
    const v = `<${f.values.join('|')}>`
    return v.length <= 22 ? v : '<value>'
  }
  if ((f.type === 'int' || f.type === 'number') && f.min !== undefined && f.max !== undefined)
    return `<${f.min}-${f.max}>`
  if (f.type === 'path') return '<path>'
  return '<value>'
}

function label(f: FlagSpec): string {
  const short = f.short ? `-${f.short}, ` : '    '
  return `${short}--${f.name}${f.type === 'bool' ? '' : ` ${valueName(f)}`}`
}

function description(f: FlagSpec): string {
  let s = f.help
  if (f.type === 'enum' && f.values && valueName(f) === '<value>') s += `: ${f.values.join(', ')}`
  if (f.aliases?.length) s += ` (also --${f.aliases.join(', --')})`
  if (f.required) s += ' (required)'
  else if (f.def !== undefined && f.def !== false && f.def !== '') s += ` (default ${f.def})`
  return s
}

function flagLines(f: FlagSpec): string[] {
  const left = `  ${label(f)}`
  const desc = wrap(description(f), WIDTH, COL)
  if (left.length < COL - 1) return [left.padEnd(COL) + desc[0], ...desc.slice(1)]
  return [left, ' '.repeat(COL) + desc[0], ...desc.slice(1)]
}

export function usageLine(cmd: CommandSpec): string {
  return `Usage: filesmith ${cmd.path.join(' ')} ${cmd.args}`.trimEnd()
}

const HELP_FLAG: FlagSpec = { name: 'help', short: 'h', type: 'bool', help: 'Show this help' }

export function renderHelp(cmd: CommandSpec): string {
  const out = [usageLine(cmd), '', ...wrap(cmd.summary, WIDTH, 0), '']
  const groups = new Map<string, FlagSpec[]>()
  for (const f of cmd.flags) {
    const g = f.group ?? 'Options'
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  for (const [g, flags] of groups) {
    if (g === 'Options') continue
    out.push(`${g}:`, ...flags.flatMap(flagLines), '')
  }
  out.push(
    'Options:',
    ...(groups.get('Options') ?? []).flatMap(flagLines),
    ...flagLines(HELP_FLAG),
    ''
  )
  if (cmd.examples.length) out.push('Examples:', ...cmd.examples.map((e) => `  ${e}`), '')
  return out.join('\n')
}

const firstSentence = (s: string): string => s.split('. ')[0].replace(/\.$/, '')

function row(name: string, text: string): string[] {
  const lines = wrap(text, WIDTH, 26)
  return [`  ${name.padEnd(23)} ${lines[0] ?? ''}`, ...lines.slice(1)]
}

export function renderGroupHelp(group: 'pdf' | 'skill'): string {
  const out = [`Usage: filesmith ${group} <tool> [options]`, '', 'Tools:']
  for (const sub of SUBCOMMANDS[group]) {
    const cmd = findCommand([group, sub])
    if (cmd) out.push(...row(sub, firstSentence(cmd.summary)))
  }
  out.push('', `Run 'filesmith ${group} <tool> --help' for a tool's options.`, '')
  return out.join('\n')
}

export function renderRootHelp(): string {
  const out = [
    'Usage: filesmith <command> [options]',
    '',
    ...wrap(
      'Convert, compress, resize, upscale, remove backgrounds, generate images and run PDF tools from the command line. Never overwrites a file.',
      WIDTH,
      0
    ),
    '',
    'Commands:'
  ]
  for (const c of COMMANDS.filter((x) => x.path.length === 1))
    out.push(...row(c.path[0], firstSentence(c.summary)))
  out.push(...row('pdf <tool>', `PDF tools: ${SUBCOMMANDS.pdf.join(', ')}`))
  out.push(...row('skill <install|status>', 'The Claude Code skill'))
  out.push(...row('help [command]', 'Help for a command'))
  out.push(
    '',
    'Global options:',
    ...flagLines({ name: 'json', type: 'bool', help: 'Machine-readable events on stdout' }),
    ...flagLines({ name: 'dry-run', type: 'bool', help: 'Show what would happen, write nothing' }),
    ...flagLines(HELP_FLAG),
    ...flagLines({ name: 'version', type: 'bool', help: 'Print the version' }),
    '',
    "Run 'filesmith <command> --help' for a command's options.",
    ''
  )
  return out.join('\n')
}
