import { existsSync } from 'fs'
import { discardRecord, type OutputRecord } from '../main/atomicOutput'

/**
 * The CLI's watchdog: a small detached process that outlives a CLI killed
 * outright (Ctrl+Break, the console window closed, TerminateProcess) and
 * cleans up after it. The CLI streams one JSON message per line on the
 * watchdog's stdin; the pipe closing without `bye` means the CLI died.
 */
export type WatchdogMessage =
  | { t: 'out'; r: OutputRecord }
  | { t: 'settled'; part: string }
  | { t: 'pid'; pid: number; image: string }
  | { t: 'ended'; pid: number }
  | { t: 'bye' }

export class WatchdogState {
  readonly outputs = new Map<string, OutputRecord>()
  readonly pids = new Map<number, string>()
  bye = false

  apply(line: string): void {
    let m: WatchdogMessage
    try {
      m = JSON.parse(line) as WatchdogMessage
    } catch {
      return // a torn last line from a killed writer
    }
    switch (m.t) {
      case 'out':
        this.outputs.set(m.r.part, m.r)
        break
      case 'settled':
        this.outputs.delete(m.part)
        break
      case 'pid':
        this.pids.set(m.pid, m.image)
        break
      case 'ended':
        this.pids.delete(m.pid)
        break
      case 'bye':
        this.bye = true
        break
    }
  }
}

export interface CleanupDeps {
  /** Kill `pid`'s tree if it is still running `image`. */
  kill(pid: number, image: string): void
  sleep(ms: number): Promise<void>
}

/**
 * After the CLI died: kill the tool processes it left running, then remove its
 * uncommitted parts and placeholders (identity-checked, so nothing that is not
 * this run's own leftover is touched). A just-killed tool can hold its part
 * file open for a moment, so the removal is retried briefly.
 */
export async function cleanUp(state: WatchdogState, deps: CleanupDeps): Promise<void> {
  if (state.bye) return
  for (const [pid, image] of state.pids) deps.kill(pid, image)
  for (let attempt = 0; attempt < 10 && state.outputs.size > 0; attempt++) {
    if (attempt > 0) await deps.sleep(300)
    for (const [part, r] of state.outputs) {
      discardRecord(r)
      if (!existsSync(r.part)) state.outputs.delete(part)
    }
  }
}
