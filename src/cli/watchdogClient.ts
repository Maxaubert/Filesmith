import { spawn } from 'child_process'
import type { Socket } from 'net'
import { setOutputObserver, type OutputRecord } from '../main/atomicOutput'
import { setChildObserver } from '../main/run'
import type { WatchdogMessage } from './watchdogCore'

export interface WatchdogLaunch {
  execPath: string
  script: string
  env: NodeJS.ProcessEnv
}

/**
 * Arm the watchdog: it is started (detached, no console) at the first output
 * this run reserves, and from then on hears of every reservation, commit,
 * discard and tool process. A run that writes nothing never starts it.
 * Returns `close`, which tells the watchdog the run ended normally.
 */
export function armWatchdog(launch: WatchdogLaunch): { close(): void } {
  let pipe: Socket | null = null
  let failed = false
  const send = (m: WatchdogMessage): void => {
    if (pipe && !failed) pipe.write(JSON.stringify(m) + '\n')
  }
  const start = (): void => {
    if (pipe || failed) return
    try {
      const child = spawn(launch.execPath, [launch.script], {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
        env: launch.env
      })
      child.on('error', () => (failed = true))
      pipe = child.stdin as Socket
      pipe.on('error', () => (failed = true))
      // Never keep the CLI alive for the watchdog's sake.
      child.unref()
      pipe.unref()
      setChildObserver({
        started: (pid, image) => send({ t: 'pid', pid, image }),
        ended: (pid) => send({ t: 'ended', pid })
      })
    } catch {
      failed = true // best effort: without it the run behaves exactly as before
    }
  }
  setOutputObserver({
    reserved: (r: OutputRecord) => {
      start()
      send({ t: 'out', r })
    },
    settled: (part) => send({ t: 'settled', part })
  })
  return {
    close() {
      setOutputObserver(null)
      setChildObserver(null)
      if (!pipe || failed) return
      send({ t: 'bye' })
      // Hold the process open until `bye` is flushed (bounded by the CLI's
      // forced exit), so the watchdog never mistakes a clean end for a crash.
      pipe.ref()
      pipe.end()
    }
  }
}
