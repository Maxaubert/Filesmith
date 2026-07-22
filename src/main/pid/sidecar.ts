import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import {
  pidCheckpointsDir,
  pidKernelCache,
  pidRepoDir,
  pidServerScript,
  pidVenvPython
} from './paths'

// A single long-lived PiD process, kept warm across images.
//
// PiD's per-image cost is dominated by loading the 2.6GB model and compiling
// Blackwell kernels the first time. Spawning per image (like the other tools)
// would pay that every time, which is the minutes-vs-seconds difference. So the
// sidecar loads once, prints {"ready":true}, then answers newline-delimited JSON
// requests over stdin/stdout. The first request after a cold start still pays
// the kernel compile (cached to disk for next session); every one after is warm.
//
// Requests carry an integer id and replies echo it, so a reply is matched to its
// caller by id (not stdout order) — a stray line can't desync the stream, and a
// cancelled request whose late reply still arrives is simply dropped.

interface Pending {
  resolve: (out: { output: string; ms: number }) => void
  reject: (e: Error) => void
}

export interface PidProgress {
  (phase: 'starting' | 'loading' | 'ready' | 'running', detail?: string): void
}

/**
 * Classify one stdout line from the PiD process. The protocol is newline-JSON:
 * a `{"ready":true}` handshake, then one reply per request
 * (`{"id":N,"ok":true,"output":...}` or `{"id":N,"ok":false,"error":...}`).
 * Anything that isn't a well-formed protocol object (diagnostics, torch banners,
 * or an "ok" reply with no output path) is ignored/reported. Pure, so the
 * protocol is testable without spawning.
 */
export type SidecarLine =
  | { kind: 'ignore' }
  | { kind: 'ready' }
  | { kind: 'ok'; id: number | null; output: string; ms: number }
  | { kind: 'error'; id: number | null; error: string }

export function classifySidecarLine(line: string): SidecarLine {
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
  if (msg.ok === true) {
    // A success reply with no output path is malformed: report it as an error so
    // the caller rejects, rather than coercing output to the string "undefined".
    if (typeof msg.output !== 'string' || msg.output.length === 0)
      return { kind: 'error', id, error: 'PiD returned no output path' }
    return { kind: 'ok', id, output: msg.output, ms: Number(msg.ms) || 0 }
  }
  if (msg.ok === false) return { kind: 'error', id, error: String(msg.error ?? 'PiD failed') }
  return { kind: 'ignore' }
}

class PidSidecar {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private reqId = 0
  private warmedUp = false
  private backbone = 'flux'

  /** Start the process (idempotent) and resolve once the model reports ready. */
  private ensure(onProgress?: PidProgress): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      onProgress?.('starting')
      const proc = spawn(
        pidVenvPython(),
        [pidServerScript(), '--backbone', this.backbone, '--output_dir', pidCheckpointsDir()],
        {
          // CWD is the repo dir: PiD resolves BOTH its config source
          // (pid/_src/configs/…) and its weights (./checkpoints/…) relative to
          // CWD, so a single dir has to hold both. The weights are installed
          // inside the repo for exactly this reason (see paths.ts).
          cwd: pidRepoDir(),
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONPATH: pidRepoDir(),
            FILESMITH_PID_CACHE: pidKernelCache(),
            // Decode stdin (filesystem paths) as UTF-8 regardless of the machine's
            // locale codepage — non-ASCII usernames otherwise corrupt paths.
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8'
          }
        }
      )
      this.proc = proc

      // stdin EPIPE on a dying process would otherwise throw an unhandled stream
      // error and crash the main process; the 'close' handler does the rejecting.
      proc.stdin.on('error', () => {})

      // stdout is the JSON protocol: one {"ready"} line, then one reply per request.
      const rl = createInterface({ input: proc.stdout })
      rl.on('line', (line) => {
        const ev = classifySidecarLine(line)
        if (ev.kind === 'ignore') return
        if (ev.kind === 'ready') {
          onProgress?.('ready')
          resolve()
          return
        }
        // Reply: match to its caller by id. A missing/unknown id (stray line, or
        // a late reply for an already-cancelled request) is dropped harmlessly.
        if (ev.id == null) return
        const p = this.pending.get(ev.id)
        if (!p) return
        if (ev.kind === 'ok') p.resolve({ output: ev.output, ms: ev.ms })
        else p.reject(new Error(ev.error))
      })

      // stderr carries load/compile progress; surface it as loading detail, and
      // keep a tail so a crash (bad driver, import error) yields an actionable
      // message instead of a bare exit code.
      let stderrTail = ''
      proc.stderr.on('data', (d: Buffer) => {
        const t = d.toString()
        if (/loading model/i.test(t)) onProgress?.('loading')
        stderrTail = (stderrTail + t).slice(-800)
      })

      proc.on('error', (e) => {
        this.reset(e)
        reject(e)
      })
      proc.on('close', (code) => {
        const tail = stderrTail.trim().split('\n').filter(Boolean).pop()
        const err = new Error(tail ? `PiD failed: ${tail}` : `PiD process exited (${code})`)
        this.reset(err)
        // If it died before ready, surface it.
        reject(err)
      })
    })
    return this.ready
  }

  private reset(err: Error): void {
    this.proc = null
    this.ready = null
    this.warmedUp = false
    const ps = [...this.pending.values()]
    this.pending.clear()
    for (const p of ps) p.reject(err)
  }

  /** Upscale one image, starting/keeping the warm process as needed. Honours an
   * optional AbortSignal: cancelling rejects the in-flight request (the model
   * stays loaded for the next image; the cancelled image's late reply is dropped
   * by id). */
  async upscale(
    input: string,
    output: string,
    scale: number,
    onProgress?: PidProgress,
    signal?: AbortSignal
  ): Promise<{ output: string; ms: number }> {
    if (signal?.aborted) throw new Error('Upscale cancelled')
    await this.ensure(onProgress)
    const proc = this.proc
    if (!proc) throw new Error('PiD process is not running')
    // The first generate of a session also pays the one-time kernel compile.
    onProgress?.('running', this.warmedUp ? undefined : 'cold')
    const id = (this.reqId += 1)

    return new Promise<{ output: string; ms: number }>((resolve, reject) => {
      let settled = false
      const onAbort = (): void => finish(() => reject(new Error('Upscale cancelled')))
      const finish = (act: () => void): void => {
        if (settled) return
        settled = true
        this.pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        this.warmedUp = true
        act()
      }
      this.pending.set(id, {
        resolve: (out) => finish(() => resolve(out)),
        reject: (e) => finish(() => reject(e))
      })
      signal?.addEventListener('abort', onAbort)
      try {
        proc.stdin.write(JSON.stringify({ id, input, output, scale, prompt: 'a photo' }) + '\n')
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))))
      }
    })
  }

  /** Stop the warm process (frees ~10GB VRAM). Called when the app quits or the
   * user leaves the Upscale tool for a long time. */
  stop(): void {
    this.proc?.kill()
    this.reset(new Error('stopped'))
  }

  running(): boolean {
    return this.proc != null
  }
}

// One shared warm instance for the app.
export const pidSidecar = new PidSidecar()
