import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { stripVTControlCharacters } from 'util'
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

/** How long the process may be SILENT before {"ready"} until it is treated as
 * hung. Any stdout or stderr output restarts the clock, so this is not a cap on
 * the whole load: the first one downloads the Gemma text encoder (about 5 GB).
 * huggingface_hub reports that download once per 10 MiB (see the spawn env), so
 * even a link well under 1 Mbit/s stays inside the limit. Torch imports and the
 * model load can print nothing for a while on a cold disk, hence minutes. */
export const PID_STARTUP_TIMEOUT_MS = 10 * 60 * 1000

export const PID_STARTUP_TIMEOUT_MESSAGE =
  'PiD did not start in time. Try again, or reinstall the upscaler from Settings.'

export class PidSidecar {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private reqId = 0
  private warmedUp = false
  private backbone = 'flux'
  /** The callers still waiting for the load; load progress goes to these only. */
  private loadListeners = new Set<PidProgress>()

  private notifyLoad(phase: 'loading' | 'ready'): void {
    for (const listener of this.loadListeners) listener(phase)
  }

  /** Start the process (idempotent) and resolve once the model reports ready.
   * onProgress only hears 'starting'; later phases go through loadListeners. */
  private ensure(onProgress?: PidProgress): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      // Settle once: ready, startup timeout, spawn error and close can race.
      let done = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const resolve = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolveReady()
      }
      const reject = (e: Error): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        rejectReady(e)
      }
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
            PYTHONIOENCODING: 'utf-8',
            // huggingface_hub hides its byte progress bars when stderr is a
            // pipe, which makes a multi-GB model download silent.
            // TQDM_POSITION=-1 is its switch to print them anyway; the second
            // variable stops an inherited setting from turning them off. The
            // startup limit relies on this output.
            TQDM_POSITION: '-1',
            HF_HUB_DISABLE_PROGRESS_BARS: '0'
          }
        }
      )
      this.proc = proc

      // A process that never prints {"ready"} would block every upscale forever.
      // Kill it and clear state now, so the next call spawns a fresh process.
      const restartTimer = (): void => {
        if (done) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (done) return
          const err = new Error(PID_STARTUP_TIMEOUT_MESSAGE)
          if (this.proc === proc) this.reset(err)
          proc.kill()
          reject(err)
        }, PID_STARTUP_TIMEOUT_MS)
      }
      restartTimer()
      // Raw chunks, not lines: a progress bar redraws without a newline.
      proc.stdout.on('data', restartTimer)
      proc.stderr.on('data', restartTimer)

      // stdin EPIPE on a dying process would otherwise throw an unhandled stream
      // error and crash the main process; the 'close' handler does the rejecting.
      proc.stdin.on('error', () => {})

      // stdout is the JSON protocol: one {"ready"} line, then one reply per request.
      const rl = createInterface({ input: proc.stdout })
      rl.on('line', (line) => {
        const ev = classifySidecarLine(line)
        if (ev.kind === 'ignore') return
        if (ev.kind === 'ready') {
          this.notifyLoad('ready')
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
        if (/loading model/i.test(t)) this.notifyLoad('loading')
        stderrTail = (stderrTail + t).slice(-800)
      })

      // Only reset when this is still the current process: a process killed by
      // the startup timeout may close after a fresh one has already spawned.
      proc.on('error', (e) => {
        if (this.proc === proc) this.reset(e)
        reject(e)
      })
      proc.on('close', (code) => {
        // Progress bars redraw with a carriage return and move the cursor with
        // ANSI codes; neither may end up as the error message.
        const tail = stripVTControlCharacters(stderrTail)
          .split(/[\r\n]+/)
          .map((l) => l.trim())
          .filter(Boolean)
          .pop()
        const err = new Error(tail ? `PiD failed: ${tail}` : `PiD process exited (${code})`)
        if (this.proc === proc) this.reset(err)
        // If it died before ready, surface it.
        reject(err)
      })
    })
    // A caller that was cancelled during the load no longer awaits this promise;
    // a later startup failure must not become an unhandled rejection.
    this.ready.catch(() => {})
    return this.ready
  }

  /** Wait for ensure(), but give up at once if the signal aborts. The load keeps
   * going in the background, so the model is warm for the next image. This
   * caller hears load progress only while it is still waiting: a cancelled job
   * must never report progress again. */
  private ensureOrAbort(onProgress?: PidProgress, signal?: AbortSignal): Promise<void> {
    // Wrapped per call, so each waiter is removed on its own.
    const listener: PidProgress | undefined =
      onProgress && ((phase, detail) => onProgress(phase, detail))
    if (listener) this.loadListeners.add(listener)
    const ready = this.ensure(onProgress)
    return new Promise<void>((resolve, reject) => {
      const stopWaiting = (): void => {
        if (listener) this.loadListeners.delete(listener)
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        stopWaiting()
        reject(new Error('Upscale cancelled'))
      }
      signal?.addEventListener('abort', onAbort)
      ready.then(
        () => {
          stopWaiting()
          resolve()
        },
        (e) => {
          stopWaiting()
          reject(e)
        }
      )
    })
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
    await this.ensureOrAbort(onProgress, signal)
    if (signal?.aborted) throw new Error('Upscale cancelled')
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
