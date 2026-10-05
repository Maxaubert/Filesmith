# View Sizes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the files view five Explorer-style view sizes (Details, Tiles, Medium icons, Large icons, Extra large icons), switched by Ctrl+wheel, keyboard shortcuts and a View menu button, persisted per app, with every row behaviour (selection, right-click menu, group headers, states, open, keyboard, drop) kept in each size.

**Architecture:** Pure, Vitest-covered modules hold the logic (`viewSize.ts`: sizes, stepping, key mapping, wheel accumulation, thumbnail px; `gridKeys.ts`: 2D keyboard navigation; `cardModel.ts`: the compact status line). A `useViewSize` hook persists the size in `localStorage` like `useSidebar`. `QueueTable` keeps one roving-focus/selection/menu pipeline and switches only the row renderer (`QueueRow` / `QueueTile` / `QueueCard`, sharing a `RowProps` shape); a `ViewMenu` lives in the toolbar; App wires the keys and lazily requests 256px thumbnails for the two largest sizes through the existing `thumbnail` IPC (main unchanged).

**Tech Stack:** Electron 43, React 19 + TypeScript strict, Vite (electron-vite 5), Tailwind v4 + plain CSS in `src/renderer/src/theme/*.css`, Vitest, Playwright Test (`_electron`).

**Spec:** `docs/superpowers/specs/2026-10-05-view-sizes-design.md` (read it fully; section numbers below refer to it). Target mockup: `docs/mockups/view-zoom/04-explorer-style.html` (copy its CSS values; shots in `docs/mockups/view-zoom/shots/04-explorer-style-*.png`).

## Global Constraints

- Branch `feat/36-view-sizes` (already checked out). Do not switch branches, do not push, never touch `main`. One PR at the end, opened by the orchestrator, not by a task.
- Commits: `type(scope): subject`, body line `Refs #36`, last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No em-dashes (U+2014) anywhere: code, comments, CSS, docs, commit messages. `test/no-em-dash.test.ts` scans the new files (Task 8).
- Strict monochrome: every colour literal outside `theme/tokens.css` is a grey (r=g=b); use the tokens (`--bg-0`, `--hover`, `--selected`, `--line`, `--line-strong`, `--fg1..3`, `--inv-*`). Square corners. `test/monochrome-source.test.ts` enforces it.
- `.tsx` files export React components only; pure helpers and types go in `.ts` files with Vitest tests in `test/*.test.ts`.
- Size ids and labels exactly: `details` Details, `tiles` Tiles, `medium` Medium icons, `large` Large icons, `xl` Extra large icons. Shortcuts Ctrl+Shift+1..5 in that order. Storage key `filesmith.viewSize`.
- Wheel: threshold 40px, at most one step per 90ms, accumulation dropped after 250ms idle, deltaMode 1 x40, deltaMode 2 x400; wheel up (negative deltaY) = bigger.
- Thumbnails: 128px for Details/Tiles/Medium, 256px for Large/Extra large.
- Fade 150ms `cubic-bezier(.2,.7,.2,1)` from opacity .25; flash 450ms. None of it under `prefers-reduced-motion: reduce`.
- Version 0.6.0 -> 0.7.0 (Task 8).
- Before any e2e run, close a running Filesmith: `pwsh -NoProfile -Command "Get-Process Filesmith -ErrorAction SilentlyContinue | Stop-Process -Force"`, then `npm run build`.

## Review Focus

- **Focus after a size change:** a keyboard user on a row presses Ctrl+Shift+3; the row element is replaced by a card. Expected: focus lands on the same item's card and it is scrolled into view, not lost to `<body>`. Pinned by the e2e "keeps focus" test in Task 7 (implemented in Task 4).
- **Non-US keyboards and the numpad:** on Nordic layouts `+` and `-` are unshifted keys with other codes and Shift+1 is `!`. Expected: `+`, numpad `+`, Ctrl+Shift+= all step bigger; Ctrl+Shift+1..5 work by `code`. Pinned in Task 1's `viewKeyFor` tests.
- **Electron's default menu zoom accelerators** (Ctrl+= / Ctrl+- / Ctrl+0 zoom the whole page). Expected: the page zoom factor stays 1 because the files view handler calls `preventDefault`. Pinned by the e2e zoom-factor assertion in Task 7.
- **A stored value from another version or hand-edited** (`"huge"`, `"3"`, empty). Expected: Details, no crash. Pinned in Task 1's `parseViewSize` tests.
- **Grids with a short last row and several convert groups:** Down from the row above a short last row, Up/Down across group headers. Expected: Explorer-like (last item; nearest column in the neighbouring group). Pinned in Task 2's `gridNeighbor` tests.

---

## File map

```
src/renderer/src/components/queue/
  viewSize.ts      NEW  sizes, stepSize, parseViewSize, viewKeyFor, wheelDelta, wheelStep, thumbPx
  gridKeys.ts      NEW  gridNeighbor, moveFor
  cardModel.ts     NEW  cardLine, kindIcon
  rowProps.ts      NEW  RowProps (shared row renderer props, types only)
  useViewSize.ts   NEW  persisted size hook
  ViewMenu.tsx     NEW  toolbar View button + menu
  Thumb.tsx        NEW  thumbnail / placeholder for tiles and cards
  QueueTile.tsx    NEW  Tiles renderer
  QueueCard.tsx    NEW  icon-grid renderer
  QueueTable.tsx   MOD  size switch, grid nav, wheel, fade, focus keep
  QueueToolbar.tsx MOD  ViewMenu slot
  StatusCell.tsx   MOD  export StatusBadge
  ResultCell.tsx   MOD  export ResultText
  TotalsRow.tsx    MOD  flat variant
  tableKeys.ts     MOD  Left/Right
src/renderer/src/components/icons/shapes.ts  MOD  6 icons
src/shared/icons.ts                          MOD  6 names
src/renderer/src/theme/viewsizes.css         NEW
src/renderer/src/index.css                   MOD  import
src/renderer/src/App.tsx                     MOD  hook, keys, big thumbs, props
test/view-size.test.ts, test/grid-keys.test.ts, test/card-model.test.ts  NEW
test/table-keys.test.ts, test/icons.test.ts, test/no-em-dash.test.ts     MOD
e2e/viewsizes.spec.ts NEW; e2e/ui.spec.ts, e2e/visual.spec.ts MOD
package.json, package-lock.json (0.7.0), docs/design/redesign-direction.md, CLAUDE.md MOD
```

---

### Task 1: View-size model

**Files:**
- Create: `src/renderer/src/components/queue/viewSize.ts`
- Test: `test/view-size.test.ts`

**Interfaces:**
- Consumes: `KeyLike` from `src/renderer/src/components/queue/tableKeys.ts`. (`ViewIcon` is a string-literal union; Task 3 adds the same five names to `ICON_NAMES`, after which a `ViewIcon` is assignable to `IconName` and can be passed to `<Icon>`.)
- Produces:
  - `type ViewSize = 'details' | 'tiles' | 'medium' | 'large' | 'xl'`
  - `interface ViewSizeDef { id: ViewSize; label: string; icon: ViewIcon; digit: number }`, `type ViewIcon = 'view-details' | 'view-tiles' | 'view-medium' | 'view-large' | 'view-xl'`
  - `VIEW_SIZES: readonly ViewSizeDef[]`, `DEFAULT_VIEW: ViewSize`, `VIEW_KEY = 'filesmith.viewSize'`
  - `viewDef(s: ViewSize): ViewSizeDef`, `stepSize(s: ViewSize, delta: number): ViewSize`, `parseViewSize(v: unknown): ViewSize`
  - `type ViewKey = { kind: 'step'; delta: 1 | -1 } | { kind: 'set'; size: ViewSize }`, `interface ViewKeyLike extends KeyLike { code: string }`, `viewKeyFor(e: ViewKeyLike): ViewKey | null`
  - `interface WheelState { acc: number; at: number; last: number }`, `WHEEL_IDLE: WheelState`, `wheelDelta(deltaY: number, deltaMode: number): number`, `wheelStep(s: WheelState, delta: number, now: number): { state: WheelState; step: -1 | 0 | 1 }`
  - `thumbPx(s: ViewSize): 128 | 256`

- [ ] **Step 1: Write the failing test**

`test/view-size.test.ts`:

```ts
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

const k = (key: string, code: string, o: Partial<Omit<ViewKeyLike, 'key' | 'code'>> = {}): ViewKeyLike => ({
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
    for (const bad of [null, undefined, '', 'huge', '3', 3, {}]) expect(parseViewSize(bad)).toBe('details')
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
    expect(viewKeyFor(k('!', 'Digit1', { shiftKey: true }))).toEqual({ kind: 'set', size: 'details' })
    expect(viewKeyFor(k('#', 'Digit3', { shiftKey: true }))).toEqual({ kind: 'set', size: 'medium' })
    expect(viewKeyFor(k('%', 'Digit5', { shiftKey: true }))).toEqual({ kind: 'set', size: 'xl' })
    expect(viewKeyFor(k('&', 'Digit6', { shiftKey: true }))).toBeNull()
  })
  it('works with Cmd, ignores Alt, plain keys and other Ctrl keys', () => {
    expect(viewKeyFor(k('=', 'Equal', { ctrlKey: false, metaKey: true }))).toEqual({ kind: 'step', delta: 1 })
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/view-size.test.ts`
Expected: FAIL, cannot resolve `../src/renderer/src/components/queue/viewSize`.

- [ ] **Step 3: Write the implementation**

`src/renderer/src/components/queue/viewSize.ts`:

