import type { Out } from './events'

/** Everything main() touches of the process, injectable for tests (spec 4.3). */
export interface CliIO {
  argv: string[]
  stdout: Out
  stderr: Out
  stdoutTTY: boolean
  stderrTTY: boolean
  env: Record<string, string | undefined>
  cwd: string
  readStdin(): Promise<string>
  /** Aborted by Ctrl+C (SIGINT, SIGBREAK) or a closed stdout. */
  signal: AbortSignal
  /** In-app console (spec 9.2): NDJSON events in addition to the human output. */
  events?: Out
}
