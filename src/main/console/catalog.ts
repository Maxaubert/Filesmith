import type { CommandSpec, FlagSpec } from '../../cli/catalog'
import type { ConsoleCatalog, ConsoleFlag } from '@shared/console'

// The CLI catalog, slimmed for the renderer's completion (spec 8). Built from
// the same COMMANDS the CLI parses with, so completion cannot drift.

const slim = (f: FlagSpec): ConsoleFlag => ({
  name: f.name,
  aliases: f.aliases ?? [],
  short: f.short,
  type: f.type,
  values: f.type === 'bool' ? [] : [...(f.values ?? [])],
  valueName: f.valueName,
  help: f.help
})

const GLOBALS: ConsoleFlag[] = [
  { name: 'json', aliases: [], type: 'bool', values: [], help: 'NDJSON events' },
  { name: 'dry-run', aliases: [], type: 'bool', values: [], help: 'plan only, write nothing' },
  { name: 'help', aliases: [], type: 'bool', values: [], help: 'options for this command' }
]

export function buildConsoleCatalog(commands: readonly CommandSpec[]): ConsoleCatalog {
  return {
    commands: commands.map((c) => ({
      path: [...c.path],
      summary: c.summary,
      inputs: c.inputs,
      flags: c.flags.map(slim)
    })),
    aliases: { 'remove-bg': 'removebg', 'remove-background': 'removebg' },
    globals: GLOBALS
  }
}
