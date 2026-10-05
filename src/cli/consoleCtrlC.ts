import { closeSync, openSync } from 'fs'
import { isatty, ReadStream } from 'tty'

/**
 * Ctrl+C for the installed command line.
 *
 * The shims run `Filesmith.exe` as Node (ELECTRON_RUN_AS_NODE). Filesmith.exe
 * is a GUI-subsystem program, so Windows gives it no console at start; Electron
 * attaches it to the terminal's console later with AttachConsole
 * (base::RouteStdioToConsole). libuv registers its console control handler
 * once, when it initialises, and in that process it is never called: a Ctrl+C
 * runs Windows' default handler, which ends the process at once with
 * 0xC000013A (no `canceled` events, no exit 130, ffmpeg killed mid-write).
 * process.on('SIGINT' | 'SIGBREAK') never fires, however late it is added.
 * The same loss reproduces in any GUI-subsystem process that registers a
 * handler BEFORE AttachConsole (one registered after it works), and no
 * JavaScript can register a handler again.
 *
 * What does work: switching the console input to raw mode. With processed
 * input off, Windows does not turn the Ctrl+C key into a signal at all; it
 * arrives as the byte 0x03 on the console input, which we read here and
 * treat as the interrupt. As a side effect cmd, which runs the .cmd shim, never
 * sees the Ctrl+C either, so its "Terminate batch job (Y/N)?" prompt is gone
 * and the exit code passes through unchanged. Ctrl+Break and programmatic
 * console events (GenerateConsoleCtrlEvent) are still signals and still end
 * the process at once; atomic outputs keep that from leaving a broken file
 * under the final name.
 *
 * The console is opened as `\\.\CONIN$` rather than through stdin, so it also
 * works when stdin is a pipe (`filesmith compress - < list.txt`).
 */
export interface ConsoleWatch {
  /** Back to normal (cooked) input, e.g. while reading file names typed at
   * the terminal; Ctrl+C is then the default signal again. */
  pause(): void
  resume(): void
  /** Restore the console mode and release it. Idempotent. */
  stop(): void
}

export function watchConsoleCtrlC(onInterrupt: () => void): ConsoleWatch | null {
  let fd: number
  try {
    fd = openSync('\\\\.\\CONIN$', 'r+')
  } catch {
    return null // no console at all (a service, a pipe-only parent): no keyboard to watch
  }
  if (!isatty(fd)) {
    closeSync(fd)
    return null
  }
  let stream: ReadStream
  try {
    stream = new ReadStream(fd)
    stream.setRawMode(true)
  } catch {
    try {
      closeSync(fd)
    } catch {
      /* already closed by the stream */
    }
    return null
  }
  let stopped = false
  stream.on('data', (chunk: Buffer | string) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    // Every 0x03 is one Ctrl+C (a second one exits at once); any other key
    // typed during the run is dropped, as before.
    for (const b of bytes) if (b === 3) onInterrupt()
  })
  stream.on('error', () => stop())
  function stop(): void {
    if (stopped) return
    stopped = true
    try {
      stream.setRawMode(false)
    } catch {
      /* console already gone */
    }
    stream.destroy()
  }
  return {
    pause() {
      if (stopped) return
      stream.pause()
      try {
        stream.setRawMode(false)
      } catch {
        /* best effort */
      }
    },
    resume() {
      if (stopped) return
      try {
        stream.setRawMode(true)
      } catch {
        /* best effort */
      }
      stream.resume()
    },
    stop
  }
}
