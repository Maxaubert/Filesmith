import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW,
  parseViewSize,
  isListSize,
  stepSize,
  VIEW_KEY,
  VIEW_SIZES,
  MENU_SIZES,
  viewDef,
  viewKeyFor,
  wheelDelta,
  WHEEL_IDLE,
  wheelStep
} from '../src/renderer/src/components/queue/viewSize'
import type { KeyLike } from '../src/renderer/src/components/queue/tableKeys'

// The second argument (KeyboardEvent.code) documents the physical key; the
// mapping only reads `key`.
const k = (key: string, _code: string, o: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...o
})

describe('view sizes', () => {
  it('lists the six sizes in wheel order', () => {
    expect(VIEW_SIZES.map((s) => [s.id, s.label])).toEqual([
      ['details', 'Details'],
      ['details-l', 'Large details'],
      ['tiles', 'Tiles'],
      ['medium', 'Medium icons'],
      ['large', 'Large icons'],
      ['xl', 'Extra large icons']
    ])
    expect(viewDef('large').label).toBe('Large icons')
    expect(DEFAULT_VIEW).toBe('details')
    expect(VIEW_KEY).toBe('filesmith.viewSize')
  })
  it('offers only Details, Tiles and Extra large icons in the menu', () => {
    expect(MENU_SIZES.map((s) => viewDef(s).label)).toEqual([
      'Details',
      'Tiles',
      'Extra large icons'
    ])
  })
  it('steps one size and clamps at both ends', () => {
    expect(stepSize('details', 1)).toBe('details-l')
    expect(stepSize('details-l', 1)).toBe('tiles')
    expect(stepSize('tiles', -1)).toBe('details-l')
    expect(stepSize('medium', -1)).toBe('tiles')
    expect(stepSize('xl', 1)).toBe('xl')
    expect(stepSize('details', -1)).toBe('details')
  })
  it('reads a stored value, falling back to Details for anything unknown', () => {
    expect(parseViewSize('large')).toBe('large')
    expect(parseViewSize('details-l')).toBe('details-l')
    for (const bad of [null, undefined, '', 'huge', '3', 3, {}, 'details-xl'])
      expect(parseViewSize(bad)).toBe('details')
  })
  it('treats the two Details sizes as the table', () => {
    expect(VIEW_SIZES.filter((s) => isListSize(s.id)).map((s) => s.id)).toEqual([
      'details',
      'details-l'
    ])
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
  it('has no per-size shortcuts: Ctrl+Shift+digits do nothing', () => {
    expect(viewKeyFor(k('!', 'Digit1', { shiftKey: true }))).toBeNull()
    expect(viewKeyFor(k('@', 'Digit2', { shiftKey: true }))).toBeNull()
    expect(viewKeyFor(k('$', 'Digit4', { shiftKey: true }))).toBeNull()
    expect(viewKeyFor(k('&', 'Digit6', { shiftKey: true }))).toBeNull()
    expect(viewKeyFor(k('1', 'Digit1', { shiftKey: true }))).toBeNull()
    expect(viewKeyFor(k('3', 'Digit3', { shiftKey: true }))).toBeNull()
    expect(viewKeyFor(k('_', 'Minus', { shiftKey: true }))).toBeNull()
    expect(viewKeyFor(k('=', 'Digit0', { shiftKey: true }))).toBeNull()
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
