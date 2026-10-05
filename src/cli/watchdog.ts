import { spawnSync } from 'child_process'
import { createInterface } from 'readline'
import { cleanUp, WatchdogState } from './watchdogCore'

// Process entry of the CLI's watchdog (see watchdogCore.ts). Started detached
// by the CLI (src/cli/watchdogClient.ts) with no console, so console control
// events that end the CLI never reach it.

/** The image name `pid` runs now, or null when it is gone. */
function imageOf(pid: number): string | null {
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true
  })
  const m = /^"([^"]+)","(\d+)"/m.exec(r.stdout ?? '')
  return m && Number(m[2]) === pid ? m[1] : null
}

const state = new WatchdogState()
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => state.apply(line))
lines.on('close', () => {
  void cleanUp(state, {
    kill(pid, image) {
      // Only the program we were told about: a pid reused by anything else is
      // left alone.
      if (imageOf(pid)?.toLowerCase() !== image.toLowerCase()) return
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms))
  }).finally(() => process.exit(0))
})