```ts
import type { KeyLike } from './tableKeys'

// Pure model for the files view sizes (spec 1-3), named like Windows File
// Explorer. Kept out of the .tsx files so Vitest and Fast Refresh both work.

export type ViewSize = 'details' | 'tiles' | 'medium' | 'large' | 'xl'
export type ViewIcon = 'view-details' | 'view-tiles' | 'view-medium' | 'view-large' | 'view-xl'

export interface ViewSizeDef {
  id: ViewSize
  label: string
  icon: ViewIcon
  /** Ctrl+Shift+<digit> jumps to this size. */
  digit: number
}

export const VIEW_SIZES: readonly ViewSizeDef[] = [
  { id: 'details', label: 'Details', icon: 'view-details', digit: 1 },
  { id: 'tiles', label: 'Tiles', icon: 'view-tiles', digit: 2 },
  { id: 'medium', label: 'Medium icons', icon: 'view-medium', digit: 3 },
  { id: 'large', label: 'Large icons', icon: 'view-large', digit: 4 },
  { id: 'xl', label: 'Extra large icons', icon: 'view-xl', digit: 5 }
]

export const DEFAULT_VIEW: ViewSize = 'details'
export const VIEW_KEY = 'filesmith.viewSize'

const indexOf = (s: ViewSize): number => VIEW_SIZES.findIndex((d) => d.id === s)

export function viewDef(s: ViewSize): ViewSizeDef {
  return VIEW_SIZES[Math.max(0, indexOf(s))]
}

export function stepSize(s: ViewSize, delta: number): ViewSize {
  const i = Math.max(0, Math.min(VIEW_SIZES.length - 1, indexOf(s) + delta))
  return VIEW_SIZES[i].id
}

export function parseViewSize(v: unknown): ViewSize {
  return VIEW_SIZES.find((d) => d.id === v)?.id ?? DEFAULT_VIEW
}

export type ViewKey = { kind: 'step'; delta: 1 | -1 } | { kind: 'set'; size: ViewSize }
export interface ViewKeyLike extends KeyLike {
  code: string
}

/** Ctrl+= / Ctrl++ bigger, Ctrl+- smaller, Ctrl+0 Details, Ctrl+Shift+1..5 a size.
 * Digits match on `code`, so Shift+1 = `!` on Nordic layouts still works. */
export function viewKeyFor(e: ViewKeyLike): ViewKey | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  if (e.shiftKey) {
    const m = /^Digit([1-5])$/.exec(e.code)
    if (m) return { kind: 'set', size: VIEW_SIZES[Number(m[1]) - 1].id }
    return e.key === '+' ? { kind: 'step', delta: 1 } : null
  }
  if (e.key === '=' || e.key === '+') return { kind: 'step', delta: 1 }
  if (e.key === '-') return { kind: 'step', delta: -1 }
  if (e.key === '0') return { kind: 'set', size: DEFAULT_VIEW }
  return null
}

export interface WheelState {
  acc: number
  /** Time of the last wheel event. */
  at: number
  /** Time of the last step. */
  last: number
}
export const WHEEL_IDLE: WheelState = { acc: 0, at: -Infinity, last: -Infinity }

const THRESHOLD = 40
const MIN_GAP_MS = 90
const STALE_MS = 250

export function wheelDelta(deltaY: number, deltaMode: number): number {
  return deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 400 : deltaY
}

/** One step per notch; trackpad deltas accumulate. Wheel up (negative) = bigger. */
export function wheelStep(
  s: WheelState,
  delta: number,
  now: number
): { state: WheelState; step: -1 | 0 | 1 } {
  const acc = (now - s.at > STALE_MS ? 0 : s.acc) + delta
  if (Math.abs(acc) >= THRESHOLD && now - s.last > MIN_GAP_MS)
    return { state: { acc: 0, at: now, last: now }, step: acc < 0 ? 1 : -1 }
  return { state: { acc, at: now, last: s.last }, step: 0 }
}

/** Thumbnail pixels a size needs (spec 5): the 128px one covers up to Medium. */
export function thumbPx(s: ViewSize): 128 | 256 {
  return s === 'large' || s === 'xl' ? 256 : 128
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/view-size.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/queue/viewSize.ts test/view-size.test.ts
git commit -m "feat(view): view-size model, keys and wheel accumulation" -m "Refs #36" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Grid navigation, card status line, Left/Right keys

**Files:**
- Create: `src/renderer/src/components/queue/gridKeys.ts`, `src/renderer/src/components/queue/cardModel.ts`
- Modify: `src/renderer/src/components/queue/tableKeys.ts`
- Test: `test/grid-keys.test.ts`, `test/card-model.test.ts`, `test/table-keys.test.ts`

**Interfaces:**
- Consumes: `ViewSize` (Task 1); `RowView` from `rowModel.ts`; `ItemStatus` from `../../state`; `FileKind` from `@shared/types`; `IconName` from `@shared/icons`.
- Produces:
  - `TableKey` gains `'left' | 'right' | 'extendLeft' | 'extendRight'`.
  - `type GridDir = 'up' | 'down' | 'left' | 'right'`; `moveFor(k: TableKey): { dir: GridDir; extend: boolean } | null`; `gridNeighbor(groups: string[][], id: string, dir: GridDir, cols: number): string | undefined`.
  - `interface CardLine { kind: ItemStatus; icon: IconName | null; strong?: string; text?: string; eta?: string; pct?: string; extra?: string; title?: string }`; `cardLine(v: RowView, size: ViewSize): CardLine`; `kindIcon(k: FileKind): IconName`.

- [ ] **Step 1: Write the failing tests**

Append to `test/table-keys.test.ts` inside the `describe('tableKey', ...)` block:

```ts
  it('maps Left/Right for the grid sizes, Shift extends', () => {
    expect(tableKey(k('ArrowLeft'))).toBe('left')
    expect(tableKey(k('ArrowRight'))).toBe('right')
    expect(tableKey(k('ArrowLeft', { shiftKey: true }))).toBe('extendLeft')
    expect(tableKey(k('ArrowRight', { shiftKey: true }))).toBe('extendRight')
  })
```

`test/grid-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { gridNeighbor, moveFor } from '../src/renderer/src/components/queue/gridKeys'

