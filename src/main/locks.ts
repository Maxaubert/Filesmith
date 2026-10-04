import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'fs'
import { dirname } from 'path'
import { engineEnv, userDataPath } from './env'

/**
 * Cross-process lock files (spec M7). The app and the CLI can now install the
 * same engine at the same moment; the old guards (withInstallLock, the IPC
 * companion map) only covered one process, and two installers share .part
 * files and rmSync the same repo dir. A lock is a file created with 'wx'
 * holding the owner's pid; a dead owner or a six-hour-old lock is stale.
 */
export interface LockInfo {
  pid: number
  host: 'app' | 'cli'
  since: number
  what: string
}

const STALE_MS = 6 * 60 * 60 * 1000

export function lockPath(name: string): string {
  return userDataPath('locks', `${name}.lock`)
}

export function readLock(name: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(lockPath(name), 'utf-8')) as LockInfo
  } catch {
    return null
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function isStale(
  info: LockInfo | null,
  now = Date.now(),
  alive: (pid: number) => boolean = pidAlive
): boolean {
  if (!info || typeof info.pid !== 'number') return true
  return !alive(info.pid) || now - info.since > STALE_MS
}

/** Take the lock, or null when a live owner holds it. Returns the release. */
export function tryAcquire(name: string, what: string, now = Date.now()): (() => void) | null {
  const p = lockPath(name)
  mkdirSync(dirname(p), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(p, 'wx')
      const info: LockInfo = { pid: process.pid, host: engineEnv().host, since: now, what }
      writeSync(fd, JSON.stringify(info))
      closeSync(fd)
      return () => {
        try {
          if (readLock(name)?.pid === process.pid) rmSync(p, { force: true })
        } catch {
          /* best effort */
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      if (!isStale(readLock(name), now)) return null
      rmSync(p, { force: true })
    }
  }
  return null
}

/** Run `fn` holding the lock, waiting (default up to 10 minutes) for a live
 * holder to finish. `onWait` is called on every poll so callers can report
 * "waiting for the app" and a heartbeat. */
export async function withFileLock<T>(
  name: string,
  what: string,
  fn: () => Promise<T>,
  opts: {
    waitMs?: number
    pollMs?: number
    onWait?: (holder: LockInfo | null) => void
    signal?: AbortSignal
  } = {}
): Promise<T> {
  const waitMs = opts.waitMs ?? 10 * 60_000
  const pollMs = opts.pollMs ?? 1000
  const start = Date.now()
  let release = tryAcquire(name, what)
  while (!release) {
    opts.signal?.throwIfAborted()
    if (Date.now() - start > waitMs) {
      const h = readLock(name)
      throw new Error(
        `Another Filesmith ${h?.host ?? 'process'} (pid ${h?.pid ?? '?'}) is still installing ${what}. Try again when it finishes.`
      )
    }
    opts.onWait?.(readLock(name))
    await new Promise((r) => setTimeout(r, pollMs))
    release = tryAcquire(name, what)
  }
  try {
    return await fn()
  } finally {
    release()
  }
}
