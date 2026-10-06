import type { ChildProcess, ForkOptions } from 'child_process'
import type { ConsoleCliEvent } from '@shared/console'
import { LineSplitter } from './lines'

// One console command = one forked CLI process (spec 9.1). Stop is staged
// (spec 9.3): 'interrupt' (graceful, exit 130), 'interrupt' again (the CLI's
// hard path), then a tree kill if it is still alive after KILL_MS.

export type ConsoleEventBody =
  | { kind: 'out' | 'err'; text: string }
  | { kind: 'event'; ev: ConsoleCliEvent }
  | { kind: 'exit'; code: number }

// fork() passes windowsHide through to spawn at runtime, but @types/node's
// ForkOptions does not declare it.
export type CliForkOptions = ForkOptions & { windowsHide?: boolean }

export interface RunDeps {
  fork: (script: string, argv: string[], opts: CliForkOptions) => ChildProcess
  kill: (pid: number) => void
  later: (fn: () => void, ms: number) => () => void
}

export interface RunHandle {
  cancel(): void
  kill(): void
  done: Promise<number>
}

export const KILL_MS = 5000

export function startCliRun(
  o: { script: string; argv: string[]; cwd: string; emit: (e: ConsoleEventBody) => void },
  deps: RunDeps
): RunHandle {
  let stops = 0
  let ended = false
  let clearKill: (() => void) | null = null
  const child = deps.fork(o.script, o.argv, {
    cwd: o.cwd,
    execPath: process.execPath,
    execArgv: ['--use-system-ca'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_USE_ENV_PROXY: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  })
  const out = new LineSplitter((text) => o.emit({ kind: 'out', text }))
  const err = new LineSplitter((text) => o.emit({ kind: 'err', text }))
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (d: string) => out.push(d))
  child.stderr?.on('data', (d: string) => err.push(d))
  child.on('message', (m) => {
    if (typeof m !== 'string') return
    for (const line of m.split('\n')) {
      if (!line.trim()) continue
      try {
        o.emit({ kind: 'event', ev: JSON.parse(line) as ConsoleCliEvent })
      } catch {
        /* not an event line: ignore */
      }
    }
  })
  // taskkill /F ends the tree with exit code 1; a run the user stopped still
  // reports 130 (spec 9.3).
  let forced = false
  const kill = (): void => {
    if (ended || !child.pid) return
    forced = true
    deps.kill(child.pid)
  }
  const done = new Promise<number>((resolve) => {
    const finish = (code: number): void => {
      if (ended) return
      ended = true
      clearKill?.()
      out.flush()
      err.flush()
      o.emit({ kind: 'exit', code })
      resolve(code)
    }
    child.on('error', (e: Error) => {
      o.emit({ kind: 'err', text: `filesmith: could not start: ${e.message}` })
      finish(1)
    })
    child.on('close', (code: number | null) => finish(forced ? 130 : (code ?? (stops ? 130 : 1))))
  })
  return {
    done,
    kill,
    cancel: () => {
      if (ended) return
      stops += 1
      if (child.connected) child.send('interrupt')
      else kill()
      if (stops >= 2 && !clearKill) clearKill = deps.later(kill, KILL_MS)
    }
  }
}