// Two groups in a 4-column grid:
//   a b c d       (group 1)
//   e f g
//   h i           (group 2)
const G = [['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['h', 'i']]

describe('gridNeighbor', () => {
  it('walks left and right in visual order, across groups', () => {
    expect(gridNeighbor(G, 'd', 'right', 4)).toBe('e')
    expect(gridNeighbor(G, 'g', 'right', 4)).toBe('h')
    expect(gridNeighbor(G, 'h', 'left', 4)).toBe('g')
    expect(gridNeighbor(G, 'a', 'left', 4)).toBeUndefined()
    expect(gridNeighbor(G, 'i', 'right', 4)).toBeUndefined()
  })
  it('moves one visual row in the same column', () => {
    expect(gridNeighbor(G, 'a', 'down', 4)).toBe('e')
    expect(gridNeighbor(G, 'c', 'down', 4)).toBe('g')
    expect(gridNeighbor(G, 'f', 'up', 4)).toBe('b')
  })
  it('reaches a short last row from the column above it', () => {
    expect(gridNeighbor(G, 'd', 'down', 4)).toBe('g')
  })
  it('crosses group headers at the nearest column', () => {
    expect(gridNeighbor(G, 'e', 'down', 4)).toBe('h')
    expect(gridNeighbor(G, 'g', 'down', 4)).toBe('i')
    expect(gridNeighbor(G, 'h', 'up', 4)).toBe('e')
    expect(gridNeighbor(G, 'i', 'up', 4)).toBe('f')
    expect(gridNeighbor(G, 'a', 'up', 4)).toBeUndefined()
    expect(gridNeighbor(G, 'i', 'down', 4)).toBeUndefined()
  })
  it('is the plain list order with one column (Details), where Left/Right do nothing', () => {
    expect(gridNeighbor(G, 'g', 'down', 1)).toBe('h')
    expect(gridNeighbor(G, 'h', 'up', 1)).toBe('g')
    expect(gridNeighbor(G, 'b', 'up', 1)).toBe('a')
    expect(gridNeighbor(G, 'b', 'right', 1)).toBeUndefined()
  })
  it('returns nothing for an unknown id', () => {
    expect(gridNeighbor(G, 'zz', 'down', 4)).toBeUndefined()
  })
})

describe('moveFor', () => {
  it('maps arrow keys to a direction and whether Shift extends', () => {
    expect(moveFor('up')).toEqual({ dir: 'up', extend: false })
    expect(moveFor('extendDown')).toEqual({ dir: 'down', extend: true })
    expect(moveFor('left')).toEqual({ dir: 'left', extend: false })
    expect(moveFor('extendRight')).toEqual({ dir: 'right', extend: true })
    expect(moveFor('toggle')).toBeNull()
    expect(moveFor('menu')).toBeNull()
  })
})
```

`test/card-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cardLine, kindIcon } from '../src/renderer/src/components/queue/cardModel'
import type { RowView } from '../src/renderer/src/components/queue/rowModel'

const base: RowView = {
  kind: 'PNG',
  size: '1.8 MB',
  result: null,
  status: { kind: 'ready', text: '' },
  action: { kind: 'remove', icon: 'close', label: 'Remove', ghost: true }
}
const done: RowView = {
  ...base,
  result: { text: '486 KB', pct: '-77%', estimate: false, grew: false },
  status: { kind: 'done', text: 'Done' }
}
const running: RowView = {
  ...base,
  result: { text: '~410 KB', pct: '-77%', estimate: true, grew: false },
  status: { kind: 'running', text: '', pct: '62%', eta: '(4s)' }
}
const failed: RowView = {
  ...base,
  status: { kind: 'failed', text: 'Unsupported compression', title: 'Unsupported compression in TIFF' }
}

describe('cardLine', () => {
  it('done: result, then %, then the source size as the cards grow', () => {
    expect(cardLine(done, 'medium')).toEqual({ kind: 'done', icon: 'check', strong: '486 KB' })
    expect(cardLine(done, 'large')).toEqual({ kind: 'done', icon: 'check', strong: '486 KB', pct: '-77%' })
    expect(cardLine(done, 'xl')).toEqual({
      kind: 'done',
      icon: 'check',
      strong: '486 KB',
      pct: '-77%',
      extra: '1.8 MB'
    })
    expect(cardLine({ ...done, result: null }, 'medium').strong).toBe('Done')
  })
  it('running: 62%(4s), plus the estimate from Large up', () => {
    expect(cardLine(running, 'medium')).toEqual({ kind: 'running', icon: 'sync', strong: '62%', eta: '(4s)' })
    expect(cardLine(running, 'large').extra).toBe('~410 KB')
  })
  it('queued and canceled add the source size from Large up', () => {
    const q: RowView = { ...base, status: { kind: 'queued', text: 'Queued' } }
    expect(cardLine(q, 'medium')).toEqual({ kind: 'queued', icon: 'clock', text: 'Queued' })
    expect(cardLine(q, 'large').extra).toBe('1.8 MB')
    const c: RowView = { ...base, status: { kind: 'canceled', text: 'Canceled' } }
    expect(cardLine(c, 'medium')).toEqual({ kind: 'canceled', icon: 'close', text: 'Canceled' })
    expect(cardLine(c, 'xl').extra).toBe('1.8 MB')
  })
  it('failed: "Failed" on Medium, the short error from Large up, full error as title', () => {
    expect(cardLine(failed, 'medium')).toEqual({
      kind: 'failed',
      icon: 'warning',
      text: 'Failed',
      title: 'Unsupported compression in TIFF'
    })
    expect(cardLine(failed, 'large').text).toBe('Unsupported compression')
  })
  it('ready: just the source size', () => {
    expect(cardLine(base, 'medium')).toEqual({ kind: 'ready', icon: null, text: '1.8 MB' })
  })
})

describe('kindIcon', () => {
  it('maps each file kind to a glyph', () => {
    expect(kindIcon('image')).toBe('image')
    expect(kindIcon('video')).toBe('video')
    expect(kindIcon('audio')).toBe('audio')
    expect(kindIcon('pdf')).toBe('pdf')
    expect(kindIcon('document')).toBe('doc')
    expect(kindIcon('text')).toBe('text')
    expect(kindIcon('archive')).toBe('archive')
    expect(kindIcon('other')).toBe('doc')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/table-keys.test.ts test/grid-keys.test.ts test/card-model.test.ts`
Expected: FAIL (`left` is null; `gridKeys` and `cardModel` do not resolve).

- [ ] **Step 3: Write the implementation**

`src/renderer/src/components/queue/tableKeys.ts`, replace the type and the two arrow lines:

```ts
export type TableKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'extendUp'
  | 'extendDown'
  | 'extendLeft'
  | 'extendRight'
  | 'toggle'
  | 'selectAll'
  | 'remove'
  | 'open'
  | 'menu'
```

and in `tableKey`, after the `ArrowDown` line:

```ts
  if (e.key === 'ArrowLeft') return e.shiftKey ? 'extendLeft' : 'left'
  if (e.key === 'ArrowRight') return e.shiftKey ? 'extendRight' : 'right'
```

`src/renderer/src/components/queue/gridKeys.ts`:

```ts
import type { TableKey } from './tableKeys'

// Keyboard movement over the files view (spec 4): Details is one column, Tiles
// two, the icon grids as many as fit. `groups` holds each convert group's ids in
// display order; each group starts a new visual row under its header.

export type GridDir = 'up' | 'down' | 'left' | 'right'

const MOVES: Partial<Record<TableKey, { dir: GridDir; extend: boolean }>> = {
  up: { dir: 'up', extend: false },
  down: { dir: 'down', extend: false },
  left: { dir: 'left', extend: false },
  right: { dir: 'right', extend: false },
  extendUp: { dir: 'up', extend: true },
  extendDown: { dir: 'down', extend: true },
  extendLeft: { dir: 'left', extend: true },
  extendRight: { dir: 'right', extend: true }
}

export function moveFor(k: TableKey): { dir: GridDir; extend: boolean } | null {
  return MOVES[k] ?? null
}

export function gridNeighbor(
  groups: string[][],
  id: string,
  dir: GridDir,
  cols: number
): string | undefined {
  const g = groups.findIndex((list) => list.includes(id))
  if (g < 0) return undefined
  const c = Math.max(1, Math.floor(cols))
  if (dir === 'left' || dir === 'right') {
    if (c === 1) return undefined
    const flat = groups.flat()
    return flat[flat.indexOf(id) + (dir === 'left' ? -1 : 1)]
  }
  const list = groups[g]
  const i = list.indexOf(id)
  const col = i % c
  if (dir === 'down') {
    if (i + c < list.length) return list[i + c]
    // A short last row below: land on its last item, like Explorer.
    if (Math.floor(i / c) < Math.floor((list.length - 1) / c)) return list[list.length - 1]
    const next = groups[g + 1]
    return next ? next[Math.min(col, next.length - 1)] : undefined
  }
  if (i - c >= 0) return list[i - c]
  const prev = groups[g - 1]
  if (!prev) return undefined
  const lastRowStart = Math.floor((prev.length - 1) / c) * c
  return prev[Math.min(lastRowStart + col, prev.length - 1)]
}
```

`src/renderer/src/components/queue/cardModel.ts`:

```ts
import type { IconName } from '@shared/icons'
import type { FileKind } from '@shared/types'
import type { ItemStatus } from '../../state'
import type { RowView } from './rowModel'
import type { ViewSize } from './viewSize'

// The compact status line under an icon-grid card (spec 4, table). Larger
// cards add detail: the change %, the estimate, the source size.

export interface CardLine {
  kind: ItemStatus
  icon: IconName | null
  /** Bold lead: the result size, or the running percentage. */
  strong?: string
  /** Plain text: Queued, Canceled, Failed / the short error, or the source size. */
  text?: string
  eta?: string
  pct?: string
  /** Right-aligned fg3 extra: the estimate or the source size. */
  extra?: string
  title?: string
}

export function cardLine(v: RowView, size: ViewSize): CardLine {
  const big = size === 'large' || size === 'xl'
  const src = big ? v.size : undefined
  const s = v.status
  switch (s.kind) {
    case 'done':
      return {
        kind: 'done',
        icon: 'check',
        strong: v.result?.text ?? 'Done',
        pct: big ? (v.result?.pct ?? undefined) : undefined,
        extra: size === 'xl' ? v.size : undefined
      }
    case 'running':
      return {
        kind: 'running',
        icon: 'sync',
        strong: s.pct ?? '…',
        eta: s.eta,
        extra: big ? v.result?.text : undefined
      }
    case 'queued':
      return { kind: 'queued', icon: 'clock', text: 'Queued', extra: src }
    case 'failed':
      return { kind: 'failed', icon: 'warning', text: big ? s.text : 'Failed', title: s.title }
    case 'canceled':
      return { kind: 'canceled', icon: 'close', text: 'Canceled', extra: src }
    default:
      return { kind: 'ready', icon: null, text: v.size }
  }
}

const KIND_ICON: Record<FileKind, IconName> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'pdf',
  document: 'doc',
  text: 'text',
  archive: 'archive',
  other: 'doc'
}

/** The glyph a card shows when there is no thumbnail. */
export function kindIcon(k: FileKind): IconName {
  return KIND_ICON[k]
}
```

- [ ] **Step 4: Keep Details correct until Task 4**

The current `onRowKey` in `QueueTable.tsx` sends every key it does not name to its final `else` (open the row menu), so Left/Right would open the menu in Details. Add this guard right after `if (!k) return` (Task 4 replaces the whole function):

```ts
    if (k === 'left' || k === 'right' || k === 'extendLeft' || k === 'extendRight') return
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/table-keys.test.ts test/grid-keys.test.ts test/card-model.test.ts && npm run typecheck && npm run lint`
Expected: PASS; typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/queue/gridKeys.ts src/renderer/src/components/queue/cardModel.ts src/renderer/src/components/queue/tableKeys.ts src/renderer/src/components/queue/QueueTable.tsx test/grid-keys.test.ts test/card-model.test.ts test/table-keys.test.ts
git commit -m "feat(view): grid keyboard navigation and card status line" -m "Refs #36" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Icons, persisted size, View menu and keyboard shortcuts

**Files:**
- Modify: `src/shared/icons.ts`, `src/renderer/src/components/icons/shapes.ts`, `test/icons.test.ts`
- Create: `src/renderer/src/components/queue/useViewSize.ts`, `src/renderer/src/components/queue/ViewMenu.tsx`, `src/renderer/src/theme/viewsizes.css`
- Modify: `src/renderer/src/index.css`, `src/renderer/src/components/queue/QueueToolbar.tsx`, `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - Icon names `view-details`, `view-tiles`, `view-medium`, `view-large`, `view-xl`, `mouse`.
  - `useViewSize(): { size: ViewSize; flash: boolean; setSize: (s: ViewSize, opts?: { flash?: boolean }) => boolean; step: (delta: number) => boolean }` (stable callbacks; `step` always flashes; both return whether the size changed).
  - `<ViewMenu size flash onPick />`; button accessible name `View: <label>`; menu `role="menu"` named `View` with five `menuitemradio`s.
  - `QueueToolbar` gains props `size: ViewSize`, `flash: boolean`, `onView: (s: ViewSize) => void`.
  - In `App.tsx`: `const view = useViewSize()` and `const filesView: boolean` (used by Tasks 4 to 6).

- [ ] **Step 1: Write the failing icon test**

In `test/icons.test.ts` add inside `describe('icon registry', ...)`:

```ts
  it('draws the view-size glyphs and the mouse hint', () => {
    for (const n of ['view-details', 'view-tiles', 'view-medium', 'view-large', 'view-xl', 'mouse'])
      expect(ICON_NAMES as readonly string[]).toContain(n)
  })
```

Run: `npx vitest run test/icons.test.ts`
Expected: FAIL (names missing).

- [ ] **Step 2: Add the icons**

`src/shared/icons.ts`: append before `] as const`:

```ts
  'dots',
  'view-details',
  'view-tiles',
  'view-medium',
  'view-large',
  'view-xl',
  'mouse'
```

(`'dots'` is the existing last entry; keep it once.)

`src/renderer/src/components/icons/shapes.ts`: add to `ICON_SHAPES` (paths copied from the mockup's `v-0..v-4` and `i-mouse` symbols):

```ts
  'view-details': [['path', 'M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11']],
  'view-tiles': [
    ['rect', 2.5, 2.5, 4, 4],
    ['rect', 2.5, 9.5, 4, 4],
    ['path', 'M8.5 3.5h5M8.5 5.5h3M8.5 10.5h5M8.5 12.5h3']
  ],
  'view-medium': [
    ['rect', 2.5, 2.5, 3, 3],
    ['rect', 6.5, 2.5, 3, 3],
    ['rect', 10.5, 2.5, 3, 3],
    ['rect', 2.5, 6.5, 3, 3],
    ['rect', 6.5, 6.5, 3, 3],
    ['rect', 10.5, 6.5, 3, 3],
    ['rect', 2.5, 10.5, 3, 3],
    ['rect', 6.5, 10.5, 3, 3],
    ['rect', 10.5, 10.5, 3, 3]
  ],
  'view-large': [
    ['rect', 2.5, 2.5, 4.5, 4.5],
    ['rect', 9, 2.5, 4.5, 4.5],
    ['rect', 2.5, 9, 4.5, 4.5],
    ['rect', 9, 9, 4.5, 4.5]
  ],
  'view-xl': [
    ['rect', 2.5, 2.5, 11, 8],
    ['path', 'M2.5 13.5h7']
  ],
  mouse: [
    ['rect', 4.5, 1.5, 7, 13],
    ['path', 'M8 4v2.5']
  ],
```

Run: `npx vitest run test/icons.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Write the hook**

`src/renderer/src/components/queue/useViewSize.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_VIEW, parseViewSize, stepSize, VIEW_KEY, type ViewSize } from './viewSize'

function read(): ViewSize {
  try {
    return parseViewSize(localStorage.getItem(VIEW_KEY))
  } catch {
    return DEFAULT_VIEW
  }
}

/** The files view size, one per app (spec 3), persisted like the sidebar. */
export function useViewSize(): {
  size: ViewSize
  flash: boolean
  setSize: (s: ViewSize, opts?: { flash?: boolean }) => boolean
  step: (delta: number) => boolean
} {
  const [size, setState] = useState<ViewSize>(read)
  const [flash, setFlash] = useState(false)
  // Mirrors `size` for the stable callbacks; written only inside them.
  const cur = useRef<ViewSize>(size)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const setSize = useCallback((next: ViewSize, opts: { flash?: boolean } = {}): boolean => {
    if (next === cur.current) return false
    cur.current = next
    setState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* storage blocked: the size still applies for this session */
    }
    if (opts.flash) {
      setFlash(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setFlash(false), 450)
    }
    return true
  }, [])

  const step = useCallback(
    (delta: number): boolean => setSize(stepSize(cur.current, delta), { flash: true }),
    [setSize]
  )

  return { size, flash, setSize, step }
}
```

- [ ] **Step 4: Write the View menu**

`src/renderer/src/components/queue/ViewMenu.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Icon } from '../icons/Icon'
import { DEFAULT_VIEW, VIEW_SIZES, viewDef, type ViewSize } from './viewSize'

/** The files toolbar's View button and its menu (spec 2). */
export function ViewMenu({
  size,
  flash,
  onPick
}: {
  size: ViewSize
  flash: boolean
  onPick: (s: ViewSize) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const def = viewDef(size)

  // Anchor under the button, right-aligned, before paint; focus the checked entry.
  useLayoutEffect(() => {
    const el = pop.current
    const b = btn.current
    if (!open || !el || !b) return
    const r = b.getBoundingClientRect()
    el.style.top = `${r.bottom}px`
    el.style.left = `${Math.max(8, r.right - el.offsetWidth)}px`
    el.style.visibility = 'visible'
    el.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (e: Event): void => {
      const t = e.target as Node
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false)
    }
    const away = (): void => setOpen(false)
    window.addEventListener('mousedown', outside)
    window.addEventListener('blur', away)
    window.addEventListener('resize', away)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('blur', away)
      window.removeEventListener('resize', away)
    }
  }, [open])

  function pick(s: ViewSize): void {
    onPick(s)
    setOpen(false)
    btn.current?.focus()
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btn.current?.focus()
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = Array.from(pop.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const n =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : e.key === 'ArrowDown'
            ? (i + 1) % items.length
            : (i - 1 + items.length) % items.length
    items[n].focus()
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`viewbtn${flash ? ' flash' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`View: ${def.label}`}
        title="View (Ctrl+wheel to resize)"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={def.icon} />
        <span className="vl">{def.label}</span>
        <Icon name="chev-d" size={12} className="k" />
      </button>
      <span className="sr-only" aria-live="polite">
        {`View: ${def.label}`}
      </span>
      {open && (
        <div
          ref={pop}
          role="menu"
          aria-label="View"
          className="menu viewmenu"
          style={{ visibility: 'hidden' }}
          onKeyDown={onKey}
          onContextMenu={(e) => e.preventDefault()}
        >
          {VIEW_SIZES.map((d) => (
            <button
              key={d.id}
              type="button"
              role="menuitemradio"
              aria-checked={d.id === size}
              className="menu-item"
              onClick={() => pick(d.id)}
            >
              <Icon name="check" size={12} className="tick" />
              <Icon name={d.icon} />
              <span className="ml">{d.label}</span>
              <span className="sc">Ctrl+Shift+{d.digit}</span>
            </button>
          ))}
          <div className="menu-sep" role="separator" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => pick(DEFAULT_VIEW)}>
            <span className="tick" />
            <Icon name="retry" />
            <span className="ml">Reset to Details</span>
            <span className="sc">Ctrl+0</span>
          </button>
          <div className="menu-sep" role="separator" />
          <div className="menu-hint">
            <Icon name="mouse" />
            <span>Ctrl + wheel over the list</span>
          </div>
          <div className="menu-hint indent">
            <span>Bigger, smaller</span>
            <span className="sc">Ctrl+= / Ctrl+-</span>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 5: Wire it into the toolbar**

`src/renderer/src/components/queue/QueueToolbar.tsx`, full file:

```tsx
import type { JSX } from 'react'
import { AddFilesButton } from '../ui/Button'
import { ViewMenu } from './ViewMenu'
import type { ViewSize } from './viewSize'

/** Add files, the count and the View menu. Row actions (remove, delete, clear
 * finished) live in the right-click menu on the rows themselves. */
export function QueueToolbar({
  files,
  selected,
  dropping,
  size,
  flash,
  onAdd,
  onView
}: {
  files: number
  selected: number
  dropping: boolean
  size: ViewSize
  flash: boolean
  onAdd: () => void
  onView: (s: ViewSize) => void
}): JSX.Element {
  const count = dropping
    ? 'Drop to add'
    : `${files} file${files === 1 ? '' : 's'}${selected ? `, ${selected} selected` : ''}`
  return (
    <div className="toolbar" role="toolbar" aria-label="File actions">
      <AddFilesButton onClick={onAdd} title="Add files (Ctrl+O)" />
      <div className="tb-right">
        <span className="count" aria-live="polite">
          {count}
        </span>
        <ViewMenu size={size} flash={flash} onPick={onView} />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Styles for the button and menu**

Create `src/renderer/src/theme/viewsizes.css` (Task 4 appends the tile/card rules):

```css
/* View sizes (spec docs/superpowers/specs/2026-10-05-view-sizes-design.md),
   values from docs/mockups/view-zoom/04-explorer-style.html. */

/* toolbar View button */
.viewbtn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
  border-left: 1px solid var(--line);
  color: var(--fg2);
  font-size: 12px;
  line-height: 1;
  transition:
    background-color 0.2s,
    color 0.2s;
}
.viewbtn .vl {
  color: var(--fg1);
  min-width: 96px;
  text-align: left;
}
.viewbtn .k {
  color: var(--fg3);
}
.viewbtn:hover,
.viewbtn[aria-expanded='true'] {
  background: var(--hover);
  color: var(--fg1);
}
.viewbtn:active {
  background: var(--selected);
}
.viewbtn.flash {
  background: var(--inv-bg);
  color: var(--fg1);
  transition: none;
}

/* its menu (shares .menu / .menu-item / .menu-sep with the context menu) */
.viewmenu {
  min-width: 272px;
}
.viewmenu .menu-item {
  white-space: nowrap;
}
.viewmenu .ml {
  flex: 1;
}
.viewmenu .sc {
  font: 11px var(--mono);
  color: var(--fg3);
}
.viewmenu .tick {
  width: 12px;
  height: 12px;
  flex: none;
  visibility: hidden;
}
.viewmenu .menu-item[aria-checked='true'] {
  color: var(--fg1);
  font-weight: 600;
}
.viewmenu .menu-item[aria-checked='true'] .tick {
  visibility: visible;
}
.menu-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  color: var(--fg3);
}
.menu-hint.indent {
  padding-left: 38px;
}
.menu-hint .sc {
  margin-left: auto;
}

@media (prefers-reduced-motion: reduce) {
  .viewbtn {
    transition: none;
  }
  .viewbtn.flash {
    background: transparent;
    color: var(--fg2);
  }
}
```

`src/renderer/src/index.css`: add after the `views.css` import:

```css
@import './theme/viewsizes.css';
```

- [ ] **Step 7: App: the hook, `filesView` and the shortcuts**

In `src/renderer/src/App.tsx`:

1. Imports (next to the other queue imports):

```ts
import { useViewSize } from './components/queue/useViewSize'
import { viewKeyFor } from './components/queue/viewSize'
```

2. After `const rail = useRailPrefs()` (around line 146):

```ts
  // Files view size (spec 3): one per app, persisted like the sidebar.
  const view = useViewSize()
```

3. After `const order = visibleOrder(groups)` (around line 362):

```ts
  // The queue (files) view is on screen: not Completed, Settings, the Tools
  // grid or Generate. View-size keys only act here.
  const filesView = !onCompleted && state.tab !== 'settings' && !onToolsGrid && tool !== 'generate'
```

4. Replace the global-shortcut block (the `actions` ref, its refresh effect and the `onKey` effect, around lines 857-878) with:

```ts
  const actions = useRef({ run, browse, runCount, toggle: sidebar.toggle, filesView, view })
  useEffect(() => {
    actions.current = { run, browse, runCount, toggle: sidebar.toggle, filesView, view }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const a = actions.current
      const s = shortcutFor(e)
      if (s) {
        e.preventDefault()
        if (s === 'toggleSidebar') a.toggle()
        else if (s === 'addFiles') void a.browse()
        else if (s === 'run' && a.runCount > 0) void a.run()
        return
      }
      // View sizes (spec 2). preventDefault also keeps Electron's default menu
      // zoom accelerators (Ctrl+= / Ctrl+- / Ctrl+0) from zooming the page.
      const v = a.filesView ? viewKeyFor(e) : null
      if (!v) return
      e.preventDefault()
      if (v.kind === 'step') a.view.step(v.delta)
      else a.view.setSize(v.size, { flash: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```

5. In the `<QueueToolbar ... />` JSX add:

```tsx
                  size={view.size}
                  flash={view.flash}
                  onView={(s) => view.setSize(s)}
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean and green. Then `npm run dev`, open Convert: the toolbar ends with `[grid glyph] Details v`; the menu opens with five sizes, a tick on Details, shortcuts on the right; Ctrl+Shift+3 changes the label to Medium icons with a brief grey flash; a reload keeps it. (The list itself still renders as Details until Task 4.)

- [ ] **Step 9: Commit**

```bash
git add src/shared/icons.ts src/renderer/src/components/icons/shapes.ts test/icons.test.ts src/renderer/src/components/queue/useViewSize.ts src/renderer/src/components/queue/ViewMenu.tsx src/renderer/src/components/queue/QueueToolbar.tsx src/renderer/src/theme/viewsizes.css src/renderer/src/index.css src/renderer/src/App.tsx
git commit -m "feat(view): View menu, persisted size and keyboard shortcuts" -m "Refs #36" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tiles and icon-grid renderers in the queue

**Files:**
- Create: `src/renderer/src/components/queue/rowProps.ts`, `Thumb.tsx`, `QueueTile.tsx`, `QueueCard.tsx`
- Modify: `QueueTable.tsx`, `StatusCell.tsx`, `ResultCell.tsx`, `TotalsRow.tsx`, `src/renderer/src/theme/viewsizes.css`, `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `ViewSize`, `thumbPx` (Task 1); `gridNeighbor`, `moveFor`, `cardLine`, `kindIcon` (Task 2); `view.size` (Task 3).
- Produces:
  - `RowProps { item: QueueItem; view: RowView; selected: boolean; dim: boolean; focusable: boolean; onClick(e: MouseEvent): void; onToggle(): void; onOpen(): void; onMenu(x: number, y: number): void; onKeyDown(e: KeyboardEvent<HTMLDivElement>): void }`
  - `StatusBadge({ status }: { status: StatusView })`, `ResultText({ result, split }: { result: ResultView; split: boolean })`
  - `TotalsRow` gains `flat?: boolean`
  - `QueueTable` gains props `size: ViewSize` and `thumbs: Record<string, string | null>` (256px thumbnails by source path; Task 6 fills it) and a `section` ref (Task 5 attaches the wheel listener to it). Its `<section>` carries `data-size={size}`. Every tile and card is `role="row"` with `aria-selected` and `data-id`.

- [ ] **Step 1: Shared row props**

`src/renderer/src/components/queue/rowProps.ts`:

```ts
import type { KeyboardEvent, MouseEvent } from 'react'
import type { QueueItem } from '../../state'
import type { RowView } from './rowModel'

/** What every row renderer (Details row, tile, card) gets from QueueTable, so
 * selection, the menu, open and keyboard behave the same in every size. */
export interface RowProps {
  item: QueueItem
  view: RowView
  selected: boolean
  /** A row of a different convert group than the selection (spec 2.6). */
  dim: boolean
  focusable: boolean
  onClick: (e: MouseEvent) => void
  onToggle: () => void
  onOpen: () => void
  onMenu: (x: number, y: number) => void
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
}
```

- [ ] **Step 2: Extract the inline status and result parts**

`StatusCell.tsx`, full file:

```tsx
import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { RowAction } from '../ui/Button'
import type { RowActionKind, RowActionView, StatusView } from './rowModel'

/** The status glyph and text (62%(4s), Done, the failed pill...). */
export function StatusBadge({ status }: { status: StatusView }): JSX.Element | null {
  if (status.kind === 'failed')
    return (
      <span className="st fail" title={status.title}>
        <Icon name="warning" />
        {status.text}
      </span>
    )
  if (status.kind === 'running')
    return (
      <span className="st run">
        <Icon name="sync" />
        <span className="prog">
          <b>{status.pct}</b>
          <span className="eta">{status.eta}</span>
        </span>
      </span>
    )
  if (status.kind === 'done')
    return (
      <span className="st done">
        <Icon name="check" />
        Done
      </span>
    )
  if (status.kind === 'queued')
    return (
      <span className="st q">
        <Icon name="clock" />
        Queued
      </span>
    )
  if (status.kind === 'canceled')
    return (
      <span className="st canceled">
        <Icon name="close" />
        Canceled
      </span>
    )
  return null
}

export function StatusCell({
  status,
  action,
  onAction
}: {
  status: StatusView
  action: RowActionView
  onAction: (k: RowActionKind) => void
}): JSX.Element {
  return (
    <div className="td" role="gridcell">
      <StatusBadge status={status} />
      <RowAction
        icon={action.icon}
        label={action.label}
        ghost={action.ghost}
        onClick={(e) => {
          e.stopPropagation()
          onAction(action.kind)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
```

`ResultCell.tsx`, full file:

```tsx
import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import type { ResultView } from './rowModel'

/** Arrow, result size and change %. `split` centres the arrow on the
 * size|result column boundary (Details only, spec 4.3). */
export function ResultText({ result, split }: { result: ResultView; split: boolean }): JSX.Element {
  return (
    <span className="res">
      <Icon name="arrow" size={12} className={split ? 'arr split' : 'arr'} />
      {result.estimate ? <span className="est">{result.text}</span> : <b>{result.text}</b>}
      {result.pct && (
        <span
          className={`pct${result.grew ? ' grew' : ''}`}
          title={result.grew ? 'Larger than the original' : undefined}
        >
          {result.pct}
        </span>
      )}
    </span>
  )
}

export function ResultCell({ result }: { result: ResultView | null }): JSX.Element {
  return (
    <div className="td rc" role="gridcell">
      {result && <ResultText result={result} split />}
    </div>
  )
}
```

`TotalsRow.tsx`, full file:

```tsx
import type { JSX } from 'react'
import { formatBytes } from '@shared/compress'
import { Icon } from '../icons/Icon'
import type { Totals } from './rowModel'

/** Column-aligned under Details; one flat line under the other sizes. */
export function TotalsRow({ totals: t, flat = false }: { totals: Totals; flat?: boolean }): JSX.Element {
  const files = `${t.files} file${t.files === 1 ? '' : 's'}`
  const soFar =
    t.doneSrc > 0 ? (
      <>
        <span>{formatBytes(t.doneSrc)}</span>
        <Icon name="arrow" size={12} className="tarr" />
        <b>{formatBytes(t.doneOut)}</b>
        <span className="pct">so far</span>
      </>
    ) : null
  const done = t.files > 0 && (
    <b>
      {t.done} of {t.files} done
    </b>
  )
  if (flat)
    return (
      <div className="totals flat" role="row" aria-label="Totals">
        <span role="gridcell">
          {files}, {formatBytes(t.bytes)}
        </span>
        {soFar && (
          <span role="gridcell" className="res">
            {soFar}
          </span>
        )}
        <span role="gridcell">{done}</span>
      </div>
    )
  return (
    <div className="totals cols" role="row" aria-label="Totals">
      <div className="td" role="gridcell" />
      <div className="td" role="gridcell">
        {files}
      </div>
      <div className="td" role="gridcell" />
      <div className="td num" role="gridcell">
        {formatBytes(t.bytes)}
      </div>
      <div className="td" role="gridcell">
        {soFar}
      </div>
      <div className="td" role="gridcell">
        {done}
      </div>
    </div>
  )
}
```

Run: `npm run typecheck && npx vitest run`
Expected: clean; Details looks exactly as before.

- [ ] **Step 3: Thumb, tile and card**

`src/renderer/src/components/queue/Thumb.tsx`:

```tsx
import type { JSX } from 'react'
import type { FileKind } from '@shared/types'
import { Icon } from '../icons/Icon'
import { kindIcon } from './cardModel'

/** A row thumbnail. Small (Details, Tiles): the image or the kind's letters.
 * Big (icon grids): the image or the kind's glyph, the kind tag, and a play
 * glyph on videos (spec 5). */
export function Thumb({
  src,
  kind,
  fileKind,
  big
}: {
  src: string | null
  kind: string
  fileKind: FileKind
  big: boolean
}): JSX.Element {
  if (!big)
    return src ? (
      <img className="thumb" src={src} alt="" />
    ) : (
      <span className="thumb" aria-hidden="true">
        {kind.slice(0, 3)}
      </span>
    )
  return (
    <span className="thumb big" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <Icon name={kindIcon(fileKind)} className="ph" />}
      {src && fileKind === 'video' && <Icon name="play" className="play" />}
      <span className="kt">{kind}</span>
    </span>
  )
}
```

`src/renderer/src/components/queue/QueueTile.tsx`:

```tsx
import type { JSX } from 'react'
import { Checkbox } from '../ui/Checkbox'
import { ResultText } from './ResultCell'
import type { RowProps } from './rowProps'
import { StatusBadge } from './StatusCell'
import { Thumb } from './Thumb'

const DIM = 'A different file type than the current selection'

/** Tiles: a two-line card with a 48px thumb (mockup size 1). */
export function QueueTile({ thumb, ...p }: RowProps & { thumb: string | null }): JSX.Element {
  const { item, view } = p
  return (
    <div
      role="row"
      aria-selected={p.selected}
      tabIndex={p.focusable ? 0 : -1}
      data-id={item.id}
      className={`tile${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}`}
      title={p.dim ? DIM : undefined}
      onClick={p.onClick}
      onDoubleClick={p.onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={p.onKeyDown}
    >
      <span className="tck" role="gridcell">
        <Checkbox checked={p.selected} onChange={p.onToggle} label={`Select ${item.file.name}`} />
      </span>
      <Thumb src={thumb} kind={view.kind} fileKind={item.file.kind} big={false} />
      <div className="lines" role="gridcell">
        <div className="l1">
          <span className="name" title={item.file.name}>
            {item.file.name}
          </span>
          <span className="meta">{view.kind}</span>
        </div>
        <div className="l2">
          {view.status.kind === 'failed' ? (
            <StatusBadge status={view.status} />
          ) : (
            <>
              <span className="size">{view.size}</span>
              {view.result && <ResultText result={view.result} split={false} />}
              <StatusBadge status={view.status} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

`src/renderer/src/components/queue/QueueCard.tsx`:

```tsx
import type { JSX } from 'react'
import { Checkbox } from '../ui/Checkbox'
import { Icon } from '../icons/Icon'
import { cardLine } from './cardModel'
import type { RowProps } from './rowProps'
import { Thumb } from './Thumb'
import type { ViewSize } from './viewSize'

const DIM = 'A different file type than the current selection'

/** Medium / Large / Extra large icons: square thumb, name, compact status. */
export function QueueCard({
  thumb,
  size,
  ...p
}: RowProps & { thumb: string | null; size: ViewSize }): JSX.Element {
  const { item, view } = p
  const line = cardLine(view, size)
  return (
    <div
      role="row"
      aria-selected={p.selected}
      tabIndex={p.focusable ? 0 : -1}
      data-id={item.id}
      className={`card${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}`}
      title={p.dim ? DIM : item.file.name}
      onClick={p.onClick}
      onDoubleClick={p.onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={p.onKeyDown}
    >
      <span className="cck" role="gridcell">
        <Checkbox checked={p.selected} onChange={p.onToggle} label={`Select ${item.file.name}`} />
      </span>
      <Thumb src={thumb} kind={view.kind} fileKind={item.file.kind} big />
      <div className="cname" role="gridcell">
        {item.file.name}
      </div>
      <div className={`cst ${line.kind}`} role="gridcell" title={line.title}>
        {line.icon && <Icon name={line.icon} size={12} />}
        {line.kind === 'running' ? (
          <span className="prog">
            <b>{line.strong}</b>
            <span className="eta">{line.eta}</span>
          </span>
        ) : (
          line.strong && <b>{line.strong}</b>
        )}
        {line.text && <span className="ct">{line.text}</span>}
        {line.pct && <span className="pct">{line.pct}</span>}
        {line.extra && <span className="xtra">{line.extra}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: QueueTable switches renderer, navigates the grid and keeps focus**

Replace `src/renderer/src/components/queue/QueueTable.tsx` with:

```tsx
import { Fragment, useEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { Checkbox } from '../ui/Checkbox'
import { Icon } from '../icons/Icon'
import { groupOf, type QueueItem } from '../../state'
import { EmptyState } from './EmptyState'
import { QueueCard } from './QueueCard'
import { QueueRow } from './QueueRow'
import { QueueTile } from './QueueTile'
import { TotalsRow } from './TotalsRow'
import { gridNeighbor, moveFor } from './gridKeys'
import { rowView, type RowActionKind, type Totals } from './rowModel'
import type { RowProps } from './rowProps'
import type { CheckState } from './selectAll'
import { tableKey } from './tableKeys'
import { visibleOrder, type RowGroup, type SortKey, type SortState } from './tableSort'
import { thumbPx, type ViewSize } from './viewSize'

const HEADS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'name' },
  { key: 'kind', label: 'kind' },
  { key: 'size', label: 'size', num: true },
  { key: 'result', label: 'result' },
  { key: 'status', label: 'status' }
]

export function QueueTable({
  groups,
  totals,
  selected,
  activeGroup,
  sort,
  check,
  estimates,
  size,
  thumbs,
  onSort,
  onToggleAll,
  onSelectAll,
  onRowClick,
  onToggleRow,
  onExtend,
  onOpen,
  onMenu,
  onAction,
  onRemove,
  onSelectGroup,
  onAdd
}: {
  groups: RowGroup[]
  totals: Totals
  selected: string[]
  activeGroup: string | null
  sort: SortState | null
  check: CheckState
  estimates: Record<string, number | null>
  size: ViewSize
  /** 256px thumbnails by source path, for the two largest sizes. */
  thumbs: Record<string, string | null>
  onSort: (k: SortKey) => void
  onToggleAll: () => void
  onSelectAll: () => void
  onRowClick: (id: string, e: MouseEvent) => void
  onToggleRow: (id: string) => void
  /** Shift+Arrow: extend the range to this id. */
  onExtend: (id: string) => void
  onOpen: (id: string) => void
  onMenu: (id: string, x: number, y: number) => void
  onAction: (id: string, k: RowActionKind) => void
  onRemove: (id: string) => void
  onSelectGroup: (group: string) => void
  onAdd: () => void
}): JSX.Element {
  const section = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const order = visibleOrder(groups)
  const lists = groups.map((g) => g.items.map((i) => i.id))
  const [focusId, setFocusId] = useState<string | null>(null)
  const tabStop = focusId && order.includes(focusId) ? focusId : (selected[0] ?? order[0] ?? null)

  // A size change replaces every row element, so focus would fall to <body>:
  // put it back on the same item and keep that item in view (spec 4).
  const prevSize = useRef(size)
  useEffect(() => {
    if (prevSize.current === size) return
    prevSize.current = size
    const el = body.current
    if (!el) return
    const row = tabStop ? el.querySelector<HTMLElement>(`[data-id="${CSS.escape(tabStop)}"]`) : null
    if (document.activeElement === document.body) row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
  }, [size, tabStop])

  /** Columns of the rendered grid: 1 for Details, 2 for Tiles, auto-fill for icons. */
  function columns(): number {
    if (size === 'details') return 1
    const grid = body.current?.querySelector<HTMLElement>('.tiles, .icons')
    if (!grid) return 1
    return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
  }

  function focusRow(id: string | undefined): void {
    if (!id) return
    setFocusId(id)
    body.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus()
  }

  function onRowKey(id: string, e: KeyboardEvent<HTMLDivElement>): void {
    if (e.target !== e.currentTarget) return
    const k = tableKey(e)
    if (!k) return
    e.preventDefault()
    const move = moveFor(k)
    if (move) {
      const next = gridNeighbor(lists, id, move.dir, columns())
      if (next) {
        focusRow(next)
        if (move.extend) onExtend(next)
      }
    } else if (k === 'toggle') onToggleRow(id)
    else if (k === 'selectAll') onSelectAll()
    else if (k === 'remove') onRemove(id)
    else if (k === 'open') onOpen(id)
    else {
      const r = e.currentTarget.getBoundingClientRect()
      onMenu(id, r.left + 40, r.bottom)
    }
  }

  function rowProps(item: QueueItem): RowProps {
    return {
      item,
      view: rowView(item, estimates[item.id]),
      selected: selected.includes(item.id),
      dim: activeGroup != null && groupOf(item.file) !== activeGroup,
      focusable: item.id === tabStop,
      onClick: (e) => {
        setFocusId(item.id)
        onRowClick(item.id, e)
      },
      onToggle: () => onToggleRow(item.id),
      onOpen: () => onOpen(item.id),
      onMenu: (x, y) => onMenu(item.id, x, y),
      onKeyDown: (e) => onRowKey(item.id, e)
    }
  }

  const big = thumbPx(size) > 128
  const thumbOf = (item: QueueItem): string | null =>
    (big ? thumbs[item.file.path] : undefined) ?? item.thumb

  function renderGroup(g: RowGroup): JSX.Element | JSX.Element[] {
    if (size === 'details')
      return g.items.map((item) => (
        <QueueRow key={item.id} {...rowProps(item)} onAction={(k) => onAction(item.id, k)} />
      ))
    if (size === 'tiles')
      return (
        <div className="tiles">
          {g.items.map((item) => (
            <QueueTile key={item.id} {...rowProps(item)} thumb={thumbOf(item)} />
          ))}
        </div>
      )
    return (
      <div className={`icons ${size}${selected.length ? ' any' : ''}`}>
        {g.items.map((item) => (
          <QueueCard key={item.id} {...rowProps(item)} thumb={thumbOf(item)} size={size} />
        ))}
      </div>
    )
  }

  return (
    <section
      ref={section}
      className="qtable"
      data-size={size}
      role="grid"
      aria-label="Files"
      aria-multiselectable="true"
    >
      {size === 'details' && (
        <div className="thead cols" role="row">
          <div className="th ck" role="columnheader">
            <Checkbox
              checked={check === 'all' ? true : check === 'mixed' ? 'mixed' : false}
              onChange={onToggleAll}
              label="Select all in this group"
              focusable
            />
          </div>
          {HEADS.map((h) => {
            const on = sort?.key === h.key
            const desc = on && sort.dir === 'desc'
            return (
              <div
                key={h.key}
                role="columnheader"
                tabIndex={0}
                aria-sort={on ? (desc ? 'descending' : 'ascending') : 'none'}
                className={`th${h.num ? ' num' : ''}${on ? ' sorted' : ''}${desc ? ' desc' : ''}`}
                onClick={() => onSort(h.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSort(h.key)
                  }
                }}
              >
                {h.label}
                <Icon name="chev-d" size={12} className="chev" />
              </div>
            )
          })}
        </div>
      )}
      <div ref={body} className="qbody scroll-thin" role="rowgroup">
        {groups.length === 0 ? (
          <EmptyState
            icon="addfile"
            title="No files yet"
            line="Add files or drop them anywhere in the window"
            action={{ label: 'Add files', onClick: onAdd }}
          />
        ) : (
          groups.map((g) => (
            <Fragment key={g.group}>
              {groups.length > 1 && (
                <div className="grp-row" role="row">
                  <button
                    type="button"
                    className="grp"
                    role="gridcell"
                    onClick={() => onSelectGroup(g.group)}
                    title={`Select all ${g.label.toLowerCase()}`}
                  >
                    {g.label.toUpperCase()}
                    <span className="n">{g.items.length}</span>
                  </button>
                </div>
              )}
              {renderGroup(g)}
            </Fragment>
          ))
        )}
      </div>
      {totals.files > 0 && <TotalsRow totals={totals} flat={size !== 'details'} />}
    </section>
  )
}
```

QueueRow keeps its own prop list, which is `RowProps` plus `onAction`, so the spread compiles unchanged.

- [ ] **Step 5: App passes the new props**

In `src/renderer/src/App.tsx`:

```ts
  // 256px thumbnails for Large / Extra large icons, by source path (spec 5).
  // Task 6 adds the setter and the effect that fills it.
  const [bigThumbs] = useState<Record<string, string | null>>({})
```

next to `outThumbs` (around line 125); and on `<QueueTable ... />` add:

```tsx
                  size={view.size}
                  thumbs={bigThumbs}
```

- [ ] **Step 6: Tile and card styles**

Append to `src/renderer/src/theme/viewsizes.css`:

```css
/* Tiles: two columns of 64px two-line tiles, 48px thumb */
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.tile {
  position: relative;
  display: grid;
  grid-template-columns: 22px 48px 1fr;
  align-items: center;
  column-gap: 10px;
  height: 64px;
  padding: 0 12px 0 8px;
  min-width: 0;
  border-bottom: 1px solid var(--line);
  cursor: default;
}
.tile:nth-child(odd) {
  border-right: 1px solid var(--line);
}
.tile:hover {
  background: var(--hover);
}
.tile.sel {
  background: var(--selected);
}
.tile:focus-visible,
.card:focus-visible {
  outline: 1px solid var(--focus);
  outline-offset: -1px;
}
.tile .tck {
  display: grid;
  place-items: center;
}
.tile .thumb {
  width: 48px;
  height: 48px;
}
.tile .lines {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.tile .l1 {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  white-space: nowrap;
}
.tile .l1 .meta {
  margin-left: auto;
  flex: none;
}
.tile .l2 {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  height: 22px;
  white-space: nowrap;
}
.tile .l2 .res {
  gap: 6px;
}
.tile .l2 .st {
  margin-left: auto;
}
.tile .l2 .st.fail {
  margin-left: 0;
}
.tile:hover .meta,
.tile.sel .meta,
.tile:hover .res .pct,
.tile.sel .res .pct {
  color: var(--fg2);
}

/* Icon grids: Medium 132px, Large 196px, Extra large 274px cards */
.icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, var(--cw));
  gap: 8px;
  padding: 10px 12px 14px;
}
.icons.medium {
  --cw: 132px;
}
.icons.large {
  --cw: 196px;
}
.icons.xl {
  --cw: 274px;
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  min-width: 0;
  cursor: default;
}
.card:hover {
  background: var(--hover);
}
.card.sel {
  background: var(--selected);
}
.card .cck {
  position: absolute;
  left: 13px;
  top: 13px;
  z-index: 1;
  display: grid;
  opacity: 0;
  transition: opacity 0.1s;
}
.card:hover .cck,
.card:focus-within .cck,
.card.sel .cck,
.icons.any .cck {
  opacity: 1;
}
.card .box {
  background: var(--bg-0);
}
.card .box.on {
  background: var(--inv-bg);
}
.thumb.big {
  position: relative;
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1;
}
.thumb.big img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb.big .ph {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 32%;
  height: 32%;
  transform: translate(-50%, -50%);
  color: var(--fg3);
}
.thumb.big .play {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 28%;
  height: 28%;
  max-width: 40px;
  max-height: 40px;
  transform: translate(-50%, -50%);
  color: var(--fg1);
}
.thumb.big .play path {
  fill: currentColor;
}
.thumb .kt {
  position: absolute;
  right: 0;
  bottom: 0;
  padding: 2px 5px;
  background: var(--bg-0);
  font: 10px/1.2 var(--mono);
  color: var(--fg2);
  letter-spacing: 0.02em;
}
.card .cname {
  font: 12px/1.35 var(--mono);
  color: var(--fg1);
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}
.icons.large .cname,
.icons.xl .cname {
  font-size: 13px;
}
.card .cst {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  min-width: 0;
  font: 12px var(--mono);
  font-variant-numeric: tabular-nums;
  color: var(--fg2);
  white-space: nowrap;
}
.card .cst svg {
  flex: none;
}
.card .cst b {
  font-weight: 600;
  color: var(--fg1);
}
.card .cst .pct,
.card .cst .eta {
  color: var(--fg3);
}
.card .cst .xtra {
  margin-left: auto;
  color: var(--fg3);
}
.card .cst.queued,
.card .cst.canceled,
.card .cst.ready {
  color: var(--fg3);
}
.card .cst.failed {
  align-self: flex-start;
  max-width: 100%;
  padding: 0 6px 0 4px;
  color: var(--inv-fg);
  background: var(--inv-bg);
  font-weight: 600;
}
.card .cst.failed .ct {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* cross-group rows, as .tr.dim in views.css */
.tile.dim .name,
.tile.dim .meta,
.tile.dim .size,
.card.dim .cname {
  color: var(--fg3);
}
.tile.dim .thumb,
.card.dim .thumb {
  opacity: 0.4;
}

/* totals as one line under the non-Details sizes */
.totals.flat {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 0 16px;
}
.totals.flat .res {
  gap: 8px;
}

@media (prefers-reduced-motion: reduce) {
  .card .cck {
    transition: none;
  }
}
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean and green (including `monochrome-source`). Then `npm run dev`, add a few images and a video to Convert, and compare each size (Ctrl+Shift+1..5) with `docs/mockups/view-zoom/shots/04-explorer-style-size0..4.png`: tile/card geometry, group headers, failed pill, `62%(4s)` while a job runs, flat totals; click / Shift+click / Ctrl+click, right-click, double-click and arrow keys work in each size; focus stays on the same item after Ctrl+Shift+3.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/queue src/renderer/src/theme/viewsizes.css src/renderer/src/App.tsx
git commit -m "feat(view): Tiles and icon-grid renderers for the files view" -m "Refs #36" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ctrl+wheel over the files view and the size-change fade

**Files:**
- Modify: `src/renderer/src/components/queue/QueueTable.tsx`, `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `WHEEL_IDLE`, `wheelDelta`, `wheelStep` (Task 1); `view.step` (Task 3); the `section` / `body` refs and the size-change effect (Task 4).
- Produces: `QueueTable` prop `onWheelStep: (step: 1 | -1) => void`.

- [ ] **Step 1: Wheel listener (non-passive, scoped to the section)**

In `QueueTable.tsx` add `onWheelStep` at the end of the destructured props and to the props type:

```ts
  /** Ctrl+wheel over the files view: +1 bigger, -1 smaller. */
  onWheelStep: (step: 1 | -1) => void
```

In `App.tsx`, on `<QueueTable ... />` add:

```tsx
                  onWheelStep={(d) => view.step(d)}
```

In `QueueTable.tsx` extend the `./viewSize` import:

```ts
import { thumbPx, wheelDelta, wheelStep, WHEEL_IDLE, type ViewSize } from './viewSize'
```

and add after the `tabStop` line:

```ts
  // Ctrl+wheel over the files view steps the size (spec 2). React's onWheel is
  // passive, so attach a native listener that may preventDefault. Only this
  // section listens: Ctrl+wheel over the inspector does nothing special.
  const wheelCb = useRef(onWheelStep)
  useEffect(() => {
    wheelCb.current = onWheelStep
  })
  useEffect(() => {
    const el = section.current
    if (!el) return
    let state = WHEEL_IDLE
    const on = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const r = wheelStep(state, wheelDelta(e.deltaY, e.deltaMode), e.timeStamp)
      state = r.state
      if (r.step !== 0) wheelCb.current(r.step)
    }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [])
```

- [ ] **Step 2: Fade on size change**

In the size-change effect from Task 4, after `if (!el) return`, add:

```ts
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      el.animate([{ opacity: 0.25 }, { opacity: 1 }], {
        duration: 150,
        easing: 'cubic-bezier(.2,.7,.2,1)'
      })
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean. `npm run dev`: hold Ctrl and roll the wheel over the list: one size per notch, up = bigger, a quick fade and a flash on the View button; the list does not scroll while Ctrl is held; Ctrl+wheel over the inspector or sidebar leaves the size and the page zoom alone. With Windows "Show animations" off (reduced motion) there is no fade and no flash.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/queue/QueueTable.tsx src/renderer/src/App.tsx
git commit -m "feat(view): Ctrl+wheel over the files view steps the size" -m "Refs #36" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 256px thumbnails for Large and Extra large icons

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `thumbPx` (Task 1); the `bigThumbs` state (Task 4); `window.filesmith.thumbnail(path, size, kind)` (existing preload; main `thumbnail.ts` already honours `size`).
- Produces: `bigThumbs` filled lazily, keyed by source path.

- [ ] **Step 1: The lazy request effect**

In `App.tsx` import `thumbPx`:

```ts
import { thumbPx, viewKeyFor } from './components/queue/viewSize'
```

give the Task 4 state its setter (`const [bigThumbs, setBigThumbs] = useState<Record<string, string | null>>({})`), and add a request set next to `requested` / `outRequested` (around line 130):

```ts
  const bigRequested = useRef<Set<string>>(new Set())
```

and after the existing output-thumbnail effect (around line 266):

```ts
  // Large / Extra large icons want 256px thumbnails (spec 5). Asked lazily, once
  // per path, only for the current queue while such a size is shown; the 128px
  // one stays on screen until it arrives, and a failure keeps it.
  useEffect(() => {
    const px = thumbPx(view.size)
    if (px <= 128) return
    for (const item of cur.items) {
      const p = item.file.path
      if (!inInput(item) || bigRequested.current.has(p)) continue
      bigRequested.current.add(p)
      void window.filesmith.thumbnail(p, px, item.file.kind).then((t) => {
        if (t) setBigThumbs((m) => ({ ...m, [p]: t }))
      })
    }
  }, [view.size, cur.items])
```

(`inInput` is already imported in App.tsx; check with `grep -n "inInput" src/renderer/src/App.tsx`.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean. `npm run dev`, add a large photo, switch to Extra large icons: the thumb sharpens shortly after (DevTools Elements: the card `img` src is a longer data URL than in Details). Switching back to Details sends no new requests.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(view): 256px thumbnails for the large icon sizes" -m "Refs #36" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end tests and screenshots

**Files:**
- Create: `e2e/viewsizes.spec.ts`
- Modify: `e2e/ui.spec.ts`, `e2e/visual.spec.ts`

**Interfaces:**
- Consumes: the DOM contract from Tasks 3 and 4: toolbar button named `View: <label>`, menu `role="menu"` named `View` with `menuitemradio` entries, `section[role=grid][data-size]`, rows/tiles/cards as `role="row"` with `data-id` and `aria-selected`, `.insp` inspector.
- Produces: nothing for later tasks.

- [ ] **Step 1: Update the toolbar test**

In `e2e/ui.spec.ts` replace the last test's expectation and title:

```ts
test('the toolbar is Add files and the View menu; row actions live in the right-click menu', async () => {
  const bar = page.getByRole('toolbar', { name: 'File actions' })
  const names = await bar
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim()))
  expect(names).toEqual(['Add files', 'View: Details'])
  await expect(page.getByTestId('stop')).toHaveCount(0)
})
```

- [ ] **Step 2: Write the view-size spec**

`e2e/viewsizes.spec.ts`:

```ts
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIN, ROOT } from './helpers'

// View sizes (spec docs/superpowers/specs/2026-10-05-view-sizes-design.md) on a
// seeded session: four images and a video, so there are two group headers.
let app: ElectronApplication
let page: Page
let userData: string

const FILES: [string, string, string][] = [
  ['alpha.png', '.png', 'image'],
  ['bravo.png', '.png', 'image'],
  ['charlie.png', '.png', 'image'],
  ['delta.png', '.png', 'image'],
  ['clip.mp4', '.mp4', 'video']
]

test.beforeAll(async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  userData = mkdtempSync(join(tmpdir(), 'filesmith-view-'))
  const dir = join(userData, 'files')
  mkdirSync(dir)
  const items = FILES.map(([name, ext, kind], i) => {
    const path = join(dir, name)
    writeFileSync(path, 'not really media')
    return { id: `v-${i}`, file: { path, name, ext, kind, size: 16 }, thumb: null, status: 'ready', percent: 0 }
  })
  const session = { version: 2, lastTool: null, options: {}, genResults: [], queues: { convert: { items } } }
  writeFileSync(join(userData, 'session.json'), JSON.stringify(session))
  app = await _electron.launch({ args: [ROOT], env: { ...process.env, FILESMITH_USER_DATA: userData } })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await expect(row('alpha')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  if (userData) rmSync(userData, { recursive: true, force: true })
})

const grid = () => page.getByRole('grid', { name: 'Files' })
const row = (name: string) => grid().getByRole('row', { name: new RegExp(name) })
const viewBtn = () => page.getByRole('button', { name: /^View: / })
const sizeIs = (s: string) => expect(grid()).toHaveAttribute('data-size', s)
const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())

async function ctrlWheel(x: number, y: number, dy: number): Promise<void> {
  await page.mouse.move(x, y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, dy)
  await page.keyboard.up('Control')
  // One step per 90ms at most: let the next notch count.
  await page.waitForTimeout(150)
}

test('the View menu lists the five sizes and picks one', async () => {
  await sizeIs('details')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Details')
  await viewBtn().click()
  const menu = page.getByRole('menu', { name: 'View' })
  const items = menu.getByRole('menuitemradio')
  await expect(items).toHaveText([
    /Details\s*Ctrl\+Shift\+1/,
    /Tiles\s*Ctrl\+Shift\+2/,
    /Medium icons\s*Ctrl\+Shift\+3/,
    /Large icons\s*Ctrl\+Shift\+4/,
    /Extra large icons\s*Ctrl\+Shift\+5/
  ])
  await expect(items.first()).toHaveAttribute('aria-checked', 'true')
  await expect(items.first()).toBeFocused()
  await items.nth(3).click()
  await expect(menu).toHaveCount(0)
  await sizeIs('large')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Large icons')
  // Group headers stay, one per convert group.
  await expect(grid().getByRole('gridcell', { name: /IMAGES/ })).toBeVisible()
  await expect(grid().getByRole('gridcell', { name: /VIDEO/ })).toBeVisible()
  await page.keyboard.press('Control+0')
  await sizeIs('details')
})

test('Ctrl+wheel over the list steps the size; over the inspector it does nothing', async () => {
  const g = (await grid().boundingBox())!
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, -100)
  await sizeIs('tiles')
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, -100)
  await sizeIs('medium')
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, 100)
  await sizeIs('tiles')
  const insp = (await page.locator('.insp').boundingBox())!
  await ctrlWheel(insp.x + insp.width / 2, insp.y + insp.height / 2, -100)
  await sizeIs('tiles')
  expect(await zoom()).toBe(1)
  await page.keyboard.press('Control+0')
})

test('keyboard shortcuts change the size without zooming the page', async () => {
  await page.keyboard.press('Control+Shift+Digit2')
  await sizeIs('tiles')
  await page.keyboard.press('Control+=')
  await sizeIs('medium')
  await page.keyboard.press('Control+-')
  await sizeIs('tiles')
  await page.keyboard.press('Control+Shift+Digit5')
  await sizeIs('xl')
  await page.keyboard.press('Control+=')
  await sizeIs('xl')
  await page.keyboard.press('Control+0')
  await sizeIs('details')
  await page.keyboard.press('Control+-')
  await sizeIs('details')
  expect(await zoom()).toBe(1)
})

test('a size change keeps focus on the same item', async () => {
  await row('bravo').click()
  await page.keyboard.press('Control+Shift+Digit3')
  await sizeIs('medium')
  await expect(page.locator('[data-id="v-1"]')).toBeFocused()
  await page.keyboard.press('Control+0')
  await expect(page.locator('[data-id="v-1"]')).toBeFocused()
})

test('selection, the right-click menu and arrow keys work in an icon grid', async () => {
  await page.keyboard.press('Control+Shift+Digit3')
  await row('alpha').click()
  await row('charlie').click({ modifiers: ['Shift'] })
  for (const n of ['alpha', 'bravo', 'charlie']) await expect(row(n)).toHaveAttribute('aria-selected', 'true')
  await expect(row('delta')).toHaveAttribute('aria-selected', 'false')
  await row('bravo').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Remove 3 from list' })).toBeVisible()
  await page.keyboard.press('Escape')
  // One-group rule: Ctrl+click on the video moves the selection to it.
  await row('clip').click({ modifiers: ['Control'] })
  await expect(row('clip')).toHaveAttribute('aria-selected', 'true')
  await expect(row('alpha')).toHaveAttribute('aria-selected', 'false')
  // Arrow keys walk the grid.
  await row('alpha').click()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-id="v-1"]')).toBeFocused()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(row('charlie')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+0')
})

test('the chosen size survives a reload', async () => {
  await page.keyboard.press('Control+Shift+Digit4')
  await sizeIs('large')
  await page.reload()
  await expect(row('alpha')).toBeVisible()
  await sizeIs('large')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Large icons')
  await page.keyboard.press('Control+0')
})
```

- [ ] **Step 3: Screenshots of every size (opt-in)**

In `e2e/visual.spec.ts` add after the existing test:

```ts
test('capture each view size next to the view-zoom mockup', async () => {
  const VZ = join(ROOT, 'docs', 'mockups', 'view-zoom', 'shots')
  await page.getByRole('navigation', { name: 'Operations' }).getByRole('button', { name: 'Convert' }).click()
  await page.getByRole('row', { name: /beach-panorama/ }).click()
  for (let n = 1; n <= 5; n++) {
    await page.keyboard.press(`Control+Shift+Digit${n}`)
    await expect(page.getByRole('grid', { name: 'Files' })).toHaveAttribute(
      'data-size',
      ['details', 'tiles', 'medium', 'large', 'xl'][n - 1]
    )
    // Let the fade, the flash and any 256px thumbnails settle.
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(VZ, `impl-size${n - 1}.png`) })
  }
  await page.keyboard.press('Control+Shift+Digit2')
  await page.getByRole('button', { name: /^View: / }).click()
  await expect(page.getByRole('menu', { name: 'View' })).toBeVisible()
  await page.screenshot({ path: join(VZ, 'impl-menu.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+0')
})
```

- [ ] **Step 4: Run the e2e suites**

```bash
pwsh -NoProfile -Command "Get-Process Filesmith -ErrorAction SilentlyContinue | Stop-Process -Force"
npm run build
npx playwright test e2e/viewsizes.spec.ts e2e/ui.spec.ts e2e/rowmenu.spec.ts e2e/workflows.spec.ts
```

Expected: all pass. Then the shots:

```bash
FILESMITH_SHOTS=1 npx playwright test e2e/visual.spec.ts
```

Expected: `docs/mockups/view-zoom/shots/impl-size0..4.png` and `impl-menu.png` written. Open each next to `04-explorer-style-size0..4.png` and `04-explorer-style-menu.png` and fix any visible mismatch (spacing, glyphs, totals) in `viewsizes.css` before committing. If the visual run also rewrites `docs/mockups/terminal-v5/shots/impl-*.png` with no visible change, restore those with `git checkout -- docs/mockups/terminal-v5/shots`.

- [ ] **Step 5: Commit**

```bash
git add e2e/viewsizes.spec.ts e2e/ui.spec.ts e2e/visual.spec.ts docs/mockups/view-zoom/shots/impl-*.png
git commit -m "test(view): e2e for view sizes and screenshots of each size" -m "Refs #36" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Version 0.7.0, docs and the full gate

**Files:**
- Modify: `package.json`, `package-lock.json`, `test/no-em-dash.test.ts`, `docs/design/redesign-direction.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the finished branch.

- [ ] **Step 1: Em-dash guard covers the new files**

In `test/no-em-dash.test.ts` append to `TARGETS`:

```ts
  'src/renderer/src/components/queue',
  'src/renderer/src/theme/viewsizes.css',
  'e2e/viewsizes.spec.ts',
  'docs/superpowers/specs/2026-10-05-view-sizes-design.md',
  'docs/superpowers/plans/2026-10-05-view-sizes.md'
```

Run: `npx vitest run test/no-em-dash.test.ts`
Expected: PASS. If an older queue file contains U+2014, replace it with an en-dash, comma or colon (the rule is "no em-dashes anywhere").

- [ ] **Step 2: Version bump**

Run: `npm version 0.7.0 --no-git-tag-version`
Expected: `package.json` and both version fields in `package-lock.json` read `0.7.0`; `git diff --stat` shows only those two files.

- [ ] **Step 3: Docs**

`docs/design/redesign-direction.md`, append:

```md
- View sizes (2026-10-05): the files view has Explorer-style sizes (Details, Tiles, Medium / Large / Extra
  large icons), Ctrl+wheel and a View menu. Chosen: `docs/mockups/view-zoom/04-explorer-style.html`; spec
  `docs/superpowers/specs/2026-10-05-view-sizes-design.md`.
```

`CLAUDE.md`, under "Design process", after the signed-off redesign line, add:

```md
**View sizes (2026-10-05):** `docs/mockups/view-zoom/04-explorer-style.html`; spec `docs/superpowers/specs/2026-10-05-view-sizes-design.md`.
```

- [ ] **Step 4: Full gate**

```bash
pwsh -NoProfile -Command "Get-Process Filesmith -ErrorAction SilentlyContinue | Stop-Process -Force"
npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e
```

Expected: all green. Any failure is fixed in the task that owns the code, then re-run the whole gate.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json test/no-em-dash.test.ts docs/design/redesign-direction.md CLAUDE.md
git commit -m "chore(release): 0.7.0, view-size docs and em-dash guard" -m "Refs #36" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
