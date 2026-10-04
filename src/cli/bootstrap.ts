import { homedir } from 'os'
import { setEngineEnv } from '../main/env'
import { bootEngine } from '../main/boot'
import { pidSidecar } from '../main/pid/sidecar'
import { spandrelSidecar } from '../main/comfy/sidecar'
import { stopComfyServer } from '../main/generate'
import { cliEngineEnv } from './env'
import type { Out } from './events'
import { defaultDeps } from './deps'
import { CliError } from './exit'
import { main } from './main'

// The process entry (spec 4.1): the only file that touches `process`. Runs as
// plain Node under ELECTRON_RUN_AS_NODE, so src/main/index.ts (and with it the
// single-instance lock) never loads.
setEngineEnv(
  cliEngineEnv(
    {
      execPath: process.execPath,
      resourcesPath: process.resourcesPath,
      env: process.env,
      homedir: homedir(),
      moduleDir: __dirname
    },
    (url, init) => fetch(url, init)
  )
)
bootEngine()
// The shims set ELECTRON_RUN_AS_NODE for this process only. Children (ffmpeg,
// uv, python, ComfyUI, soffice) inherit process.env through run(), and an
// Electron-based program started from here must not silently run as Node.
delete process.env.ELECTRON_RUN_AS_NODE

const ctrl = new AbortController()
let interrupts = 0
const interrupt = (): void => {
  interrupts += 1
  if (interrupts > 1) process.exit(130) // a second Ctrl+C leaves at once
  ctrl.abort()
}
process.on('SIGINT', interrupt)
process.on('SIGBREAK', interrupt)

// `filesmith ... --json | head -1`: the reader went away. Treat it as Ctrl+C:
// cancel the jobs, stop writing, exit 130, no stack trace.
let stdoutClosed = false
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EPIPE') throw e
  stdoutClosed = true
  ctrl.abort()
})
const stdout: Out = { write: (s) => void (stdoutClosed || process.stdout.write(s)) }
const stderr: Out = { write: (s) => void process.stderr.write(s) }

// Ctrl+C while `filesmith <verb> -` still waits on an interactive stdin
// cancels at once instead of needing a second Ctrl+C.
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const canceled = (): void => {
      process.stdin.pause()
      reject(new CliError('CANCELED', 'Canceled while reading file names from stdin.'))
    }
    if (ctrl.signal.aborted) return canceled()
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (d) => (text += d))
    process.stdin.on('end', () => {
      ctrl.signal.removeEventListener('abort', canceled)
      resolve(text)
    })
    process.stdin.on('error', reject)
    ctrl.signal.addEventListener('abort', canceled, { once: true })
  })
}

function stopEverything(): void {
  for (const stop of [
    () => pidSidecar.stop(),
    () => spandrelSidecar.stop(),
    () => stopComfyServer()
  ])
    try {
      stop()
    } catch {
      /* best effort */
    }
}

main(
  {
    argv: process.argv.slice(2),
    stdout,
    stderr,
    stdoutTTY: process.stdout.isTTY === true,
    stderrTTY: process.stderr.isTTY === true,
    env: process.env,
    cwd: process.cwd(),
    readStdin,
    signal: ctrl.signal
  },
  defaultDeps()
)
  .then((code) => {
    process.exitCode = stdoutClosed ? 130 : code
  })
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    stopEverything()
    // Leave even if a stray handle (a child's pipe) would keep Node alive.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1500).unref()
  })
