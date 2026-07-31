import { createHash } from 'crypto'
import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { dirname } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { net } from 'electron'

// Atomic HTTP download: stream to `<dest>.part`, verify the transfer completed
// against Content-Length and (when declared) its sha256, then rename into place.
// A truncated/failed transfer leaves no file at `dest`, so existence checks never
// mistake a partial download for a finished one. An idle watchdog aborts a
// stalled socket.

const STALL_MS = 60_000

/**
 * Electron's `net.fetch` when we're in the app, Node's global `fetch` otherwise
 * (tests). This matters for real users, not tidiness: the Node global is undici,
 * which ignores the system proxy and validates TLS against Node's own bundled CA
 * list rather than the Windows certificate store. On a corporate machine behind a
 * TLS-inspecting gateway the install could never succeed — while the `uv pip
 * install` phases, being subprocesses, honoured the proxy and worked. `net.fetch`
 * uses Chromium's stack: system proxy, Windows trust store.
 */
function httpFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    if (net?.fetch) return net.fetch(url, init)
  } catch {
    /* not in an Electron runtime */
  }
  return fetch(url, init)
}

/**
 * Turn a transport failure into something a person can act on. undici's rejection
 * message is literally "fetch failed" with the real code buried in `.cause`, so
 * every user whose wifi was off saw only "fetch failed".
 */
function describeNetworkError(e: unknown, url: string): Error {
  const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code
  let host = url
  try {
    host = new URL(url).host
  } catch {
    /* keep the raw url */
  }
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'ETIMEDOUT':
      return new Error(
        `Could not reach ${host}. Check your internet connection (or your proxy settings) and try again.`
      )
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return new Error(
        `Your network inspects HTTPS traffic, so the download could not be verified. Ask IT to allow ${host}.`
      )
    default:
      return e instanceof Error ? e : new Error(String(e))
  }
}

export interface DownloadOptions {
  onPct?: (pct: number) => void
  /** Reject a "complete" transfer smaller than this (guards against an LFS
   * pointer / error page whose tiny Content-Length matches its body). */
  minBytes?: number
  /** Expected sha256, verified WHILE STREAMING. A mismatch discards the .part. */
  sha256?: string
  signal?: AbortSignal
}

/** What a completed download turned out to be. */
export interface DownloadResult {
  bytes: number
  /** The sha256 actually computed. Recorded as the integrity anchor for future
   * re-downloads even when nothing was declared up front. */
  sha256: string
  /** The URL that succeeded (the first mirror that worked). */
  url: string
}

/**
 * Download `url` to `dest`. Accepts a single URL or a list of mirrors tried in
 * order — pin a commit sha first and a moving branch last, so a repo reorg
 * degrades to the fallback instead of 404ing the model out of existence.
 */
export async function downloadFile(
  url: string | string[],
  dest: string,
  onPctOrOpts?: ((pct: number) => void) | DownloadOptions,
  minBytesLegacy?: number
): Promise<DownloadResult> {
  const opts: DownloadOptions =
    typeof onPctOrOpts === 'function'
      ? { onPct: onPctOrOpts, minBytes: minBytesLegacy }
      : { ...onPctOrOpts, minBytes: onPctOrOpts?.minBytes ?? minBytesLegacy }

  const urls = (Array.isArray(url) ? url : [url]).filter(Boolean)
  if (!urls.length) throw new Error('No download URL was given.')
  let lastErr: unknown
  for (const u of urls) {
    try {
      return await downloadOne(u, dest, opts)
    } catch (e) {
      lastErr = e
      // A license wall is not a broken mirror — retrying every mirror would just
      // repeat the same wall with a less useful message each time.
      if (e instanceof Error && /requires accepting a license/.test(e.message)) throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function downloadOne(
  url: string,
  dest: string,
  opts: DownloadOptions
): Promise<DownloadResult> {
  mkdirSync(dirname(dest), { recursive: true })
  const ac = new AbortController()
  const onOuterAbort = (): void => ac.abort(new Error('Download cancelled'))
  opts.signal?.addEventListener('abort', onOuterAbort)
  let idle: ReturnType<typeof setTimeout> | null = null
  const arm = (): void => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => ac.abort(new Error(`Download stalled: ${url}`)), STALL_MS)
    idle.unref?.()
  }
  arm()
  const part = `${dest}.part`
  // Resume where we left off. Neither downloader sent a Range header or reused
  // an existing part file — both opened with rmSync — so a 2.6 GB checkpoint
  // that dropped at 95% restarted from zero, every time. Only attempted when no
  // hash is expected for the whole file, since a partial body can't be verified
  // against one without re-reading what is already on disk.
  let resumeAt = 0
  if (!opts.sha256) {
    try {
      const st = statSync(part)
      if (st.isFile() && st.size > 0) resumeAt = st.size
    } catch {
      /* no part file — a fresh start */
    }
  }
  try {
    let res: Response
    try {
      res = await httpFetch(url, {
        signal: ac.signal,
        redirect: 'follow',
        ...(resumeAt ? { headers: { Range: `bytes=${resumeAt}-` } } : {})
      })
    } catch (e) {
      throw describeNetworkError(e, url)
    }
    // 206 means the server honoured the range; anything else means start over.
    const resuming = resumeAt > 0 && res.status === 206
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
    const body = Number(res.headers.get('content-length')) || 0
    const total = resuming ? body + resumeAt : body
    if (opts.minBytes && total && total < opts.minBytes)
      throw new Error(
        `Download looks wrong: server reports ${total} bytes, expected at least ${opts.minBytes}. ${url}`
      )
    if (!resuming) {
      rmSync(part, { force: true })
      resumeAt = 0
    }

    let got = resumeAt
    // Hash WHILE streaming — a second pass over a 2.6 GB file just to verify it
    // would double the I/O of every install.
    const hash = createHash('sha256')
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        got += chunk.length
        hash.update(chunk)
        arm()
        if (total && opts.onPct) opts.onPct(Math.min(99, Math.round((got / total) * 100)))
        cb(null, chunk)
      }
    })
    try {
      await pipeline(
        Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
        counter,
        createWriteStream(part, resuming ? { flags: 'a' } : undefined),
        { signal: ac.signal }
      )
    } catch (e) {
      rmSync(part, { force: true })
      throw describeNetworkError(e, url)
    }
    // A resumed transfer only hashed the tail, so the digest is meaningless —
    // report it as empty rather than as a wrong-but-confident value.
    const digest = resuming ? '' : hash.digest('hex')
    const fail = (msg: string): never => {
      rmSync(part, { force: true })
      throw new Error(msg)
    }
    if (total && got < total)
      fail(`Download incomplete: got ${got} of ${total} bytes from ${url}`)
    // Final size sanity check even when Content-Length was absent.
    if (opts.minBytes && got < opts.minBytes)
      fail(`Download looks wrong: got only ${got} bytes, expected at least ${opts.minBytes}. ${url}`)
    if (opts.sha256 && digest && digest.toLowerCase() !== opts.sha256.toLowerCase())
      fail(
        `This download does not match its expected checksum and was discarded. Expected ${opts.sha256.slice(0, 16)}…, got ${digest.slice(0, 16)}… (${url})`
      )

    rmSync(dest, { force: true })
    renameSync(part, dest)
    opts.onPct?.(100)
    return { bytes: got, sha256: digest, url }
  } finally {
    if (idle) clearTimeout(idle)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}
