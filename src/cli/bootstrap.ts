import { homedir } from 'os'
import { join } from 'path'
import { setEngineEnv } from '../main/env'
import { bootEngine } from '../main/boot'
import { pidSidecar } from '../main/pid/sidecar'
import { spandrelSidecar } from '../main/comfy/sidecar'
import { stopComfyServer } from '../main/generate'
import { killAllToolsSync } from '../main/run'
import { discardAllOutputs } from '../main/atomicOutput'
import { watchConsoleCtrlC, type ConsoleWatch } from './consoleCtrlC'
import { armWatchdog } from './watchdogClient'
import { cliEngineEnv } from './env'
import type { Out } from './events'
import { defaultDeps } from './deps'
import { CliError } from './exit'
import { main } from './main'
import { sanitizeText } from './sanitize'

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
  if (interrupts > 1) {
    // A second Ctrl+C leaves at once. Kill the tools first so the exit hook
    // can remove this run's part files and placeholders (atomicOutput).
    killAllToolsSync()
    discardAllOutputs()
    keyboard?.stop()
    process.exit(130)
  }
  ctrl.abort()
}
process.on('SIGINT', interrupt)
process.on('SIGBREAK', interrupt)
// The in-app console (spec 9.2, 9.3) forks this file with an IPC channel and
// no console window: Stop arrives as an 'interrupt' message, and a vanished
// app (closed channel) cancels the run like Ctrl+C.
let finished = false
const ipc = typeof process.send === 'function'
if (ipc) {
  process.on('message', (m) => {
    if (m === 'interrupt') interrupt()
  })
  process.on('disconnect', () => {
    if (!finished) interrupt()
  })
}
// Events go out one IPC message per NDJSON line. Sends are asynchronous, so
// the channel is closed only once every send has been flushed: closing it
// earlier can drop the last `done` / `summary` events.
let pendingSends = 0
let afterSends: (() => void) | null = null
const events: Out | undefined = ipc
  ? {
      write: (s) => {
        if (!process.connected || !process.send) return
        pendingSends += 1
        process.send(s, undefined, {}, () => {
          pendingSends -= 1
          if (pendingSends === 0) afterSends?.()
        })
      }
    }
  : undefined
function closeChannel(): void {
  finished = true
  const close = (): void => {
    if (process.connected) process.disconnect?.()
  }
  if (pendingSends === 0) close()
  else afterSends = close
}
// Under Electron's Node mode (the installed shims) the handlers above never
// run on Windows; read Ctrl+C from the console in raw mode instead. Plain Node
// (npm run cli, the tests) keeps the signal path. See consoleCtrlC.ts.
// A forked console child (IPC channel) never touches a console: Ctrl+C
// arrives as the 'interrupt' message, and if the app itself was started from
// a terminal, opening CONIN$ in raw mode would steal that terminal's keyboard.
const keyboard: ConsoleWatch | null =
  process.platform === 'win32' && process.versions.electron && !ipc
    ? watchConsoleCtrlC(interrupt)
    : null
process.on('exit', () => keyboard?.stop())
// What Ctrl+C cannot cover there (Ctrl+Break, closing the window, a hard
// kill) ends the process at once; a detached watchdog then kills the tools
// it left and removes its unfinished outputs. See watchdogCore.ts.
const watchdog =
  process.platform === 'win32' &&
  (process.versions.electron || process.env.FILESMITH_WATCHDOG === '1')
    ? armWatchdog({
        execPath: process.execPath,
        script: join(__dirname, 'cliWatchdog.js'),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      })
    : null

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
  // Names typed at the terminal need normal line input (echo, Enter, Ctrl+Z),
  // so the raw-mode Ctrl+C watch steps aside while they are read.
  const typed = process.stdin.isTTY === true
  if (typed) keyboard?.pause()
  return new Promise<string>((resolve, reject) => {
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
  }).finally(() => {
    if (typed) keyboard?.resume()
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
    signal: ctrl.signal,
    events
  },
  defaultDeps()
)
  .then((code) => {
    process.exitCode = stdoutClosed ? 130 : code
  })
  .catch((e: unknown) => {
    process.stderr.write(
      `${sanitizeText(e instanceof Error ? (e.stack ?? e.message) : String(e))}\n`
    )
    process.exitCode = 1
  })
  .finally(() => {
    closeChannel()
    keyboard?.stop()
    watchdog?.close()
    stopEverything()
    // Leave even if a stray handle (a child's pipe) would keep Node alive.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1500).unref()
  })
