import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW,
  parseViewSize,
  stepSize,
  thumbPx,
  VIEW_KEY,
  VIEW_SIZES,
  viewDef,
  viewKeyFor,
  wheelDelta,
  WHEEL_IDLE,
  wheelStep,
  type ViewKeyLike
} from '../src/renderer/src/components/queue/viewSize'

const k = (
  key: string,
  code: string,
  o: Partial<Omit<ViewKeyLike, 'key' | 'code'>> = {}
): ViewKeyLike => ({
  key,
  code,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...o
})

describe('view sizes', () => {
  it('lists the five Explorer sizes in order with their Ctrl+Shift digit', () => {
    expect(VIEW_SIZES.map((s) => [s.id, s.label, s.digit])).toEqual([
      ['details', 'Details', 1],
      ['tiles', 'Tiles', 2],
      ['medium', 'Medium icons', 3],
      ['large', 'Large icons', 4],
      ['xl', 'Extra large icons', 5]
    ])
    expect(DEFAULT_VIEW).toBe('details')
    expect(VIEW_KEY).toBe('filesmith.viewSize')
    expect(viewDef('large').icon).toBe('view-large')
  })
  it('steps one size and clamps at both ends', () => {
    expect(stepSize('details', 1)).toBe('tiles')
    expect(stepSize('medium', -1)).toBe('tiles')
    expect(stepSize('xl', 1)).toBe('xl')
    expect(stepSize('details', -1)).toBe('details')
  })
  it('reads a stored value, falling back to Details for anything unknown', () => {
    expect(parseViewSize('large')).toBe('large')
    for (const bad of [null, undefined, '', 'huge', '3', 3, {}])
      expect(parseViewSize(bad)).toBe('details')
  })
  it('gives 256px thumbnails only to the two largest sizes', () => {
    expect(VIEW_SIZES.map((s) => thumbPx(s.id))).toEqual([128, 128, 128, 256, 256])
  })
})

describe('view keys', () => {
  it('maps Ctrl+= / Ctrl++ / numpad + / Ctrl+Shift+= to bigger', () => {
    expect(viewKeyFor(k('=', 'Equal'))).toEqual({ kind: 'step', delta: 1 })
    expect(viewKeyFor(k('+', 'NumpadAdd'))).toEqual({ kind: 'step', delta: 1 })
    expect(viewKeyFor(k('+', 'Equal', { shiftKey: true }))).toEqual({ kind: 'step', delta: 1 })
    // Nordic layouts: + is its own unshifted key (code Minus)
    expect(viewKeyFor(k('+', 'Minus'))).toEqual({ kind: 'step', delta: 1 })
  })
  it('maps Ctrl+- (any layout, numpad) to smaller and Ctrl+0 to Details', () => {
    expect(viewKeyFor(k('-', 'Minus'))).toEqual({ kind: 'step', delta: -1 })
    expect(viewKeyFor(k('-', 'Slash'))).toEqual({ kind: 'step', delta: -1 })
    expect(viewKeyFor(k('-', 'NumpadSubtract'))).toEqual({ kind: 'step', delta: -1 })
    expect(viewKeyFor(k('0', 'Digit0'))).toEqual({ kind: 'set', size: 'details' })
    expect(viewKeyFor(k('0', 'Numpad0'))).toEqual({ kind: 'set', size: 'details' })
  })
  it('maps Ctrl+Shift+1..5 by code, whatever character the layout makes', () => {
    expect(viewKeyFor(k('!', 'Digit1', { shiftKey: true }))).toEqual({
      kind: 'set',
      size: 'details'
    })
    expect(viewKeyFor(k('#', 'Digit3', { shiftKey: true }))).toEqual({
      kind: 'set',
      size: 'medium'
    })
    expect(viewKeyFor(k('%', 'Digit5', { shiftKey: true }))).toEqual({ kind: 'set', size: 'xl' })
    expect(viewKeyFor(k('&', 'Digit6', { shiftKey: true }))).toBeNull()
  })
  it('works with Cmd, ignores Alt, plain keys and other Ctrl keys', () => {
    expect(viewKeyFor(k('=', 'Equal', { ctrlKey: false, metaKey: true }))).toEqual({
      kind: 'step',
      delta: 1
    })
    expect(viewKeyFor(k('=', 'Equal', { ctrlKey: false }))).toBeNull()
    expect(viewKeyFor(k('=', 'Equal', { altKey: true }))).toBeNull()
    expect(viewKeyFor(k('a', 'KeyA'))).toBeNull()
    expect(viewKeyFor(k('3', 'Digit3'))).toBeNull()
  })
})

describe('Ctrl+wheel accumulation', () => {
  it('scales line and page deltas to pixels', () => {
    expect(wheelDelta(100, 0)).toBe(100)
    expect(wheelDelta(3, 1)).toBe(120)
    expect(wheelDelta(1, 2)).toBe(400)
  })
  it('steps once per mouse notch, wheel up = bigger, at most once per 90ms', () => {
    let r = wheelStep(WHEEL_IDLE, -100, 1000)
    expect(r.step).toBe(1)
    r = wheelStep(r.state, -100, 1050)
    expect(r.step).toBe(0)
    r = wheelStep(r.state, -100, 1200)
    expect(r.step).toBe(1)
    expect(wheelStep(WHEEL_IDLE, 100, 1000).step).toBe(-1)
  })
  it('accumulates small trackpad deltas and drops a stale accumulation', () => {
    let r = wheelStep(WHEEL_IDLE, -10, 1000)
    r = wheelStep(r.state, -10, 1010)
    r = wheelStep(r.state, -10, 1020)
    expect(r.step).toBe(0)
    r = wheelStep(r.state, -10, 1030)
    expect(r.step).toBe(1)
    const stale = wheelStep(WHEEL_IDLE, -30, 1000)
    expect(wheelStep(stale.state, -30, 1400).step).toBe(0)
  })
})
