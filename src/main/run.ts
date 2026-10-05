import { spawn, spawnSync } from 'child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  signal?: AbortSignal
  /** Called with each stderr chunk — used to parse tool progress (ffmpeg etc.). */
  onStderr?: (chunk: string) => void
  cwd?: string
  /** Child environment (defaults to this process's). rembg needs U2NET_HOME. */
  env?: NodeJS.ProcessEnv
}

/**
 * The binary could not be found at all (the process never started). Distinct
 * from a non-zero exit, which means the tool ran and refused the work — a
 * missing tool is an install/packaging problem and needs a different message.
 * `tool` is the command we tried to spawn, so callers can name it.
 */
export class ToolMissingError extends Error {
  readonly tool: string
  constructor(tool: string, cause?: unknown) {
    super(`${tool} could not be started (not found)`, { cause })
    this.name = 'ToolMissingError'
    this.tool = tool
  }
}

/** Tool processes started by run() that have not exited yet: pid -> image
 * file name (`ffmpeg.exe`), so a later kill can check it is still that program. */
const liveChildren = new Map<number, string>()

/** Told about every tool process run() starts and sees end (the CLI forwards
 * them to its watchdog, which kills what a hard-killed CLI left running). */
export interface ChildObserver {
  started(pid: number, image: string): void
  ended(pid: number): void
}
let childObserver: ChildObserver | null = null
export function setChildObserver(o: ChildObserver | null): void {
  childObserver = o
  if (o) for (const [pid, image] of liveChildren) o.started(pid, image)
}

function imageOf(cmd: string): string {
  const name = cmd.split(/[\\/]/).pop() ?? cmd
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.exe`
}

/**
 * Kill every tool process run() started and is still running, whole trees,
 * synchronously. For a process about to exit at once (the CLI's second
 * Ctrl+C), so no ffmpeg keeps writing, or holding open, a file we remove.
 */
export function killAllToolsSync(): void {
  for (const pid of liveChildren.keys()) {
    try {
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      else process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
  liveChildren.clear()
}

/**
 * Spawn a CLI tool with an argument array (never a shell string, so paths with
 * spaces/`;`/`&` are safe and there is no injection surface). Resolves with the
 * exit code and captured output; rejects only if the process cannot be spawned
 * or is aborted. Callers decide what a non-zero code means.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      cwd: opts.cwd,
      env: opts.env
    })

    const pid = child.pid
    if (pid) {
      liveChildren.set(pid, imageOf(cmd))
      childObserver?.started(pid, imageOf(cmd))
    }
    const gone = (): void => {
      if (pid && liveChildren.delete(pid)) childObserver?.ended(pid)
    }

    // Abort kills the whole PROCESS TREE, not just the direct child. spawn's
    // own `signal` option maps to TerminateProcess on win32, which leaves
    // grandchildren running: `uv tool run`'s python and soffice's workers
    // survived cancel/quit, kept GPU memory, and later wrote an output path
    // the app had already released.
    let aborted = false
    const onAbort = (): void => {
      aborted = true
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true
        })
        killer.on('error', () => child.kill())
      } else {
        child.kill('SIGKILL')
      }
    }
    if (opts.signal?.aborted) queueMicrotask(onAbort)
    else opts.signal?.addEventListener('abort', onAbort, { once: true })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString()
      stderr += s
      opts.onStderr?.(s)
    })
    child.on('error', (e) => {
      gone()
      opts.signal?.removeEventListener('abort', onAbort)
      // ENOENT/EACCES here mean the image itself is missing or unrunnable, not
      // that the conversion failed.
      const code = (e as NodeJS.ErrnoException).code
      reject(code === 'ENOENT' || code === 'EACCES' ? new ToolMissingError(cmd, e) : e)
    })
    child.on('close', (code) => {
      gone()
      opts.signal?.removeEventListener('abort', onAbort)
      if (aborted) {
        // Match the AbortError shape spawn's `signal` option used to produce,
        // so callers checking ctx.signal.aborted keep working unchanged.
        const e = new Error('The operation was aborted')
        e.name = 'AbortError'
        reject(e)
        return
      }
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
