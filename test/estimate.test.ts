import { describe, expect, it, vi } from 'vitest'
import { estimateProgress, estimateSecForBytes } from '../src/main/tools/estimate'

describe('estimateSecForBytes', () => {
  it('returns the base for a zero-byte input', () => {
    expect(estimateSecForBytes(0, 0.06, 0.6)).toBeCloseTo(0.6, 5)
  })

  it('scales with size', () => {
    expect(estimateSecForBytes(1_000_000, 0.06, 0.6)).toBeCloseTo(0.66, 5)
  })

  it('clamps to [0.5, 90]', () => {
    expect(estimateSecForBytes(0, 0.06, 0.1)).toBe(0.5) // floor
    expect(estimateSecForBytes(10_000_000_000)).toBe(90) // ceiling
  })
})

describe('estimateProgress', () => {
  it('emits an initial value in (0, ceiling), climbs monotonically, and stops on stop()', () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const t = estimateProgress(2, (p) => seen.push(p), { ceiling: 95 })

    expect(seen.length).toBe(1) // immediate initial tick
    expect(seen[0]).toBeGreaterThan(0)
    expect(seen[0]).toBeLessThan(95)

    vi.advanceTimersByTime(1000)
    const n = seen.length
    expect(n).toBeGreaterThan(1)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen[seen.length - 1]).toBeLessThanOrEqual(95)

    t.stop()
    vi.advanceTimersByTime(3000)
    expect(seen.length).toBe(n) // no further emissions after stop

    vi.useRealTimers()
  })

  it('never exceeds the ceiling even after a long time', () => {
    vi.useFakeTimers()
    let last = 0
    const t = estimateProgress(1, (p) => (last = p), { ceiling: 90 })
    vi.advanceTimersByTime(60_000)
    expect(last).toBeLessThanOrEqual(90)
    expect(last).toBeGreaterThan(85) // has crept close to the ceiling
    t.stop()
    vi.useRealTimers()
  })

  it('starts from startPct on a restart so the bar never jumps backward', () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const t = estimateProgress(2, (p) => seen.push(p), { startPct: 50 })
    expect(seen[0]).toBeGreaterThanOrEqual(50)
    t.stop()
    vi.useRealTimers()
  })
})
