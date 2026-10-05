import { describe, expect, it } from 'vitest'
import { JsonReporter, TeeReporter, type EventBody } from '../src/cli/events'

function collect(): {
  out: { write: (s: string) => void }
  lines: () => Record<string, unknown>[]
} {
  let buf = ''
  return {
    out: { write: (s) => (buf += s) },
    lines: () =>
      buf
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
  }
}

const fixedNow = (): Date => new Date('2026-10-04T12:00:00.000Z')

describe('JsonReporter', () => {
  it('writes one envelope per line: v, event, ts first, undefined fields omitted', () => {
    const c = collect()
    const r = new JsonReporter(c.out, () => 0, fixedNow)
    r.emit({ event: 'error', code: 'NOT_FOUND', message: 'nope', input: 'C:\\a.png' })
    let raw = ''
    const r2 = new JsonReporter({ write: (s) => (raw += s) }, () => 0, fixedNow)
    r2.emit({
      event: 'done',
      id: '1',
      input: 'a',
      output: 'b',
      outputKind: 'file',
      inSize: 1,
      ms: 5
    })
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw.indexOf('"v":1')).toBeLessThan(raw.indexOf('"event"'))
    expect(c.lines()).toEqual([
      {
        v: 1,
        event: 'error',
        ts: '2026-10-04T12:00:00.000Z',
        code: 'NOT_FOUND',
        message: 'nope',
        input: 'C:\\a.png'
      }
    ])
    expect(raw).not.toContain('outSize')
  })

  it('rate-limits progress to one per 250 ms per job, but always passes a new tenth', () => {
    const c = collect()
    let t = 0
    const r = new JsonReporter(c.out, () => t, fixedNow)
    const p = (id: string, pct: number | null): EventBody => ({ event: 'progress', id, pct })
    r.emit(p('1', 1)) // first: passes
    t = 100
    r.emit(p('1', 2)) // same tenth, 100 ms: dropped
    r.emit(p('2', 2)) // other job: passes
    t = 150
    r.emit(p('1', 10)) // new tenth: passes
    t = 300
    r.emit(p('1', 11)) // 150 ms since last: dropped
    t = 401
    r.emit(p('1', null)) // 251 ms since last: passes
    expect(c.lines().map((l) => [l.id, l.pct])).toEqual([
      ['1', 1],
      ['2', 2],
      ['1', 10],
      ['1', null]
    ])
  })

  it('text() writes nothing in JSON mode', () => {
    const c = collect()
    new JsonReporter(c.out).text('hello')
    expect(c.lines()).toEqual([])
  })
})

describe('TeeReporter', () => {
  it('passes every call to both reporters', () => {
    const calls: string[] = []
    const r = (n: string) => ({
      emit: (e: { event: string }) => calls.push(`${n}:emit:${e.event}`),
      text: (s: string) => calls.push(`${n}:text:${s}`),
      close: () => calls.push(`${n}:close`)
    })
    const t = new TeeReporter(r('a'), r('b'))
    t.emit({ event: 'version', version: '1' })
    t.text('x')
    t.close()
    expect(calls).toEqual([
      'a:emit:version',
      'b:emit:version',
      'a:text:x',
      'b:text:x',
      'a:close',
      'b:close'
    ])
  })
})
