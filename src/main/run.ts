import { spawn } from 'child_process'

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
      signal: opts.signal
    })

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
      // ENOENT/EACCES here mean the image itself is missing or unrunnable, not
      // that the conversion failed. Aborts (AbortError) fall through unchanged.
      const code = (e as NodeJS.ErrnoException).code
      reject(code === 'ENOENT' || code === 'EACCES' ? new ToolMissingError(cmd, e) : e)
    })
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}
