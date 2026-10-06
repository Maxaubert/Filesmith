// The in-app console's IPC payloads (spec 9.5), declared once for main,
// preload and renderer.

export interface ConsoleFlag {
  name: string
  aliases: string[]
  short?: string
  type: string
  values: string[]
  valueName?: string
  help: string
}

export interface ConsoleCommand {
  path: string[]
  summary: string
  inputs: 'files' | 'prompt' | 'words' | 'none'
  flags: ConsoleFlag[]
}

/** A slim copy of the CLI catalog (src/cli/catalog.ts) for completion. */
export interface ConsoleCatalog {
  commands: ConsoleCommand[]
  aliases: Record<string, string>
  globals: ConsoleFlag[]
}

/** One NDJSON event of the CLI (src/cli/events.ts), loosely typed. */
export type ConsoleCliEvent = { event: string; [k: string]: unknown }

export type ConsoleEvent =
  | { id: string; kind: 'out' | 'err'; text: string }
  | { id: string; kind: 'event'; ev: ConsoleCliEvent }
  | { id: string; kind: 'exit'; code: number }

export type ConsoleRunResult = { ok: true; code: number } | { ok: false; error: string }

export interface ConsoleEntry {
  name: string
  dir: boolean
  size: number
}

export type ConsoleCdResult = { ok: true; dir: string } | { ok: false; error: string }
