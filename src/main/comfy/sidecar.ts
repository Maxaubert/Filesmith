import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { pidKernelCache, pidVenvPython, spandrelServerScript } from '../pid/paths'

// Resident spandrel upscale sidecar — loads a ComfyUI upscale model once and runs
// tiled upscales, kept warm across images. Runs in the shared PiD torch venv (see
// paths.ts). Protocol is newline-JSON, id-framed like the PiD sidecar, with an
// extra per-tile {"id","progress"} line so the bar is MEASURED, not estimated.

interface Pending {
  resolve: (out: { output: string; ms: number }) => void
  reject: (e: Error) => void
  onProgress?: (pct: number) => void
}

export type SpandrelLine =
  | { kind: 'ignore' }
  | { kind: 'ready' }
  | { kind: 'progress'; id: number | null; pct: number }
  | { kind: 'ok'; id: number | null; output: string; ms: number }
  | { kind: 'error'; id: number | null; error: string }

export function classifySpandrelLine(line: string): SpandrelLine {
  const s = line.trim()
  if (!s.startsWith('{')) return { kind: 'ignore' }
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(s)
  } catch {
    return { kind: 'ignore' }
  }
  if (msg.ready === true) return { kind: 'ready' }
  const id = typeof msg.id === 'number' ? msg.id : null
  if (typeof msg.progress === 'number')
    return { kind: 'progress', id, pct: Math.max(0, Math.min(99, msg.progress * 100)) }
  if (msg.ok === true) {
    if (typeof msg.output !== 'string' || msg.output.length === 0)
      return { kind: 'error', id, error: 'upscaler returned no output path' }
    return { kind: 'ok', id, output: msg.output, ms: Number(msg.ms) || 0 }
  }
  if (msg.ok === false) return { kind: 'error', id, error: String(msg.error ?? 'upscale failed') }
  return { kind: 'ignore' }
}

class SpandrelSidecar {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private reqId = 0

  private ensure(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const proc = spawn(pidVenvPython(), [spandrelServerScript()], {
        windowsHide: true,
        env: {
          ...process.env,
          FILESMITH_PID_CACHE: pidKernelCache(),
          // UTF-8 stdin so non-ASCII model/image paths aren't corrupted.
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8'
        }
      })
      this.proc = proc
      proc.stdin.on('error', () => {})

      let stderrTail = ''
      proc.stderr.on('data', (d: Buffer) => {
        stderrTail = (stderrTail + d.toString()).slice(-800)
      })

      const rl = createInterface({ input: proc.stdout })
      rl.on('line', (line) => {
        const ev = classifySpandrelLine(line)
        if (ev.kind === 'ignore') return
        if (ev.kind === 'ready') return resolve()
        if (ev.id == null) return
        const p = this.pending.get(ev.id)
        if (!p) return
        if (ev.kind === 'progress') return p.onProgress?.(ev.pct)
        if (ev.kind === 'ok') p.resolve({ output: ev.output, ms: ev.ms })
        else p.reject(new Error(ev.error))
      })

      proc.on('error', (e) => {
        this.reset(e)
        reject(e)
      })
      proc.on('close', (code) => {
        const tail = stderrTail.trim().split('\n').filter(Boolean).pop()
        const err = new Error(tail ? `Upscaler failed: ${tail}` : `spandrel process exited (${code})`)
        this.reset(err)
        reject(err)
      })
    })
    return this.ready
  }

  private reset(err: Error): void {
    this.proc = null
    this.ready = null
    const ps = [...this.pending.values()]
    this.pending.clear()
    for (const p of ps) p.reject(err)
  }

  /** Upscale one image with a ComfyUI model. `scaleTo` is the desired final
   * factor (0 = the model's native scale). Progress is measured per tile. */
  async upscale(
    modelPath: string,
    input: string,
    output: string,
    scaleTo: number,
    opts: {
      tile?: number
      /** 0/1 = uncapped; 0<f<1 caps VRAM to that fraction (background mode). */
      memFraction?: number
      /** Sleep between tiles (ms) to keep the GPU responsive (background mode). */
      paceMs?: number
      onProgress?: (pct: number) => void
      signal?: AbortSignal
    } = {}
  ): Promise<{ output: string; ms: number }> {
    if (opts.signal?.aborted) throw new Error('Upscale cancelled')
    await this.ensure()
    const proc = this.proc
    if (!proc) throw new Error('spandrel process is not running')
    const id = (this.reqId += 1)
    const { signal } = opts

    return new Promise<{ output: string; ms: number }>((resolve, reject) => {
      let settled = false
      const onAbort = (): void => finish(() => reject(new Error('Upscale cancelled')))
      const finish = (act: () => void): void => {
        if (settled) return
        settled = true
        this.pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        act()
      }
      this.pending.set(id, {
        resolve: (out) => finish(() => resolve(out)),
        reject: (e) => finish(() => reject(e)),
        onProgress: opts.onProgress
      })
      signal?.addEventListener('abort', onAbort)
      try {
        proc.stdin.write(
          JSON.stringify({
            id,
            model_path: modelPath,
            input,
            output,
            scale_to: scaleTo,
            tile: opts.tile ?? 512,
            overlap: 32,
            mem_fraction: opts.memFraction ?? 0,
            pace_ms: opts.paceMs ?? 0
          }) + '\n'
        )
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))))
      }
    })
  }

  stop(): void {
    this.proc?.kill()
    this.reset(new Error('stopped'))
  }

  running(): boolean {
    return this.proc != null
  }
}

export const spandrelSidecar = new SpandrelSidecar()
