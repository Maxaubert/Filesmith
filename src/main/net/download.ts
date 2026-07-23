import { createWriteStream, mkdirSync, renameSync, rmSync } from 'fs'
import { dirname } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'

// Atomic HTTP download: stream to `<dest>.part`, verify the transfer completed
// against Content-Length, then rename into place. A truncated/failed transfer
// leaves no file at `dest`, so existence checks never mistake a partial download
// for a finished one. An idle watchdog aborts a stalled socket. (This mirrors the
// PiD installer's downloader; kept standalone so generation doesn't depend on the
// PiD module.)

const STALL_MS = 60_000

export async function downloadFile(
  url: string,
  dest: string,
  onPct?: (pct: number) => void,
  /** Reject a "complete" transfer smaller than this (guards against an LFS
   * pointer / error page whose tiny Content-Length matches its body). */
  minBytes?: number
): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true })
  const ac = new AbortController()
  let idle: ReturnType<typeof setTimeout> | null = null
  const arm = (): void => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => ac.abort(new Error(`Download stalled: ${url}`)), STALL_MS)
    idle.unref?.()
  }
  arm()
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow' })
    // Gated / license-required repos answer 401/403 — say so actionably.
    if (res.status === 401 || res.status === 403)
      throw new Error(
        `This file requires accepting a license or signing in on Hugging Face. Open the model page and accept access, then retry: ${url}`
      )
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
    // A large model file is never HTML/JSON — that means an error page served as 200.
    const ctype = (res.headers.get('content-type') || '').toLowerCase()
    if (/text\/html|application\/json/.test(ctype))
      throw new Error(`Download did not return a file (got ${ctype || 'an error page'}): ${url}`)
    const total = Number(res.headers.get('content-length')) || 0
    if (minBytes && total && total < minBytes)
      throw new Error(`Download looks wrong: server reports ${total} bytes, expected at least ${minBytes}. ${url}`)
    const part = `${dest}.part`
    rmSync(part, { force: true })

    let got = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        got += chunk.length
        arm()
        if (total && onPct) onPct(Math.min(99, Math.round((got / total) * 100)))
        cb(null, chunk)
      }
    })
    try {
      await pipeline(
        Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
        counter,
        createWriteStream(part),
        { signal: ac.signal }
      )
    } catch (e) {
      rmSync(part, { force: true })
      throw e
    }
    if (total && got < total) {
      rmSync(part, { force: true })
      throw new Error(`Download incomplete: got ${got} of ${total} bytes from ${url}`)
    }
    // Final size sanity check even when Content-Length was absent.
    if (minBytes && got < minBytes) {
      rmSync(part, { force: true })
      throw new Error(`Download looks wrong: got only ${got} bytes, expected at least ${minBytes}. ${url}`)
    }
    rmSync(dest, { force: true })
    renameSync(part, dest)
    onPct?.(100)
  } finally {
    if (idle) clearTimeout(idle)
  }
}
