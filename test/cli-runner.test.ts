import { describe, expect, it } from 'vitest'
import { classifyError, runPlanned, type QueueLike } from '../src/cli/runner'
import type { EventBody, Reporter } from '../src/cli/events'
import type { PlannedJob } from '../src/cli/plan'
import type { JobEvent, JobRequest } from '@shared/types'

function recorder(): Reporter & { events: EventBody[] } {
  const events: EventBody[] = []
  return { events, emit: (e) => events.push(e), text: () => {}, close: () => {} }
}

/** Models JobQueue faithfully where it matters: concurrency 1, and cancelAll
 * drops QUEUED jobs without any event (only the running one reports). */
function fakeQueue(script: (req: JobRequest, emit: (e: JobEvent) => void) => void) {
  let emit: (e: JobEvent) => void = () => {}
  const pending: JobRequest[] = []
  let running: JobRequest | null = null
  const next = (): void => {
    if (running || !pending.length) return
    running = pending.shift() as JobRequest
    emit({ id: running.id, status: 'running' })
    script(running, (e) => {
      emit(e)
      if (e.status !== 'running') {
        running = null
        next()
      }
    })
  }
  const factory = (e: (ev: JobEvent) => void): QueueLike => {
    emit = e
    return {
      add: (req) => {
        pending.push(req)
        emit({ id: req.id, status: 'queued' })
        next()
      },
      cancelAll: () => {
        pending.length = 0
        if (running) {
          const id = running.id
          running = null
          emit({ id, status: 'canceled' })
        }
      }
    }
  }
  return factory
}

const job = (id: string, over: Partial<PlannedJob> = {}): PlannedJob => ({
  id,
  input: `C:\\in\\${id}.png`,
  inSize: 100,
  tool: 'convert',
  op: 'convert',
  options: {},
  state: 'ready',
  ...over
})
const deps = (queue: ReturnType<typeof fakeQueue>) => ({
  queue,
  clock: () => 0,
  statOutput: () => ({ outSize: 40 })
})

describe('runPlanned', () => {
  it('maps JobEvents to start/progress/done/error and totals the bytes', async () => {
    const r = recorder()
    const q = fakeQueue((req, emit) => {
      emit({ id: req.id, status: 'running', percent: 50 })
      if (req.id === '2')
        emit({ id: req.id, status: 'failed', error: 'magick: improper image header' })
      else emit({ id: req.id, status: 'done', outputPath: 'C:\\in\\1.webp' })
    })
    const t = await runPlanned(
      [
        job('1'),
        job('2'),
        job('3', { state: 'skip', code: 'SAME_FORMAT', message: 'already webp' })
      ],
      r,
      deps(q),
      new AbortController().signal
    )
    expect(t).toMatchObject({
      ok: 1,
      failed: 1,
      skipped: 1,
      canceled: 0,
      inBytes: 100,
      outBytes: 40
    })
    expect(r.events.map((e) => e.event)).toEqual([
      'skipped',
      'start',
      'progress',
      'done',
      'start',
      'progress',
      'error'
    ])
  })

  it('Ctrl+C: the running job and every never-started job end as canceled', async () => {
    const r = recorder()
    const ctrl = new AbortController()
    const q = fakeQueue((req) => {
      if (req.id === '1') queueMicrotask(() => ctrl.abort())
    })
    const t = await runPlanned([job('1'), job('2'), job('3')], r, deps(q), ctrl.signal)
    expect(t).toMatchObject({ ok: 0, canceled: 3 })
    expect(
      r.events
        .filter((e) => e.event === 'canceled')
        .map((e) => (e as { id: string }).id)
        .sort()
    ).toEqual(['1', '2', '3'])
  })

  it('an already-aborted signal cancels everything without starting', async () => {
    const r = recorder()
    const ctrl = new AbortController()
    ctrl.abort()
    const t = await runPlanned([job('1')], r, deps(fakeQueue(() => {})), ctrl.signal)
    expect(t.canceled).toBe(1)
  })

  it('an already-aborted signal never creates the queue, so no tool is spawned', async () => {
    const r = recorder()
    const ctrl = new AbortController()
    ctrl.abort()
    const t = await runPlanned(
      [job('1'), job('2')],
      r,
      {
        ...deps(fakeQueue(() => {})),
        queue: () => {
          throw new Error('the queue must not be created after an abort')
        }
      },
      ctrl.signal
    )
    expect(t.canceled).toBe(2)
    expect(r.events.map((e) => e.event)).toEqual(['canceled', 'canceled'])
  })
})

describe('classifyError', () => {
  it.each([
    ['PiD is not installed. Run: filesmith setup pid.', 'SETUP_REQUIRED', 'filesmith setup pid'],
    ['Output folder not found: D:\\x', 'OUT_DIR_MISSING', undefined],
    ['This archive is password-protected.', 'PASSWORD', undefined],
    [
      'The image engine (ImageMagick) is missing from this installation. Reinstall Filesmith.',
      'TOOL_MISSING',
      'filesmith doctor'
    ],
    ['magick: improper image header', 'TOOL_FAILED', undefined]
  ])('%s', (msg, code, hint) =>
    expect(classifyError(msg)).toEqual(hint ? { code, hint } : { code })
  )
})
