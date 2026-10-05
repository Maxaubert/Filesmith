import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { isStale, lockPath, readLock, tryAcquire, withFileLock } from '../src/main/locks'

const NAME = `test-${process.pid}`
afterEach(() => rmSync(lockPath(NAME), { force: true }))

describe('file locks', () => {
  it('acquires, blocks a second taker, and releases', () => {
    const release = tryAcquire(NAME, 'a test')
    expect(release).not.toBeNull()
    expect(readLock(NAME)).toMatchObject({ pid: process.pid, what: 'a test' })
    expect(tryAcquire(NAME, 'again')).toBeNull()
    release?.()
    expect(existsSync(lockPath(NAME))).toBe(false)
  })

  it('takes over a lock whose owner process is gone', () => {
    mkdirSync(dirname(lockPath(NAME)), { recursive: true })
    writeFileSync(
      lockPath(NAME),
      JSON.stringify({ pid: 999_999_999, host: 'app', since: Date.now(), what: 'x' })
    )
    const release = tryAcquire(NAME, 'mine')
    expect(release).not.toBeNull()
    expect(readLock(NAME)?.pid).toBe(process.pid)
    release?.()
  })

  it('treats a lock older than six hours as stale even if the pid lives', () => {
    const now = Date.now()
    const info = { pid: process.pid, host: 'cli' as const, since: now - 7 * 3600_000, what: 'x' }
    expect(isStale(info, now, () => true)).toBe(true)
    expect(isStale({ ...info, since: now }, now, () => true)).toBe(false)
    expect(isStale(null, now)).toBe(true)
  })

  it('withFileLock waits for the holder, then runs', async () => {
    const release = tryAcquire(NAME, 'holder')
    const waits: number[] = []
    setTimeout(() => release?.(), 50)
    const result = await withFileLock(NAME, 'waiter', async () => 'ran', {
      pollMs: 10,
      onWait: () => waits.push(1)
    })
    expect(result).toBe('ran')
    expect(waits.length).toBeGreaterThan(0)
    expect(existsSync(lockPath(NAME))).toBe(false)
  })

  it('withFileLock gives up after waitMs with a message naming the holder', async () => {
    const release = tryAcquire(NAME, 'holder')
    await expect(
      withFileLock(NAME, 'the engine', async () => 'never', { waitMs: 30, pollMs: 10 })
    ).rejects.toThrow(/still installing the engine/)
    release?.()
  })

  it('withFileLock stops waiting when aborted', async () => {
    const release = tryAcquire(NAME, 'holder')
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 20)
    await expect(
      withFileLock(NAME, 'x', async () => 'never', { pollMs: 5, signal: ctrl.signal })
    ).rejects.toThrow()
    release?.()
  })
})
