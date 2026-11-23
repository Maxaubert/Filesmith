import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A fake PiD process: stdout/stderr/stdin streams and a kill spy. Tests drive the
// protocol by writing lines to stdout and reading requests from stdin.
class FakeProc extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => {
    setImmediate(() => this.emit('close', null))
    return true
  })
  /** The JSON requests written to stdin so far. */
  requests(): Array<{ id: number }> {
    const raw = (this.stdin.read() as Buffer | null)?.toString() ?? ''
    this.seen.push(
      ...raw
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id: number })
    )
    return this.seen
  }
  private seen: Array<{ id: number }> = []
  send(line: string): void {
    this.stdout.write(line + '\n')
  }
}

const procs: FakeProc[] = []
const spawnMock = vi.fn(() => {
  const p = new FakeProc()
  procs.push(p)
  return p
})

vi.mock('child_process', () => ({ spawn: spawnMock }))
vi.mock('../src/main/pid/paths', () => ({
  pidCheckpointsDir: () => 'ckpt',
  pidKernelCache: () => 'cache',
  pidRepoDir: () => 'repo',
  pidServerScript: () => 'server.py',
  pidVenvPython: () => 'python'
}))

const { PidSidecar, PID_STARTUP_TIMEOUT_MS, PID_STARTUP_TIMEOUT_MESSAGE } =
  await import('../src/main/pid/sidecar')

/** Let readline and promise callbacks run. */
const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

beforeEach(() => {
  procs.length = 0
  spawnMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PidSidecar cancel and startup timeout', () => {
  it('normal path: ready, then a reply by id resolves', async () => {
    const s = new PidSidecar()
    const job = s.upscale('in.png', 'out.png', 2)
    await flush()
    procs[0].send('{"ready": true}')
    await flush()
    const [req] = procs[0].requests()
    procs[0].send(JSON.stringify({ id: req.id, ok: true, output: 'out.png', ms: 5 }))
    await expect(job).resolves.toEqual({ output: 'out.png', ms: 5 })
  })

  it('abort before ready rejects at once and does not kill the process', async () => {
    const s = new PidSidecar()
    const ac = new AbortController()
    const job = s.upscale('in.png', 'out.png', 2, undefined, ac.signal)
    await flush()
    ac.abort()
    await expect(job).rejects.toThrow('Upscale cancelled')
    expect(procs[0].kill).not.toHaveBeenCalled()
    expect(procs[0].requests()).toEqual([])
    expect(s.running()).toBe(true)

    // The load finishes later; the next upscale reuses the same warm process.
    procs[0].send('{"ready": true}')
    await flush()
    const next = s.upscale('b.png', 'b-out.png', 2)
    await flush()
    const reqs = procs[0].requests()
    expect(reqs).toHaveLength(1)
    procs[0].send(JSON.stringify({ id: reqs[0].id, ok: true, output: 'b-out.png', ms: 1 }))
    await expect(next).resolves.toEqual({ output: 'b-out.png', ms: 1 })
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('no ready line within the limit kills the process; the next call spawns again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = new PidSidecar()
    const job = s.upscale('in.png', 'out.png', 2)
    const settled = expect(job).rejects.toThrow(PID_STARTUP_TIMEOUT_MESSAGE)
    vi.advanceTimersByTime(PID_STARTUP_TIMEOUT_MS)
    await settled
    expect(procs[0].kill).toHaveBeenCalledTimes(1)
    expect(s.running()).toBe(false)
    // Let the killed process close; it must not disturb the next start.
    await flush()

    const next = s.upscale('in.png', 'out.png', 2)
    await flush()
    expect(spawnMock).toHaveBeenCalledTimes(2)
    procs[1].send('{"ready": true}')
    await flush()
    const [req] = procs[1].requests()
    procs[1].send(JSON.stringify({ id: req.id, ok: true, output: 'out.png', ms: 2 }))
    await expect(next).resolves.toEqual({ output: 'out.png', ms: 2 })
  })

  it('a start failure after the caller cancelled is not an unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const s = new PidSidecar()
      const ac = new AbortController()
      const job = s.upscale('in.png', 'out.png', 2, undefined, ac.signal)
      await flush()
      ac.abort()
      await expect(job).rejects.toThrow('Upscale cancelled')
      procs[0].emit('close', 1)
      await flush()
      await flush()
      expect(unhandled).not.toHaveBeenCalled()
      expect(s.running()).toBe(false)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
