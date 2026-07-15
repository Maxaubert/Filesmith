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
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}
