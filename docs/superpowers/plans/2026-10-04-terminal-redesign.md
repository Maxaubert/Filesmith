# Terminal Redesign (S2 "VS Code grouped") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Filesmith renderer to match the signed-off mockup `docs/mockups/terminal-v5/10-s2-vscode-grouped.html`: a dark, strictly monochrome, square, flush-panel workbench (title bar with breadcrumb, collapsible sidebar, files table, Options / Preview / Info inspector, status bar), with every existing behaviour kept.

**Architecture:** Pure view logic (row model, totals, sorting, select-all, size estimates, breadcrumbs, status summary, keyboard maps) lands first in `.ts` files with Vitest tests. Then a token layer (`theme/*.css`, CSS custom properties mirrored into Tailwind v4 `@theme`) and a 16px icon registry, then `components/ui/` primitives, and finally the shell, queue table, inspector, options split and remaining views are rebuilt on top. Main-process changes are limited to the spec's M1 to M5 plus one additive preload method (`pickFolder`).

**Tech Stack:** Electron 43, React 19, TypeScript strict, Vite via electron-vite 5, Tailwind CSS v4, Vitest 3, Playwright `_electron`, `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`.

**Spec:** `docs/superpowers/specs/2026-10-04-terminal-redesign-design.md` (design rules and feedback trail: `docs/design/redesign-direction.md`; target: `docs/mockups/terminal-v5/10-s2-vscode-grouped.html`, screenshot `docs/mockups/terminal-v5/shots/10-s2-vscode-grouped.png`).

## Global Constraints

- **Dark only.** No `dark:` variants, no theme toggle, no `prefers-color-scheme` branch. Every colour is a CSS custom property defined once in `src/renderer/src/theme/tokens.css`.
- **Strict monochrome.** Every colour has r=g=b. Errors, warnings and danger actions use a glyph, weight 600 and inverted fill, never red, green or amber. This includes the window close button, the former per-verb rail colours and `GROUP_COLOR`. The one exception is the Remove BG custom-colour swatch, which shows user data.
- **Token values, verbatim:** `--bg-0 #0a0a0a`, `--bg-1 #0f0f0f`, `--hover #1a1a1a`, `--selected #202020`, `--field #141414`, `--track #2a2a2a`, `--line #262626`, `--line-strong #3a3a3a`, `--fg1 #ededed`, `--fg2 #b4b4b4`, `--fg3 #8c8c8c`, `--fg-disabled #5c5c5c`, `--inv-bg #ededed`, `--inv-fg #0a0a0a`, `--inv-hover #ffffff`, `--inv-active #bdbdbd`, `--focus #ededed`.
- **Square and flush.** `border-radius: 0` globally, 1px borders only, no shadows, no cards except the estimate box. 2px `--fg1` bars mark active items.
- **Type:** `--sans: "IBM Plex Sans", system-ui, sans-serif`, `--mono: "IBM Plex Mono", Consolas, monospace`, weights 400/500/600, bundled through `@fontsource` (no Google Fonts; CSP stays as is). Body `13px/1.4 var(--sans)`. Numbers use `tabular-nums`.
- **Fixed heights:** 32 title bar / sidebar head / toolbar / tab bar / table row / info row; 28 table head / select / input / segment / in-row button; 36 sidebar item; 30 totals; 48 primary footer; 24 status bar.
- **No drop row, no progress bar under a row.** Progress reads `62%(4s)` in the status column. The whole window accepts drops.
- **Controls read as buttons** (boxed, outlined or inverted). No underlined or dotted words as controls.
- **Avoid Wind's signatures:** no floating progress-plus-button pill, no icon-tile header band, no big rounded cards of right-aligned setting rows.
- **No em-dashes anywhere**: code, comments, copy, commit messages, PR text. Use commas, en-dashes or rephrase.
- **Renderer stays browser-only.** No `fs` or `child_process` in `src/renderer`. The preload API is additive only (`pickFolder`); no existing `window.filesmith.*` method changes signature.
- **Never overwrite** a source or an existing output. Output paths still come from `reserveOutPath` / `reserveFileInDir` / `uniqueOutDir`.
- **State semantics are frozen.** Existing reducer actions, `queueKey`, `optionsKey` and the v2 session schema keep their meaning. New actions are additive.
- **React Fast Refresh rule:** `.tsx` files export components only. Pure helpers live in sibling `.ts` files so Vitest can import them.
- **Tests:** unit tests in `test/*.test.ts` (renderer modules imported by relative path `../src/renderer/src/...`, shared through `@shared/...`); e2e in `e2e/*.spec.ts`.
- **Owner checks O1 to O10** in spec section 5 are built as proposed there; they are approved together with this plan (O10 is the run scope, see Task 12). O7 resolution: ship OUTPUT > Location (M3); show FILES > If file exists as a fixed, disabled select reading `add (2)`; defer Naming and Keep metadata.
- **Delivery:** one issue, one branch `feat/<issue>-terminal-redesign`, one PR. Never merge without the owner's explicit "merge" for this PR. Version bump to `0.5.0` inside the PR.
- **Deleting files:** `trash "<absolute path>"` for anything outside this session's scratchpad (global rule); `git rm` for tracked files being removed by the change.

## Review Focus

- **Output folder removed between choosing it and pressing Run:** the job must fail with "Output folder not found" and must never fall back to writing somewhere else. Pinned in Task 3.
- **Zero-byte source or folder output:** the result cell must not show `NaN%` or `-100%`; a folder output shows `folder` and no percentage, a zero-byte source shows no percentage. Pinned in Task 5.
- **Re-running a row and restoring an old session:** a source re-queued in place must drop its previous `outputSize` / `outputPath`, and a `done` source restored from a pre-0.5 session (no `outputPath` on the source) must render `Done` with an empty result cell, not a crash or a stale value. Pinned in Tasks 4 and 5.
- **Header checkbox in a mixed queue:** with a selection in group B it selects all of B and nothing else; with no selection it acts on the first group in display order; it never produces a cross-group selection. Pinned in Task 6.
- **Estimator with nothing to go on:** unknown formats, audio without a bitrate, and zero-byte sources must yield `null` (empty cell, card hidden), never `0` or `NaN`; a batch with some non-estimable rows sums only the estimable ones and says how many. Pinned in Task 7.

## File Structure

```
src/main/
  index.ts                     M1 window size, nativeTheme, bg; M4 FILESMITH_USER_DATA
  windowSize.ts          NEW   initialWindowSize(workArea) (pure)
  ipc.ts                       + 'files:pick-folder'
  output.ts                    reserveOutPath(..., outDir?) + resolveOutDir()
  jobQueue.ts                  ctx.outDir from options.outDir
  tools/tool.ts                ToolContext.outDir
  tools/estimate.ts            onPct(pct, etaSec)
  tools/registry.ts            pass ctx.outDir to every reserve/unique call; forward eta
src/preload/index.ts           + pickFolder()
src/shared/
  icons.ts               NEW   ICON_NAMES, IconName
  sizeEstimate.ts        NEW   estimateOutputBytes, medianRatio, estimateBatch
  tabs.ts                      icon: IconName, SETTINGS_TAB, colour fields removed (Task 16)
src/renderer/src/
  index.css                    imports theme/*, Tailwind @theme mirror
  main.tsx                     font imports
  state.ts                     source->result link, select order, selectIds, hideFinished
  theme/tokens.css       NEW   the only colour literals
  theme/base.css         NEW   reset, focus, scrollbars, app grid, motion
  theme/workbench.css    NEW   ported mockup component CSS
  theme/controls.css     NEW   new controls: chips, range, popup, progress, disabled
  theme/views.css        NEW   group rows, empty states, tools list, generate grid, menu, dialog, wipe
  components/icons/      NEW   Icon.tsx, shapes.ts
  components/ui/         NEW   Button, Checkbox, Segmented, Select, TextField, Setting, RangeField,
                               ChipGrid, ProgressBar, Tabs, EstimateCard, OutputSizeList,
                               roving.ts, selectNav.ts
  components/shell/      NEW   TitleBar, Breadcrumb, Sidebar, StatusBar, crumbs.ts, sidebarState.ts,
                               useSidebar.ts, railPrefs.ts, statusModel.ts, shortcuts.ts
  components/queue/      NEW   QueueToolbar, QueueTable, QueueRow, StatusCell, ResultCell, TotalsRow,
                               EmptyState, rowModel.ts, tableSort.ts, selectAll.ts, tableKeys.ts
  components/inspector/  NEW   Inspector, PreviewPane, InfoPane, Wipe, infoModel.ts
  components/options/    NEW   OptionsPane + one file per verb + generate/ + upscale/
  components/views/      NEW   GenerateView, ToolsView, CompletedView, SettingsView
  components/            DEL   TopBar, TabRail, OperationTitle, DropZone, Queue, OptionsPanel,
                               ToolsGrid, PromptBox, CompletedView (old), Icon (old)
test/                          new *.test.ts per pure module
e2e/                           selector updates, ui.spec.ts, visual.spec.ts
```

The app will look half-converted between Tasks 8 and 16. That is expected on the branch; each task still passes `npm test`, `npm run typecheck` and `npm run lint`.

---

### Task 0: Issue, branch and design record

**Files:**

- Add (currently untracked): `docs/design/redesign-direction.md`, `docs/mockups/terminal/`, `docs/mockups/terminal-v2/`, `docs/mockups/terminal-v3/`, `docs/mockups/terminal-v4/`, `docs/mockups/terminal-v5/`, `docs/superpowers/specs/2026-10-04-terminal-redesign-design.md`, `docs/superpowers/plans/2026-10-04-terminal-redesign.md`

**Interfaces:**

- Consumes: nothing.
- Produces: branch `feat/<N>-terminal-redesign` where `<N>` is the new issue number. Every later commit lands here.

- [ ] **Step 1: Create the issue**

```bash
gh issue create --title "Terminal redesign (S2 VS Code grouped)" --body "Rebuild the renderer to match docs/mockups/terminal-v5/10-s2-vscode-grouped.html. Spec: docs/superpowers/specs/2026-10-04-terminal-redesign-design.md. Plan: docs/superpowers/plans/2026-10-04-terminal-redesign.md."
```

Note the issue number `<N>` it prints.

- [ ] **Step 2: Branch from an up-to-date main**

```bash
git switch main && git pull --ff-only
git switch -c feat/<N>-terminal-redesign
```

- [ ] **Step 3: Commit the design record**

`CLAUDE.md` has an uncommitted owner edit; leave it unstaged here. Task 18 edits `CLAUDE.md` and commits both together.

```bash
git add docs/design/redesign-direction.md docs/mockups/terminal docs/mockups/terminal-v2 docs/mockups/terminal-v3 docs/mockups/terminal-v4 docs/mockups/terminal-v5 docs/superpowers/specs/2026-10-04-terminal-redesign-design.md docs/superpowers/plans/2026-10-04-terminal-redesign.md
git commit -m "docs(design): terminal redesign direction, mockups, spec and plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Window defaults, dark native theme, test userData override, folder picker (M1, M4)

**Files:**

- Create: `src/main/windowSize.ts`
- Modify: `src/main/index.ts:1` (imports), `src/main/index.ts:134-148` (`createWindow`), top-level before `requestSingleInstanceLock`
- Modify: `src/main/ipc.ts` (after the `'files:pick'` handler at `:161-167`)
- Modify: `src/preload/index.ts:21-23` (next to `pickFiles` / `pickImage`)
- Test: `test/window-size.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `initialWindowSize(work: { width: number; height: number }): { width: number; height: number }`; `MIN_WINDOW = { width: 1100, height: 640 }`; `window.filesmith.pickFolder(): Promise<string | null>`; env `FILESMITH_USER_DATA` (absolute folder) redirects `userData` when set.

- [ ] **Step 1: Write the failing test**

```ts
// test/window-size.test.ts
import { describe, expect, it } from 'vitest'
import { initialWindowSize, MIN_WINDOW } from '../src/main/windowSize'

describe('initialWindowSize', () => {
  it('uses 1440x900 when the work area is larger', () => {
    expect(initialWindowSize({ width: 2560, height: 1400 })).toEqual({ width: 1440, height: 900 })
  })

  it('shrinks to the work area on a small display', () => {
    expect(initialWindowSize({ width: 1366, height: 728 })).toEqual({ width: 1366, height: 728 })
  })

  it('never goes below the minimum, even on a tiny display', () => {
    expect(initialWindowSize({ width: 1024, height: 600 })).toEqual(MIN_WINDOW)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/window-size.test.ts`
Expected: FAIL, cannot resolve `../src/main/windowSize`.

- [ ] **Step 3: Implement**

```ts
// src/main/windowSize.ts
// The redesign's table needs about 1440px to give the name column room
// (spec section 3.7). Clamp to the display so a small laptop still fits.

export const DEFAULT_WINDOW = { width: 1440, height: 900 }
export const MIN_WINDOW = { width: 1100, height: 640 }

export function initialWindowSize(work: { width: number; height: number }): {
  width: number
  height: number
} {
  return {
    width: Math.max(MIN_WINDOW.width, Math.min(DEFAULT_WINDOW.width, work.width)),
    height: Math.max(MIN_WINDOW.height, Math.min(DEFAULT_WINDOW.height, work.height))
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/window-size.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into `createWindow`, set the dark native theme, add the userData override**

In `src/main/index.ts` change the electron import to:

```ts
import { app, nativeTheme, protocol, screen, shell, BrowserWindow } from 'electron'
import { initialWindowSize, MIN_WINDOW } from './windowSize'
```

Directly after the imports (before any `app.requestSingleInstanceLock()` call and before `app.whenReady`), add:

```ts
// Test hook (spec M4): e2e points userData at a temp folder to seed a session.
// Read only when set, so a normal launch is unaffected.
const userDataOverride = process.env['FILESMITH_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)
```

Replace the `new BrowserWindow({...})` options head in `createWindow()` with:

```ts
// Dark only: native scrollbars, dialogs and the pre-paint fill follow the app.
nativeTheme.themeSource = 'dark'
const size = initialWindowSize(screen.getPrimaryDisplay().workAreaSize)
const mainWindow = new BrowserWindow({
  width: size.width,
  height: size.height,
  minWidth: MIN_WINDOW.width,
  minHeight: MIN_WINDOW.height,
  show: false,
  // Frameless: the renderer draws the 32px title bar and window controls.
  frame: false,
  backgroundColor: '#0a0a0a',
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false
  }
})
```

- [ ] **Step 6: Add the folder picker (OUTPUT > Location needs it)**

In `src/main/ipc.ts`, after the `'files:pick'` handler:

```ts
// Output folder for OUTPUT > Location. Additive: no existing channel changes.
ipcMain.handle('files:pick-folder', async (e) => {
  const r = await openDialog(e, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory']
  })
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
})
```

In `src/preload/index.ts`, after `pickImage`:

```ts
  /** Folder picker for the output location; resolves to the path or null. */
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('files:pick-folder'),
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

Run: `npm run dev`, check the window opens at 1440x900 (or the work area) with a near-black fill before the renderer paints, then close it.

- [ ] **Step 8: Commit**

```bash
git add src/main/windowSize.ts src/main/index.ts src/main/ipc.ts src/preload/index.ts test/window-size.test.ts
git commit -m "feat(main): dark window defaults, 1440x900 clamp, userData test hook, folder picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Remaining-seconds estimate for ticker-driven jobs (M2)

**Files:**

- Modify: `src/main/tools/estimate.ts:19-47`
- Modify: `src/main/tools/registry.ts:118`, `:442`, `:595`, `:724-730`, `:990`, `:1307-1309`
- Test: `test/estimate.test.ts` (extend)

**Interfaces:**

- Consumes: `ToolContext.onProgress(percent, message?, etaSec?)` from `src/main/tools/tool.ts:7` (unchanged).
- Produces: `estimateProgress(expectedSec, onPct: (pct: number, etaSec: number | null) => void, opts)`. `etaSec` is `ceil(expectedSec - elapsed)` while positive, otherwise `null` (the row then shows `62%` without a bracket).

- [ ] **Step 1: Write the failing test** (append to `test/estimate.test.ts`)

```ts
describe('estimateProgress remaining seconds', () => {
  it('counts down from the expected duration and goes null once overdue', () => {
    vi.useFakeTimers()
    const etas: (number | null)[] = []
    const t = estimateProgress(2, (_p, eta) => etas.push(eta))
    expect(etas[0]).toBe(2) // 2 - 0.2 = 1.8, rounded up
    vi.advanceTimersByTime(1000) // elapsed 1.2s
    expect(etas[etas.length - 1]).toBe(1)
    vi.advanceTimersByTime(2000) // elapsed 3.2s, past the estimate
    expect(etas[etas.length - 1]).toBeNull()
    t.stop()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/estimate.test.ts`
Expected: FAIL, `etas[0]` is `undefined`.

- [ ] **Step 3: Implement** (in `estimate.ts`)

Change the callback type and the tick:

```ts
export function estimateProgress(
  expectedSec: number,
  onPct: (pct: number, etaSec: number | null) => void,
  opts: { ceiling?: number; startPct?: number } = {}
): EstimateTicker {
```

and inside `tick`:

```ts
const pct = startPct + (ceiling - startPct) * (1 - Math.exp(-elapsed / tau))
// The same expected duration that shapes the curve doubles as an ETA, so
// image, PDF and rembg rows can show 62%(4s) like ffmpeg rows do.
const left = expectedSec - elapsed
onPct(Math.min(ceiling, pct), left > 0 ? Math.ceil(left) : null)
```

- [ ] **Step 4: Forward the ETA at every caller in `registry.ts`**

Replace each `(p) => ctx.onProgress(p)` passed to `estimateProgress` with `(p, eta) => ctx.onProgress(p, undefined, eta)` (lines 118, 442, 595, 990). For the PiD ticker at `:724-730`:

```ts
est = estimateProgress(
  expectedSec,
  (p, eta) => {
    lastPct = p
    ctx.onProgress(p, undefined, eta)
  },
  { startPct: lastPct }
)
```

For the archive from-pdf ticker at `:1307-1309`, which caps the estimate at 90%:

```ts
const est = estimateProgress(estimateSecForBytes(file.size, 0.15), (p, eta) =>
  ctx.onProgress(Math.min(p, 90), undefined, eta)
)
```

Check with `grep -n "estimateProgress(" src/main/tools/registry.ts` that all six call sites now take `(p, eta)`.

`message` stays `undefined`, and the reducer already keeps the last message on a percent-only update (`state.ts:647`). A `null` ETA reaches the renderer as `undefined` (`jobQueue.ts:99`); Task 4 makes the reducer drop the previous ETA in that case, so an overdue row shows `62%` and not a frozen `(1s)`.

- [ ] **Step 5: Verify**

Run: `npx vitest run test/estimate.test.ts && npm run typecheck && npm run lint`
Expected: PASS, typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/tools/estimate.ts src/main/tools/registry.ts test/estimate.test.ts
git commit -m "feat(engine): report remaining seconds from the estimated-progress ticker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Optional output folder (M3, OUTPUT > Location)

**Files:**

- Modify: `src/main/output.ts`
- Modify: `src/main/tools/tool.ts:4-8`
- Modify: `src/main/jobQueue.ts:89-100`
- Modify: `src/main/tools/registry.ts` (every `reserveOutPath(file.path, ...)` and `uniqueOutDir(dirname(file.path), ...)`)
- Test: `test/output.test.ts` (extend)

**Interfaces:**

- Consumes: `JobOptions.outDir?: string` (new optional key; empty string or absent means next to the source).
- Produces: `reserveOutPath(sourcePath: string, ext: string, tag: string, outDir?: string): string`; `resolveOutDir(value: unknown): string | undefined` (throws `Error('Output folder not found: <path>')` when set but missing); `ToolContext.outDir?: string`.

Every tool helper already has `ctx` in scope (they all call `ctx.onProgress`), so threading the folder through the context reaches the Comfy, ncnn and PiD helpers that never see `options`.

- [ ] **Step 1: Write the failing tests** (append to `test/output.test.ts`; reuse that file's temp-dir setup and imports, adding `resolveOutDir` to the `../src/main/output` import and `mkdtempSync`, `mkdirSync`, `writeFileSync`, `existsSync` from `fs`, `join` from `path`, `tmpdir` from `os` if not already imported)

```ts
describe('output folder', () => {
  it('reserves the output in the chosen folder, not next to the source', () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-outdir-'))
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir)
    mkdirSync(outDir)
    const src = join(srcDir, 'a.png')
    writeFileSync(src, 'x')
    const out = reserveOutPath(src, '.webp', 'converted', outDir)
    expect(out).toBe(join(outDir, 'a.webp'))
    expect(existsSync(join(srcDir, 'a.webp'))).toBe(false)
  })

  it('keeps collision safety inside the chosen folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-outdir-'))
    writeFileSync(join(root, 'a.webp'), 'existing')
    const out = reserveOutPath(join(root, 'elsewhere', 'a.png'), '.webp', 'converted', root)
    expect(out).toBe(join(root, 'a (converted).webp'))
  })

  it('treats an empty or missing option as next to the source', () => {
    expect(resolveOutDir(undefined)).toBeUndefined()
    expect(resolveOutDir('')).toBeUndefined()
  })

  it('refuses a folder that no longer exists instead of writing elsewhere', () => {
    const gone = join(tmpdir(), `fs-gone-${Date.now()}`)
    expect(() => resolveOutDir(gone)).toThrow(/Output folder not found/)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/output.test.ts`
Expected: FAIL, `resolveOutDir` is not exported and the first test writes next to the source.

- [ ] **Step 3: Implement in `output.ts`**

```ts
/** Atomically-reserved output with a new extension: next to the source, or in
 * `outDir` when the user chose an output folder. Collision rules are identical. */
export function reserveOutPath(
  sourcePath: string,
  ext: string,
  tag: string,
  outDir?: string
): string {
  const dir = outDir ?? dirname(sourcePath)
  const name = basename(sourcePath, extname(sourcePath))
  return reserveFileInDir(dir, name, ext, tag)
}

/** The job's output folder from `options.outDir`, or undefined for "next to
 * source". A folder that has gone missing is an error: silently writing next to
 * the source would put files where the user did not ask for them. */
export function resolveOutDir(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  if (!existsSync(value)) throw new Error(`Output folder not found: ${value}`)
  return value
}
```

- [ ] **Step 4: Thread it through the context**

`src/main/tools/tool.ts`, inside `ToolContext`:

```ts
  /** Folder chosen under OUTPUT > Location; undefined means next to the source. */
  outDir?: string
```

`src/main/jobQueue.ts`, in `execute()` (add `resolveOutDir` to an `import { resolveOutDir } from './output'`):

```ts
      const file = fileInfoFromPath(req.input)
      const outDir = resolveOutDir(req.options.outDir)
      const output = await tool.run(file, req.options, {
        signal: ctrl.signal,
        outDir,
        onProgress: (percent, message, etaSec) =>
```

`resolveOutDir` throwing lands in the existing `catch`, which emits `failed` with the message.

- [ ] **Step 5: Pass `ctx.outDir` at every reserve site in `registry.ts`**

Run these two mechanical replacements, then read every changed line:

```bash
sed -i -E "s/reserveOutPath\(file\.path, ([^)]*)\)/reserveOutPath(file.path, \1, ctx.outDir)/" src/main/tools/registry.ts
sed -i -E "s/uniqueOutDir\(dirname\(file\.path\),/uniqueOutDir(ctx.outDir ?? dirname(file.path),/" src/main/tools/registry.ts
grep -n "reserveOutPath\|uniqueOutDir" src/main/tools/registry.ts
```

Expected: every call ends in `ctx.outDir)` or starts with `ctx.outDir ??`. The multi-line `uniqueOutDir(` at `:432-433` and `:1164-1165` puts `dirname(file.path),` on its own line; edit those two by hand to `ctx.outDir ?? dirname(file.path),`. `src/main/generate/index.ts:120` is left alone (Generate has no Location setting).

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green, including the existing `registry*.test.ts` and `percent-paths.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/main/output.ts src/main/tools/tool.ts src/main/jobQueue.ts src/main/tools/registry.ts test/output.test.ts
git commit -m "feat(engine): optional output folder with unchanged collision safety

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: State additions: source-to-result link, ordered range, explicit selection, clear finished, Settings tab id

**Files:**

- Modify: `src/renderer/src/state.ts` (`Action` union `:167-179`, `selectInQueue` `:419-455`, `markQueued` `:578-596`, `jobEvent` done branch `:604-637`)
- Modify: `src/shared/tabs.ts` (`TabId` `:17-18`, `COMPLETED_TAB` `:100-108`, `tabById` `:223-226`)
- Test: `test/queues.test.ts`, `test/verb-state.test.ts`, `test/tabs.test.ts` (extend)

**Interfaces:**

- Consumes: existing `reducer`, `initialState`, `QueueItem`.
- Produces:
  - Action `{ type: 'select'; id: string; mode: SelectMode; order?: string[] }`: `order` is the visible id order for range selection.
  - Action `{ type: 'selectIds'; ids: string[] }`: replaces the current workspace selection; anchor becomes `ids[0] ?? null`.
  - Action `{ type: 'hideFinished' }`: sets `hiddenInput` on `done` and `canceled` input rows of the current workspace.
  - On a `done` job event the source row gains `outputPath` and `outputSize`; `markQueued` clears both, and `etaSec`.
  - A `running` event that carries a percent but no `etaSec` clears the stored `etaSec` (it used to keep the previous value forever, which would freeze `62%(1s)` once a ticker runs past its estimate).
  - `TabId` gains `'settings'`; `SETTINGS_TAB: Tab`; `tabById('settings')` returns it.

- [ ] **Step 1: Write the failing tests**

Append to `test/queues.test.ts`:

```ts
describe('source to result link', () => {
  it('writes the output path and size onto the source when its job finishes', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')], key: CONVERT })
    const id = s.queues[CONVERT]!.items[0].id
    s = reducer(s, {
      type: 'jobEvent',
      event: { id, status: 'done', outputPath: 'C:/x/a.webp', outputSize: 4 }
    })
    const src = s.queues[CONVERT]!.items.find((i) => i.id === id)!
    expect(src.outputPath).toBe('C:/x/a.webp')
    expect(src.outputSize).toBe(4)
    // The separate result item, which Completed relies on, is still appended.
    expect(s.queues[CONVERT]!.items.filter((i) => i.isResult)).toHaveLength(1)
  })

  it('clears the previous result when the row is queued again in place', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')], key: CONVERT })
    const id = s.queues[CONVERT]!.items[0].id
    s = reducer(s, {
      type: 'jobEvent',
      event: { id, status: 'done', outputPath: 'C:/x/a.webp', outputSize: 4 }
    })
    s = reducer(s, { type: 'markQueued', ids: [id] })
    const src = s.queues[CONVERT]!.items.find((i) => i.id === id)!
    expect(src.outputPath).toBeUndefined()
    expect(src.outputSize).toBeUndefined()
  })
})

describe('compact ETA', () => {
  it('drops a stale ETA on a percent-only update and on re-queue', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')], key: CONVERT })
    const id = s.queues[CONVERT]!.items[0].id
    const eta = (): number | undefined => s.queues[CONVERT]!.items.find((i) => i.id === id)!.etaSec
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'running', percent: 40, etaSec: 4 } })
    expect(eta()).toBe(4)
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'running', message: 'Still going' } })
    expect(eta()).toBe(4) // a message-only update keeps it
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'running', percent: 60 } })
    expect(eta()).toBeUndefined()
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'running', percent: 70, etaSec: 2 } })
    s = reducer(s, { type: 'markQueued', ids: [id] })
    expect(eta()).toBeUndefined()
  })
})

describe('clear finished', () => {
  it('hides done and canceled inputs but keeps their results for Completed', () => {
    let s = reducer(start, {
      type: 'addItems',
      files: [img('a.png'), img('b.png'), img('c.png')],
      key: CONVERT
    })
    const [a, b] = s.queues[CONVERT]!.items.map((i) => i.id)
    s = reducer(s, {
      type: 'jobEvent',
      event: { id: a, status: 'done', outputPath: 'C:/x/a.webp' }
    })
    s = reducer(s, { type: 'jobEvent', event: { id: b, status: 'canceled' } })
    s = reducer(s, { type: 'hideFinished' })
    const q = s.queues[CONVERT]!
    expect(q.items.filter((i) => !i.isResult && !i.hiddenInput).map((i) => i.file.name)).toEqual([
      'c.png'
    ])
    expect(q.items.some((i) => i.isResult && i.outputPath === 'C:/x/a.webp')).toBe(true)
  })
})
```

Append to `test/verb-state.test.ts` (reuse its `img` helper if present, otherwise copy the `img` helper from `test/queues.test.ts`):

```ts
describe('selection in visible order', () => {
  it('ranges over the order the table shows, not insertion order', () => {
    let s = reducer(initialState, {
      type: 'addItems',
      files: [img('a.png'), img('b.png'), img('c.png')],
      key: 'convert'
    })
    const [a, b, c] = s.queues.convert!.items.map((i) => i.id)
    s = reducer(s, { type: 'select', id: c, mode: 'single' })
    // Table sorted c, a, b: shift-click a selects c and a only.
    s = reducer(s, { type: 'select', id: a, mode: 'range', order: [c, a, b] })
    expect(s.queues.convert!.selected.sort()).toEqual([a, c].sort())
  })

  it('selectIds replaces the selection and drops ids outside the queue', () => {
    let s = reducer(initialState, {
      type: 'addItems',
      files: [img('a.png'), img('b.png')],
      key: 'convert'
    })
    const [a, b] = s.queues.convert!.items.map((i) => i.id)
    s = reducer(s, { type: 'selectIds', ids: [b, a, 'nope'] })
    expect(s.queues.convert!.selected).toEqual([b, a])
    expect(s.queues.convert!.anchor).toBe(b)
  })
})
```

Append to `test/tabs.test.ts`:

```ts
import { SETTINGS_TAB } from '@shared/tabs'

describe('settings tab', () => {
  it('is reachable by id but is not one of the seven verbs', () => {
    expect(tabById('settings')).toBe(SETTINGS_TAB)
    expect(TABS.some((t) => t.id === 'settings')).toBe(false)
  })
})
```

(Merge the import into the file's existing `@shared/tabs` import.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/queues.test.ts test/verb-state.test.ts test/tabs.test.ts`
Expected: FAIL (source has no `outputPath`; unknown action types; `SETTINGS_TAB` missing).

- [ ] **Step 3: Implement in `state.ts`**

Action union additions:

```ts
  | { type: 'select'; id: string; mode: SelectMode; order?: string[] }
  | { type: 'selectIds'; ids: string[] }
  | { type: 'hideFinished' }
```

(replace the existing `select` member with the one above).

`selectInQueue` gains an `order` parameter:

```ts
function selectInQueue(q: QueueState, id: string, mode: SelectMode, visible?: string[]): QueueState {
  const known = new Set(q.items.map((i) => i.id))
  // Range follows what the user SEES: the table may be sorted.
  const order = visible ? visible.filter((v) => known.has(v)) : q.items.map((i) => i.id)
```

and the reducer case becomes `return mapQueue(state, (q) => selectInQueue(q, action.id, action.mode, action.order))`.

New reducer cases (before `default`):

```ts
    case 'selectIds':
      return mapQueue(state, (q) => {
        const known = new Set(q.items.filter(inInput).map((i) => i.id))
        const ids = action.ids.filter((id) => known.has(id))
        return { ...q, selected: ids, anchor: ids[0] ?? null }
      })
    case 'hideFinished':
      return mapQueue(state, (q) => {
        const items = q.items.map((i) =>
          !i.isResult && (i.status === 'done' || i.status === 'canceled')
            ? { ...i, hiddenInput: true }
            : i
        )
        const kept = items.filter((i) => inInput(i) || inOutput(i))
        const selectable = new Set(kept.filter(inInput).map((i) => i.id))
        return {
          items: kept,
          selected: q.selected.filter((s) => selectable.has(s)),
          anchor: q.anchor && selectable.has(q.anchor) ? q.anchor : null
        }
      })
```

`markQueued`: next to `outputPath: undefined,` add `outputSize: undefined,` and `etaSec: undefined,`.

Non-done `jobEvent` branch (`state.ts:640-652`): replace `etaSec: e.etaSec ?? i.etaSec,` with

```ts
        // A fresh percent without an ETA means the tool no longer has one
        // (ticker overdue, ffmpeg before its first time stamp): drop the old one.
        etaSec: e.percent != null ? e.etaSec : i.etaSec,
```

`jobEvent` done branch: in the source update object add the link:

```ts
                  ? {
                      ...i,
                      status: 'done' as ItemStatus,
                      percent: 100,
                      message: undefined,
                      error: undefined,
                      // The table shows source -> result on one row (spec 6.1).
                      outputPath: e.outputPath,
                      outputSize: e.outputSize
                    }
```

Check that `mapQueue` acts on the current workspace queue (it does for `select` and `clearSelection` today); `hideFinished` and `selectIds` use it the same way.

- [ ] **Step 4: Implement in `tabs.ts`**

```ts
export type TabId =
  | 'convert'
  | 'compress'
  | 'resize'
  | 'upscale'
  | 'removebg'
  | 'generate'
  | 'tools'
  | 'completed'
  | 'settings'
```

After `COMPLETED_TAB`:

```ts
/** Sidebar layout and tool status. Pinned to the bottom group, not a verb. */
export const SETTINGS_TAB: Tab = {
  id: 'settings',
  label: 'Settings',
  desc: 'Sidebar and tools',
  color: '#6e6e6e',
  icon: 'settings',
  kinds: [],
  tool: 'convert'
}
```

(`color` is removed from every tab in Task 16; it stays here so the type still checks.)

```ts
export function tabById(id: TabId): Tab {
  if (id === 'completed') return COMPLETED_TAB
  if (id === 'settings') return SETTINGS_TAB
  return TABS.find((t) => t.id === id) ?? TABS[0]
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test && npm run typecheck`
Expected: PASS. If `App.tsx` fails typecheck on an exhaustive `switch (state.tab)`, add a `case 'settings':` that falls through to the Completed branch for now; Task 15 gives it its own view.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state.ts src/shared/tabs.ts test/queues.test.ts test/verb-state.test.ts test/tabs.test.ts
git commit -m "feat(state): link sources to results, ordered range, selectIds, clear finished, settings tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Row model (result, status, row action, totals, compact progress)

**Files:**

- Create: `src/renderer/src/components/queue/rowModel.ts`
- Test: `test/row-model.test.ts`

**Interfaces:**

- Consumes: `QueueItem`, `inInput`, `ItemStatus` from `state.ts`; `formatBytes` from `@shared/compress`.
- Produces (all exported from `rowModel.ts`):
  - `formatEtaCompact(sec: number | null | undefined): string` gives `'(4s)'`, `'(2m)'`, `'(1h 5m)'` or `''`.
  - `progressParts(pct: number, etaSec?: number | null): { pct: string; eta: string }` and `formatProgress(pct, etaSec?) => pct + eta` (`formatProgress(62, 4) === '62%(4s)'`).
  - `kindLabel(ext: string): string` gives `'HEIC'`.
  - `pctChange(src: number, out: number): number | null` and `formatPct(n: number): string` (`-80%`, `+12%`, `0%`).
  - `shortError(message: string | undefined): string`.
  - `type RowActionKind = 'reveal' | 'remove' | 'cancel' | 'retry'`
  - `interface RowView { kind: string; size: string; result: ResultView | null; status: StatusView; action: RowActionView }` with
    `ResultView { text: string; pct: string | null; estimate: boolean; grew: boolean }`,
    `StatusView { kind: ItemStatus; text: string; pct?: string; eta?: string; title?: string }`,
    `RowActionView { kind: RowActionKind; icon: 'folder' | 'close' | 'retry'; label: string; ghost: boolean }`.
  - `rowView(item: QueueItem, estimateBytes?: number | null): RowView`
  - `interface Totals { files: number; bytes: number; doneSrc: number; doneOut: number; done: number; failed: number; inFlight: number }` and `queueTotals(items: QueueItem[]): Totals` (input rows only).
  - `doneSamples(items: QueueItem[], group: string, options: JobOptions): { source: number; output: number }[]` (done input rows of `group` whose `runOptions` equal `options`).

- [ ] **Step 1: Write the failing test**

```ts
// test/row-model.test.ts
import { describe, expect, it } from 'vitest'
import {
  doneSamples,
  formatEtaCompact,
  formatPct,
  formatProgress,
  kindLabel,
  pctChange,
  queueTotals,
  rowView,
  shortError
} from '../src/renderer/src/components/queue/rowModel'
import type { QueueItem } from '../src/renderer/src/state'

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: over.id ?? 'a',
  file: { path: 'C:/x/a.heic', name: 'a.heic', ext: '.heic', kind: 'image', size: 3_200_000 },
  thumb: null,
  status: 'ready',
  percent: 0,
  ...over
})

describe('compact progress', () => {
  it('formats the mockup string', () => {
    expect(formatProgress(62, 4)).toBe('62%(4s)')
  })
  it('drops the bracket without an ETA', () => {
    expect(formatProgress(62.4, undefined)).toBe('62%')
    expect(formatProgress(62.4, null)).toBe('62%')
  })
  it('keeps one decimal below 10%', () => {
    expect(formatProgress(5.5, 120)).toBe('5.5%(2m)')
    expect(formatProgress(0, 3)).toBe('0%(3s)')
  })
  it('formats minutes and hours', () => {
    expect(formatEtaCompact(59)).toBe('(59s)')
    expect(formatEtaCompact(90)).toBe('(2m)')
    expect(formatEtaCompact(3900)).toBe('(1h 5m)')
    expect(formatEtaCompact(-1)).toBe('')
    expect(formatEtaCompact(Number.NaN)).toBe('')
  })
})

describe('labels', () => {
  it('derives the kind from the extension', () => {
    expect(kindLabel('.heic')).toBe('HEIC')
    expect(kindLabel('')).toBe('')
  })
  it('signs the percentage with a plain hyphen', () => {
    expect(pctChange(1000, 200)).toBe(-80)
    expect(formatPct(-80)).toBe('-80%')
    expect(formatPct(12)).toBe('+12%')
    expect(formatPct(0)).toBe('0%')
  })
  it('has no percentage for a zero-byte source', () => {
    expect(pctChange(0, 10)).toBeNull()
  })
})

describe('shortError', () => {
  it('maps known failures to a short label', () => {
    expect(shortError('magick: Unsupported compression method (5)')).toBe('Unsupported compression')
    expect(shortError('RAR output needs WinRAR (Rar.exe) installed')).toBe('WinRAR not found')
    expect(shortError('The archive is password protected')).toBe('Password-protected')
  })
  it('falls back to the first clause, capped at 32 characters', () => {
    expect(shortError('Disk full. Free some space and retry')).toBe('Disk full')
    const long = shortError('Something very long happened while encoding the frames')
    expect(long).toHaveLength(32)
    expect(long.endsWith('…')).toBe(true)
  })
  it('says Failed when there is no message', () => {
    expect(shortError(undefined)).toBe('Failed')
  })
})

describe('rowView', () => {
  it('done: actual result, percentage, reveal action as ghost', () => {
    const v = rowView(item({ status: 'done', outputPath: 'C:/x/a.webp', outputSize: 640_000 }))
    expect(v.status).toMatchObject({ kind: 'done', text: 'Done' })
    expect(v.result).toEqual({ text: '625 KB', pct: '-80%', estimate: false, grew: false })
    expect(v.action).toEqual({
      kind: 'reveal',
      icon: 'folder',
      label: 'Show in folder',
      ghost: true
    })
  })
  it('done with a folder output: no size, no percentage', () => {
    const v = rowView(item({ status: 'done', outputPath: 'C:/x/a (pages)' }))
    expect(v.result).toEqual({ text: 'folder', pct: null, estimate: false, grew: false })
  })
  it('done from an old session without a link: empty result, no crash', () => {
    const v = rowView(item({ status: 'done' }))
    expect(v.result).toBeNull()
    expect(v.status.text).toBe('Done')
  })
  it('growth is flagged so the cell can use weight instead of amber', () => {
    const v = rowView(item({ status: 'done', outputPath: 'C:/x/a.png', outputSize: 6_400_000 }))
    expect(v.result).toMatchObject({ pct: '+100%', grew: true })
  })
  it('running: progress, compact ETA, grey estimate, cancel ghost', () => {
    const v = rowView(
      item({ status: 'running', percent: 62, hasProgress: true, etaSec: 4 }),
      410_000
    )
    expect(v.status).toMatchObject({ kind: 'running', pct: '62%', eta: '(4s)' })
    expect(v.result).toMatchObject({ text: '~400 KB', estimate: true })
    expect(v.action).toMatchObject({ kind: 'cancel', icon: 'close', ghost: true })
  })
  it('running without real progress shows an ellipsis and no estimate cell', () => {
    const v = rowView(item({ status: 'running', hasProgress: false }), null)
    expect(v.status.pct).toBe('…')
    expect(v.result).toBeNull()
  })
  it('queued: no result, remove ghost', () => {
    const v = rowView(item({ status: 'queued' }), 999)
    expect(v.result).toBeNull()
    expect(v.status.text).toBe('Queued')
    expect(v.action).toMatchObject({ kind: 'remove', ghost: true })
  })
  it('failed: short label, full tooltip, retry always visible', () => {
    const v = rowView(
      item({ status: 'failed', error: 'Unsupported compression in TIFF. Try PNG.' })
    )
    expect(v.status).toMatchObject({
      text: 'Unsupported compression',
      title: 'Unsupported compression in TIFF. Try PNG.'
    })
    expect(v.result).toBeNull()
    expect(v.action).toEqual({ kind: 'retry', icon: 'retry', label: 'Retry', ghost: false })
  })
  it('ready: blank status, remove ghost', () => {
    const v = rowView(item())
    expect(v.status.text).toBe('')
    expect(v.action.kind).toBe('remove')
  })
  it('canceled: Canceled, retry ghost', () => {
    const v = rowView(item({ status: 'canceled' }))
    expect(v.status.text).toBe('Canceled')
    expect(v.action).toMatchObject({ kind: 'retry', ghost: true })
  })
  it('kind and size columns', () => {
    const v = rowView(item())
    expect(v.kind).toBe('HEIC')
    expect(v.size).toBe('3.1 MB')
  })
})

describe('queueTotals', () => {
  it('sums inputs, counts statuses, and only adds done rows with a file output', () => {
    const t = queueTotals([
      item({ id: '1', status: 'done', outputPath: 'o1', outputSize: 1_000_000 }),
      item({ id: '2', status: 'done', outputPath: 'C:/x/folder' }),
      item({ id: '3', status: 'running' }),
      item({ id: '4', status: 'queued' }),
      item({ id: '5', status: 'failed' }),
      item({ id: 'r', isResult: true, status: 'done', outputPath: 'o1', outputSize: 1_000_000 }),
      item({ id: 'h', hiddenInput: true })
    ])
    expect(t).toEqual({
      files: 5,
      bytes: 16_000_000,
      doneSrc: 3_200_000,
      doneOut: 1_000_000,
      done: 2,
      failed: 1,
      inFlight: 2
    })
  })
})

describe('doneSamples', () => {
  it('uses done rows of the same group run with the same options', () => {
    const opts = { format: '.webp', quality: 'balanced' }
    const s = doneSamples(
      [
        item({ id: '1', status: 'done', outputSize: 800_000, runOptions: opts }),
        item({
          id: '2',
          status: 'done',
          outputSize: 100,
          runOptions: { ...opts, quality: 'best' }
        }),
        item({ id: '3', status: 'running', runOptions: opts })
      ],
      'image',
      { quality: 'balanced', format: '.webp' }
    )
    expect(s).toEqual([{ source: 3_200_000, output: 800_000 }])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/row-model.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/components/queue/rowModel.ts
import type { JobOptions } from '@shared/types'
import { formatBytes } from '@shared/compress'
import { groupOf, inInput, type ItemStatus, type QueueItem } from '../../state'

// Pure view model for one table row (spec 4.3) and the totals row (spec 4.4).
// Kept apart from the .tsx files so React Fast Refresh and Vitest both work.

export function formatEtaCompact(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return ''
  const s = Math.round(sec)
  if (s < 60) return `(${Math.max(1, s)}s)`
  const m = Math.round(sec / 60)
  if (m < 60) return `(${m}m)`
  return `(${Math.floor(m / 60)}h ${m % 60}m)`
}

export function progressParts(pct: number, etaSec?: number | null): { pct: string; eta: string } {
  const n = pct > 0 && pct < 10 ? pct.toFixed(1) : String(Math.round(pct))
  return { pct: `${n}%`, eta: formatEtaCompact(etaSec) }
}

export function formatProgress(pct: number, etaSec?: number | null): string {
  const p = progressParts(pct, etaSec)
  return p.pct + p.eta
}

export function kindLabel(ext: string): string {
  return ext.replace(/^\./, '').toUpperCase()
}

export function pctChange(src: number, out: number): number | null {
  if (!(src > 0) || !Number.isFinite(out)) return null
  return Math.round(((out - src) / src) * 100)
}

export function formatPct(n: number): string {
  return n > 0 ? `+${n}%` : `${n}%`
}

const KNOWN_ERRORS: [RegExp, string][] = [
  [/unsupported compression/i, 'Unsupported compression'],
  [/winrar|rar\.exe/i, 'WinRAR not found'],
  [/password/i, 'Password-protected'],
  [/no (en|de)code delegate|missing encoder/i, 'Missing encoder'],
  [/not installed|could not be found|enoent|tool missing/i, 'Tool missing']
]
const MAX_ERROR = 32

export function shortError(message: string | undefined): string {
  const m = (message ?? '').trim()
  if (!m) return 'Failed'
  for (const [re, label] of KNOWN_ERRORS) if (re.test(m)) return label
  const first = m.split(/[.:;\n]|,\s/)[0].trim() || m
  return first.length > MAX_ERROR ? first.slice(0, MAX_ERROR - 1).trimEnd() + '…' : first
}

export type RowActionKind = 'reveal' | 'remove' | 'cancel' | 'retry'
export interface ResultView {
  text: string
  pct: string | null
  estimate: boolean
  grew: boolean
}
export interface StatusView {
  kind: ItemStatus
  text: string
  pct?: string
  eta?: string
  title?: string
}
export interface RowActionView {
  kind: RowActionKind
  icon: 'folder' | 'close' | 'retry'
  label: string
  ghost: boolean
}
export interface RowView {
  kind: string
  size: string
  result: ResultView | null
  status: StatusView
  action: RowActionView
}

function resultFor(item: QueueItem, estimateBytes?: number | null): ResultView | null {
  const src = item.file.size
  if (item.status === 'done') {
    if (item.outputSize != null) {
      const pct = pctChange(src, item.outputSize)
      return {
        text: formatBytes(item.outputSize),
        pct: pct == null ? null : formatPct(pct),
        estimate: false,
        grew: pct != null && pct > 0
      }
    }
    return item.outputPath ? { text: 'folder', pct: null, estimate: false, grew: false } : null
  }
  if (item.status === 'running' && estimateBytes != null && estimateBytes > 0) {
    const pct = pctChange(src, estimateBytes)
    return {
      text: `~${formatBytes(estimateBytes)}`,
      pct: pct == null ? null : formatPct(pct),
      estimate: true,
      grew: pct != null && pct > 0
    }
  }
  return null
}

function statusFor(item: QueueItem): StatusView {
  switch (item.status) {
    case 'done':
      return { kind: 'done', text: 'Done' }
    case 'queued':
      return { kind: 'queued', text: 'Queued' }
    case 'running': {
      if (!item.hasProgress) return { kind: 'running', text: '', pct: '…', eta: '' }
      const p = progressParts(item.percent, item.etaSec)
      return { kind: 'running', text: '', pct: p.pct, eta: p.eta }
    }
    case 'failed':
      return { kind: 'failed', text: shortError(item.error), title: item.error ?? 'Failed' }
    case 'canceled':
      return { kind: 'canceled', text: 'Canceled' }
    default:
      return { kind: 'ready', text: '' }
  }
}

function actionFor(status: ItemStatus): RowActionView {
  switch (status) {
    case 'done':
      return { kind: 'reveal', icon: 'folder', label: 'Show in folder', ghost: true }
    case 'running':
      return { kind: 'cancel', icon: 'close', label: 'Cancel', ghost: true }
    case 'failed':
      return { kind: 'retry', icon: 'retry', label: 'Retry', ghost: false }
    case 'canceled':
      return { kind: 'retry', icon: 'retry', label: 'Retry', ghost: true }
    default:
      return { kind: 'remove', icon: 'close', label: 'Remove', ghost: true }
  }
}

export function rowView(item: QueueItem, estimateBytes?: number | null): RowView {
  return {
    kind: kindLabel(item.file.ext),
    size: formatBytes(item.file.size),
    result: resultFor(item, estimateBytes),
    status: statusFor(item),
    action: actionFor(item.status)
  }
}

export interface Totals {
  files: number
  bytes: number
  doneSrc: number
  doneOut: number
  done: number
  failed: number
  inFlight: number
}

export function queueTotals(items: QueueItem[]): Totals {
  const t: Totals = { files: 0, bytes: 0, doneSrc: 0, doneOut: 0, done: 0, failed: 0, inFlight: 0 }
  for (const i of items) {
    if (!inInput(i)) continue
    t.files += 1
    t.bytes += i.file.size
    if (i.status === 'done') {
      t.done += 1
      if (i.outputSize != null) {
        t.doneSrc += i.file.size
        t.doneOut += i.outputSize
      }
    } else if (i.status === 'failed') t.failed += 1
    else if (i.status === 'queued' || i.status === 'running') t.inFlight += 1
  }
  return t
}

function sameOptions(a: JobOptions | undefined, b: JobOptions): boolean {
  if (!a) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false
  return true
}

export function doneSamples(
  items: QueueItem[],
  group: string,
  options: JobOptions
): { source: number; output: number }[] {
  return items
    .filter(
      (i) =>
        inInput(i) &&
        i.status === 'done' &&
        i.outputSize != null &&
        groupOf(i.file) === group &&
        sameOptions(i.runOptions, options)
    )
    .map((i) => ({ source: i.file.size, output: i.outputSize as number }))
}
```

Note: `formatBytes(640_000)` is `625 KB` and `formatBytes(410_000)` is `400 KB` (1024-based, as the app has always shown); the tests assert those exact strings.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/row-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/queue/rowModel.ts test/row-model.test.ts
git commit -m "feat(queue): pure row model for result, status, actions and totals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Table sorting, select-all and table keyboard map

**Files:**

- Create: `src/renderer/src/components/queue/tableSort.ts`, `src/renderer/src/components/queue/selectAll.ts`, `src/renderer/src/components/queue/tableKeys.ts`
- Modify: `src/renderer/src/components/queueGroups.ts:9` (export `GROUP_ORDER`, add `groupLabel`)
- Test: `test/table-sort.test.ts`, `test/select-all.test.ts`, `test/table-keys.test.ts`

**Interfaces:**

- Consumes: `QueueItem`, `groupOf`, `inInput` from `state.ts`; `GROUP_ORDER` from `queueGroups.ts`.
- Produces:
  - `type SortKey = 'name' | 'kind' | 'size' | 'result' | 'status'`; `interface SortState { key: SortKey; dir: 'asc' | 'desc' }`.
  - `nextSort(cur: SortState | null, key: SortKey): SortState | null` (asc, desc, off).
  - `sortItems(items: QueueItem[], sort: SortState | null): QueueItem[]` (stable, never mutates).
  - `groupedRows(items: QueueItem[], sort: SortState | null): { group: string; label: string; items: QueueItem[] }[]` (groups in `GROUP_ORDER`, each sorted).
  - `visibleOrder(groups): string[]`.
  - `type CheckState = 'none' | 'mixed' | 'all'`; `activeGroupFor(items, selected): string | null`; `headerCheck(items, selected): CheckState`; `toggleAllIds(items, selected): string[]`.
  - `export const GROUP_ORDER: string[]`; `groupLabel(group: string): string` from `queueGroups.ts`.
  - `type TableKey = 'up' | 'down' | 'extendUp' | 'extendDown' | 'toggle' | 'selectAll' | 'remove' | 'open' | 'menu'`; `tableKey(e: KeyLike): TableKey | null` where `KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/table-sort.test.ts
import { describe, expect, it } from 'vitest'
import {
  groupedRows,
  nextSort,
  sortItems,
  visibleOrder
} from '../src/renderer/src/components/queue/tableSort'
import type { QueueItem } from '../src/renderer/src/state'

const it_ = (
  id: string,
  name: string,
  ext: string,
  size: number,
  over: Partial<QueueItem> = {}
): QueueItem => ({
  id,
  file: { path: `C:/x/${name}`, name, ext, kind: ext === '.mp4' ? 'video' : 'image', size },
  thumb: null,
  status: 'ready',
  percent: 0,
  ...over
})

describe('nextSort', () => {
  it('cycles ascending, descending, off', () => {
    const a = nextSort(null, 'size')
    expect(a).toEqual({ key: 'size', dir: 'asc' })
    const b = nextSort(a, 'size')
    expect(b).toEqual({ key: 'size', dir: 'desc' })
    expect(nextSort(b, 'size')).toBeNull()
  })
  it('starts ascending when switching column', () => {
    expect(nextSort({ key: 'size', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })
})

describe('sortItems', () => {
  const rows = [
    it_('1', 'b.png', '.png', 30),
    it_('2', 'a.png', '.png', 10),
    it_('3', 'c.jpg', '.jpg', 20)
  ]
  it('keeps insertion order when off and never mutates', () => {
    const copy = [...rows]
    expect(sortItems(rows, null).map((r) => r.id)).toEqual(['1', '2', '3'])
    sortItems(rows, { key: 'size', dir: 'asc' })
    expect(rows).toEqual(copy)
  })
  it('sorts by name, size and kind', () => {
    expect(sortItems(rows, { key: 'name', dir: 'asc' }).map((r) => r.id)).toEqual(['2', '1', '3'])
    expect(sortItems(rows, { key: 'size', dir: 'desc' }).map((r) => r.id)).toEqual(['1', '3', '2'])
    expect(sortItems(rows, { key: 'kind', dir: 'asc' }).map((r) => r.id)).toEqual(['3', '1', '2'])
  })
  it('sorts by result size with empty results last', () => {
    const r = [
      it_('1', 'a.png', '.png', 10),
      it_('2', 'b.png', '.png', 10, { status: 'done', outputSize: 5 }),
      it_('3', 'c.png', '.png', 10, { status: 'done', outputSize: 2 })
    ]
    expect(sortItems(r, { key: 'result', dir: 'asc' }).map((x) => x.id)).toEqual(['3', '2', '1'])
    expect(sortItems(r, { key: 'result', dir: 'desc' }).map((x) => x.id)).toEqual(['2', '3', '1'])
  })
  it('sorts by status with failures first', () => {
    const r = [
      it_('1', 'a.png', '.png', 1, { status: 'done' }),
      it_('2', 'b.png', '.png', 1, { status: 'failed' }),
      it_('3', 'c.png', '.png', 1, { status: 'running' })
    ]
    expect(sortItems(r, { key: 'status', dir: 'asc' }).map((x) => x.id)).toEqual(['2', '3', '1'])
  })
})

describe('groupedRows', () => {
  it('sorts within each group and keeps groups in display order', () => {
    const g = groupedRows(
      [it_('v', 'z.mp4', '.mp4', 99), it_('2', 'b.png', '.png', 2), it_('1', 'a.png', '.png', 1)],
      { key: 'name', dir: 'asc' }
    )
    expect(g.map((x) => x.group)).toEqual(['image', 'video'])
    expect(visibleOrder(g)).toEqual(['1', '2', 'v'])
  })
  it('skips hidden inputs and results', () => {
    const g = groupedRows(
      [
        it_('1', 'a.png', '.png', 1, { hiddenInput: true }),
        it_('2', 'b.png', '.png', 1, { isResult: true })
      ],
      null
    )
    expect(g).toEqual([])
  })
})
```

```ts
// test/select-all.test.ts
import { describe, expect, it } from 'vitest'
import {
  activeGroupFor,
  headerCheck,
  toggleAllIds
} from '../src/renderer/src/components/queue/selectAll'
import type { QueueItem } from '../src/renderer/src/state'

const row = (id: string, ext: string): QueueItem => ({
  id,
  file: {
    path: `C:/x/${id}${ext}`,
    name: id + ext,
    ext,
    kind: ext === '.mp4' ? 'video' : 'image',
    size: 1
  },
  thumb: null,
  status: 'ready',
  percent: 0
})
const items = [row('v1', '.mp4'), row('i1', '.png'), row('i2', '.png'), row('v2', '.mp4')]

describe('active group', () => {
  it('is the group of the selection', () => {
    expect(activeGroupFor(items, ['v2'])).toBe('video')
  })
  it('falls back to the first group in display order, not insertion order', () => {
    expect(activeGroupFor(items, [])).toBe('image')
  })
  it('is null for an empty queue', () => {
    expect(activeGroupFor([], [])).toBeNull()
  })
})

describe('header checkbox', () => {
  it('reads none, mixed and all for the active group only', () => {
    expect(headerCheck(items, [])).toBe('none')
    expect(headerCheck(items, ['i1'])).toBe('mixed')
    expect(headerCheck(items, ['i1', 'i2'])).toBe('all')
  })
  it('selects every row of the selected group and nothing else', () => {
    expect(toggleAllIds(items, ['v1'])).toEqual(['v1', 'v2'])
  })
  it('selects the first display group when nothing is selected', () => {
    expect(toggleAllIds(items, [])).toEqual(['i1', 'i2'])
  })
  it('clears when the whole group is already selected', () => {
    expect(toggleAllIds(items, ['i1', 'i2'])).toEqual([])
  })
})
```

```ts
// test/table-keys.test.ts
import { describe, expect, it } from 'vitest'
import { tableKey } from '../src/renderer/src/components/queue/tableKeys'

const k = (
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
})

describe('tableKey', () => {
  it('maps the spec 4.1 keys', () => {
    expect(tableKey(k('ArrowUp'))).toBe('up')
    expect(tableKey(k('ArrowDown'))).toBe('down')
    expect(tableKey(k('ArrowUp', { shiftKey: true }))).toBe('extendUp')
    expect(tableKey(k('ArrowDown', { shiftKey: true }))).toBe('extendDown')
    expect(tableKey(k(' '))).toBe('toggle')
    expect(tableKey(k('a', { ctrlKey: true }))).toBe('selectAll')
    expect(tableKey(k('A', { metaKey: true }))).toBe('selectAll')
    expect(tableKey(k('Delete'))).toBe('remove')
    expect(tableKey(k('Enter'))).toBe('open')
    expect(tableKey(k('ContextMenu'))).toBe('menu')
    expect(tableKey(k('F10', { shiftKey: true }))).toBe('menu')
  })
  it('ignores everything else, including Ctrl+Enter (that is Run)', () => {
    expect(tableKey(k('Enter', { ctrlKey: true }))).toBeNull()
    expect(tableKey(k('a'))).toBeNull()
    expect(tableKey(k('ArrowUp', { altKey: true }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/table-sort.test.ts test/select-all.test.ts test/table-keys.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Export the group order and label**

In `queueGroups.ts` change `const GROUP_ORDER` to `export const GROUP_ORDER` and add:

```ts
/** "Images" / "Video" / "Documents"; "Other" for an unknown group. */
export function groupLabel(group: string): string {
  return GROUP_LABEL[group] ?? 'Other'
}

/** Index of a group in display order; unknown groups sort last. */
export function groupRank(group: string): number {
  const i = GROUP_ORDER.indexOf(group)
  return i < 0 ? GROUP_ORDER.length : i
}
```

- [ ] **Step 4: Implement the three modules**

```ts
// src/renderer/src/components/queue/tableSort.ts
import { groupOf, inInput, type ItemStatus, type QueueItem } from '../../state'
import { groupLabel, groupRank } from '../queueGroups'

export type SortKey = 'name' | 'kind' | 'size' | 'result' | 'status'
export interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

/** Header click cycle: ascending, descending, back to insertion order. */
export function nextSort(cur: SortState | null, key: SortKey): SortState | null {
  if (!cur || cur.key !== key) return { key, dir: 'asc' }
  return cur.dir === 'asc' ? { key, dir: 'desc' } : null
}

const STATUS_RANK: Record<ItemStatus, number> = {
  failed: 0,
  running: 1,
  queued: 2,
  ready: 3,
  canceled: 4,
  done: 5
}

function compare(a: QueueItem, b: QueueItem, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.file.name.localeCompare(b.file.name, undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    case 'kind':
      return a.file.ext.localeCompare(b.file.ext)
    case 'size':
      return a.file.size - b.file.size
    case 'status':
      return STATUS_RANK[a.status] - STATUS_RANK[b.status]
    case 'result':
      return (a.outputSize ?? 0) - (b.outputSize ?? 0)
  }
}

export function sortItems(items: QueueItem[], sort: SortState | null): QueueItem[] {
  if (!sort) return items.slice()
  const sign = sort.dir === 'asc' ? 1 : -1
  return items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => {
      if (sort.key === 'result') {
        // Rows without a result always go last, whichever the direction.
        const ex = x.item.outputSize == null
        const ey = y.item.outputSize == null
        if (ex !== ey) return ex ? 1 : -1
      }
      return sign * compare(x.item, y.item, sort.key) || x.index - y.index
    })
    .map((x) => x.item)
}

export interface RowGroup {
  group: string
  label: string
  items: QueueItem[]
}

/** Input rows bucketed by convert group in display order, each bucket sorted. */
export function groupedRows(items: QueueItem[], sort: SortState | null): RowGroup[] {
  const by = new Map<string, QueueItem[]>()
  for (const i of items) {
    if (!inInput(i)) continue
    const g = groupOf(i.file)
    const list = by.get(g)
    if (list) list.push(i)
    else by.set(g, [i])
  }
  return [...by.keys()]
    .sort((a, b) => groupRank(a) - groupRank(b))
    .map((g) => ({ group: g, label: groupLabel(g), items: sortItems(by.get(g)!, sort) }))
}

export function visibleOrder(groups: RowGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.id))
}
```

```ts
// src/renderer/src/components/queue/selectAll.ts
import { groupOf, inInput, type QueueItem } from '../../state'
import { groupRank } from '../queueGroups'

export type CheckState = 'none' | 'mixed' | 'all'

/** The group the header checkbox speaks for: the selection's group, or the
 * first group in display order when nothing is selected. */
export function activeGroupFor(items: QueueItem[], selected: string[]): string | null {
  const rows = items.filter(inInput)
  const first = rows.find((i) => i.id === selected[0])
  if (first) return groupOf(first.file)
  const groups = [...new Set(rows.map((i) => groupOf(i.file)))]
  if (!groups.length) return null
  return groups.sort((a, b) => groupRank(a) - groupRank(b))[0]
}

function groupIds(items: QueueItem[], group: string | null): string[] {
  return items.filter((i) => inInput(i) && groupOf(i.file) === group).map((i) => i.id)
}

export function headerCheck(items: QueueItem[], selected: string[]): CheckState {
  const ids = groupIds(items, activeGroupFor(items, selected))
  const n = ids.filter((id) => selected.includes(id)).length
  if (n === 0) return 'none'
  return n === ids.length ? 'all' : 'mixed'
}

/** What a header click selects: the whole active group, or nothing when the
 * group is already fully selected. Never crosses groups. */
export function toggleAllIds(items: QueueItem[], selected: string[]): string[] {
  const ids = groupIds(items, activeGroupFor(items, selected))
  return headerCheck(items, selected) === 'all' ? [] : ids
}
```

```ts
// src/renderer/src/components/queue/tableKeys.ts
export type TableKey =
  'up' | 'down' | 'extendUp' | 'extendDown' | 'toggle' | 'selectAll' | 'remove' | 'open' | 'menu'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** Keyboard map for the files table (spec 4.1). Ctrl+Enter is left for Run. */
export function tableKey(e: KeyLike): TableKey | null {
  if (e.altKey) return null
  const mod = e.ctrlKey || e.metaKey
  if (mod) return e.key.toLowerCase() === 'a' && !e.shiftKey ? 'selectAll' : null
  if (e.key === 'ArrowUp') return e.shiftKey ? 'extendUp' : 'up'
  if (e.key === 'ArrowDown') return e.shiftKey ? 'extendDown' : 'down'
  if (e.key === ' ') return 'toggle'
  if (e.key === 'Delete') return 'remove'
  if (e.key === 'Enter') return 'open'
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) return 'menu'
  return null
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/table-sort.test.ts test/select-all.test.ts test/table-keys.test.ts test/queue-groups.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/queue/tableSort.ts src/renderer/src/components/queue/selectAll.ts src/renderer/src/components/queue/tableKeys.ts src/renderer/src/components/queueGroups.ts test/table-sort.test.ts test/select-all.test.ts test/table-keys.test.ts
git commit -m "feat(queue): sort cycle, group-scoped select-all and table key map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Size estimator (per file and batch)

**Files:**

- Create: `src/shared/sizeEstimate.ts`
- Test: `test/size-estimate.test.ts`

**Interfaces:**

- Consumes: `FileInfo`, `JobOptions`, `ToolId` from `@shared/types`; `estimatedPngBytes` from `@shared/compress`.
- Produces:
  - `interface Sample { source: number; output: number }`
  - `medianRatio(samples: Sample[]): number | null`
  - `ratioFor(tool: ToolId, file: FileInfo, options: JobOptions): number | null`
  - `interface EstimateCtx { samples?: Sample[]; pixelRatio?: number | null; outPixels?: number | null }`
  - `estimateOutputBytes(file: FileInfo, tool: ToolId, options: JobOptions, ctx?: EstimateCtx): number | null`
  - `estimateBatch(rows: { size: number; estimate: number | null }[]): { from: number; to: number; files: number } | null`

Order of evidence (spec 6.2): batch samples first, then pixels (resize, upscale), then the ratio table, else `null`.

- [ ] **Step 1: Write the failing test**

```ts
// test/size-estimate.test.ts
import { describe, expect, it } from 'vitest'
import { estimateBatch, estimateOutputBytes, medianRatio, ratioFor } from '@shared/sizeEstimate'
import type { FileInfo } from '@shared/types'

const png: FileInfo = {
  path: 'C:/a.png',
  name: 'a.png',
  ext: '.png',
  kind: 'image',
  size: 1_000_000
}
const mp4: FileInfo = {
  path: 'C:/a.mp4',
  name: 'a.mp4',
  ext: '.mp4',
  kind: 'video',
  size: 10_000_000
}
const wav: FileInfo = {
  path: 'C:/a.wav',
  name: 'a.wav',
  ext: '.wav',
  kind: 'audio',
  size: 5_000_000
}
const pdf: FileInfo = { path: 'C:/a.pdf', name: 'a.pdf', ext: '.pdf', kind: 'pdf', size: 2_000_000 }

describe('medianRatio', () => {
  it('takes the median output/source ratio', () => {
    expect(
      medianRatio([
        { source: 10, output: 1 },
        { source: 10, output: 3 },
        { source: 10, output: 9 }
      ])
    ).toBeCloseTo(0.3)
    expect(
      medianRatio([
        { source: 10, output: 2 },
        { source: 10, output: 4 }
      ])
    ).toBeCloseTo(0.3)
  })
  it('ignores zero-byte sources and returns null with nothing usable', () => {
    expect(medianRatio([])).toBeNull()
    expect(medianRatio([{ source: 0, output: 5 }])).toBeNull()
  })
})

describe('ratio table', () => {
  it('knows image convert targets by quality preset', () => {
    expect(ratioFor('convert', png, { format: '.webp', quality: 'balanced' })).toBeCloseTo(0.22)
    expect(ratioFor('convert', png, { format: '.avif', quality: 'smaller' })).toBeCloseTo(0.1)
  })
  it('has no ratio for lossless or odd targets', () => {
    expect(ratioFor('convert', png, { format: '.bmp' })).toBeNull()
    expect(ratioFor('convert', mp4, { format: '.mkv' })).toBeNull()
  })
  it('scales video compress by codec, quality and scale', () => {
    const full = ratioFor('compress', mp4, { videoCodec: 'h264', quality: 80, scale: 100 })!
    const half = ratioFor('compress', mp4, { videoCodec: 'h264', quality: 80, scale: 50 })!
    expect(full).toBeCloseTo(0.5)
    expect(half).toBeCloseTo(0.125)
  })
  it('has no ratio for audio without a known source bitrate', () => {
    expect(ratioFor('compress', wav, { audioCodec: 'mp3', audioBitrate: 192 })).toBeNull()
  })
  it('maps PDF levels', () => {
    expect(ratioFor('compress', pdf, { pdfLevel: 'smallest' })).toBeCloseTo(0.3)
  })
  it('never estimates tools whose output is not comparable', () => {
    for (const t of ['pdf', 'archive', 'generate', 'removebg'] as const)
      expect(ratioFor(t, png, {})).toBeNull()
  })
})

describe('estimateOutputBytes', () => {
  it('prefers finished rows of the same batch over the table', () => {
    const v = estimateOutputBytes(
      png,
      'convert',
      { format: '.webp', quality: 'balanced' },
      {
        samples: [{ source: 100, output: 50 }]
      }
    )
    expect(v).toBe(500_000)
  })
  it('uses pixels for resize and upscale', () => {
    expect(
      estimateOutputBytes(png, 'resize', { mode: 'percent', percent: 50 }, { pixelRatio: 0.25 })
    ).toBe(250_000)
    expect(estimateOutputBytes(png, 'upscale', { upscaleFactor: 2 }, { outPixels: 1000 })).toBe(
      1200
    )
  })
  it('returns null, never 0 or NaN, when there is nothing to go on', () => {
    expect(estimateOutputBytes(png, 'resize', {}, {})).toBeNull()
    expect(estimateOutputBytes({ ...png, size: 0 }, 'convert', { format: '.webp' })).toBeNull()
    expect(estimateOutputBytes(wav, 'compress', { audioCodec: 'mp3' })).toBeNull()
  })
})

describe('estimateBatch', () => {
  it('sums only rows that have an estimate and counts them', () => {
    expect(
      estimateBatch([
        { size: 100, estimate: 20 },
        { size: 50, estimate: null },
        { size: 300, estimate: 60 }
      ])
    ).toEqual({ from: 400, to: 80, files: 2 })
  })
  it('is null when no row can be estimated', () => {
    expect(estimateBatch([{ size: 100, estimate: null }])).toBeNull()
    expect(estimateBatch([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/size-estimate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/shared/sizeEstimate.ts
import type { FileInfo, JobOptions, ToolId } from './types'
import { estimatedPngBytes } from './compress'

// Output-size estimates for the result column and the batch card (spec 6.2).
// Always shown with "~". Conservative by design: a wrong guess is worse than an
// empty cell, so anything unpredictable returns null.

export interface Sample {
  source: number
  output: number
}

export function medianRatio(samples: Sample[]): number | null {
  const r = samples
    .filter((s) => s.source > 0 && s.output >= 0)
    .map((s) => s.output / s.source)
    .sort((a, b) => a - b)
  if (!r.length) return null
  const mid = Math.floor(r.length / 2)
  return r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2
}

type Preset = 'smaller' | 'balanced' | 'best'
const IMAGE_CONVERT: Record<string, Record<Preset, number>> = {
  '.webp': { smaller: 0.15, balanced: 0.22, best: 0.35 },
  '.avif': { smaller: 0.1, balanced: 0.16, best: 0.25 },
  '.jxl': { smaller: 0.15, balanced: 0.22, best: 0.35 },
  '.jpg': { smaller: 0.25, balanced: 0.35, best: 0.5 },
  '.jpeg': { smaller: 0.25, balanced: 0.35, best: 0.5 }
}
const VIDEO_CODEC: Record<string, number> = { h264: 0.5, h265: 0.35, av1: 0.3 }
const PDF_LEVEL: Record<string, number> = { lossless: 0.9, high: 0.7, balanced: 0.5, smallest: 0.3 }

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp01 = (n: number): number => Math.max(0.01, Math.min(1, n))

export function ratioFor(tool: ToolId, file: FileInfo, options: JobOptions): number | null {
  if (tool === 'convert') {
    if (file.kind !== 'image') return null
    const row = IMAGE_CONVERT[String(options.format ?? '')]
    if (!row) return null
    const q = String(options.quality ?? 'balanced') as Preset
    return row[q] ?? row.balanced
  }
  if (tool === 'compress') {
    const q = num(options.quality, 80)
    if (file.kind === 'image') {
      const fmt = String(options.imageFormat ?? 'keep')
      if (fmt === 'webp') return clamp01(0.08 + (q / 100) * 0.3)
      if (fmt === 'avif') return clamp01(0.05 + (q / 100) * 0.2)
      return clamp01((q / 100) * 0.6)
    }
    if (file.kind === 'video') {
      const base = VIDEO_CODEC[String(options.videoCodec ?? 'h264')]
      if (base == null) return null
      const s = num(options.scale, 100) / 100
      return clamp01(base * (q / 80) * s * s)
    }
    if (file.kind === 'pdf') return PDF_LEVEL[String(options.pdfLevel ?? 'balanced')] ?? null
    return null // audio: needs the source bitrate, which is not probed
  }
  return null
}

export interface EstimateCtx {
  samples?: Sample[]
  /** Output pixels / source pixels (resize), from the dimension probe. */
  pixelRatio?: number | null
  /** Output pixel count (upscale writes PNG). */
  outPixels?: number | null
}

export function estimateOutputBytes(
  file: FileInfo,
  tool: ToolId,
  options: JobOptions,
  ctx: EstimateCtx = {}
): number | null {
  if (!(file.size > 0)) return null
  const fromBatch = medianRatio(ctx.samples ?? [])
  if (fromBatch != null) return Math.round(file.size * fromBatch)
  if (tool === 'resize')
    return ctx.pixelRatio != null && ctx.pixelRatio > 0
      ? Math.round(file.size * ctx.pixelRatio)
      : null
  if (tool === 'upscale')
    return ctx.outPixels != null && ctx.outPixels > 0
      ? Math.round(estimatedPngBytes(ctx.outPixels, 1))
      : null
  const r = ratioFor(tool, file, options)
  return r == null ? null : Math.round(file.size * r)
}

export function estimateBatch(
  rows: { size: number; estimate: number | null }[]
): { from: number; to: number; files: number } | null {
  let from = 0
  let to = 0
  let files = 0
  for (const r of rows) {
    if (r.estimate == null) continue
    from += r.size
    to += r.estimate
    files += 1
  }
  return files ? { from, to, files } : null
}
```

`estimatedPngBytes(w, h)` is `w * h * 1.2` (`src/shared/compress.ts:118`); passing `(outPixels, 1)` reuses it unchanged.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/size-estimate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/sizeEstimate.ts test/size-estimate.test.ts
git commit -m "feat(shared): conservative output-size estimator with batch extrapolation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Design tokens, bundled fonts, base and workbench CSS (light theme removed)

**Files:**

- Create: `src/renderer/src/theme/tokens.css`, `src/renderer/src/theme/base.css`, `src/renderer/src/theme/workbench.css`
- Modify: `src/renderer/src/index.css` (rewrite), `src/renderer/src/main.tsx:1-5` (font imports), `package.json` (dependencies)
- Test: `test/theme-tokens.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: the CSS custom properties listed in Global Constraints plus `--sans`, `--mono`, `--backdrop`, `--sbw: 208px`, `--sbw-c: 48px`, `--cols: 40px 1fr 64px 88px 184px 232px`; Tailwind utilities `bg-bg-0 bg-bg-1 bg-hover bg-selected bg-field bg-track border-line border-line-strong text-fg1 text-fg2 text-fg3 text-fg-disabled bg-inv-bg text-inv-fg font-sans font-mono`; the class vocabulary every later task uses: `app wb no-insp titlebar brand tsep crumb winctl side side-head lbl toggle nav nav-sep spacer bottom item lab n center toolbar tbtn add ibtn tb-right count qtable qbody cols thead th tr td ck num sel box mixed on name thumb meta size res arr split est pct grew rc st done run q canceled fail prog eta row-act ghost fill totals insp tabs tab tl ibody ihead vs vs-gh vs-set vs-t vs-d vs-sel half vs-in vs-row sbtn seg vs-chk lt vs-est eh ev from dgrid ifoot primary statusbar sitem mini sright warn wipe line tag l r mono sr-only scroll-thin`.

Mockup class names that collide with Tailwind utilities are renamed: `.table` becomes `.qtable`, `.grid` becomes `.dgrid`. Breadcrumb links become `<button>`s, so `.crumb a` becomes `.crumb button`. Every hex literal in the mockup CSS becomes a token.

- [ ] **Step 1: Add the fonts**

```bash
npm install --save-dev @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono
```

(The project keeps every package in `devDependencies`; electron-vite bundles the CSS and font files into `out/renderer`.)

- [ ] **Step 2: Write the failing test**

```ts
// test/theme-tokens.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const css = readFileSync(join(__dirname, '../src/renderer/src/theme/tokens.css'), 'utf-8')

const EXPECTED: Record<string, string> = {
  'bg-0': '#0a0a0a',
  'bg-1': '#0f0f0f',
  hover: '#1a1a1a',
  selected: '#202020',
  field: '#141414',
  track: '#2a2a2a',
  line: '#262626',
  'line-strong': '#3a3a3a',
  fg1: '#ededed',
  fg2: '#b4b4b4',
  fg3: '#8c8c8c',
  'fg-disabled': '#5c5c5c',
  'inv-bg': '#ededed',
  'inv-fg': '#0a0a0a',
  'inv-hover': '#ffffff',
  'inv-active': '#bdbdbd',
  focus: '#ededed'
}

function expand(hex: string): string {
  const h = hex.slice(1).toLowerCase()
  return h.length === 3
    ? h
        .split('')
        .map((c) => c + c)
        .join('')
    : h.slice(0, 6)
}

describe('design tokens', () => {
  it('defines every spec token with its exact value', () => {
    for (const [name, value] of Object.entries(EXPECTED)) {
      const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`))
      expect(m?.[1]?.toLowerCase(), name).toBe(value)
    }
  })

  it('is strictly monochrome: every colour token has r = g = b', () => {
    const all = [...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\b/g)]
    expect(all.length).toBeGreaterThanOrEqual(Object.keys(EXPECTED).length)
    for (const [, name, hex] of all) {
      const h = expand(hex)
      expect(h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6), name).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/theme-tokens.test.ts`
Expected: FAIL, ENOENT for `tokens.css`.

- [ ] **Step 4: Write `theme/tokens.css`** (the only file allowed to hold colour literals)

```css
/* Filesmith design tokens (spec 2.1). Dark only, strictly monochrome: every
   colour has r = g = b. A future theme redefines these and nothing else. */
:root {
  --bg-0: #0a0a0a;
  --bg-1: #0f0f0f;
  --hover: #1a1a1a;
  --selected: #202020;
  --field: #141414;
  --track: #2a2a2a;
  --line: #262626;
  --line-strong: #3a3a3a;
  --fg1: #ededed;
  --fg2: #b4b4b4;
  --fg3: #8c8c8c;
  --fg-disabled: #5c5c5c;
  --inv-bg: #ededed;
  --inv-fg: #0a0a0a;
  --inv-hover: #ffffff;
  --inv-active: #bdbdbd;
  --focus: #ededed;
  --backdrop: rgba(0, 0, 0, 0.6);

  --sans: 'IBM Plex Sans', system-ui, sans-serif;
  --mono: 'IBM Plex Mono', Consolas, monospace;

  --sbw: 208px;
  --sbw-c: 48px;
  --cols: 40px 1fr 64px 88px 184px 232px;
  color-scheme: dark;
}
```

- [ ] **Step 5: Write `theme/base.css`**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  border-radius: 0;
}
html,
body,
#root {
  height: 100%;
  background: var(--bg-0);
}
body {
  margin: 0;
  overflow: hidden;
  color: var(--fg1);
  font: 13px/1.4 var(--sans);
  -webkit-font-smoothing: antialiased;
  user-select: none;
  cursor: default;
}
input,
textarea,
.select-text {
  user-select: text;
}
img {
  -webkit-user-drag: none;
}
button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
button:disabled,
[aria-disabled='true'] {
  cursor: default;
}
svg.i {
  width: 16px;
  height: 16px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.25;
  stroke-linecap: square;
  stroke-linejoin: miter;
}
svg.i * {
  vector-effect: non-scaling-stroke;
}
svg.i12 {
  width: 12px;
  height: 12px;
}
svg.i10 {
  width: 10px;
  height: 10px;
}
:focus-visible {
  outline: 1px solid var(--focus);
  outline-offset: -1px;
}
.mono {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}
.drag {
  -webkit-app-region: drag;
}
.no-drag {
  -webkit-app-region: no-drag;
}
.scroll-thin {
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) var(--bg-0);
}
.scroll-thin::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.scroll-thin::-webkit-scrollbar-track {
  background: var(--bg-0);
}
.scroll-thin::-webkit-scrollbar-thumb {
  background: var(--line-strong);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* App frame (spec 3): title bar, workbench, status bar. */
.app {
  display: grid;
  grid-template-rows: 32px 1fr 24px;
  width: 100vw;
  height: 100vh;
  min-width: 0;
}

/* Menus and dialogs only fade: no scale, no radius (spec 2.3). */
@keyframes fs-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.ctx-pop,
.modal-pop {
  animation: fs-fade 0.12s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .ctx-pop,
  .modal-pop {
    animation: none;
  }
}
```

- [ ] **Step 6: Write `theme/workbench.css`**

This is the mockup's component CSS (`10-s2-vscode-grouped.html:50-319`), tokenised and renamed. Port it rule by rule in this order: title bar, workbench, sidebar, centre, table, inspector, segmented, small button, info grid, footer, status bar, preview, grouped settings, reduced motion. Apply exactly these transformations and nothing else:

| Mockup                                                                                       | Port                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `#ffffff` (hover on inverted surfaces)                                                       | `var(--inv-hover)`                                                                                                        |
| `#bdbdbd` (active on inverted surfaces)                                                      | `var(--inv-active)`                                                                                                       |
| `#141414` (`.vs-sel`, `.vs-in` fill)                                                         | `var(--field)`                                                                                                            |
| `#2a2a2a` (`.seg button:active`)                                                             | `var(--track)`                                                                                                            |
| `.table`                                                                                     | `.qtable`                                                                                                                 |
| `.grid`, `.grid div`, `.grid dt`, `.grid dd`                                                 | `.dgrid`, `.dgrid > div`, `.dgrid dt`, `.dgrid dd`                                                                        |
| `.crumb a`, `.crumb a:hover`                                                                 | `.crumb button` (add `font: inherit`), `.crumb button:hover`                                                              |
| `.ihead b`                                                                                   | `.ihead h1` (add `margin: 0; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`)           |
| `.sitem .mini`, `.sitem .mini i`                                                             | `.mini`, `.mini i` (drop the fixed `width: 43%` on `i`; width comes from inline style; add `overflow: hidden` on `.mini`) |
| `.wipe` background gradient, `.wipe .flr`, `.wipe .btl`                                      | `.wipe { background: var(--bg-1) }`; drop `.flr` and `.btl` (demo art); drop `left: 50%` from `.wipe .line` (set inline)  |
| `html,body`, `body`, `button`, `svg.i`, `:focus-visible`, `.mono`, `:root`                   | not ported here (they live in `base.css` and `tokens.css`)                                                                |
| `.kv*`, `.dv*`, `.sub`, `.chk`, `.seg.dense`, `.estv*`, `.vs-est .bar*`, `.pane`, `.pane.on` | not ported (dead in S2)                                                                                                   |

Then append these rules, which the app needs and the static mockup does not:

```css
.wb.no-insp {
  grid-template-columns: auto 1fr;
}
.center {
  position: relative;
}
.qbody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.thead,
.totals {
  flex: none;
}
.th.ck {
  cursor: default;
}
.th.desc .chev {
  transform: scaleY(-1);
}
.thumb {
  object-fit: cover;
  display: grid;
  place-items: center;
  font: 9px/1 var(--mono);
  color: var(--fg3);
  overflow: hidden;
}
.res .pct.grew {
  font-weight: 600;
}
.st {
  min-width: 0;
}
.st.canceled {
  color: var(--fg3);
}
.st.fail {
  overflow: hidden;
}
.row-act {
  flex: none;
}
.insp {
  min-width: 0;
}
.ihead span {
  white-space: nowrap;
}
.dgrid {
  border-top: 1px solid var(--line);
}
.dgrid > div {
  min-height: 32px;
  height: auto;
}
.dgrid dd {
  gap: 8px;
  padding: 6px 12px 6px 14px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.sitem {
  white-space: nowrap;
}
.count {
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .seg button,
  .sbtn,
  .vs-sel,
  .vs-in {
    transition: none;
  }
}
```

Check: `grep -nE "#[0-9a-fA-F]{3,8}\b" src/renderer/src/theme/workbench.css` prints nothing.

- [ ] **Step 7: Rewrite `index.css`**

Replace the whole file with:

```css
@import 'tailwindcss';
@import './theme/tokens.css';
@import './theme/base.css';
@import './theme/workbench.css';

/* Mirror the tokens into Tailwind so utilities (bg-bg-0, text-fg2,
   border-line) resolve to the variables; a future theme redefines only the
   variables. The old light tokens (ink, muted, dim, canvas, accent*) are gone. */
@theme inline {
  --color-bg-0: var(--bg-0);
  --color-bg-1: var(--bg-1);
  --color-hover: var(--hover);
  --color-selected: var(--selected);
  --color-field: var(--field);
  --color-track: var(--track);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-fg1: var(--fg1);
  --color-fg2: var(--fg2);
  --color-fg3: var(--fg3);
  --color-fg-disabled: var(--fg-disabled);
  --color-inv-bg: var(--inv-bg);
  --color-inv-fg: var(--inv-fg);
  --font-sans: var(--sans);
  --font-mono: var(--mono);
}
```

The dead viewer CSS (`.preview-stage`, `.fs-bar`, `.fs-art`, `.md-body`), the light `@theme` block, the old `ctxpop` / `modalpop` keyframes, the old `.scroll-thin` and the `@layer base` cursor rules all go with the old file (`base.css` now owns cursors). `.fs-fill` and `.fs-indet` go too; their replacement is the `ProgressBar` primitive (Task 10).

- [ ] **Step 8: Import the fonts**

At the top of `src/renderer/src/main.tsx`, before `import './index.css'`:

```ts
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
```

- [ ] **Step 9: Verify**

Run: `npx vitest run test/theme-tokens.test.ts && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green; `out/renderer/assets` contains `ibm-plex-*.woff2` files.

Run: `npm run dev`. The window is dark and IBM Plex renders; the old components look broken (their light classes no longer resolve). That is expected until Tasks 11 to 16 replace them.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/renderer/src/theme src/renderer/src/index.css src/renderer/src/main.tsx test/theme-tokens.test.ts
git commit -m "feat(theme): monochrome dark tokens, bundled IBM Plex, workbench CSS; drop light theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 16px icon registry and typed icon names

**Files:**

- Create: `src/shared/icons.ts`, `src/renderer/src/components/icons/shapes.ts`, `src/renderer/src/components/icons/Icon.tsx`
- Modify: `src/shared/tabs.ts` (`Tab.icon` `:18`, `ToolCard.icon` `:117`, the Generate icon `:78`, `COMPLETED_TAB.icon` `:105`)
- Test: `test/icons.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `ICON_NAMES` (readonly tuple) and `type IconName` from `@shared/icons`; `ICON_SHAPES: Record<IconName, Prim[]>` where `type Prim = ['path', string] | ['rect', number, number, number, number] | ['circle', number, number, number]`; `<Icon name={IconName} size?={16 | 12 | 10} strokeWidth?={number} className?={string} />` from `components/icons/Icon.tsx`. `Tab.icon` and `ToolCard.icon` are typed `IconName`.

Shapes are plain data in a `.ts` file, so the registry is testable in Vitest without a JSX transform. The old `components/Icon.tsx` stays until its last consumer goes (Task 16). Window-control glyphs stay in `WinControls` as their own 10x10 paths (spec 2.4), so `minimize` / `maximize` are not registry entries.

- [ ] **Step 1: Write the failing test**

```ts
// test/icons.test.ts
import { describe, expect, it } from 'vitest'
import { ICON_NAMES } from '@shared/icons'
import { ICON_SHAPES } from '../src/renderer/src/components/icons/shapes'
import { COMPLETED_TAB, SETTINGS_TAB, TABS, TOOL_CARDS } from '@shared/tabs'

describe('icon registry', () => {
  it('draws every declared icon', () => {
    for (const n of ICON_NAMES) expect(ICON_SHAPES[n]?.length, n).toBeGreaterThan(0)
  })
  it('contains the full mockup set', () => {
    const mockup = [
      'convert',
      'compress',
      'resize',
      'upscale',
      'removebg',
      'generate',
      'tools',
      'completed',
      'settings',
      'addfile',
      'folder',
      'play',
      'stop',
      'retry',
      'close',
      'check',
      'warning',
      'clock',
      'sync',
      'chev-r',
      'chev-d',
      'trash',
      'eye',
      'info',
      'arrow',
      'sidebar',
      'anvil'
    ]
    for (const n of mockup) expect(ICON_NAMES as readonly string[]).toContain(n)
  })
  it('stays inside the 16px grid', () => {
    for (const [name, prims] of Object.entries(ICON_SHAPES))
      for (const p of prims)
        if (p[0] !== 'path')
          for (const v of p.slice(1) as number[]) expect(v, name).toBeLessThanOrEqual(16)
  })
  it('every tab and tool card names a real icon', () => {
    for (const t of [...TABS, COMPLETED_TAB, SETTINGS_TAB, ...TOOL_CARDS])
      expect(ICON_NAMES as readonly string[]).toContain(t.icon)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/icons.test.ts`
Expected: FAIL, `@shared/icons` not found.

- [ ] **Step 3: Implement `src/shared/icons.ts`**

```ts
// Icon names shared by the navigation model (tabs.ts) and the renderer's
// registry, so a misspelt icon fails typecheck instead of rendering nothing.
export const ICON_NAMES = [
  'convert',
  'compress',
  'resize',
  'upscale',
  'removebg',
  'generate',
  'tools',
  'completed',
  'settings',
  'addfile',
  'folder',
  'play',
  'stop',
  'retry',
  'close',
  'check',
  'warning',
  'clock',
  'sync',
  'chev-r',
  'chev-d',
  'trash',
  'eye',
  'info',
  'arrow',
  'sidebar',
  'anvil',
  'image',
  'pdf',
  'text',
  'merge',
  'split',
  'burst',
  'pull',
  'archive',
  'video',
  'audio',
  'doc',
  'unpack',
  'topdf',
  'tocbz',
  'edit',
  'grip',
  'dots'
] as const

export type IconName = (typeof ICON_NAMES)[number]
```

- [ ] **Step 4: Implement `components/icons/shapes.ts`**

The first 27 entries are copied from the mockup's `<symbol>`s (`10-s2-vscode-grouped.html:327-353`); the rest are drawn in the same 16px, 1.25 stroke language.

```ts
import type { IconName } from '@shared/icons'

export type Prim =
  ['path', string] | ['rect', number, number, number, number] | ['circle', number, number, number]

const page = 'M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3'
const box = 'M2 2.5h12v3H2z M3 5.5v8h10v-8'

export const ICON_SHAPES: Record<IconName, Prim[]> = {
  convert: [['path', 'M2.5 5.5h10.5M10.5 3l2.5 2.5-2.5 2.5M13.5 10.5H3M5.5 8L3 10.5 5.5 13']],
  compress: [['path', 'M8 1.5V6M5.5 3.5L8 6l2.5-2.5M8 14.5V10M5.5 12.5L8 10l2.5 2.5M2.5 8h11']],
  resize: [['path', 'M2.5 6V2.5H6M13.5 10v3.5H10M3 3l10 10']],
  upscale: [
    ['rect', 2.5, 8.5, 5, 5],
    ['path', 'M9 2.5h4.5V7M13.5 2.5L8.5 7.5']
  ],
  removebg: [['path', 'M9.5 2.5l4 4-6 6H4.5l-2-2 7-8zM6 6l4 4M8 13.5h5.5']],
  generate: [
    ['path', 'M7 2l1.2 3.3L11.5 6.5 8.2 7.7 7 11 5.8 7.7 2.5 6.5l3.3-1.2zM12.5 10v4M10.5 12h4']
  ],
  tools: [
    ['rect', 2.5, 2.5, 4.5, 4.5],
    ['rect', 9, 2.5, 4.5, 4.5],
    ['rect', 2.5, 9, 4.5, 4.5],
    ['rect', 9, 9, 4.5, 4.5]
  ],
  completed: [
    ['circle', 8, 8, 5.5],
    ['path', 'M5.5 8.25l1.75 1.75L10.75 6.5']
  ],
  settings: [
    ['path', 'M2.5 5h5M10.5 5h3M2.5 11h2M7.5 11h6'],
    ['circle', 9, 5, 1.5],
    ['circle', 6, 11, 1.5]
  ],
  addfile: [['path', 'M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3M8 7v5M5.5 9.5h5']],
  folder: [['path', 'M1.5 3.5h4.5l1.5 1.5h7v8h-13z']],
  play: [['path', 'M5 3.5v9l7.5-4.5z']],
  stop: [['rect', 4, 4, 8, 8]],
  retry: [['path', 'M3 3v3h3M3.3 6A5 5 0 1 1 3 9.5']],
  close: [['path', 'M4 4l8 8M12 4l-8 8']],
  check: [['path', 'M3 8.5l3 3 7-7']],
  warning: [['path', 'M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.5']],
  clock: [
    ['circle', 8, 8, 5.5],
    ['path', 'M8 5v3l2 1.5']
  ],
  sync: [['path', 'M13.5 8A5.5 5.5 0 1 1 8 2.5']],
  'chev-r': [['path', 'M6 4l4 4-4 4']],
  'chev-d': [['path', 'M4 6l4 4 4-4']],
  trash: [['path', 'M3 4.5h10M6 4.5V2.5h4v2M4.5 4.5l.5 9h6l.5-9']],
  eye: [
    ['path', 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z'],
    ['circle', 8, 8, 2]
  ],
  info: [
    ['circle', 8, 8, 5.5],
    ['path', 'M8 7.5v3.5M8 5v.5']
  ],
  arrow: [['path', 'M3 8h10M10 5l3 3-3 3']],
  sidebar: [
    ['rect', 2, 2.5, 12, 11],
    ['path', 'M6 2.5v11M10.5 6.5L9 8l1.5 1.5']
  ],
  anvil: [['path', 'M1.5 4.5h10c0 2 1.5 3 3 3v1h-5l-1 2h2v2h-6v-2h2l-1-2c-2.5 0-4-1.5-4-4z']],
  image: [
    ['rect', 2.5, 2.5, 11, 11],
    ['path', 'M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5'],
    ['circle', 10.5, 5.5, 1]
  ],
  pdf: [['path', `${page}M5.5 9h5M5.5 11.5h3`]],
  text: [['path', 'M3 4h10M3 7h10M3 10h10M3 13h6']],
  merge: [['path', 'M2.5 3l5.5 5M13.5 3L8 8v6M5.5 11.5L8 14l2.5-2.5']],
  split: [['path', 'M8 2v6l-5.5 5.5M8 8l5.5 5.5M5.5 4.5L8 2l2.5 2.5']],
  burst: [
    ['rect', 2.5, 3.5, 5, 6],
    ['rect', 8.5, 6.5, 5, 6]
  ],
  pull: [['path', 'M2.5 6.5v7h11v-7M8 2v8M5.5 7.5L8 10l2.5-2.5']],
  archive: [['path', `${box}M6.5 8.5h3`]],
  video: [
    ['rect', 1.5, 3.5, 9, 9],
    ['path', 'M10.5 7l4-2.5v7l-4-2.5']
  ],
  audio: [
    ['path', 'M6 12V3.5l7.5-1.5V10.5'],
    ['circle', 4.5, 12, 1.5],
    ['circle', 12, 10.5, 1.5]
  ],
  doc: [['path', `${page}M5.5 8h5M5.5 10.5h5M5.5 13h3`]],
  unpack: [['path', `${box}M8 7v5M5.5 9.5L8 12l2.5-2.5`]],
  topdf: [['path', 'M5.5 1.5h5l3 3v10h-8v-4M10.5 1.5v3h3M1.5 8h6M5 5.5L7.5 8 5 10.5']],
  tocbz: [
    ['rect', 6.5, 6.5, 8, 7],
    ['path', 'M1.5 4h7M6 1.5L8.5 4 6 6.5']
  ],
  edit: [['path', 'M10.5 2.5l3 3-8 8h-3v-3zM9 4l3 3']],
  grip: [
    ['circle', 6, 4, 0.75],
    ['circle', 10, 4, 0.75],
    ['circle', 6, 8, 0.75],
    ['circle', 10, 8, 0.75],
    ['circle', 6, 12, 0.75],
    ['circle', 10, 12, 0.75]
  ],
  dots: [
    ['circle', 8, 3.5, 0.75],
    ['circle', 8, 8, 0.75],
    ['circle', 8, 12.5, 0.75]
  ]
}
```

- [ ] **Step 5: Implement `components/icons/Icon.tsx`**

```tsx
import type { JSX } from 'react'
import type { IconName } from '@shared/icons'
import { ICON_SHAPES } from './shapes'

export function Icon({
  name,
  size = 16,
  strokeWidth,
  className = ''
}: {
  name: IconName
  size?: 16 | 12 | 10
  strokeWidth?: number
  className?: string
}): JSX.Element {
  const cls = `i${size === 12 ? ' i12' : size === 10 ? ' i10' : ''}${className ? ' ' + className : ''}`
  return (
    <svg
      className={cls}
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={strokeWidth ? { strokeWidth } : undefined}
    >
      {ICON_SHAPES[name].map((p, i) =>
        p[0] === 'path' ? (
          <path key={i} d={p[1]} />
        ) : p[0] === 'rect' ? (
          <rect key={i} x={p[1]} y={p[2]} width={p[3]} height={p[4]} />
        ) : (
          <circle key={i} cx={p[1]} cy={p[2]} r={p[3]} />
        )
      )}
    </svg>
  )
}
```

- [ ] **Step 6: Type the tab icons**

In `src/shared/tabs.ts` add `import type { IconName } from './icons'`, change `icon: string` to `icon: IconName` in both `Tab` and `ToolCard`, change the Generate tab's `icon: 'image'` to `icon: 'generate'` and `COMPLETED_TAB`'s `icon: 'check'` to `icon: 'completed'`. The old `TabRail` / `ToolsGrid` cast `c.icon as IconName` (the old union) and still compile; they are deleted in Tasks 11 and 15.

- [ ] **Step 7: Verify**

Run: `npx vitest run test/icons.test.ts && npm test && npm run typecheck && npm run lint`
Expected: PASS and clean.

- [ ] **Step 8: Commit**

```bash
git add src/shared/icons.ts src/shared/tabs.ts src/renderer/src/components/icons test/icons.test.ts
git commit -m "feat(ui): 16px stroke icon registry with typed icon names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: UI primitives

**Files:**

- Create in `src/renderer/src/components/ui/`: `roving.ts`, `selectNav.ts`, `Button.tsx`, `Checkbox.tsx`, `Segmented.tsx`, `Select.tsx`, `TextField.tsx`, `Setting.tsx`, `RangeField.tsx`, `ChipGrid.tsx`, `ProgressBar.tsx`, `Tabs.tsx`, `EstimateCard.tsx`, `OutputSizeList.tsx`
- Create: `src/renderer/src/theme/controls.css`
- Modify: `src/renderer/src/index.css` (add `@import './theme/controls.css';` after `workbench.css`)
- Test: `test/ui-nav.test.ts`

**Interfaces:**

- Consumes: `Icon` (Task 9); `formatBytes` from `@shared/compress`; `pctChange`, `formatPct` from `components/queue/rowModel.ts` (Task 5).
- Produces (exact names and props; later tasks use them):
  - `rovingIndex(key: string, i: number, n: number, axis?: 'x' | 'y'): number | null`
  - `interface SelectOption<T extends string> { value: T; label: string; disabled?: boolean; reason?: string; group?: string }` and `nextEnabled(options: { label: string; disabled?: boolean }[], i: number, key: string): number | null`, both from `selectNav.ts`
  - `AddFilesButton(props: ButtonHTMLAttributes<HTMLButtonElement>)`, `IconButton({ icon, label, ...button })`, `SmallButton({ icon?, children, ...button })`, `RowAction({ icon, label, ghost?, ...button })`, `PrimaryButton({ icon?, children, ...button })`
  - `Checkbox({ checked: boolean | 'mixed', onChange: () => void, label: string, size?: 'sm' | 'md', focusable?: boolean })`
  - `Segmented<T extends string>({ value: T, options: { value: T; label: string }[], onChange: (v: T) => void, label: string })`
  - `Select<T extends string>({ value: T, options: SelectOption<T>[], onChange: (v: T) => void, label: string, half?: boolean, disabled?: boolean, placeholder?: string })`
  - `TextField(props: InputHTMLAttributes<HTMLInputElement>)`, `NumberField({ value: number | '', onCommit: (v: number | '') => void, label: string, placeholder?: string, clamp?: (n: number) => number })`
  - `SettingGroup({ title: string, collapsible?: boolean, open?: boolean, onToggle?: () => void, children })`, `Setting({ title: string, desc?: ReactNode, warn?: boolean, children? })`, `CheckSetting({ checked: boolean, onChange: (v: boolean) => void, label: string, sub?: string })`
  - `RangeField({ label, value, min, max, step?, onChange: (v: number) => void, format?: (v: number) => string, ends?: [string, string] })`
  - `interface Chip<T extends string | number> { value: T; label: string; disabled?: boolean; title?: string }` and `ChipGrid<T>({ value: T | null, chips: Chip<T>[], onChange, label, cols? })`
  - `ProgressBar({ value?: number | null, label: string, wide?: boolean })` (`null` or omitted means indeterminate)
  - `interface TabDef<T extends string> { id: T; label: string; icon: IconName }` and `Tabs<T>({ tabs, value, onChange, label, idPrefix })`
  - `EstimateCard({ from: number, to: number, files: number })`
  - `interface SizeRow { name: string; from: string; to: string }` (exported from `OutputSizeList.tsx` as a type) and `OutputSizeList({ rows: SizeRow[] })`

- [ ] **Step 1: Write the failing test**

```ts
// test/ui-nav.test.ts
import { describe, expect, it } from 'vitest'
import { rovingIndex } from '../src/renderer/src/components/ui/roving'
import { nextEnabled } from '../src/renderer/src/components/ui/selectNav'

describe('rovingIndex', () => {
  it('wraps left and right on the x axis', () => {
    expect(rovingIndex('ArrowRight', 2, 3)).toBe(0)
    expect(rovingIndex('ArrowLeft', 0, 3)).toBe(2)
  })
  it('uses up and down on the y axis only', () => {
    expect(rovingIndex('ArrowDown', 0, 3, 'y')).toBe(1)
    expect(rovingIndex('ArrowRight', 0, 3, 'y')).toBeNull()
  })
  it('jumps with Home and End', () => {
    expect(rovingIndex('Home', 2, 3)).toBe(0)
    expect(rovingIndex('End', 0, 3)).toBe(2)
  })
  it('does nothing for an empty set or another key', () => {
    expect(rovingIndex('ArrowRight', 0, 0)).toBeNull()
    expect(rovingIndex('a', 0, 3)).toBeNull()
  })
})

describe('nextEnabled (select popup keyboard)', () => {
  const opts = [
    { label: 'webp' },
    { label: 'png', disabled: true },
    { label: 'avif' },
    { label: 'jpg' }
  ]
  it('skips disabled options with the arrows and stops at the ends', () => {
    expect(nextEnabled(opts, 0, 'ArrowDown')).toBe(2)
    expect(nextEnabled(opts, 2, 'ArrowUp')).toBe(0)
    expect(nextEnabled(opts, 3, 'ArrowDown')).toBe(3)
  })
  it('Home and End land on enabled options', () => {
    expect(nextEnabled([{ label: 'x', disabled: true }, ...opts], 3, 'Home')).toBe(1)
    expect(nextEnabled(opts, 0, 'End')).toBe(3)
  })
  it('type-ahead finds the next enabled match after the current one', () => {
    expect(nextEnabled(opts, 0, 'a')).toBe(2)
    expect(nextEnabled(opts, 0, 'p')).toBeNull() // png is disabled
    expect(nextEnabled(opts, 2, 'W')).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/ui-nav.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the two pure helpers**

```ts
// src/renderer/src/components/ui/roving.ts
/** Next index for roving-tabindex groups (tabs, segments, chips). */
export function rovingIndex(
  key: string,
  i: number,
  n: number,
  axis: 'x' | 'y' = 'x'
): number | null {
  if (n <= 0) return null
  const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
  const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
  if (key === back) return (i - 1 + n) % n
  if (key === fwd) return (i + 1) % n
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  return null
}
```

```ts
// src/renderer/src/components/ui/selectNav.ts
export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  /** Shown after the label, for example "WinRAR not found" on a disabled
   * target or "needs download" on a selectable Generate model. */
  reason?: string
  /** Option-group heading (Generate's architectures). */
  group?: string
}

/** Keyboard movement inside the select popup: arrows skip disabled items and
 * stop at the ends, Home/End land on enabled items, a printable key jumps to the
 * next enabled label starting with it. */
export function nextEnabled(
  options: { label: string; disabled?: boolean }[],
  i: number,
  key: string
): number | null {
  const ok = (k: number): boolean => k >= 0 && k < options.length && !options[k].disabled
  if (key === 'ArrowDown') {
    for (let k = i + 1; k < options.length; k++) if (ok(k)) return k
    return i
  }
  if (key === 'ArrowUp') {
    for (let k = i - 1; k >= 0; k--) if (ok(k)) return k
    return i
  }
  if (key === 'Home') {
    for (let k = 0; k < options.length; k++) if (ok(k)) return k
    return null
  }
  if (key === 'End') {
    for (let k = options.length - 1; k >= 0; k--) if (ok(k)) return k
    return null
  }
  if (key.length === 1) {
    const c = key.toLowerCase()
    for (let step = 1; step <= options.length; step++) {
      const k = (i + step) % options.length
      if (ok(k) && options[k].label.toLowerCase().startsWith(c)) return k
    }
    return null
  }
  return null
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/ui-nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the components**

```tsx
// src/renderer/src/components/ui/Button.tsx
import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react'
import type { IconName } from '@shared/icons'
import { Icon } from '../icons/Icon'

type B = ButtonHTMLAttributes<HTMLButtonElement>

export function AddFilesButton({ children = 'Add files', ...rest }: B): JSX.Element {
  return (
    <button type="button" className="tbtn add" {...rest}>
      <Icon name="addfile" />
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  label,
  ...rest
}: B & { icon: IconName; label: string }): JSX.Element {
  return (
    <button type="button" className="ibtn" aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  )
}

export function SmallButton({
  icon,
  children,
  ...rest
}: B & { icon?: IconName; children: ReactNode }): JSX.Element {
  return (
    <button type="button" className="sbtn" {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

export function RowAction({
  icon,
  label,
  ghost,
  ...rest
}: B & { icon: IconName; label: string; ghost?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={`row-act${ghost ? ' ghost' : ''}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  )
}

export function PrimaryButton({
  icon = 'play',
  children,
  ...rest
}: B & { icon?: IconName; children: ReactNode }): JSX.Element {
  return (
    <button type="button" className="primary" {...rest}>
      <Icon name={icon} />
      {children}
    </button>
  )
}
```

```tsx
// src/renderer/src/components/ui/Checkbox.tsx
import type { JSX } from 'react'
import { Icon } from '../icons/Icon'

export function Checkbox({
  checked,
  onChange,
  label,
  size = 'sm',
  focusable = false
}: {
  checked: boolean | 'mixed'
  onChange: () => void
  label: string
  size?: 'sm' | 'md'
  /** Table rows take focus themselves, so row boxes are tabindex -1 (spec 4.1). */
  focusable?: boolean
}): JSX.Element {
  const on = checked === true
  return (
    <span
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : on}
      aria-label={label}
      tabIndex={focusable ? 0 : -1}
      className={`box${on ? ' on' : ''}${checked === 'mixed' ? ' mixed' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onChange()
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          onChange()
        }
      }}
    >
      {on && <Icon name="check" size={size === 'md' ? 12 : 10} strokeWidth={2} />}
    </span>
  )
}
```

```tsx
// src/renderer/src/components/ui/Segmented.tsx
import { useRef, type JSX } from 'react'
import { rovingIndex } from './roving'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = options.findIndex((o) => o.value === value)
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={i === idx}
          tabIndex={i === (idx < 0 ? 0 : idx) ? 0 : -1}
          className={i === idx ? 'on' : ''}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const n = rovingIndex(e.key, i, options.length)
            if (n == null) return
            e.preventDefault()
            onChange(options[n].value)
            refs.current[n]?.focus()
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

```tsx
// src/renderer/src/components/ui/Select.tsx
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Icon } from '../icons/Icon'
import { nextEnabled, type SelectOption } from './selectNav'

// A custom listbox (spec 2.7): Chromium draws a native <select> popup in light
// OS chrome, which breaks the dark-only rule.
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  half,
  disabled,
  placeholder = 'choose'
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (v: T) => void
  label: string
  half?: boolean
  disabled?: boolean
  placeholder?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const blur = (): void => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', blur)
    }
  }, [open])

  function show(): void {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value)
      )
    )
    setOpen(true)
  }
  function commit(i: number): void {
    const o = options[i]
    if (!o || o.disabled) return
    onChange(o.value)
    setOpen(false)
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>): void {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(active)
      return
    }
    const n = nextEnabled(options, active, e.key)
    if (n != null) {
      e.preventDefault()
      setActive(n)
    }
  }

  return (
    <div ref={root} className={`vs-selwrap${half ? ' half' : ''}`}>
      <button
        type="button"
        className={`vs-sel${half ? ' half' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={label}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span className="val">
          {current ? current.label : <span className="ph">{placeholder}</span>}
        </span>
        <Icon name="chev-d" />
      </button>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="vs-pop scroll-thin">
          {options.flatMap((o, i) => {
            const head = o.group && o.group !== options[i - 1]?.group ? o.group : null
            const opt = (
              <li
                key={o.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                className={`${i === active ? 'act' : ''}${o.value === value ? ' cur' : ''}${o.disabled ? ' dis' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => commit(i)}
              >
                <span className="val">
                  {o.label}
                  {o.reason ? `, ${o.reason}` : ''}
                </span>
                {o.value === value && <Icon name="check" />}
              </li>
            )
            return head
              ? [
                  <li key={`g-${head}`} role="presentation" className="vs-pop-gh">
                    {head.toUpperCase()}
                  </li>,
                  opt
                ]
              : [opt]
          })}
        </ul>
      )}
    </div>
  )
}
```

```tsx
// src/renderer/src/components/ui/TextField.tsx
import { useState, type InputHTMLAttributes, type JSX } from 'react'

export function TextField({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input spellCheck={false} {...rest} className={`vs-in ${className}`} />
}

/** Commit-on-blur/Enter number input with optional clamping (replaces DimInput).
 * The draft exists only while editing, so no effect has to sync it. */
export function NumberField({
  value,
  onCommit,
  label,
  placeholder,
  clamp
}: {
  value: number | ''
  onCommit: (v: number | '') => void
  label: string
  placeholder?: string
  clamp?: (n: number) => number
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  function commit(): void {
    if (draft == null) return
    const t = draft.trim()
    if (t === '') onCommit('')
    else {
      const n = Number(t)
      if (Number.isFinite(n)) onCommit(clamp ? clamp(n) : n)
    }
    setDraft(null)
  }
  return (
    <input
      className="vs-in"
      inputMode="numeric"
      spellCheck={false}
      aria-label={label}
      placeholder={placeholder}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}
```

```tsx
// src/renderer/src/components/ui/Setting.tsx
import type { JSX, ReactNode } from 'react'
import { Icon } from '../icons/Icon'
import { Checkbox } from './Checkbox'

export function SettingGroup({
  title,
  collapsible,
  open = true,
  onToggle,
  children
}: {
  title: string
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <section className="vs-grp">
      <h2 className="vs-gh">
        {collapsible ? (
          <button type="button" className="vs-ghb" aria-expanded={open} onClick={onToggle}>
            <Icon name={open ? 'chev-d' : 'chev-r'} size={12} />
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
      {open && children}
    </section>
  )
}

export function Setting({
  title,
  desc,
  warn,
  children
}: {
  title: string
  desc?: ReactNode
  /** Prefix the description with the warning glyph (monochrome warning). */
  warn?: boolean
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="vs-set">
      <div className="vs-t">{title}</div>
      {desc != null && (
        <div className={`vs-d${warn ? ' warn' : ''}`}>
          {warn && <Icon name="warning" size={12} />}
          {desc}
        </div>
      )}
      {children}
    </div>
  )
}

export function CheckSetting({
  checked,
  onChange,
  label,
  sub
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  sub?: string
}): JSX.Element {
  return (
    <div className="vs-chk" onClick={() => onChange(!checked)}>
      <Checkbox
        checked={checked}
        onChange={() => onChange(!checked)}
        label={label}
        size="md"
        focusable
      />
      <span className="lt">
        {label}
        {sub && <span>{sub}</span>}
      </span>
    </div>
  )
}
```

```tsx
// src/renderer/src/components/ui/RangeField.tsx
import type { CSSProperties, JSX } from 'react'

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
  ends
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  ends?: [string, string]
}): JSX.Element {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <div className="rng">
      <div className="rng-row">
        <input
          type="range"
          aria-label={label}
          aria-valuetext={format(value)}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ '--fill': `${fill}%` } as CSSProperties}
        />
        <output className="mono">{format(value)}</output>
      </div>
      {ends && (
        <div className="rng-ends mono">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  )
}
```

```tsx
// src/renderer/src/components/ui/ChipGrid.tsx
import { useRef, type JSX } from 'react'
import { rovingIndex } from './roving'

export interface Chip<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

export function ChipGrid<T extends string | number>({
  value,
  chips,
  onChange,
  label,
  cols = 4
}: {
  value: T | null
  chips: Chip<T>[]
  onChange: (v: T) => void
  label: string
  cols?: number
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = chips.findIndex((c) => c.value === value && !c.disabled)
  const focusIdx =
    idx >= 0
      ? idx
      : Math.max(
          0,
          chips.findIndex((c) => !c.disabled)
        )
  return (
    <div
      className="chips"
      role="radiogroup"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {chips.map((c, i) => (
        <button
          key={String(c.value)}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={i === idx}
          aria-disabled={c.disabled || undefined}
          tabIndex={i === focusIdx ? 0 : -1}
          title={c.title}
          className={`chip${i === idx ? ' on' : ''}`}
          onClick={() => !c.disabled && onChange(c.value)}
          onKeyDown={(e) => {
            let n = rovingIndex(e.key, i, chips.length)
            if (n == null) return
            e.preventDefault()
            const dir = e.key === 'ArrowLeft' || e.key === 'End' ? -1 : 1
            for (let s = 0; s < chips.length && chips[n].disabled; s++)
              n = (n + dir + chips.length) % chips.length
            if (chips[n].disabled) return
            onChange(chips[n].value)
            refs.current[n]?.focus()
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
```

```tsx
// src/renderer/src/components/ui/ProgressBar.tsx
import type { JSX } from 'react'

/** 2px track with an fg1 fill; a null value is an indeterminate sweep (static
 * under reduced motion). Replaces the three copies in the tool setup cards. */
export function ProgressBar({
  value,
  label,
  wide
}: {
  value?: number | null
  label: string
  wide?: boolean
}): JSX.Element {
  const ind = value == null
  return (
    <div
      className={`mini${wide ? ' wide' : ''}${ind ? ' ind' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ind ? undefined : Math.round(value)}
    >
      <i style={ind ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}
```

```tsx
// src/renderer/src/components/ui/Tabs.tsx
import { useRef, type JSX } from 'react'
import type { IconName } from '@shared/icons'
import { Icon } from '../icons/Icon'
import { rovingIndex } from './roving'

export interface TabDef<T extends string> {
  id: T
  label: string
  icon: IconName
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix
}: {
  tabs: TabDef<T>[]
  value: T
  onChange: (v: T) => void
  label: string
  idPrefix: string
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          className={`tab${t.id === value ? ' on' : ''}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const n = rovingIndex(e.key, i, tabs.length)
            if (n == null) return
            e.preventDefault()
            onChange(tabs[n].id)
            refs.current[n]?.focus()
          }}
        >
          <Icon name={t.icon} />
          <span className="tl" data-t={t.label}>
            {t.label}
          </span>
        </button>
      ))}
    </div>
  )
}
```

```tsx
// src/renderer/src/components/ui/EstimateCard.tsx
import type { JSX } from 'react'
import { formatBytes } from '@shared/compress'
import { Icon } from '../icons/Icon'
import { formatPct, pctChange } from '../queue/rowModel'

export function EstimateCard({
  from,
  to,
  files
}: {
  from: number
  to: number
  files: number
}): JSX.Element {
  const pct = pctChange(from, to)
  const noun = `${files} file${files === 1 ? '' : 's'}`
  const label = `Estimated output for ${noun}: ${formatBytes(from)} to about ${formatBytes(to)}${
    pct != null ? `, ${formatPct(pct)}` : ''
  }`
  return (
    <div className="vs-est" role="group" aria-label={label}>
      <div className="eh">
        <span>estimate</span>
        <span>{noun}</span>
      </div>
      <div className="ev">
        <span className="from">{formatBytes(from)}</span>
        <Icon name="arrow" size={12} />
        <b>~{formatBytes(to)}</b>
        {pct != null && <span className="pct">{formatPct(pct)}</span>}
      </div>
    </div>
  )
}
```

```tsx
// src/renderer/src/components/ui/OutputSizeList.tsx
import type { JSX } from 'react'

export type SizeRow = { name: string; from: string; to: string }

/** Input to output resolution list under the video scale, resize and upscale
 * settings (replaces three identical copies). */
export function OutputSizeList({ rows }: { rows: SizeRow[] }): JSX.Element | null {
  if (!rows.length) return null
  return (
    <ul className="sizes mono">
      {rows.map((r, i) => (
        <li key={`${i}-${r.name}`} title={r.name}>
          <span className="nm">{r.name}</span>
          <span>
            {r.from} to {r.to}
          </span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 6: Write `theme/controls.css`**

```css
/* Controls the mockup does not draw, in its language (spec 2.5 and 2.7). */

/* disabled: fg-disabled text, line border, no hover change */
.sbtn:disabled,
.vs-sel:disabled,
.ibtn:disabled,
.row-act:disabled,
.chip[aria-disabled='true'] {
  color: var(--fg-disabled);
  border-color: var(--line);
  background: transparent;
}
.sbtn:disabled svg,
.vs-sel:disabled svg {
  color: var(--fg-disabled);
}
.primary:disabled {
  background: var(--selected);
  color: var(--fg-disabled);
}

/* select popup */
.vs-selwrap {
  position: relative;
  width: 100%;
}
.vs-selwrap.half {
  width: 168px;
}
.vs-row .vs-selwrap {
  flex: 1;
  width: auto;
}
.vs-sel .ph {
  color: var(--fg3);
}
.vs-pop {
  position: absolute;
  z-index: 30;
  left: 0;
  right: 0;
  top: 100%;
  max-height: 280px;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  background: var(--bg-0);
  border: 1px solid var(--line-strong);
  border-top: 0;
}
.vs-pop li[role='option'] {
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  font: 13px var(--mono);
  color: var(--fg2);
  cursor: pointer;
}
.vs-pop li .val {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vs-pop li.act {
  background: var(--hover);
  color: var(--fg1);
}
.vs-pop li.cur {
  color: var(--fg1);
  font-weight: 600;
}
.vs-pop li.dis {
  color: var(--fg-disabled);
  cursor: default;
}
.vs-pop-gh {
  padding: 10px 8px 4px;
  font: 600 11px/1 var(--mono);
  letter-spacing: 0.09em;
  color: var(--fg3);
}

/* group header that collapses (Generate > ADVANCED) */
.vs-ghb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
}
.vs-ghb:hover {
  color: var(--fg1);
}
.vs-d.warn {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  color: var(--fg2);
}
.vs-d.warn svg {
  margin-top: 2px;
}

/* chip grid: square outlined cells, the selected one inverted */
.chips {
  display: grid;
  border-top: 1px solid var(--line-strong);
  border-left: 1px solid var(--line-strong);
}
.chip {
  height: 28px;
  display: grid;
  place-items: center;
  font: 13px/1 var(--mono);
  color: var(--fg2);
  border-right: 1px solid var(--line-strong);
  border-bottom: 1px solid var(--line-strong);
  transition:
    background-color 0.1s,
    color 0.1s;
}
.chip:hover:not([aria-disabled='true']) {
  background: var(--hover);
  color: var(--fg1);
}
.chip:active:not([aria-disabled='true']) {
  background: var(--track);
}
.chip.on {
  background: var(--inv-bg);
  color: var(--inv-fg);
  font-weight: 600;
}
.chip.on:hover {
  background: var(--inv-hover);
}
.chip:focus-visible {
  outline-offset: -3px;
  position: relative;
  z-index: 1;
}

/* range: 2px track, fg1 fill, square 10px thumb */
.rng-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rng output {
  min-width: 52px;
  text-align: right;
  font-size: 13px;
  color: var(--fg1);
}
.rng input[type='range'] {
  flex: 1;
  height: 16px;
  margin: 0;
  background: transparent;
  appearance: none;
  cursor: pointer;
}
.rng input[type='range']::-webkit-slider-runnable-track {
  height: 2px;
  background: linear-gradient(to right, var(--fg1) var(--fill), var(--track) var(--fill));
}
.rng input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 10px;
  height: 10px;
  margin-top: -4px;
  background: var(--fg1);
  border: 0;
}
.rng input[type='range']:hover::-webkit-slider-thumb {
  background: var(--inv-hover);
}
.rng input[type='range']:focus-visible {
  outline-offset: 2px;
}
.rng-ends {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--fg3);
  margin-top: 2px;
}

/* progress: determinate fill or an indeterminate sweep */
.mini.wide {
  width: 100%;
}
.mini.ind i {
  width: 30%;
  animation: fs-sweep 1.2s linear infinite;
}
@keyframes fs-sweep {
  from {
    left: -30%;
  }
  to {
    left: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mini.ind i {
    animation: none;
    left: 0;
  }
  .chip {
    transition: none;
  }
}

/* output size list */
.sizes {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--fg2);
}
.sizes li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
}
.sizes .nm {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg3);
}
```

Add `@import './theme/controls.css';` after the `workbench.css` import in `index.css`.

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green (the components are not mounted yet; Tasks 11 to 15 mount them).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/ui src/renderer/src/theme/controls.css src/renderer/src/index.css test/ui-nav.test.ts
git commit -m "feat(ui): monochrome primitives (buttons, select, segmented, chips, range, tabs, settings)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: App shell: title bar and breadcrumb, collapsible sidebar, status bar, global shortcuts

**Files:**

- Create in `src/renderer/src/components/shell/`: `crumbs.ts`, `sidebarState.ts`, `useSidebar.ts`, `railPrefs.ts`, `useRailPrefs.ts`, `statusModel.ts`, `shortcuts.ts`, `TitleBar.tsx`, `Breadcrumb.tsx`, `Sidebar.tsx`, `StatusBar.tsx`
- Modify: `src/renderer/src/components/queue/selectAll.ts` (add `oneGroupIds`)
- Modify: `src/renderer/src/App.tsx` (root layout `:852-1022`, `run()` `:661-729`, new state and effects)
- Delete: `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/components/TabRail.tsx`, `src/renderer/src/assets/fmark.png` (only if `grep -rn fmark src` shows no other user)
- Test: `test/shell-model.test.ts`, `test/select-all.test.ts` (extend)

**Interfaces:**

- Consumes: `Icon`, `ProgressBar` (Tasks 9, 10); `TABS`, `COMPLETED_TAB`, `SETTINGS_TAB`, `tabById`, `type Tab`, `type TabId`, `type ToolCard` from `@shared/tabs`; `groupLabel` (Task 6); `inInput`, `groupOf` from `state.ts`; `activeGroupFor` (Task 6).
- Produces:
  - `type CrumbAction = 'tools' | 'clearSelection'`; `interface Crumb { label: string; action?: CrumbAction; ariaLabel?: string }`; `crumbsFor(tab: TabId, card: ToolCard | null, group: string | null): Crumb[]`
  - `type SidebarPref = 'expanded' | 'collapsed'`; `NARROW_PX = 1280`; `isCollapsed(pref, narrow, override: boolean | null): boolean`; `afterToggle(pref, narrow, override): { pref: SidebarPref; override: boolean | null }`; hook `useSidebar(): { collapsed: boolean; toggle: () => void }`
  - `normalizeOrder(saved: unknown, all: TabId[]): TabId[]`; `moveItem<T>(list: T[], from: number, to: number): T[]`; `sidebarVerbs(order: TabId[], hidden: TabId[]): TabId[]` (excludes `tools` and hidden); hook `useRailPrefs(): { order: TabId[]; hidden: TabId[]; setOrder(o: TabId[]): void; toggleHidden(id: TabId): void }`
  - `interface StatusSummary { running: { label: string; pct: number } | null; message: string | null; done: string | null; failed: number }`; `verbGerund(label: string): string`; `statusSummary(items: QueueItem[], batch: string[] | null, verb: string, message?: string | null): StatusSummary`
  - `type Shortcut = 'toggleSidebar' | 'addFiles' | 'run'`; `shortcutFor(e: KeyLike): Shortcut | null` (`KeyLike` from `queue/tableKeys.ts`)
  - `oneGroupIds(items: QueueItem[], ids: string[]): string[]` (keeps only ids in the display-first group among them)
  - Components `TitleBar({ crumbs, onCrumb })`, `Sidebar({ tab, verbs, showTools, counts, completedCount, collapsed, onToggle, onSelect })`, `StatusBar({ summary, onFailedClick })`
  - The sidebar is `<nav aria-label="Operations">`; each item is a `<button>` whose text is the tab label.

- [ ] **Step 1: Write the failing tests**

```ts
// test/shell-model.test.ts
import { describe, expect, it } from 'vitest'
import { crumbsFor } from '../src/renderer/src/components/shell/crumbs'
import { afterToggle, isCollapsed } from '../src/renderer/src/components/shell/sidebarState'
import {
  moveItem,
  normalizeOrder,
  sidebarVerbs
} from '../src/renderer/src/components/shell/railPrefs'
import { statusSummary, verbGerund } from '../src/renderer/src/components/shell/statusModel'
import { shortcutFor } from '../src/renderer/src/components/shell/shortcuts'
import { TABS, toolCardById, type TabId } from '@shared/tabs'
import type { QueueItem } from '../src/renderer/src/state'

describe('breadcrumb', () => {
  it('shows the verb, then the active group as the current segment', () => {
    expect(crumbsFor('convert', null, 'image')).toEqual([
      { label: 'convert', action: 'clearSelection' },
      { label: 'images' }
    ])
    expect(crumbsFor('removebg', null, null)).toEqual([{ label: 'remove bg' }])
  })
  it('makes tools a Back to Tools button inside a card', () => {
    expect(crumbsFor('tools', toolCardById('pdf-merge')!, 'doc')).toEqual([
      { label: 'tools', action: 'tools', ariaLabel: 'Back to Tools' },
      { label: 'merge' }
    ])
    expect(crumbsFor('tools', null, null)).toEqual([{ label: 'tools' }])
  })
  it('has a single segment for generate, completed and settings', () => {
    for (const t of ['generate', 'completed', 'settings'] as TabId[])
      expect(crumbsFor(t, null, 'image')).toEqual([{ label: t }])
  })
})

describe('sidebar collapse', () => {
  it('follows the stored preference on a wide window', () => {
    expect(isCollapsed('expanded', false, null)).toBe(false)
    expect(isCollapsed('collapsed', false, null)).toBe(true)
  })
  it('auto-collapses when narrow without touching the preference', () => {
    expect(isCollapsed('expanded', true, null)).toBe(true)
    expect(afterToggle('expanded', true, null)).toEqual({ pref: 'expanded', override: false })
  })
  it('a wide toggle flips and persists the preference', () => {
    expect(afterToggle('expanded', false, null)).toEqual({ pref: 'collapsed', override: null })
    expect(afterToggle('collapsed', false, null)).toEqual({ pref: 'expanded', override: null })
  })
})

describe('rail preferences', () => {
  const all = TABS.map((t) => t.id)
  it('keeps a saved order, drops unknown ids and appends new verbs', () => {
    expect(normalizeOrder(['resize', 'bogus', 'convert'], all).slice(0, 2)).toEqual([
      'resize',
      'convert'
    ])
    expect(normalizeOrder(['resize'], all)).toHaveLength(all.length)
    expect(normalizeOrder('garbage', all)).toEqual(all)
  })
  it('moves an item', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })
  it('lists visible verbs without Tools, which has its own slot', () => {
    expect(sidebarVerbs(all, ['upscale'])).toEqual([
      'convert',
      'compress',
      'resize',
      'removebg',
      'generate'
    ])
  })
})

const row = (id: string, status: QueueItem['status'], percent = 0): QueueItem => ({
  id,
  file: { path: `C:/${id}.png`, name: `${id}.png`, ext: '.png', kind: 'image', size: 1 },
  thumb: null,
  status,
  percent,
  hasProgress: percent > 0
})

describe('status bar', () => {
  const items = [
    row('a', 'done'),
    row('b', 'done'),
    row('c', 'running', 62),
    row('d', 'queued'),
    row('e', 'queued'),
    row('f', 'failed')
  ]
  it('reports the batch in flight, done count and failures', () => {
    const s = statusSummary(items, ['a', 'b', 'c', 'd', 'e', 'f'], 'Convert')
    expect(s.running).toEqual({ label: 'Converting 3 of 6', pct: 60 })
    expect(s.done).toBe('2 of 6 done')
    expect(s.failed).toBe(1)
  })
  it('drops the running item once the batch settles or without a batch', () => {
    const settled = items.map((i) =>
      i.status === 'queued' || i.status === 'running' ? { ...i, status: 'done' as const } : i
    )
    expect(statusSummary(settled, ['a', 'b', 'c', 'd', 'e', 'f'], 'Convert').running).toBeNull()
    expect(statusSummary(items, null, 'Convert').running).toBeNull()
  })
  it('renders nothing for an empty queue', () => {
    expect(statusSummary([], null, 'Convert')).toEqual({
      running: null,
      message: null,
      done: null,
      failed: 0
    })
  })
  it('names each verb', () => {
    expect(verbGerund('Remove BG')).toBe('Removing backgrounds')
    expect(verbGerund('Merge')).toBe('Processing')
  })
})

describe('global shortcuts', () => {
  const k = (
    key: string,
    o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}
  ) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...o
  })
  it('maps Ctrl+B, Ctrl+O and Ctrl+Enter', () => {
    expect(shortcutFor(k('b', { ctrlKey: true }))).toBe('toggleSidebar')
    expect(shortcutFor(k('O', { ctrlKey: true }))).toBe('addFiles')
    expect(shortcutFor(k('Enter', { ctrlKey: true }))).toBe('run')
  })
  it('ignores plain keys and Alt combinations', () => {
    expect(shortcutFor(k('b'))).toBeNull()
    expect(shortcutFor(k('b', { ctrlKey: true, altKey: true }))).toBeNull()
  })
})
```

Append to `test/select-all.test.ts`:

```ts
import { oneGroupIds } from '../src/renderer/src/components/queue/selectAll'

describe('oneGroupIds', () => {
  it('keeps only the ids of the first display group among them', () => {
    expect(oneGroupIds(items, ['v1', 'i2', 'v2'])).toEqual(['i2'])
    expect(oneGroupIds(items, ['v1', 'v2'])).toEqual(['v1', 'v2'])
    expect(oneGroupIds(items, [])).toEqual([])
  })
})
```

(Merge the import into the file's existing import from `selectAll`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/shell-model.test.ts test/select-all.test.ts`
Expected: FAIL, modules and `oneGroupIds` missing.

- [ ] **Step 3: Implement the pure modules**

```ts
// src/renderer/src/components/shell/crumbs.ts
import { tabById, type TabId, type ToolCard } from '@shared/tabs'
import { groupLabel } from '../queueGroups'

export type CrumbAction = 'tools' | 'clearSelection'
export interface Crumb {
  label: string
  action?: CrumbAction
  ariaLabel?: string
}

/** Title-bar breadcrumb per context (spec 3.1). */
export function crumbsFor(tab: TabId, card: ToolCard | null, group: string | null): Crumb[] {
  if (tab === 'tools')
    return card
      ? [
          { label: 'tools', action: 'tools', ariaLabel: 'Back to Tools' },
          { label: card.label.toLowerCase() }
        ]
      : [{ label: 'tools' }]
  const label = tabById(tab).label.toLowerCase()
  if (tab === 'generate' || tab === 'completed' || tab === 'settings' || !group) return [{ label }]
  return [{ label, action: 'clearSelection' }, { label: groupLabel(group).toLowerCase() }]
}
```

```ts
// src/renderer/src/components/shell/sidebarState.ts
export type SidebarPref = 'expanded' | 'collapsed'

/** Below this width the sidebar auto-collapses (spec 3.7), without persisting. */
export const NARROW_PX = 1280

export function isCollapsed(pref: SidebarPref, narrow: boolean, override: boolean | null): boolean {
  if (override != null) return override
  return narrow || pref === 'collapsed'
}

/** A toggle on a wide window flips the stored preference; on a narrow window it
 * only overrides for as long as the window stays narrow. */
export function afterToggle(
  pref: SidebarPref,
  narrow: boolean,
  override: boolean | null
): { pref: SidebarPref; override: boolean | null } {
  const now = isCollapsed(pref, narrow, override)
  if (narrow) return { pref, override: !now }
  return { pref: now ? 'expanded' : 'collapsed', override: null }
}
```

```ts
// src/renderer/src/components/shell/useSidebar.ts
import { useCallback, useEffect, useState } from 'react'
import { afterToggle, isCollapsed, NARROW_PX, type SidebarPref } from './sidebarState'

const KEY = 'filesmith.sidebar'

function readPref(): SidebarPref {
  try {
    return localStorage.getItem(KEY) === 'collapsed' ? 'collapsed' : 'expanded'
  } catch {
    return 'expanded'
  }
}

export function useSidebar(): { collapsed: boolean; toggle: () => void } {
  const [pref, setPref] = useState<SidebarPref>(readPref)
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_PX)
  // An override only applies to the width class it was made in, so crossing
  // the breakpoint restores the stored preference without an effect.
  const [override, setOverride] = useState<{ narrow: boolean; value: boolean } | null>(null)

  useEffect(() => {
    const on = (): void => setNarrow(window.innerWidth < NARROW_PX)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  const ov = override && override.narrow === narrow ? override.value : null
  const toggle = useCallback(() => {
    const next = afterToggle(pref, narrow, ov)
    if (next.pref !== pref) {
      setPref(next.pref)
      try {
        localStorage.setItem(KEY, next.pref)
      } catch {
        /* storage blocked: the toggle still works for this session */
      }
    }
    setOverride(next.override == null ? null : { narrow, value: next.override })
  }, [pref, narrow, ov])

  return { collapsed: isCollapsed(pref, narrow, ov), toggle }
}
```

```ts
// src/renderer/src/components/shell/railPrefs.ts
import type { TabId } from '@shared/tabs'

// Same localStorage keys as the old rail, so a user's order and hidden verbs
// carry over (spec 3.2).
export const ORDER_KEY = 'filesmith.rail.tabOrder'
export const HIDDEN_KEY = 'filesmith.rail.tabHidden'

export function normalizeOrder(saved: unknown, all: TabId[]): TabId[] {
  if (!Array.isArray(saved)) return all
  const kept = saved.filter((id): id is TabId => all.includes(id as TabId))
  return [...kept, ...all.filter((id) => !kept.includes(id))]
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** The verbs shown in the sidebar's top group: ordered, visible, without Tools
 * (Tools has its own slot under the separator). */
export function sidebarVerbs(order: TabId[], hidden: TabId[]): TabId[] {
  return order.filter((id) => id !== 'tools' && !hidden.includes(id))
}
```

```ts
// src/renderer/src/components/shell/useRailPrefs.ts
import { useCallback, useState } from 'react'
import { TABS, type TabId } from '@shared/tabs'
import { HIDDEN_KEY, normalizeOrder, ORDER_KEY } from './railPrefs'

const ALL = TABS.map((t) => t.id)

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}
function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* storage blocked: keep the in-memory value */
  }
}

export function useRailPrefs(): {
  order: TabId[]
  hidden: TabId[]
  setOrder: (o: TabId[]) => void
  toggleHidden: (id: TabId) => void
} {
  const [order, setOrderState] = useState<TabId[]>(() => normalizeOrder(read(ORDER_KEY), ALL))
  const [hidden, setHidden] = useState<TabId[]>(() => {
    const h = read(HIDDEN_KEY)
    return Array.isArray(h) ? h.filter((id): id is TabId => ALL.includes(id)) : []
  })
  const setOrder = useCallback((o: TabId[]) => {
    setOrderState(o)
    write(ORDER_KEY, o)
  }, [])
  const toggleHidden = useCallback((id: TabId) => {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      write(HIDDEN_KEY, next)
      return next
    })
  }, [])
  return { order, hidden, setOrder, toggleHidden }
}
```

```ts
// src/renderer/src/components/shell/statusModel.ts
import { inInput, type QueueItem } from '../../state'

export interface StatusSummary {
  running: { label: string; pct: number } | null
  /** Generate's startup line ("Starting ComfyUI"), shown with an indeterminate bar. */
  message: string | null
  done: string | null
  failed: number
}

const GERUND: Record<string, string> = {
  Convert: 'Converting',
  Compress: 'Compressing',
  Resize: 'Resizing',
  Upscale: 'Upscaling',
  'Remove BG': 'Removing backgrounds',
  Generate: 'Generating'
}

export function verbGerund(label: string): string {
  return GERUND[label] ?? 'Processing'
}

/** Status bar content (spec 3.5 and 6.4). `batch` is the ids of the last run in
 * this workspace; it is renderer-only and not persisted. */
export function statusSummary(
  items: QueueItem[],
  batch: string[] | null,
  verb: string,
  message?: string | null
): StatusSummary {
  const inputs = items.filter(inInput)
  let running: StatusSummary['running'] = null
  if (batch?.length) {
    const ids = new Set(batch)
    const rows = inputs.filter((i) => ids.has(i.id))
    const live = rows.filter((i) => i.status === 'queued' || i.status === 'running')
    if (live.length) {
      const done = rows.filter((i) => i.status === 'done').length
      const run = rows.filter((i) => i.status === 'running')
      const settled = rows.filter((i) => ['done', 'failed', 'canceled'].includes(i.status)).length
      const partial = run.reduce((s, i) => s + (i.hasProgress ? i.percent / 100 : 0), 0)
      running = {
        label: `${verbGerund(verb)} ${done + run.length} of ${rows.length}`,
        pct: Math.round(((settled + partial) / rows.length) * 100)
      }
    }
  }
  const doneN = inputs.filter((i) => i.status === 'done').length
  return {
    running,
    message: message || null,
    done: doneN ? `${doneN} of ${inputs.length} done` : null,
    failed: inputs.filter((i) => i.status === 'failed').length
  }
}
```

```ts
// src/renderer/src/components/shell/shortcuts.ts
import type { KeyLike } from '../queue/tableKeys'

export type Shortcut = 'toggleSidebar' | 'addFiles' | 'run'

/** Global shortcuts (spec 4.1): Ctrl+B sidebar, Ctrl+O add files, Ctrl+Enter run. */
export function shortcutFor(e: KeyLike): Shortcut | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'b' && !e.shiftKey) return 'toggleSidebar'
  if (k === 'o' && !e.shiftKey) return 'addFiles'
  if (k === 'enter') return 'run'
  return null
}
```

Append to `src/renderer/src/components/queue/selectAll.ts`:

```ts
/** Restrict a set of ids to one convert group (the first in display order among
 * them), so bulk selections such as "select the failed rows" never span groups. */
export function oneGroupIds(items: QueueItem[], ids: string[]): string[] {
  const set = new Set(ids)
  const rows = items.filter((i) => inInput(i) && set.has(i.id))
  if (!rows.length) return []
  const group = [...new Set(rows.map((i) => groupOf(i.file)))].sort(
    (a, b) => groupRank(a) - groupRank(b)
  )[0]
  return ids.filter((id) => rows.some((r) => r.id === id && groupOf(r.file) === group))
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/shell-model.test.ts test/select-all.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the shell components**

```tsx
// src/renderer/src/components/shell/Breadcrumb.tsx
import { Fragment, type JSX } from 'react'
import type { Crumb, CrumbAction } from './crumbs'

export function Breadcrumb({
  crumbs,
  onCrumb
}: {
  crumbs: Crumb[]
  onCrumb: (a: CrumbAction) => void
}): JSX.Element {
  return (
    <nav className="crumb no-drag" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">/</span>}
          {i === crumbs.length - 1 ? (
            <b aria-current="page">{c.label}</b>
          ) : c.action ? (
            <button
              type="button"
              aria-label={c.ariaLabel}
              title={c.ariaLabel}
              onClick={() => onCrumb(c.action as CrumbAction)}
            >
              {c.label}
            </button>
          ) : (
            <span>{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
```

```tsx
// src/renderer/src/components/shell/TitleBar.tsx
import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { Breadcrumb } from './Breadcrumb'
import type { Crumb, CrumbAction } from './crumbs'

export function TitleBar({
  crumbs,
  onCrumb
}: {
  crumbs: Crumb[]
  onCrumb: (a: CrumbAction) => void
}): JSX.Element {
  return (
    <header className="titlebar drag">
      <div className="brand">
        <Icon name="anvil" />
        <span>Filesmith</span>
      </div>
      <div className="tsep" />
      <Breadcrumb crumbs={crumbs} onCrumb={onCrumb} />
      {/* Window controls: 10x10 glyphs at stroke 1; close is not red (spec 2.5). */}
      <div className="winctl no-drag">
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => window.filesmith.minimize()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Maximize"
          title="Maximize"
          onClick={() => window.filesmith.toggleMaximize()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x=".5" y=".5" width="9" height="9" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={() => window.filesmith.close()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </button>
      </div>
    </header>
  )
}
```

```tsx
// src/renderer/src/components/shell/Sidebar.tsx
import type { JSX } from 'react'
import { COMPLETED_TAB, SETTINGS_TAB, tabById, type Tab, type TabId } from '@shared/tabs'
import { Icon } from '../icons/Icon'

export function Sidebar({
  tab,
  verbs,
  showTools,
  counts,
  completedCount,
  collapsed,
  onToggle,
  onSelect
}: {
  tab: TabId
  verbs: TabId[]
  showTools: boolean
  counts: Record<string, number>
  completedCount: number
  collapsed: boolean
  onToggle: () => void
  onSelect: (t: TabId) => void
}): JSX.Element {
  const item = (t: Tab, n?: number): JSX.Element => (
    <button
      key={t.id}
      type="button"
      className={`item${tab === t.id ? ' on' : ''}`}
      aria-current={tab === t.id ? 'page' : undefined}
      title={t.label}
      onClick={() => onSelect(t.id)}
    >
      <Icon name={t.icon} />
      <span className="lab">{t.label}</span>
      {n ? <span className="n">{n}</span> : null}
    </button>
  )
  return (
    <nav className="side" aria-label="Operations">
      <div className="side-head">
        <span className="lbl">operations</span>
        <button
          type="button"
          className="toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
          onClick={onToggle}
        >
          <Icon name="sidebar" />
        </button>
      </div>
      <div className="nav">
        {verbs.map((id) => item(tabById(id), counts[id]))}
        {showTools && (
          <>
            <div className="nav-sep" role="separator" />
            {item(tabById('tools'), counts.tools)}
          </>
        )}
      </div>
      <div className="spacer" />
      <div className="nav bottom">
        {item(COMPLETED_TAB, completedCount)}
        {item(SETTINGS_TAB)}
      </div>
    </nav>
  )
}
```

```tsx
// src/renderer/src/components/shell/StatusBar.tsx
import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { ProgressBar } from '../ui/ProgressBar'
import type { StatusSummary } from './statusModel'

export function StatusBar({
  summary,
  onFailedClick
}: {
  summary: StatusSummary
  onFailedClick: () => void
}): JSX.Element {
  return (
    <footer className="statusbar" aria-label="Status">
      {summary.running && (
        <div className="sitem" role="status">
          <Icon name="sync" />
          <span>{summary.running.label}</span>
          <ProgressBar value={summary.running.pct} label={summary.running.label} />
        </div>
      )}
      {summary.message && (
        <div className="sitem" role="status">
          <Icon name="sync" />
          <span>{summary.message}</span>
          <ProgressBar value={null} label={summary.message} />
        </div>
      )}
      {summary.done && <div className="sitem">{summary.done}</div>}
      <div className="sright">
        {summary.failed > 0 && (
          <button
            type="button"
            className="sitem warn"
            onClick={onFailedClick}
            title="Select the failed files"
          >
            <Icon name="warning" />
            {summary.failed} failed
          </button>
        )}
      </div>
    </footer>
  )
}
```

- [ ] **Step 6: Wire the shell into `App.tsx`**

Imports: remove `TopBar` and `TabRail`; add

```ts
import { TitleBar } from './components/shell/TitleBar'
import { Sidebar } from './components/shell/Sidebar'
import { StatusBar } from './components/shell/StatusBar'
import { crumbsFor } from './components/shell/crumbs'
import { useSidebar } from './components/shell/useSidebar'
import { useRailPrefs } from './components/shell/useRailPrefs'
import { sidebarVerbs } from './components/shell/railPrefs'
import { statusSummary } from './components/shell/statusModel'
import { shortcutFor } from './components/shell/shortcuts'
import { oneGroupIds } from './components/queue/selectAll'
```

New state next to the other `useState`s:

```ts
const sidebar = useSidebar()
const rail = useRailPrefs()
// Ids of the last run per workspace, for "Converting 3 of 6" (spec 6.4).
const [batches, setBatches] = useState<Record<string, string[]>>({})
```

In `run()`: after the merge branch's `dispatch({ type: 'markQueued', ids: [anchorId], ... })` add `setBatches((b) => ({ ...b, [qKey]: [anchorId] }))`; after the per-file `dispatch({ type: 'markQueued', ids: targets.map((t) => t.id), ... })` add `setBatches((b) => ({ ...b, [qKey]: targets.map((t) => t.id) }))`.

Global shortcuts effect (after the job-event effect). `run` and `browse` are re-created each render, so read them through the existing `latest` ref pattern: add a ref `const actions = useRef({ run, browse, runCount, toggle: sidebar.toggle })` and assign `actions.current = { run, browse, runCount, toggle: sidebar.toggle }` in the render body after `runCount` is computed, then:

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent): void => {
    const s = shortcutFor(e)
    if (!s) return
    e.preventDefault()
    const a = actions.current
    if (s === 'toggleSidebar') a.toggle()
    else if (s === 'addFiles') void a.browse()
    else if (s === 'run' && a.runCount > 0) void a.run()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [])
```

Derived values before `return`:

```ts
const crumbs = crumbsFor(state.tab, card ?? null, activeGroup)
const verbLabel = card ? card.label : tab.label
const summary = statusSummary(
  onToolsGrid || onCompleted || state.tab === 'settings' ? [] : cur.items,
  batches[qKey] ?? null,
  verbLabel,
  genRun.running && genRun.message && !genRun.message.startsWith('Generating')
    ? genRun.message
    : null
)
const showInspector = !onToolsGrid && !onCompleted && state.tab !== 'settings'
```

Replace the outer layout. The root becomes:

```tsx
<div className="app" data-sidebar={sidebar.collapsed ? 'collapsed' : 'expanded'}>
  <TitleBar
    crumbs={crumbs}
    onCrumb={(a) =>
      a === 'tools'
        ? dispatch({ type: 'setActiveTool', tool: null })
        : dispatch({ type: 'clearSelection' })
    }
  />
  <div className={`wb${showInspector ? '' : ' no-insp'}`}>
    <Sidebar
      tab={state.tab}
      verbs={sidebarVerbs(rail.order, rail.hidden)}
      showTools={!rail.hidden.includes('tools')}
      counts={counts}
      completedCount={completed.length}
      collapsed={sidebar.collapsed}
      onToggle={sidebar.toggle}
      onSelect={(t) => dispatch({ type: 'setTab', tab: t })}
    />
    {/* existing <section> ... </section> stays for now; change its tag to
            <main className="center" aria-label="Workspace"> and drop its Tailwind classes */}
    {/* existing OptionsPanel stays for now, rendered when showInspector */}
  </div>
  <StatusBar
    summary={summary}
    onFailedClick={() =>
      dispatch({
        type: 'selectIds',
        ids: oneGroupIds(
          cur.items,
          cur.items.filter((i) => i.status === 'failed').map((i) => i.id)
        )
      })
    }
  />
  <ContextMenu menu={menu} onClose={closeMenu} />
  <ConfirmDialog state={confirm} onClose={closeConfirm} />
</div>
```

Move the `onDragOver` / `onDragLeave` / `onDrop` handlers from the old `<section>` onto the `.app` root (spec 4.9: the whole window accepts drops). Keep the existing window-level `dragover`/`drop` `preventDefault` effect.

- [ ] **Step 7: Delete the replaced components**

```bash
git rm src/renderer/src/components/TopBar.tsx src/renderer/src/components/TabRail.tsx
grep -rn "fmark" src || git rm src/renderer/src/assets/fmark.png
```

(The second line removes the old logo only when nothing else references it; `build/icon.ico` and the installer icon are untouched, spec section 8.)

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

Run: `npm run dev` and check by hand: title bar shows the anvil, `Filesmith`, the breadcrumb and three square window buttons (close turns light grey on hover, never red; minimize, maximize and close work); the sidebar lists six verbs, a separator, Tools, then Completed and Settings at the bottom; the toggle and Ctrl+B collapse it to 48px with labels faded, the state survives a restart; narrowing the window under 1280px collapses it without changing the stored state; dropping a file anywhere in the window adds it.

- [ ] **Step 9: Commit**

```bash
git add -A src/renderer/src/components/shell src/renderer/src/components/queue/selectAll.ts src/renderer/src/App.tsx test/shell-model.test.ts test/select-all.test.ts
git commit -m "feat(shell): title bar with breadcrumb, collapsible sidebar, status bar, global shortcuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Files table, toolbar, row actions, keyboard and drops

**Files:**

- Create in `src/renderer/src/components/queue/`: `QueueToolbar.tsx`, `QueueTable.tsx`, `QueueRow.tsx`, `ResultCell.tsx`, `StatusCell.tsx`, `TotalsRow.tsx`, `EmptyState.tsx`
- Create: `src/renderer/src/theme/views.css`; Modify: `src/renderer/src/index.css` (add `@import './theme/views.css';` last)
- Modify: `src/renderer/src/App.tsx` (centre content for queue workspaces, `onItemClick` `:339-347`, new `retry`, `onRowAction`, toolbar handlers, per-row estimates, run scope)
- Delete: `src/renderer/src/components/Queue.tsx`, `src/renderer/src/components/DropZone.tsx`

**Interfaces:**

- Consumes: `rowView`, `queueTotals`, `doneSamples`, `RowActionKind`, `Totals` (Task 5); `groupedRows`, `visibleOrder`, `nextSort`, `SortKey`, `SortState`, `RowGroup` (Task 6); `headerCheck`, `toggleAllIds`, `activeGroupFor` (Task 6); `tableKey`, `TableKey` (Task 6); `estimateOutputBytes` (Task 7); `Checkbox`, `RowAction`, `AddFilesButton`, `IconButton`, `SmallButton` (Task 10); reducer actions `select` (with `order`), `selectIds`, `hideFinished` (Task 4).
- Produces:
  - `QueueTable({ groups, totals, selected, activeGroup, sort, check, estimates, onSort, onToggleAll, onSelectAll, onRowClick, onToggleRow, onExtend, onOpen, onMenu, onAction, onRemove, onSelectGroup, onAdd })`; the table root is `role="grid"` with `aria-label="Files"`.
  - `QueueToolbar({ files, selected, dropping, canRemove, canRetry, canClear, canStop, onAdd, onRemove, onRetry, onClear, onStop })`
  - `EmptyState({ icon, title, line, action? })` (reused by Completed in Task 15)
  - App functions `retry(ids: string[])`, `onRowAction(id, kind)`.
  - Run scope (spec 4.1): with nothing selected, Run and the options act on every input row of the first group in display order; the inspector says `all N files`.

- [ ] **Step 1: Write the table components**

```tsx
// src/renderer/src/components/queue/ResultCell.tsx
import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import type { ResultView } from './rowModel'

/** The arrow sits centred on the size|result column boundary, on a patch of the
 * row background, and only when the cell has content (spec 4.3). */
export function ResultCell({ result }: { result: ResultView | null }): JSX.Element {
  return (
    <div className="td rc" role="gridcell">
      {result && (
        <span className="res">
          <Icon name="arrow" size={12} className="arr split" />
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
      )}
    </div>
  )
}
```

```tsx
// src/renderer/src/components/queue/StatusCell.tsx
import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { RowAction } from '../ui/Button'
import type { RowActionKind, RowActionView, StatusView } from './rowModel'

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
      {status.kind === 'failed' ? (
        <span className="st fail" title={status.title}>
          <Icon name="warning" />
          {status.text}
        </span>
      ) : status.kind === 'running' ? (
        <span className="st run">
          <Icon name="sync" />
          <span className="prog">
            <b>{status.pct}</b>
            <span className="eta">{status.eta}</span>
          </span>
        </span>
      ) : status.kind === 'done' ? (
        <span className="st done">
          <Icon name="check" />
          Done
        </span>
      ) : status.kind === 'queued' ? (
        <span className="st q">
          <Icon name="clock" />
          Queued
        </span>
      ) : status.kind === 'canceled' ? (
        <span className="st canceled">
          <Icon name="close" />
          Canceled
        </span>
      ) : null}
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

```tsx
// src/renderer/src/components/queue/QueueRow.tsx
import type { JSX, MouseEvent } from 'react'
import type { QueueItem } from '../../state'
import { Checkbox } from '../ui/Checkbox'
import { ResultCell } from './ResultCell'
import { StatusCell } from './StatusCell'
import type { RowActionKind, RowView } from './rowModel'

export function QueueRow({
  item,
  view,
  selected,
  dim,
  focusable,
  onClick,
  onToggle,
  onOpen,
  onMenu,
  onAction,
  onKeyDown
}: {
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
  onAction: (k: RowActionKind) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
}): JSX.Element {
  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      data-id={item.id}
      className={`tr cols${selected ? ' sel' : ''}${dim ? ' dim' : ''}`}
      title={dim ? 'A different file type than the current selection' : undefined}
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={onKeyDown}
    >
      <div className="td ck" role="gridcell">
        <Checkbox checked={selected} onChange={onToggle} label={`Select ${item.file.name}`} />
      </div>
      <div className="td" role="gridcell">
        {item.thumb ? (
          <img className="thumb" src={item.thumb} alt="" />
        ) : (
          <span className="thumb" aria-hidden="true">
            {view.kind.slice(0, 3)}
          </span>
        )}
        <span className="name" title={item.file.name}>
          {item.file.name}
        </span>
        {/* Below 1180px the kind column folds into the name cell (spec 3.7). */}
        <span className="meta ktag" aria-hidden="true">
          {view.kind}
        </span>
      </div>
      <div className="td" role="gridcell">
        <span className="meta">{view.kind}</span>
      </div>
      <div className="td num" role="gridcell">
        <span className="size">{view.size}</span>
      </div>
      <ResultCell result={view.result} />
      <StatusCell status={view.status} action={view.action} onAction={onAction} />
    </div>
  )
}
```

```tsx
// src/renderer/src/components/queue/TotalsRow.tsx
import type { JSX } from 'react'
import { formatBytes } from '@shared/compress'
import { Icon } from '../icons/Icon'
import type { Totals } from './rowModel'

export function TotalsRow({ totals: t }: { totals: Totals }): JSX.Element {
  return (
    <div className="totals cols" role="row" aria-label="Totals">
      <div className="td" role="gridcell" />
      <div className="td" role="gridcell">
        {t.files} file{t.files === 1 ? '' : 's'}
      </div>
      <div className="td" role="gridcell" />
      <div className="td num" role="gridcell">
        {formatBytes(t.bytes)}
      </div>
      <div className="td" role="gridcell">
        {t.doneSrc > 0 && (
          <>
            <span>{formatBytes(t.doneSrc)}</span>
            <Icon name="arrow" size={12} className="tarr" />
            <b>{formatBytes(t.doneOut)}</b>
            <span className="pct">so far</span>
          </>
        )}
      </div>
      <div className="td" role="gridcell">
        {t.files > 0 && (
          <b>
            {t.done} of {t.files} done
          </b>
        )}
      </div>
    </div>
  )
}
```

```tsx
// src/renderer/src/components/queue/EmptyState.tsx
import type { JSX } from 'react'
import type { IconName } from '@shared/icons'
import { Icon } from '../icons/Icon'
import { SmallButton } from '../ui/Button'

/** Centred empty block (spec 4.12): no drop zone, an outlined button instead. */
export function EmptyState({
  icon,
  title,
  line,
  action
}: {
  icon: IconName
  title: string
  line: string
  action?: { label: string; onClick: () => void }
}): JSX.Element {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div className="et">{title}</div>
      <div className="el">{line}</div>
      {action && (
        <SmallButton icon="addfile" onClick={action.onClick}>
          {action.label}
        </SmallButton>
      )}
    </div>
  )
}
```

```tsx
// src/renderer/src/components/queue/QueueToolbar.tsx
import type { JSX } from 'react'
import { AddFilesButton, IconButton } from '../ui/Button'

export function QueueToolbar({
  files,
  selected,
  dropping,
  canRemove,
  canRetry,
  canClear,
  canStop,
  onAdd,
  onRemove,
  onRetry,
  onClear,
  onStop
}: {
  files: number
  selected: number
  dropping: boolean
  canRemove: boolean
  canRetry: boolean
  canClear: boolean
  canStop: boolean
  onAdd: () => void
  onRemove: () => void
  onRetry: () => void
  onClear: () => void
  onStop: () => void
}): JSX.Element {
  const count = dropping
    ? 'Drop to add'
    : `${files} file${files === 1 ? '' : 's'}${selected ? `, ${selected} selected` : ''}`
  return (
    <div className="toolbar" role="toolbar" aria-label="File actions">
      <AddFilesButton onClick={onAdd} title="Add files (Ctrl+O)" />
      <IconButton icon="close" label="Remove selected" disabled={!canRemove} onClick={onRemove} />
      <IconButton icon="retry" label="Retry failed" disabled={!canRetry} onClick={onRetry} />
      <IconButton icon="trash" label="Clear finished" disabled={!canClear} onClick={onClear} />
      <div className="tb-right">
        <span className="count" aria-live="polite">
          {count}
        </span>
        <IconButton icon="stop" label="Stop all" disabled={!canStop} onClick={onStop} />
      </div>
    </div>
  )
}
```

```tsx
// src/renderer/src/components/queue/QueueTable.tsx
import { Fragment, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { Checkbox } from '../ui/Checkbox'
import { Icon } from '../icons/Icon'
import { groupOf } from '../../state'
import { EmptyState } from './EmptyState'
import { QueueRow } from './QueueRow'
import { TotalsRow } from './TotalsRow'
import { rowView, type RowActionKind, type Totals } from './rowModel'
import type { CheckState } from './selectAll'
import { tableKey } from './tableKeys'
import { visibleOrder, type RowGroup, type SortKey, type SortState } from './tableSort'

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
  const body = useRef<HTMLDivElement>(null)
  const order = visibleOrder(groups)
  const [focusId, setFocusId] = useState<string | null>(null)
  const tabStop = focusId && order.includes(focusId) ? focusId : (selected[0] ?? order[0] ?? null)

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
    const i = order.indexOf(id)
    if (k === 'up' || k === 'down') focusRow(order[k === 'up' ? i - 1 : i + 1])
    else if (k === 'extendUp' || k === 'extendDown') {
      const next = order[k === 'extendUp' ? i - 1 : i + 1]
      if (next) {
        focusRow(next)
        onExtend(next)
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

  return (
    <section className="qtable" role="grid" aria-label="Files" aria-multiselectable="true">
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
          return (
            <div
              key={h.key}
              role="columnheader"
              tabIndex={0}
              aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              className={`th${h.num ? ' num' : ''}${on ? ' sorted' : ''}${on && sort!.dir === 'desc' ? ' desc' : ''}`}
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
              {g.items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  view={rowView(item, estimates[item.id])}
                  selected={selected.includes(item.id)}
                  dim={activeGroup != null && groupOf(item.file) !== activeGroup}
                  focusable={item.id === tabStop}
                  onClick={(e) => {
                    setFocusId(item.id)
                    onRowClick(item.id, e)
                  }}
                  onToggle={() => onToggleRow(item.id)}
                  onOpen={() => onOpen(item.id)}
                  onMenu={(x, y) => onMenu(item.id, x, y)}
                  onAction={(k) => onAction(item.id, k)}
                  onKeyDown={(e) => onRowKey(item.id, e)}
                />
              ))}
            </Fragment>
          ))
        )}
      </div>
      <TotalsRow totals={totals} />
    </section>
  )
}
```

- [ ] **Step 2: Write `theme/views.css` (queue part)**

```css
/* Views and states the mockup does not draw (spec 2.6, 3.3, 4.9, 4.12). */

/* cross-group rows: fg3 text, thumbnail at 40% (monochrome replacement for opacity-40) */
.tr.dim .name,
.tr.dim .meta,
.tr.dim .size {
  color: var(--fg3);
}
.tr.dim .thumb {
  opacity: 0.4;
}

/* mixed-queue group row: SettingGroup style, selects the whole group */
.grp-row {
  height: 28px;
  border-bottom: 1px solid var(--line);
}
.grp {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 16px;
  font: 600 11px/1 var(--mono);
  letter-spacing: 0.09em;
  color: var(--fg3);
}
.grp::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.grp .n {
  font-weight: 500;
  letter-spacing: 0;
}
.grp:hover {
  color: var(--fg1);
  background: var(--hover);
}

/* narrow window (spec 3.7, O5): below 1180px the kind column folds into the
   name cell as a trailing fg3 tag. Hidden cells take no grid slot, so the
   head, rows and totals all drop their third cell and use five columns. */
.ktag {
  display: none;
}
@media (max-width: 1179px) {
  .cols {
    --cols: 40px 1fr 88px 184px 232px;
  }
  .cols > :nth-child(3) {
    display: none;
  }
  .ktag {
    display: inline;
    margin-left: auto;
  }
}

/* totals arrow is inline, not the split arrow */
.totals .tarr,
.totals .pct {
  color: var(--fg3);
}

/* drop target: a 1px fg1 inset outline around the centre panel */
.center.dropping::after {
  content: '';
  position: absolute;
  inset: 0;
  outline: 1px solid var(--fg1);
  outline-offset: -1px;
  pointer-events: none;
}

/* empty states */
.empty {
  height: 100%;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--fg2);
}
.empty .et {
  font-weight: 600;
  font-size: 14px;
  color: var(--fg1);
}
.empty .el {
  font-size: 12px;
  color: var(--fg3);
  margin-bottom: 6px;
}
.empty .sbtn {
  align-self: center;
}
```

Add `@import './theme/views.css';` as the last import in `index.css`.

- [ ] **Step 3: Wire the table into `App.tsx`**

Imports: remove `DropZone` and `Queues`; add

```ts
import { QueueTable } from './components/queue/QueueTable'
import { QueueToolbar } from './components/queue/QueueToolbar'
import { doneSamples, queueTotals, type RowActionKind } from './components/queue/rowModel'
import { groupedRows, nextSort, visibleOrder, type SortState } from './components/queue/tableSort'
import { activeGroupFor, headerCheck, toggleAllIds } from './components/queue/selectAll'
import { estimateOutputBytes } from '@shared/sizeEstimate'
import { resizedSize } from '@shared/resize'
import type { JobOptions, ToolId } from '@shared/types'
```

State: `const [sorts, setSorts] = useState<Record<string, SortState | null>>({})`.

**Run scope** (spec 4.1). Replace the selection-derived block (`:265-276`) so that with nothing selected the panel and Run act on the first display group:

```ts
const selectedItems = cur.items.filter((i) => cur.selected.includes(i.id))
// With nothing selected, options and Run speak for the first group in the
// queue (spec 4.1), not an empty panel.
const firstGroup = activeGroupFor(cur.items, [])
const scopeItems = selectedItems.length
  ? selectedItems
  : cur.items.filter((i) => inInput(i) && firstGroup != null && groupOf(i.file) === firstGroup)
const selEff = scopeItems.map(effectiveFile)
const activeKind: FileKind | null = selEff.length ? selEff[0].kind : null
// Dimming and the breadcrumb follow the SELECTION only.
const activeGroup: string | null = selectedItems.length
  ? groupOf(effectiveFile(selectedItems[0]))
  : null
const scopeGroup: string | null = selEff.length ? groupOf(selEff[0]) : null
const fallbackKind: FileKind = tab.kinds[0] ?? card?.kinds[0] ?? 'image'
const optGroup = scopeGroup ?? convertGroup(fallbackKind, '')
```

and in the `runList` filter (`:298`) change `selectedItems.filter(` to `scopeItems.filter(`. Leave the rest of `runList`'s predicate unchanged. Everywhere the OptionsPanel props used `activeGroup` to decide whether to show options, pass `scopeGroup` instead (until Task 13 replaces the panel).

**Row clicks follow the visible order:**

```ts
const sort = sorts[qKey] ?? null
const groups = groupedRows(cur.items, sort)
const order = visibleOrder(groups)

function onItemClick(id: string, e: MouseEvent): void {
  const mode: SelectMode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single'
  dispatch({ type: 'select', id, mode, order })
}
```

**Retry and row actions:**

```ts
function toolFor(it: QueueItem, opts: JobOptions): ToolId {
  return engineFor(
    state.tab,
    groupOf(it.file),
    card,
    { kind: it.file.kind, ext: it.file.ext },
    typeof opts.format === 'string' ? opts.format : undefined
  ).tool
}

/** Same path as run() for one in-place item, with the options it last ran
 * with (spec 4.3). A merge row retries with the same input list, because
 * run() now stores `mergeInputs` in its `runOptions` (see below). */
function retry(ids: string[]): void {
  const started: string[] = []
  for (const id of ids) {
    const it = cur.items.find((i) => i.id === id)
    if (!it || (it.status !== 'failed' && it.status !== 'canceled')) continue
    const opts = it.runOptions ?? curOptions
    dispatch({ type: 'markQueued', ids: [id], options: opts })
    void window.filesmith.runJob({
      id,
      tool: toolFor(it, opts),
      input: it.file.path,
      options: opts
    })
    started.push(id)
  }
  if (started.length) setBatches((b) => ({ ...b, [qKey]: started }))
}

function onRowAction(id: string, kind: RowActionKind): void {
  const it = cur.items.find((i) => i.id === id)
  if (!it) return
  if (kind === 'reveal') {
    if (it.outputPath) window.filesmith.reveal(it.outputPath)
  } else if (kind === 'cancel') cancelJob(id)
  else if (kind === 'remove') dismiss([id], 'input')
  else retry([id])
}
```

In `run()`'s merge branch (`App.tsx:697`) change `dispatch({ type: 'markQueued', ids: [anchorId], options: opts })` to `dispatch({ type: 'markQueued', ids: [anchorId], options: { ...opts, mergeInputs: paths } })`. Without it a retried merge row would reach the engine with no input list and fail again with "Select at least two PDFs to merge" (`registry.ts:322-323`).

**Per-row estimates** for running rows:

```ts
function estimateFor(it: QueueItem): number | null {
  const opts = it.runOptions ?? curOptions
  const t = toolFor(it, opts)
  const d = vDims[it.file.path]
  let pixelRatio: number | null = null
  let outPixels: number | null = null
  if (t === 'resize') {
    if (String(opts.mode ?? 'percent') === 'percent')
      pixelRatio = (Number(opts.percent ?? 50) / 100) ** 2
    else if (d) {
      const o = resizedSize(
        d.width,
        d.height,
        numOrNull(opts.width),
        numOrNull(opts.height),
        opts.fit === 'stretch' ? 'stretch' : 'contain'
      )
      if (o) pixelRatio = (o.w * o.h) / (d.width * d.height)
    }
  } else if (t === 'upscale' && d) {
    const f = Number(opts.upscaleFactor ?? 4)
    outPixels = d.width * f * d.height * f
  }
  return estimateOutputBytes(it.file, t, opts, {
    samples: doneSamples(cur.items, groupOf(it.file), opts),
    pixelRatio,
    outPixels
  })
}
const estimates: Record<string, number | null> = {}
for (const i of cur.items)
  if (inInput(i) && i.status === 'running') estimates[i.id] = estimateFor(i)
```

(`numOrNull` already exists at `:803`; move it above `estimateFor` if it is declared later.)

**Toolbar flags and handlers:**

```ts
const inputs = cur.items.filter(inInput)
const groupForBulk = activeGroupFor(cur.items, cur.selected)
const failedInGroup = inputs.filter(
  (i) => i.status === 'failed' && groupOf(i.file) === groupForBulk
)
const inFlight = inputs.filter((i) => i.status === 'queued' || i.status === 'running')
```

Replace the old `DropZone` + `Queues` branch of the centre with:

```tsx
<>
  <QueueToolbar
    files={inputs.length}
    selected={cur.selected.length}
    dropping={dragging}
    canRemove={cur.selected.length > 0}
    canRetry={failedInGroup.length > 0}
    canClear={inputs.some((i) => i.status === 'done' || i.status === 'canceled')}
    canStop={inFlight.length > 0}
    onAdd={() => void browse()}
    onRemove={() => dismiss(cur.selected, 'input')}
    onRetry={() => retry(failedInGroup.map((i) => i.id))}
    onClear={() => dispatch({ type: 'hideFinished' })}
    onStop={() => inFlight.forEach((i) => cancelJob(i.id))}
  />
  <QueueTable
    groups={groups}
    totals={queueTotals(cur.items)}
    selected={cur.selected}
    activeGroup={activeGroup}
    sort={sort}
    check={headerCheck(cur.items, cur.selected)}
    estimates={estimates}
    onSort={(k) => setSorts((s) => ({ ...s, [qKey]: nextSort(sort, k) }))}
    onToggleAll={() => dispatch({ type: 'selectIds', ids: toggleAllIds(cur.items, cur.selected) })}
    onSelectAll={() => {
      const ids = toggleAllIds(cur.items, cur.selected)
      if (ids.length) dispatch({ type: 'selectIds', ids })
    }}
    onRowClick={onItemClick}
    onToggleRow={(id) => dispatch({ type: 'select', id, mode: 'toggle', order })}
    onExtend={(id) => dispatch({ type: 'select', id, mode: 'range', order })}
    onOpen={(id) => {
      const it = cur.items.find((i) => i.id === id)
      if (it) openExternally('input', it)
    }}
    onMenu={(id, x, y) => {
      const it = cur.items.find((i) => i.id === id)
      if (it) openMenu('input', it, x, y)
    }}
    onAction={onRowAction}
    onRemove={(id) => dismiss(cur.selected.includes(id) ? cur.selected : [id], 'input')}
    onSelectGroup={(g) =>
      dispatch({
        type: 'selectIds',
        ids: inputs.filter((i) => groupOf(i.file) === g).map((i) => i.id)
      })
    }
    onAdd={() => void browse()}
  />
</>
```

Set the centre element's class to `` `center${dragging ? ' dropping' : ''}` ``. The `.center` grid has rows `32px 1fr`; the toolbar and table are its two children. `dragging` is still set by the root's `onDragOver` and cleared by `onDragLeave` / `onDrop`; skip setting it while on Generate, the Tools grid, Completed or Settings (unchanged guard).

Note on Ctrl+A: when the whole group is already selected `toggleAllIds` returns `[]`, so `onSelectAll` leaves the selection as is instead of clearing it.

- [ ] **Step 4: Delete the replaced components**

```bash
git rm src/renderer/src/components/Queue.tsx src/renderer/src/components/DropZone.tsx
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green (`queue-groups.test.ts` still passes; `groupItemsByGroup` stays exported for its test until Task 16 decides its fate).

Run: `npm run dev` and check by hand with a mix of 6 images: column widths match the mockup (40 / name / 64 / 88 / 184 / 232), narrowing the window under 1180px drops the kind column and shows the kind as a grey tag at the end of the name cell, header labels are lowercase, the head and totals stay fixed while rows scroll, the result arrow sits exactly on the size/result border and its patch matches hover and selected backgrounds; a running row shows `NN%(Ns)` with no bar under it; a failed row shows the inverted pill and an always-visible Retry that re-runs it; done rows show `Show in folder` on hover and it reveals the OUTPUT; queued rows' Remove cancels and removes; clicking `size` sorts ascending, again descending (chevron flips), a third time restores the order; header checkbox selects the active group only; Up/Down move focus, Space toggles, Shift+Arrow extends, Ctrl+A selects the group, Delete removes, Enter opens, Shift+F10 opens the menu; an empty queue shows "No files yet" with an Add files button and keeps head and totals; dragging files over the window outlines the centre and the count reads `Drop to add`. Add a video to the image queue: group rows `IMAGES 6` / `VIDEO 1` appear, image rows dim when the video is selected, clicking a group row selects that group.

- [ ] **Step 6: Commit**

```bash
git add -A src/renderer/src/components/queue src/renderer/src/theme/views.css src/renderer/src/index.css src/renderer/src/App.tsx
git commit -m "feat(queue): details table with result arrow, compact progress, row actions, sort and keyboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Inspector and the options split (grouped settings, estimate card, output location)

**Files:**

- Create: `src/renderer/src/components/inspector/Inspector.tsx`
- Create in `src/renderer/src/components/options/`: `types.ts`, `OptionsPane.tsx`, `ConvertSettings.tsx`, `PageRenderSettings.tsx`, `CompressSettings.tsx`, `ResizeSettings.tsx`, `UpscaleSettings.tsx`, `RemoveBgSettings.tsx`, `PdfSettings.tsx`, `ArchiveSettings.tsx`, `OutputSettings.tsx`, `upscale/PidSetup.tsx`, `upscale/ComfySetup.tsx`, `generate/GenerateSettings.tsx`, `generate/ModelSelect.tsx`, `generate/CompanionDownload.tsx`, `generate/LocateComfy.tsx`, `generate/AddModel.tsx`, `generate/AdvancedSettings.tsx`, `generate/restore.ts`
- Move (git mv): `components/useArchiveStatus.ts`, `useComfyModels.ts`, `useGenerateStatus.ts`, `usePidStatus.ts` into `components/options/hooks/`
- Modify: `src/renderer/src/App.tsx` (replace `<OptionsPanel ... />`, memoize `onSet`, batch estimate, inspector state)
- Delete: `src/renderer/src/components/OptionsPanel.tsx`, `PidUpscale.tsx`, `ComfyImport.tsx`, `OperationTitle.tsx`
- Test: `test/generate-restore.test.ts`

**Interfaces:**

- Consumes: every primitive from Task 10; `Icon`; `estimateBatch` (Task 7); `groupNoun` from `queueGroups.ts`; `window.filesmith.pickFolder` (Task 1); existing hooks and IPC calls.
- Produces:
  - `type SetOption = (k: string, v: string | number | boolean) => void` (`options/types.ts`)
  - `OptionsPane({ tab, tool, options, kind, srcExts, sourceExt, runCount, videoOutputs, resizeOutputs, upscaleOutputs, estimate, set })` where `estimate: { from: number; to: number; files: number } | null` and the three output lists are `SizeRow[]`
  - `type InspTab = 'options' | 'preview' | 'info'` (exported from `inspector/Inspector.tsx` as a type) and `Inspector({ tab, onTab, title, sub, runLabel, runDisabled, onRun, children })`. Its title is an `<h1>`; the Run button carries `data-testid="run"`.
  - `isRestoreName(label: string): boolean` (`generate/restore.ts`, moved verbatim from `OptionsPanel.tsx:1116`)

Every existing control is kept (spec 4.2); headings group them; the old label becomes the setting title and the old hint or `HelpTip` text becomes the description. Behavioural fixes riding along: `ArchiveSettings` from-pdf reuses `PageRenderSettings`, so the quality slider writes `pageQuality` (the engine reads `options.pageQuality`, `registry.ts:1301`); `onSet` is memoized; `useArchiveStatus` is called once; the stale "three toggles" comment is dropped.

- [ ] **Step 1: Move the restoration-name helper out and test it**

Copy `isRestoreName` from `OptionsPanel.tsx:1116` (the function and its regex, unchanged) into `options/generate/restore.ts` as `export function isRestoreName(label: string): boolean`. Then:

```ts
// test/generate-restore.test.ts
import { describe, expect, it } from 'vitest'
import { isRestoreName } from '../src/renderer/src/components/options/generate/restore'

describe('isRestoreName', () => {
  it('flags restoration checkpoints so Generate does not auto-pick them', () => {
    expect(isRestoreName('SUPIR-v0Q')).toBe(true)
  })
  it('leaves ordinary text-to-image models alone', () => {
    expect(isRestoreName('sd_xl_base_1.0')).toBe(false)
  })
})
```

Run: `npx vitest run test/generate-restore.test.ts`
Expected: PASS. (If the copied regex does not match `SUPIR-v0Q`, the copy is wrong: re-copy it from `OptionsPanel.tsx:1116`.)

- [ ] **Step 2: Move the status hooks**

```bash
mkdir -p src/renderer/src/components/options/hooks
git mv src/renderer/src/components/useArchiveStatus.ts src/renderer/src/components/useComfyModels.ts src/renderer/src/components/useGenerateStatus.ts src/renderer/src/components/usePidStatus.ts src/renderer/src/components/options/hooks/
```

Fix their relative imports (`../../../` depth changes) until `npm run typecheck` passes for those four files.

- [ ] **Step 3: Shared type and the simple settings files**

```ts
// src/renderer/src/components/options/types.ts
export type SetOption = (k: string, v: string | number | boolean) => void
```

```tsx
// src/renderer/src/components/options/PageRenderSettings.tsx
import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { RangeField } from '../ui/RangeField'
import { Segmented } from '../ui/Segmented'
import { Setting, SettingGroup } from '../ui/Setting'
import type { SetOption } from './types'

/** Page rendering for every route that turns a PDF into images. Writes
 * `pageQuality`, never `quality`, so it cannot collide with convert's preset. */
export function PageRenderSettings({
  options,
  set
}: {
  options: JobOptions
  set: SetOption
}): JSX.Element {
  const pageFormat = String(options.pageFormat ?? 'jpg')
  return (
    <SettingGroup title="PAGES">
      <Setting title="Resolution" desc="Dots per inch when each page is rendered.">
        <RangeField
          label="Resolution"
          min={72}
          max={400}
          step={2}
          value={Number(options.dpi ?? 150)}
          onChange={(v) => set('dpi', v)}
          format={(v) => `${v} dpi`}
        />
      </Setting>
      <Setting
        title="Page format"
        desc={
          pageFormat === 'jpg'
            ? 'Much smaller files, the usual choice for comics.'
            : 'Lossless, but a long comic runs to hundreds of megabytes.'
        }
      >
        <Segmented
          label="Page format"
          value={pageFormat}
          options={[
            { value: 'jpg', label: 'jpg' },
            { value: 'png', label: 'png' }
          ]}
          onChange={(v) => set('pageFormat', v)}
        />
      </Setting>
      {pageFormat === 'jpg' && (
        <Setting title="Page quality">
          <RangeField
            label="Page quality"
            min={10}
            max={100}
            value={Number(options.pageQuality ?? 100)}
            onChange={(v) => set('pageQuality', v)}
            ends={['smaller file', 'higher quality']}
          />
        </Setting>
      )}
    </SettingGroup>
  )
}
```

```tsx
// src/renderer/src/components/options/ConvertSettings.tsx
import type { JSX } from 'react'
import type { FileKind, JobOptions } from '@shared/types'
import { familyFormats, isSameFormat, sharedTargets } from '@shared/convert'
import { needsRar } from '@shared/archive'
import { Select } from '../ui/Select'
import type { SelectOption } from '../ui/selectNav'
import { Segmented } from '../ui/Segmented'
import { Setting, SettingGroup } from '../ui/Setting'
import { OutputSettings } from './OutputSettings'
import { PageRenderSettings } from './PageRenderSettings'
import type { SetOption } from './types'

export function ConvertSettings({
  options,
  kind,
  sourceExt,
  srcExts,
  verb,
  hasRar,
  set
}: {
  options: JobOptions
  kind: FileKind
  sourceExt: string | null
  srcExts: string[]
  /** The archive verb this target resolves to, if any: repack / to-pdf / from-pdf. */
  verb?: string
  hasRar: boolean
  set: SetOption
}): JSX.Element {
  // Targets valid for EVERY selected source, so a mixed pdf+docx selection never
  // offers CBZ (which only the pdf could do).
  const formats = srcExts.length
    ? sharedTargets(kind, srcExts)
    : familyFormats(kind, sourceExt ?? '')
  const choices: SelectOption<string>[] = formats.map((f) => {
    const isSource = srcExts.some((e) => isSameFormat(f.ext, e))
    const noRar = needsRar(f.ext) && !hasRar
    return {
      value: f.ext,
      label: f.label.toLowerCase(),
      disabled: isSource || noRar,
      reason: noRar ? 'WinRAR not found' : isSource ? 'already this format' : undefined
    }
  })
  return (
    <>
      <SettingGroup title="FORMAT">
        <Setting title="Format" desc="The format the selected files are converted to.">
          <Select
            label="Format"
            value={String(options.format ?? '')}
            options={choices}
            onChange={(v) => set('format', v)}
          />
        </Setting>
        {kind === 'image' && (
          <Setting title="Quality" desc="Smaller files, or closer to the original.">
            <Segmented
              label="Quality"
              value={String(options.quality ?? 'balanced')}
              options={[
                { value: 'smaller', label: 'smaller' },
                { value: 'balanced', label: 'balanced' },
                { value: 'best', label: 'best' }
              ]}
              onChange={(v) => set('quality', v)}
            />
          </Setting>
        )}
        {verb === 'repack' && (
          <Setting
            title="Compression"
            desc="Comic pages are already compressed images, so store is faster at the same size."
          >
            <Segmented
              label="Compression"
              value={options.store === false ? 'normal' : 'store'}
              options={[
                { value: 'store', label: 'store' },
                { value: 'normal', label: 'normal' }
              ]}
              onChange={(v) => set('store', v === 'store')}
            />
          </Setting>
        )}
      </SettingGroup>
      {verb === 'from-pdf' && <PageRenderSettings options={options} set={set} />}
      {!verb && <OutputSettings options={options} set={set} />}
    </>
  )
}
```

```tsx
// src/renderer/src/components/options/OutputSettings.tsx
import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { SmallButton } from '../ui/Button'
import { Select } from '../ui/Select'
import { Setting, SettingGroup } from '../ui/Setting'
import type { SetOption } from './types'

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** OUTPUT > Location (engine support: Task 3) and FILES > If file exists, which
 * is fixed because the never-overwrite rule leaves one possible value (O7). */
export function OutputSettings({
  options,
  set
}: {
  options: JobOptions
  set: SetOption
}): JSX.Element {
  const dir = typeof options.outDir === 'string' ? options.outDir : ''
  async function choose(): Promise<void> {
    const p = await window.filesmith.pickFolder()
    if (p) set('outDir', p)
  }
  return (
    <>
      <SettingGroup title="OUTPUT">
        <Setting
          title="Location"
          desc={dir ? <code>{dir}</code> : 'Files are written next to each source.'}
        >
          <div className="vs-row">
            <Select
              label="Location"
              value={dir ? 'folder' : 'source'}
              options={[
                { value: 'source', label: 'next to source' },
                {
                  value: 'folder',
                  label: dir ? baseName(dir) : 'chosen folder',
                  disabled: !dir,
                  reason: dir ? undefined : 'choose one first'
                }
              ]}
              onChange={(v) => {
                if (v === 'source') set('outDir', '')
              }}
            />
            <SmallButton icon="folder" onClick={() => void choose()}>
              Choose folder
            </SmallButton>
          </div>
        </Setting>
      </SettingGroup>
      <SettingGroup title="FILES">
        <Setting title="If file exists" desc="Existing files are never overwritten.">
          <Select
            half
            disabled
            label="If file exists"
            value="add"
            options={[{ value: 'add', label: 'add (2)' }]}
            onChange={() => undefined}
          />
        </Setting>
      </SettingGroup>
    </>
  )
}
```

```tsx
// src/renderer/src/components/options/CompressSettings.tsx
import type { JSX } from 'react'
import type { FileKind, JobOptions } from '@shared/types'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  IMAGE_FORMATS,
  PDF_LEVELS,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  VIDEO_CODECS
} from '@shared/compress'
import { ChipGrid } from '../ui/ChipGrid'
import { OutputSizeList, type SizeRow } from '../ui/OutputSizeList'
import { RangeField } from '../ui/RangeField'
import { Select } from '../ui/Select'
import { CheckSetting, Setting, SettingGroup } from '../ui/Setting'
import type { SetOption } from './types'

const quality = (options: JobOptions, set: SetOption): JSX.Element => (
  <Setting title="Quality">
    <RangeField
      label="Quality"
      min={10}
      max={100}
      value={Number(options.quality ?? 80)}
      onChange={(v) => set('quality', v)}
      ends={['smaller file', 'higher quality']}
    />
  </Setting>
)

export function CompressSettings({
  options,
  kind,
  videoOutputs,
  set
}: {
  options: JobOptions
  kind: FileKind
  videoOutputs: SizeRow[]
  set: SetOption
}): JSX.Element {
  if (kind === 'pdf')
    return (
      <SettingGroup title="PDF">
        <Setting
          title="Level"
          desc="Lossless keeps every pixel; smallest recompresses images hardest."
        >
          <Select
            label="Level"
            value={String(options.pdfLevel ?? 'balanced')}
            options={PDF_LEVELS}
            onChange={(v) => set('pdfLevel', v)}
          />
        </Setting>
        <Setting title="Colour">
          <CheckSetting
            checked={Boolean(options.pdfGray)}
            onChange={(v) => set('pdfGray', v)}
            label="Convert to greyscale"
            sub="Smaller, but every page loses its colour"
          />
        </Setting>
      </SettingGroup>
    )
  if (kind === 'video') {
    const scale = Number(options.scale ?? 100)
    return (
      <SettingGroup title="VIDEO">
        <Setting title="Codec">
          <Select
            label="Codec"
            value={String(options.videoCodec ?? 'h264')}
            options={VIDEO_CODECS}
            onChange={(v) => set('videoCodec', v)}
          />
        </Setting>
        <Setting title="Scale" desc="Downscale while compressing.">
          <RangeField
            label="Scale"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={scale}
            onChange={(v) => set('scale', v)}
            format={(v) => (v === 100 ? 'original' : `${v}%`)}
            ends={[`${SCALE_MIN}%`, 'original']}
          />
          {scale < 100 && <OutputSizeList rows={videoOutputs} />}
        </Setting>
        {quality(options, set)}
      </SettingGroup>
    )
  }
  if (kind === 'audio')
    return (
      <SettingGroup title="AUDIO">
        <Setting title="Codec">
          <Select
            label="Codec"
            value={String(options.audioCodec ?? 'keep')}
            options={AUDIO_CODECS}
            onChange={(v) => set('audioCodec', v)}
          />
        </Setting>
        <Setting title="Bitrate">
          <ChipGrid
            label="Bitrate"
            cols={3}
            value={Number(options.audioBitrate ?? 192)}
            chips={AUDIO_BITRATES.map((b) => ({ value: b, label: `${b}k` }))}
            onChange={(v) => set('audioBitrate', v)}
          />
        </Setting>
      </SettingGroup>
    )
  return (
    <SettingGroup title="FORMAT">
      <Setting title="Format">
        <Select
          label="Format"
          value={String(options.imageFormat ?? 'keep')}
          options={IMAGE_FORMATS}
          onChange={(v) => set('imageFormat', v)}
        />
      </Setting>
      {quality(options, set)}
    </SettingGroup>
  )
}
```

`PDF_LEVELS`, `VIDEO_CODECS`, `AUDIO_CODECS` and `IMAGE_FORMATS` are `Choice<T>[]` (`{ value, label }`), which is assignable to `SelectOption<T>[]`.

```tsx
// src/renderer/src/components/options/ResizeSettings.tsx
import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { RESIZE_FITS } from '@shared/resize'
import { OutputSizeList, type SizeRow } from '../ui/OutputSizeList'
import { RangeField } from '../ui/RangeField'
import { Segmented } from '../ui/Segmented'
import { Setting, SettingGroup } from '../ui/Setting'
import { NumberField } from '../ui/TextField'
import type { SetOption } from './types'

const dim = (v: unknown): number | '' =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v)

export function ResizeSettings({
  options,
  outputs,
  set
}: {
  options: JobOptions
  outputs: SizeRow[]
  set: SetOption
}): JSX.Element {
  const mode = String(options.mode ?? 'percent')
  return (
    <SettingGroup title="SIZE">
      <Setting title="Mode">
        <Segmented
          label="Mode"
          value={mode}
          options={[
            { value: 'percent', label: 'percent' },
            { value: 'dimensions', label: 'dimensions' }
          ]}
          onChange={(v) => set('mode', v)}
        />
      </Setting>
      {mode === 'percent' ? (
        <Setting title="Percent">
          <RangeField
            label="Percent"
            min={5}
            max={200}
            value={Number(options.percent ?? 50)}
            onChange={(v) => set('percent', v)}
            format={(v) => `${v}%`}
          />
        </Setting>
      ) : (
        <>
          <Setting title="Width and height" desc="Leave one blank to scale by the other.">
            <div className="vs-row">
              <NumberField
                label="Width"
                placeholder="auto"
                value={dim(options.width)}
                onCommit={(v) => set('width', v)}
                clamp={(n) => Math.max(1, Math.round(n))}
              />
              <NumberField
                label="Height"
                placeholder="auto"
                value={dim(options.height)}
                onCommit={(v) => set('height', v)}
                clamp={(n) => Math.max(1, Math.round(n))}
              />
            </div>
          </Setting>
          <Setting
            title="Fit"
            desc="Contain keeps the aspect ratio inside the box; stretch honours both numbers."
          >
            <Segmented
              label="Fit"
              value={options.fit === 'stretch' ? 'stretch' : 'contain'}
              options={RESIZE_FITS.map((f) => ({ value: f.value, label: f.label.toLowerCase() }))}
              onChange={(v) => set('fit', v)}
            />
            <OutputSizeList rows={outputs} />
          </Setting>
        </>
      )}
    </SettingGroup>
  )
}
```

```tsx
// src/renderer/src/components/options/RemoveBgSettings.tsx
import { useEffect, useState, type JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { BG_DEFAULTS, BG_FILLS, type BgFill } from '@shared/removebg'
import { SmallButton } from '../ui/Button'
import { Select } from '../ui/Select'
import { Setting, SettingGroup } from '../ui/Setting'
import type { SetOption } from './types'

/** One fill choice plus its custom colour or image. The model and matting
 * thresholds are deliberately not exposed (see src/shared/removebg.ts). */
export function RemoveBgSettings({
  options,
  set
}: {
  options: JobOptions
  set: SetOption
}): JSX.Element {
  const fill = String(options.bgFill ?? BG_DEFAULTS.bgFill) as BgFill
  const bgImage = String(options.bgImagePath ?? '')
  const color = String(options.bgCustomColor ?? BG_DEFAULTS.bgCustomColor)
  const [rembg, setRembg] = useState<{ ready: boolean; uvAvailable: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    void window.filesmith.removebgStatus().then((s) => alive && setRembg(s))
    return () => {
      alive = false
    }
  }, [])
  const notice =
    rembg && !rembg.ready ? (
      rembg.uvAvailable ? (
        'The first run downloads the AI model once (a few hundred MB), then works offline.'
      ) : (
        <>
          Needs the free uv tool: <code>winget install astral-sh.uv</code>, then reopen Filesmith.
        </>
      )
    ) : undefined
  return (
    <SettingGroup title="BACKGROUND">
      <Setting title="Fill" desc={notice} warn={notice != null}>
        <Select label="Fill" value={fill} options={BG_FILLS} onChange={(v) => set('bgFill', v)} />
      </Setting>
      {fill === 'custom' && (
        <Setting title="Custom colour">
          {/* The swatch shows user data, the one non-grey value on screen (spec 4.2). */}
          <label className="swatch">
            <span className="sw" style={{ background: color }} />
            <span className="mono">{color}</span>
            <input
              type="color"
              className="sr-only"
              value={color}
              onChange={(e) => set('bgCustomColor', e.target.value)}
            />
          </label>
        </Setting>
      )}
      {fill === 'image' && (
        <Setting
          title="Background image"
          desc={bgImage ? <code>{bgImage.split(/[\\/]/).pop()}</code> : undefined}
        >
          <SmallButton
            icon="image"
            onClick={() =>
              void window.filesmith.pickImage().then((p) => {
                if (p) set('bgImagePath', p)
              })
            }
          >
            Choose image
          </SmallButton>
        </Setting>
      )}
    </SettingGroup>
  )
}
```

```tsx
// src/renderer/src/components/options/PdfSettings.tsx
import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { RangeField } from '../ui/RangeField'
import { Setting, SettingGroup } from '../ui/Setting'
import { TextField } from '../ui/TextField'
import type { SetOption } from './types'

/** Each Tools card is one op, so there is no op picker (spec 4.2). */
export function PdfSettings({
  options,
  runCount,
  set
}: {
  options: JobOptions
  runCount: number
  set: SetOption
}): JSX.Element | null {
  const op = String(options.op ?? 'extract-text')
  if (op === 'pages-to-images')
    return (
      <SettingGroup title="PAGES">
        <Setting title="Resolution" desc="Dots per inch for each rendered page.">
          <RangeField
            label="Resolution"
            min={72}
            max={400}
            step={2}
            value={Number(options.dpi ?? 150)}
            onChange={(v) => set('dpi', v)}
            format={(v) => `${v} dpi`}
          />
        </Setting>
      </SettingGroup>
    )
  if (op === 'split-range')
    return (
      <SettingGroup title="PAGES">
        <Setting
          title="Pages to keep"
          desc={
            <>
              Ranges and single pages, for example <code>1-3,5,8-10</code>.
            </>
          }
        >
          <TextField
            aria-label="Pages to keep"
            placeholder="1-3,5,8-10"
            value={String(options.range ?? '')}
            onChange={(e) => set('range', e.target.value)}
          />
        </Setting>
      </SettingGroup>
    )
  if (op === 'merge' && runCount < 2)
    return (
      <SettingGroup title="FILES">
        <Setting title="Merge" desc="Select 2 or more PDFs. They are combined in table order." />
      </SettingGroup>
    )
  return null
}
```

```tsx
// src/renderer/src/components/options/ArchiveSettings.tsx
import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { ARCHIVE_FORMATS, COMIC_FORMATS, needsRar } from '@shared/archive'
import { ChipGrid } from '../ui/ChipGrid'
import { Segmented } from '../ui/Segmented'
import { Setting, SettingGroup } from '../ui/Setting'
import { PageRenderSettings } from './PageRenderSettings'
import type { SetOption } from './types'

/** Archive Tools cards (only reachable when such a card exists). from-pdf reuses
 * PageRenderSettings, which fixes the old bug where this panel wrote `quality`
 * while the engine reads `pageQuality`. */
export function ArchiveSettings({
  options,
  srcExts,
  hasRar,
  set
}: {
  options: JobOptions
  srcExts: string[]
  hasRar: boolean
  set: SetOption
}): JSX.Element {
  const op = String(options.op ?? 'repack')
  const targets = (list: typeof ARCHIVE_FORMATS): JSX.Element => (
    <Setting title="Format">
      <ChipGrid
        label="Format"
        value={String(options.format ?? '.cbz')}
        chips={list.map((f) => {
          // .zip and .cbz are the same container but not the same file: compare by extension.
          const isSource = srcExts.includes(f.ext)
          const noRar = needsRar(f.ext) && !hasRar
          return {
            value: f.ext,
            label: f.label.toLowerCase(),
            disabled: isSource || noRar,
            title: noRar
              ? 'WinRAR not found'
              : isSource
                ? 'Files are already this format'
                : undefined
          }
        })}
        onChange={(v) => set('format', v)}
      />
    </Setting>
  )
  if (op === 'extract')
    return (
      <SettingGroup title="OUTPUT">
        <Setting title="Extract" desc="Each archive is unpacked into its own folder next to it." />
      </SettingGroup>
    )
  if (op === 'to-pdf')
    return (
      <SettingGroup title="OUTPUT">
        <Setting
          title="To PDF"
          desc="Pages are ordered by filename, the way a reader shows them."
        />
      </SettingGroup>
    )
  if (op === 'from-pdf')
    return (
      <>
        <SettingGroup title="FORMAT">{targets(COMIC_FORMATS)}</SettingGroup>
        <PageRenderSettings options={options} set={set} />
      </>
    )
  return (
    <SettingGroup title="FORMAT">
      {targets(ARCHIVE_FORMATS)}
      <Setting
        title="Compression"
        desc="Comic pages are already compressed images, so store is faster at the same size."
      >
        <Segmented
          label="Compression"
          value={options.store === false ? 'normal' : 'store'}
          options={[
            { value: 'store', label: 'store' },
            { value: 'normal', label: 'normal' }
          ]}
          onChange={(v) => set('store', v === 'store')}
        />
      </Setting>
    </SettingGroup>
  )
}
```

The two info-only descriptions (`extract`, `to-pdf`) and the `.cbz` default target are copied word for word from the old `ArchiveOptions` (`OptionsPanel.tsx:1006-1033`).

- [ ] **Step 4: Upscale settings and its setup blocks**

`options/upscale/PidSetup.tsx`: move `PidInstallCard` from `components/PidUpscale.tsx` and `PidRemoveButton` from `OptionsPanel.tsx`, keeping every state, effect and IPC call (`pidInstalling`, `pidInstall`, `onPidProgress`, `pidRemove`, the two-step remove confirmation). Restyle as `Setting` blocks per spec 5.5, using this mapping:

| Old markup                                                    | New                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| card container with title + paragraph                         | `<Setting title="..." desc="...">` (licence notice and VRAM text become the description)         |
| primary download button                                       | `<SmallButton icon="pull">`                                                                      |
| remove / uninstall button                                     | `<SmallButton icon="trash">`                                                                     |
| progress bar (rounded track + accent fill)                    | `<ProgressBar wide value={pct} label="..."/>` followed by `<span className="mono">{pct}%</span>` |
| any `text-[#...]`, `bg-[#...]`, `rounded-*`, `shadow-*` class | removed                                                                                          |

`options/upscale/ComfySetup.tsx`: the same treatment for `ComfyImportCard` and its local `ProgressBar` from `components/ComfyImport.tsx` (three states: engine not built, scanning, ready; the unusable-files list renders as a `<ul className="sizes mono">`). Delete the local `ProgressBar` in favour of `ui/ProgressBar`.

```tsx
// src/renderer/src/components/options/UpscaleSettings.tsx
import { useEffect, useMemo, useState, type JSX } from 'react'
import type { JobOptions } from '@shared/types'
import {
  UPSCALE_COMFY,
  UPSCALE_FACTORS,
  UPSCALE_GPU_MODES,
  UPSCALE_MODELS,
  type Choice,
  type UpscaleModel
} from '@shared/compress'
import { SmallButton } from '../ui/Button'
import { ChipGrid } from '../ui/ChipGrid'
import { OutputSizeList, type SizeRow } from '../ui/OutputSizeList'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { Setting, SettingGroup } from '../ui/Setting'
import { useComfyModels } from './hooks/useComfyModels'
import { usePidStatus } from './hooks/usePidStatus'
import { ComfyImportCard } from './upscale/ComfySetup'
import { PidInstallCard, PidRemoveButton } from './upscale/PidSetup'
import type { SetOption } from './types'

export function UpscaleSettings({
  options,
  outputs,
  set
}: {
  options: JobOptions
  outputs: SizeRow[]
  set: SetOption
}): JSX.Element {
  const factor = Number(options.upscaleFactor ?? 4)
  const comfy = useComfyModels()
  const { status: pid, refresh: refreshPid } = usePidStatus()
  const rawModel = String(options.upscaleModel ?? 'photo')
  const hasNvidia = Boolean(comfy.status?.nvidia || pid?.nvidia)
  const [ncnn, setNcnn] = useState<{ value: string; label: string; user: boolean }[] | null>(null)
  useEffect(() => {
    let alive = true
    void window.filesmith.upscaleModels().then((m) => alive && setNcnn(m))
    return () => {
      alive = false
    }
  }, [])
  const comfyModels = comfy.status?.models
  const comfyChoices = useMemo(
    () =>
      (comfyModels ?? []).map((m) => ({
        value: `comfy:${m.path}`,
        label: `${m.name}, ${m.scale}×${m.badge === 'experimental' ? ', experimental' : ''}`
      })),
    [comfyModels]
  )
  const ncnnChoices: Choice<UpscaleModel>[] = ncnn?.length
    ? ncnn.map((m) => ({
        value: m.value as UpscaleModel,
        label: m.user ? `${m.label}, added by you` : m.label
      }))
    : UPSCALE_MODELS
  const isPid = rawModel === 'pid'
  const isComfyPath = rawModel.startsWith('comfy:')
  const inAi = isPid || isComfyPath || rawModel === 'comfy'
  const category = inAi
    ? 'comfy'
    : ncnnChoices.some((c) => c.value === rawModel)
      ? rawModel
      : (ncnnChoices[0]?.value ?? 'photo')
  const categoryChoices = [...ncnnChoices, ...(hasNvidia ? [UPSCALE_COMFY] : [])]
  const showPid = hasNvidia && Boolean(pid?.installed || comfy.status?.pidReusable)
  const subChoices = [
    ...comfyChoices,
    ...(showPid ? [{ value: 'pid', label: 'PiD (diffusion), 4×' }] : [])
  ]
  const subDefault = comfyChoices[0]?.value ?? (showPid ? 'pid' : 'comfy')
  const subValue = isPid ? 'pid' : isComfyPath ? rawModel : subDefault
  const pidNeedsInstall = isPid && pid != null && !pid.installed
  const vramMb = pid?.nvidia?.vramMb ?? null
  const lowVram = isPid && vramMb != null && vramMb < 12_000
  const pickCategory = (v: string): void => set('upscaleModel', v === 'comfy' ? subDefault : v)
  useEffect(() => {
    if (pid == null || comfy.status == null) return
    if (inAi && !hasNvidia) set('upscaleModel', 'photo')
    else if (isComfyPath && !comfyChoices.some((c) => c.value === rawModel))
      set('upscaleModel', subDefault)
    else if (isPid && !showPid) set('upscaleModel', subDefault)
  }, [
    pid,
    comfy.status,
    hasNvidia,
    inAi,
    isComfyPath,
    isPid,
    showPid,
    rawModel,
    comfyChoices,
    subDefault,
    set
  ])
  const gpuReason = !hasNvidia ? (pid?.cudaReason ?? comfy.status?.cudaReason) : undefined

  return (
    <>
      <SettingGroup title="MODEL">
        <Setting title="Factor">
          <ChipGrid
            label="Factor"
            cols={3}
            value={factor}
            chips={UPSCALE_FACTORS.map((f) => ({ value: f, label: `${f}×` }))}
            onChange={(v) => set('upscaleFactor', v)}
          />
        </Setting>
        <Setting title="Model" desc={gpuReason ?? undefined}>
          <Select
            label="Model"
            value={category}
            options={categoryChoices}
            onChange={pickCategory}
          />
          {category === 'comfy' && subChoices.length > 0 && (
            <Select
              label="AI model"
              value={subValue}
              options={subChoices}
              onChange={(v) => set('upscaleModel', v)}
            />
          )}
          {!inAi && (
            <SmallButton
              icon="folder"
              onClick={() => void window.filesmith.upscaleOpenModelsFolder()}
            >
              Add your own model
            </SmallButton>
          )}
        </Setting>
        {category === 'comfy' && pidNeedsInstall && <PidInstallCard onInstalled={refreshPid} />}
        {category === 'comfy' && isPid && pid?.installed && (
          <PidRemoveButton onRemoved={refreshPid} />
        )}
        {category === 'comfy' && comfy.status && (
          <ComfyImportCard status={comfy.status} refresh={comfy.refresh} />
        )}
      </SettingGroup>
      {(!isPid || lowVram) && (
        <SettingGroup title="PERFORMANCE">
          {!isPid && (
            <Setting title="GPU mode">
              <Segmented
                label="GPU mode"
                value={String(options.gpuMode ?? 'full')}
                options={UPSCALE_GPU_MODES.map((o) => ({
                  value: o.value,
                  label: o.label.toLowerCase()
                }))}
                onChange={(v) => set('gpuMode', v)}
              />
            </Setting>
          )}
          {lowVram && (
            <Setting
              title="Graphics memory"
              warn
              desc={`Your GPU reports about ${Math.round((vramMb as number) / 1024)} GB, so PiD reduces the resolution of large images to fit.`}
            />
          )}
        </SettingGroup>
      )}
      {outputs.length > 0 && (
        <SettingGroup title="OUTPUT">
          <Setting title="Output size">
            <OutputSizeList rows={outputs} />
          </Setting>
        </SettingGroup>
      )}
    </>
  )
}
```

The separators inside model labels change from `·` to `, ` only for display; stored values (`comfy:<path>`, `pid`, `photo`, ...) are unchanged.

- [ ] **Step 5: Generate settings**

Create `generate/ModelSelect.tsx` exporting `ModelSelect({ models, value, onChange })`: a `Select` whose options are the models with `group` = the architecture group heading the old `ModelPicker` used for its `<optgroup>`s (`OptionsPanel.tsx:1123-1167`), no `disabled` flag, and `reason: 'needs download'` for non-runnable models (replacing the old dash-prefixed suffix). Non-runnable models must stay selectable, exactly as the old picker documents (`OptionsPanel.tsx:1119-1121`): picking one is what reveals `CompanionDownload` or the Try anyway button below, so disabling them would make both unreachable. Move `CompanionDownload` (`:1172-1241`), `LocateComfy` (`:1252-1276`) and `AddModel` (`:1284-1356`) into their own files under `generate/` with every effect, state and IPC call unchanged, restyled with the same mapping table as Step 4 (buttons become `SmallButton`; `AddModel`'s three actions use icons `addfile`, `folder`, `folder`; the missing-file list is `<ul className="sizes mono">`; the download bar is `<ProgressBar wide ... />`).

`generate/AdvancedSettings.tsx` exports `AdvancedSettings({ options, info, set })` and holds Steps, CFG, Guidance and Seed from `OptionsPanel.tsx:1631-1725` with their ranges unchanged (`steps`: min 8 for sdxl and flux1 else 1, max 50; `cfg`: 1-15 step 0.5, sdxl only; `guidance`: 1-10 step 0.5 when `info.hasGuidance`; `seed`: `NumberField` plus a `CheckSetting` "Random seed" that writes `-1`). Each `HelpTip` text becomes that setting's `desc`. It renders inside `<SettingGroup title="ADVANCED" collapsible open={open} onToggle={...}>` with local `useState(false)` for `open`.

`generate/GenerateSettings.tsx`:

```tsx
import { useEffect, useMemo, useRef, type JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { GEN_MAX_COUNT, GEN_SIZES, GEN_STYLES, clampDim } from '@shared/generate'
import { archInfoFor, type GenArch } from '@shared/genArch'
import { SmallButton } from '../../ui/Button'
import { ChipGrid } from '../../ui/ChipGrid'
import { RangeField } from '../../ui/RangeField'
import { Select } from '../../ui/Select'
import { Setting, SettingGroup } from '../../ui/Setting'
import { NumberField, TextField } from '../../ui/TextField'
import { useGenerateStatus } from '../hooks/useGenerateStatus'
import type { SetOption } from '../types'
import { AddModel } from './AddModel'
import { AdvancedSettings } from './AdvancedSettings'
import { CompanionDownload } from './CompanionDownload'
import { LocateComfy } from './LocateComfy'
import { ModelSelect } from './ModelSelect'
import { isRestoreName } from './restore'

export function GenerateSettings({
  options,
  set
}: {
  options: JobOptions
  set: SetOption
}): JSX.Element {
  const { status, refresh } = useGenerateStatus()
  const model = String(options.model ?? '')
  const w = Number(options.width ?? 1024)
  const h = Number(options.height ?? 1024)
  const isPreset = GEN_SIZES.some((s) => s.width === w && s.height === h)
  const sizeValue =
    String(options.sizeMode ?? '') === 'custom' || !isPreset ? 'custom' : `${w}x${h}`
  const models = useMemo(() => status?.models ?? [], [status])
  const selected = models.find((m) => m.name === model)
  const tryAnyway = Boolean(options.tryAnyway)
  const dimCaps = status?.dimCaps?.[selected?.arch ?? 'sdxl']
  const arch: GenArch = selected?.arch ?? 'sdxl'
  const info = archInfoFor(arch, status?.archInfo)
  useEffect(() => {
    if (!models.length || selected) return
    const good =
      models.find((m) => m.runnable && !isRestoreName(m.label)) ??
      models.find((m) => m.runnable) ??
      models[0]
    if (good && good.name !== model) set('model', good.name)
  }, [model, models, selected, set])
  const prevArch = useRef<GenArch | null>(null)
  useEffect(() => {
    if (!status) return
    if (prevArch.current === null) {
      prevArch.current = arch
      return
    }
    if (prevArch.current === arch) return
    prevArch.current = arch
    set('tryAnyway', 0)
    set('steps', info.steps)
    set('cfg', info.cfg)
    if (info.hasGuidance) set('guidance', info.guidance)
  }, [arch, info, set, status])

  const sizeChoices = [
    ...GEN_SIZES.map((s) => ({ value: `${s.width}x${s.height}`, label: s.label })),
    { value: 'custom', label: 'custom' }
  ]
  return (
    <>
      {status && !status.available && <LocateComfy onLocated={refresh} />}
      <SettingGroup title="MODEL">
        <Setting
          title="Model"
          desc={
            !models.length
              ? 'No image models found in your ComfyUI models folder.'
              : selected && !selected.runnable && !selected.missing?.length
                ? selected.reason
                : undefined
          }
        >
          {models.length > 0 && (
            <ModelSelect models={models} value={model} onChange={(v) => set('model', v)} />
          )}
          {selected && !selected.runnable && !selected.missing?.length && selected.tryAnyway && (
            <SmallButton
              icon={tryAnyway ? 'close' : 'play'}
              onClick={() => set('tryAnyway', tryAnyway ? 0 : 1)}
            >
              {tryAnyway ? 'Will try anyway, click to cancel' : 'Try anyway'}
            </SmallButton>
          )}
        </Setting>
        {selected && !selected.runnable && selected.missing?.length ? (
          <CompanionDownload model={selected} onDone={refresh} />
        ) : null}
        <AddModel onAdded={refresh} comfyFolder={status?.comfyFolder} />
      </SettingGroup>
      <SettingGroup title="PROMPT">
        {info.cfg !== 1 && (
          <Setting title="Negative prompt" desc="What the image should avoid.">
            <TextField
              aria-label="Negative prompt"
              value={String(options.negative ?? '')}
              onChange={(e) => set('negative', e.target.value)}
            />
          </Setting>
        )}
        <Setting title="Style">
          <ChipGrid
            label="Style"
            cols={3}
            value={String(options.style ?? '')}
            chips={GEN_STYLES.map((s) => ({ value: s.value, label: s.label.toLowerCase() }))}
            onChange={(v) => set('style', v)}
          />
        </Setting>
      </SettingGroup>
      <SettingGroup title="OUTPUT">
        <Setting title="Count">
          <RangeField
            label="Count"
            min={1}
            max={GEN_MAX_COUNT}
            value={Number(options.count ?? 1)}
            onChange={(v) => set('count', v)}
          />
        </Setting>
        <Setting title="Size">
          <Select
            label="Size"
            value={sizeValue}
            options={sizeChoices}
            onChange={(v) => {
              if (v === 'custom') return set('sizeMode', 'custom')
              const [sw, sh] = v.split('x').map(Number)
              set('sizeMode', 'preset')
              set('width', sw)
              set('height', sh)
            }}
          />
          {sizeValue === 'custom' && (
            <div className="vs-row">
              <NumberField
                label="Width"
                value={w}
                onCommit={(v) => v !== '' && set('width', v)}
                clamp={(n) => clampDim(n, dimCaps)}
              />
              <NumberField
                label="Height"
                value={h}
                onCommit={(v) => v !== '' && set('height', v)}
                clamp={(n) => clampDim(n, dimCaps)}
              />
            </div>
          )}
        </Setting>
      </SettingGroup>
      <AdvancedSettings options={options} info={info} set={set} />
    </>
  )
}
```

Before writing this file, read `OptionsPanel.tsx:1562-1627` and match three details exactly: the `GEN_STYLES` item shape (`value`/`label`), how the old size `onChange` wrote `sizeMode`/`width`/`height`, and `clampDim`'s real signature. If any differs from the code above, follow the old code; the visual structure above is what changes.

- [ ] **Step 6: The pane router and the inspector**

```tsx
// src/renderer/src/components/options/OptionsPane.tsx
import type { JSX } from 'react'
import type { FileKind, JobOptions, ToolId } from '@shared/types'
import type { TabId } from '@shared/tabs'
import { EstimateCard } from '../ui/EstimateCard'
import type { SizeRow } from '../ui/OutputSizeList'
import { ArchiveSettings } from './ArchiveSettings'
import { CompressSettings } from './CompressSettings'
import { ConvertSettings } from './ConvertSettings'
import { GenerateSettings } from './generate/GenerateSettings'
import { useArchiveStatus } from './hooks/useArchiveStatus'
import { PdfSettings } from './PdfSettings'
import { RemoveBgSettings } from './RemoveBgSettings'
import { ResizeSettings } from './ResizeSettings'
import type { SetOption } from './types'
import { UpscaleSettings } from './UpscaleSettings'

export function OptionsPane({
  tab,
  tool,
  options,
  kind,
  srcExts,
  sourceExt,
  runCount,
  videoOutputs,
  resizeOutputs,
  upscaleOutputs,
  estimate,
  set
}: {
  tab: TabId
  tool: ToolId
  options: JobOptions
  kind: FileKind
  srcExts: string[]
  sourceExt: string | null
  runCount: number
  videoOutputs: SizeRow[]
  resizeOutputs: SizeRow[]
  upscaleOutputs: SizeRow[]
  estimate: { from: number; to: number; files: number } | null
  set: SetOption
}): JSX.Element {
  // One status call for the whole pane (it used to be made twice).
  const { rar } = useArchiveStatus()
  function body(): JSX.Element | null {
    // Convert owns its target choice for every route, including archive ones.
    if (tab === 'convert')
      return (
        <ConvertSettings
          options={options}
          kind={kind}
          sourceExt={sourceExt}
          srcExts={srcExts}
          verb={tool === 'archive' ? String(options.op ?? '') : undefined}
          hasRar={rar}
          set={set}
        />
      )
    switch (tool) {
      case 'compress':
        return (
          <CompressSettings options={options} kind={kind} videoOutputs={videoOutputs} set={set} />
        )
      case 'resize':
        return <ResizeSettings options={options} outputs={resizeOutputs} set={set} />
      case 'upscale':
        return <UpscaleSettings options={options} outputs={upscaleOutputs} set={set} />
      case 'removebg':
        return <RemoveBgSettings options={options} set={set} />
      case 'pdf':
        return <PdfSettings options={options} runCount={runCount} set={set} />
      case 'archive':
        return <ArchiveSettings options={options} srcExts={srcExts} hasRar={rar} set={set} />
      case 'generate':
        return <GenerateSettings options={options} set={set} />
      default:
        return null
    }
  }
  return (
    <div className="vs">
      {body()}
      {estimate && <EstimateCard from={estimate.from} to={estimate.to} files={estimate.files} />}
    </div>
  )
}
```

```tsx
// src/renderer/src/components/inspector/Inspector.tsx
import type { JSX, ReactNode } from 'react'
import { PrimaryButton } from '../ui/Button'
import { Tabs } from '../ui/Tabs'

export type InspTab = 'options' | 'preview' | 'info'

export function Inspector({
  tab,
  onTab,
  title,
  sub,
  runLabel,
  runDisabled,
  onRun,
  children
}: {
  tab: InspTab
  onTab: (t: InspTab) => void
  title: string
  sub: string
  runLabel: string
  runDisabled: boolean
  onRun: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <aside className="insp" aria-label="Inspector">
      <Tabs
        label="Inspector"
        idPrefix="insp"
        value={tab}
        onChange={onTab}
        tabs={[
          { id: 'options', label: 'Options', icon: 'settings' },
          { id: 'preview', label: 'Preview', icon: 'eye' },
          { id: 'info', label: 'Info', icon: 'info' }
        ]}
      />
      <div
        className="ibody scroll-thin"
        role="tabpanel"
        id={`insp-panel-${tab}`}
        aria-labelledby={`insp-tab-${tab}`}
      >
        <div className="ihead">
          <h1>{title}</h1>
          <span>{sub}</span>
        </div>
        {children}
      </div>
      <div className="ifoot">
        <PrimaryButton
          data-testid="run"
          disabled={runDisabled}
          onClick={onRun}
          title="Run (Ctrl+Enter)"
        >
          {runLabel}
        </PrimaryButton>
      </div>
    </aside>
  )
}
```

- [ ] **Step 7: Wire it into `App.tsx`**

1. Memoize the setter (spec 4.2; the inline arrow re-ran two effects every render):

```ts
const onSet = useCallback(
  (k: string, v: string | number | boolean) =>
    dispatch({ type: 'setOption', group: optGroup, key: k, value: v }),
  [optGroup]
)
```

2. Inspector state: `const [inspTab, setInspTab] = useState<InspTab>('options')`. In the Sidebar `onSelect`, also call `setInspTab('options')`, so every workspace opens on its options and its `<h1>` names the verb.

3. Change the three `VideoOutputRow[]` annotations to `SizeRow[]` (`import type { SizeRow } from './components/ui/OutputSizeList'`); the objects already have `name`, `from`, `to`.

4. Batch estimate (spec 4.5), using the Task 12 `estimateFor` with the CURRENT options:

```ts
  function estimateFor(it: QueueItem, opts: JobOptions = it.runOptions ?? curOptions): number | null {
```

(change the signature; body unchanged) and

```ts
const batchEstimate =
  tool === 'generate' || runList.length === 0
    ? null
    : estimateBatch(
        runList.map((i) => ({ size: i.file.size, estimate: estimateFor(i, curOptions) }))
      )
```

5. Inspector head and Run label:

```ts
const verbLabel = card ? card.label : tab.label
const focused = cur.items.find(
  (i) => i.id === (cur.anchor && cur.selected.includes(cur.anchor) ? cur.anchor : cur.selected[0])
)
const scopeCount = scopeItems.length
const inspSub =
  tool === 'generate'
    ? ''
    : inspTab !== 'options'
      ? focused
        ? 'selected'
        : ''
      : cur.selected.length
        ? `${cur.selected.length} selected`
        : scopeCount
          ? `all ${scopeCount} file${scopeCount === 1 ? '' : 's'}`
          : 'no files'
const inspTitle = inspTab === 'options' || !focused ? verbLabel : focused.file.name
const genCount = Number(curOptions.count ?? 1)
const runLabel =
  tool === 'generate'
    ? genCount > 1
      ? `Generate ${genCount} images`
      : 'Generate'
    : runCount > 0
      ? `${verbLabel} ${groupNoun(optGroup, runCount)}`
      : verbLabel
```

6. Replace `<OptionsPanel ... />` with:

```tsx
{
  showInspector && (
    <Inspector
      tab={inspTab}
      onTab={setInspTab}
      title={inspTitle}
      sub={inspSub}
      runLabel={runLabel}
      runDisabled={runCount === 0}
      onRun={() => void run()}
    >
      {inspTab === 'options' ? (
        <OptionsPane
          tab={state.tab}
          tool={tool}
          options={curOptions}
          kind={tool === 'compress' ? (runKind ?? fallbackKind) : (activeKind ?? fallbackKind)}
          srcExts={srcExts}
          sourceExt={sourceExt}
          runCount={runCount}
          videoOutputs={videoOutputs}
          resizeOutputs={resizeOutputs}
          upscaleOutputs={upscaleOutputs}
          estimate={batchEstimate}
          set={onSet}
        />
      ) : (
        <EmptyState
          icon={inspTab === 'preview' ? 'eye' : 'info'}
          title="Nothing selected"
          line="Select a file in the table to see it here"
        />
      )}
    </Inspector>
  )
}
```

(Import `EmptyState` from `./components/queue/EmptyState`, `Inspector` and `type InspTab` from `./components/inspector/Inspector`, and `OptionsPane` from `./components/options/OptionsPane`. Task 14 replaces the `EmptyState` branch with the real Preview and Info panes.) Generate keeps the inspector; its options now show with no file selected because `OptionsPane` no longer gates on a selection (spec 4.1).

7. Delete `OperationTitle` from the centre and its import.

- [ ] **Step 8: Delete the replaced files**

```bash
git rm src/renderer/src/components/OptionsPanel.tsx src/renderer/src/components/PidUpscale.tsx src/renderer/src/components/ComfyImport.tsx src/renderer/src/components/OperationTitle.tsx
```

Add to `theme/views.css`:

```css
/* Remove BG custom colour: a 28px swatch button (user data, spec 4.2) */
.swatch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 28px;
  padding-right: 10px;
  border: 1px solid var(--line-strong);
  cursor: pointer;
  align-self: flex-start;
  font-size: 13px;
}
.swatch:hover {
  border-color: var(--fg3);
}
.swatch:focus-within {
  outline: 1px solid var(--focus);
  outline-offset: 1px;
}
.swatch .sw {
  width: 26px;
  height: 26px;
  border-right: 1px solid var(--line-strong);
}
.vs-set > .vs-selwrap + .vs-selwrap,
.vs-set > .vs-selwrap + .sbtn,
.vs-set > .rng + .sizes {
  margin-top: 6px;
}
```

- [ ] **Step 9: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green; `grep -rn "OptionsPanel\|OperationTitle\|PidUpscale\|ComfyImport'" src/renderer` prints nothing.

Run: `npm run dev` and walk every verb: Convert (images: FORMAT with Format select and Quality segments, OUTPUT Location with Choose folder, FILES If file exists disabled `add (2)`, then the estimate card `35.2 MB -> ~7.6 MB -78%` style once files are present); Convert a PDF to CBZ (PAGES group, Page quality changes `pageQuality`); Compress image / video (Scale list below 100%) / audio (bitrate chips) / pdf (greyscale checkbox); Resize both modes; Upscale (factor chips, model select, AI sub-select on NVIDIA, GPU mode); Remove BG (fill select, custom colour swatch, background image button); Tools > Pages to PNG (DPI), Split (range field), Merge (hint with one PDF); Generate (MODEL / PROMPT / OUTPUT / ADVANCED collapsible). Open every select with the keyboard (Down, type-ahead, Enter, Esc). Choose an output folder, convert, confirm the file lands there; delete that folder, convert again, confirm the row fails with "Output folder not found".

- [ ] **Step 10: Commit**

```bash
git add -A src/renderer/src/components/options src/renderer/src/components/inspector src/renderer/src/components/ui/OutputSizeList.tsx src/renderer/src/theme/views.css src/renderer/src/App.tsx test/generate-restore.test.ts
git commit -m "feat(inspector): grouped options per verb, estimate card, output location; fix archive page quality

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Preview and Info panes

**Files:**

- Create: `src/renderer/src/components/inspector/infoModel.ts`, `PreviewPane.tsx`, `InfoPane.tsx`, `Wipe.tsx`
- Modify: `src/renderer/src/App.tsx` (render the panes, probe the focused file)
- Modify: `src/renderer/src/theme/views.css` (wipe slider)
- Test: `test/info-model.test.ts`

**Interfaces:**

- Consumes: `QueueItem`; `formatBytes`; `pctChange`, `formatPct`, `kindLabel` (Task 5); `ProgressBar`, `SmallButton`; `window.filesmith.thumbnail(path, size, kind)`.
- Produces:
  - `interface InfoRow { k: string; v: string; reveal?: string; selectable?: boolean }`
  - `previewRows(item: QueueItem, dims: { width: number; height: number } | null): InfoRow[]` (`size`, `saved` when done with a file output, `pixels`)
  - `infoRows(item: QueueItem, dims: { width: number; height: number } | null, target: string | null): InfoRow[]` (`format`, `pixels`, `size`, `output`, `error`)
  - `wipeStep(key: string, pct: number): number | null` (Left/Right 5, Home 0, End 100)
  - `PreviewPane({ item, outKind, dims })`, `InfoPane({ item, dims, target })`

- [ ] **Step 1: Write the failing test**

```ts
// test/info-model.test.ts
import { describe, expect, it } from 'vitest'
import { infoRows, previewRows, wipeStep } from '../src/renderer/src/components/inspector/infoModel'
import type { QueueItem } from '../src/renderer/src/state'

const base: QueueItem = {
  id: 'a',
  file: { path: 'C:/p/a.jpg', name: 'a.jpg', ext: '.jpg', kind: 'image', size: 2_202_010 },
  thumb: null,
  status: 'ready',
  percent: 0
}
const done: QueueItem = { ...base, status: 'done', outputPath: 'C:/p/a.webp', outputSize: 497_664 }

describe('previewRows', () => {
  it('shows size, saved and pixels for a done file', () => {
    expect(previewRows(done, { width: 4032, height: 3024 })).toEqual([
      { k: 'size', v: '2.1 MB to 486 KB' },
      { k: 'saved', v: '1.6 MB, -77%' },
      { k: 'pixels', v: '4032 × 3024' }
    ])
  })
  it('omits saved before the file is done and says unknown without a probe', () => {
    expect(previewRows(base, null)).toEqual([
      { k: 'size', v: '2.1 MB' },
      { k: 'pixels', v: 'unknown' }
    ])
  })
})

describe('infoRows', () => {
  it('uses the word "to", never an arrow', () => {
    const rows = infoRows(done, { width: 10, height: 20 }, null)
    expect(rows.find((r) => r.k === 'format')?.v).toBe('jpg to webp')
    expect(rows.find((r) => r.k === 'output')).toEqual({
      k: 'output',
      v: 'C:/p/a.webp',
      reveal: 'C:/p/a.webp'
    })
    expect(rows.map((r) => r.v).join(' ')).not.toMatch(/→|->/)
  })
  it('shows the planned target before a run', () => {
    expect(infoRows(base, null, '.webp').find((r) => r.k === 'format')?.v).toBe('jpg to webp')
  })
  it('gives a failed row its full, selectable error', () => {
    const r = infoRows(
      { ...base, status: 'failed', error: 'Unsupported compression in TIFF' },
      null,
      null
    )
    expect(r.find((x) => x.k === 'error')).toEqual({
      k: 'error',
      v: 'Unsupported compression in TIFF',
      selectable: true
    })
  })
})

describe('wipeStep', () => {
  it('moves by 5 and clamps', () => {
    expect(wipeStep('ArrowRight', 50)).toBe(55)
    expect(wipeStep('ArrowLeft', 2)).toBe(0)
    expect(wipeStep('ArrowRight', 98)).toBe(100)
    expect(wipeStep('Home', 40)).toBe(0)
    expect(wipeStep('End', 40)).toBe(100)
    expect(wipeStep('a', 40)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/info-model.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/components/inspector/infoModel.ts
import { formatBytes } from '@shared/compress'
import type { QueueItem } from '../../state'
import { formatPct, pctChange } from '../queue/rowModel'

export interface InfoRow {
  k: string
  v: string
  reveal?: string
  selectable?: boolean
}

type Dims = { width: number; height: number } | null

const extOf = (p: string): string => {
  const b = p.split(/[\\/]/).pop() ?? p
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toLowerCase() : ''
}
const pixels = (d: Dims): string => (d ? `${d.width} × ${d.height}` : 'unknown')

export function previewRows(item: QueueItem, dims: Dims): InfoRow[] {
  const src = item.file.size
  const out = item.status === 'done' ? item.outputSize : undefined
  const rows: InfoRow[] = [
    { k: 'size', v: out != null ? `${formatBytes(src)} to ${formatBytes(out)}` : formatBytes(src) }
  ]
  if (out != null) {
    const pct = pctChange(src, out)
    rows.push({
      k: 'saved',
      v: `${formatBytes(Math.max(0, src - out))}${pct != null ? `, ${formatPct(pct)}` : ''}`
    })
  }
  rows.push({ k: 'pixels', v: pixels(dims) })
  return rows
}

export function infoRows(item: QueueItem, dims: Dims, target: string | null): InfoRow[] {
  const src = item.file.ext.replace(/^\./, '').toLowerCase()
  const to =
    item.status === 'done' && item.outputPath
      ? extOf(item.outputPath)
      : target
        ? target.replace(/^\./, '').toLowerCase()
        : ''
  const rows: InfoRow[] = [
    { k: 'format', v: to && to !== src ? `${src} to ${to}` : src },
    { k: 'pixels', v: pixels(dims) },
    {
      k: 'size',
      v:
        item.status === 'done' && item.outputSize != null
          ? `${formatBytes(item.file.size)} to ${formatBytes(item.outputSize)}`
          : formatBytes(item.file.size)
    }
  ]
  if (item.status === 'done' && item.outputPath)
    rows.push({ k: 'output', v: item.outputPath, reveal: item.outputPath })
  if (item.status === 'failed' && item.error)
    rows.push({ k: 'error', v: item.error, selectable: true })
  return rows
}

export function wipeStep(key: string, pct: number): number | null {
  const clamp = (n: number): number => Math.max(0, Math.min(100, n))
  if (key === 'ArrowLeft') return clamp(pct - 5)
  if (key === 'ArrowRight') return clamp(pct + 5)
  if (key === 'Home') return 0
  if (key === 'End') return 100
  return null
}
```

(`formatBytes(2_202_010)` is `2.1 MB`, `formatBytes(497_664)` is `486 KB`, the difference `1_704_346` is `1.6 MB`, and `pctChange` gives `-77`.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/info-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the panes**

```tsx
// src/renderer/src/components/inspector/Wipe.tsx
import { useRef, useState, type JSX } from 'react'
import { wipeStep } from './infoModel'

/** Source left, result right, a 1px fg1 divider you can drag (spec 4.6, O9). */
export function Wipe({
  left,
  right,
  leftTag,
  rightTag
}: {
  left: string | null
  right: string | null
  leftTag: string
  rightTag?: string
}): JSX.Element {
  const [pos, setPos] = useState(50)
  const frame = useRef<HTMLDivElement>(null)
  function fromPointer(clientX: number): void {
    const r = frame.current?.getBoundingClientRect()
    if (r) setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }
  const split = right != null
  return (
    <div
      ref={frame}
      className="wipe"
      onPointerDown={(e) => {
        if (!split) return
        e.currentTarget.setPointerCapture(e.pointerId)
        fromPointer(e.clientX)
      }}
      onPointerMove={(e) => {
        if (split && e.buttons === 1) fromPointer(e.clientX)
      }}
    >
      {left ? (
        <img className="wimg" src={left} alt="" />
      ) : (
        <span className="wext mono">{leftTag.split(' ')[0]}</span>
      )}
      {split && right && (
        <img className="wimg" src={right} alt="" style={{ clipPath: `inset(0 0 0 ${pos}%)` }} />
      )}
      {split && (
        <div
          className="line"
          role="slider"
          tabIndex={0}
          aria-label="Compare source and result"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          style={{ left: `${pos}%` }}
          onKeyDown={(e) => {
            const n = wipeStep(e.key, pos)
            if (n == null) return
            e.preventDefault()
            setPos(n)
          }}
        />
      )}
      <span className="tag l">{leftTag}</span>
      {rightTag && <span className="tag r">{rightTag}</span>}
    </div>
  )
}
```

```tsx
// src/renderer/src/components/inspector/PreviewPane.tsx
import { useEffect, useState, type JSX } from 'react'
import type { FileKind } from '@shared/types'
import { formatBytes } from '@shared/compress'
import type { QueueItem } from '../../state'
import { previewRows } from './infoModel'
import { Wipe } from './Wipe'

const ext = (p: string): string => (p.split('.').pop() ?? '').toLowerCase()

/** Keyed by item id in the parent, so its fetched images never leak between rows. */
export function PreviewPane({
  item,
  outKind,
  dims
}: {
  item: QueueItem
  outKind: FileKind | null
  dims: { width: number; height: number } | null
}): JSX.Element {
  const [srcImg, setSrcImg] = useState<string | null>(item.thumb)
  const [outImg, setOutImg] = useState<string | null>(null)
  const out = item.status === 'done' && item.outputSize != null ? item.outputPath : undefined
  useEffect(() => {
    let alive = true
    void window.filesmith
      .thumbnail(item.file.path, 640, item.file.kind)
      .then((t) => alive && t && setSrcImg(t))
    if (out && outKind)
      void window.filesmith.thumbnail(out, 640, outKind).then((t) => alive && setOutImg(t))
    return () => {
      alive = false
    }
  }, [item.file.path, item.file.kind, out, outKind])
  return (
    <>
      <Wipe
        left={srcImg}
        right={out ? outImg : null}
        leftTag={`${ext(item.file.name)} ${formatBytes(item.file.size)}`}
        rightTag={
          out && item.outputSize != null ? `${ext(out)} ${formatBytes(item.outputSize)}` : undefined
        }
      />
      <dl className="dgrid">
        {previewRows(item, dims).map((r) => (
          <div key={r.k}>
            <dt>{r.k}</dt>
            <dd>{r.v}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
```

```tsx
// src/renderer/src/components/inspector/InfoPane.tsx
import type { JSX } from 'react'
import type { QueueItem } from '../../state'
import { SmallButton } from '../ui/Button'
import { infoRows } from './infoModel'

export function InfoPane({
  item,
  dims,
  target
}: {
  item: QueueItem
  dims: { width: number; height: number } | null
  target: string | null
}): JSX.Element {
  return (
    <dl className="dgrid">
      {infoRows(item, dims, target).map((r) => (
        <div key={r.k}>
          <dt>{r.k}</dt>
          <dd className={r.selectable || r.reveal ? 'select-text' : undefined}>
            <span>{r.v}</span>
            {r.reveal && (
              <SmallButton
                icon="folder"
                onClick={() => window.filesmith.reveal(r.reveal as string)}
              >
                Show
              </SmallButton>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
```

Add to `theme/views.css`:

```css
.wipe {
  cursor: default;
  touch-action: none;
}
.wimg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.wext {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 13px;
  color: var(--fg3);
  text-transform: uppercase;
}
.wipe .line {
  cursor: ew-resize;
  z-index: 1;
}
.wipe .line::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -6px;
  right: -6px;
}
.wipe .line:focus-visible {
  outline: 1px solid var(--focus);
  outline-offset: 2px;
}
.wipe .tag {
  z-index: 2;
}
```

- [ ] **Step 6: Wire into `App.tsx`**

Replace the Task 13 `EmptyState` branch in the inspector with:

```tsx
              ) : focused ? (
                inspTab === 'preview' ? (
                  <PreviewPane
                    key={focused.id}
                    item={focused}
                    outKind={focused.outputPath ? fileKind(extOfPath(focused.outputPath)) : null}
                    dims={vDims[focused.file.path] ?? null}
                  />
                ) : (
                  <InfoPane
                    item={focused}
                    dims={vDims[focused.file.path] ?? null}
                    target={typeof curOptions.format === 'string' ? curOptions.format : null}
                  />
                )
              ) : (
                <EmptyState icon={inspTab === 'preview' ? 'eye' : 'info'} title="Nothing selected" line="Select a file in the table to see it here" />
              )}
```

Probe the focused file: in the dimension-probe effect (`App.tsx:758-787`), add `focused.file.path` to the paths it requests whenever `inspTab !== 'options'` and `focused.file.kind` is `image` or `video` (image via `imageDimensions`, video via `videoDimensions`, the same calls and the same `vDimsRequested` guard the effect already uses).

- [ ] **Step 7: Verify**

Run: `npx vitest run test/info-model.test.ts && npm test && npm run typecheck && npm run lint`
Expected: all green.

Run: `npm run dev`: select a converted image, open Preview: source and result side by side with tags `jpg 2.1 MB` / `webp 486 KB`, drag the divider and move it with the arrow keys; the grid shows size / saved / pixels. Open Info: `format jpg to webp`, pixels, size, output with a Show button that reveals it; a failed row shows its full error, selectable. A video row shows its frame thumbnail with one tag and no wipe.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/inspector src/renderer/src/theme/views.css src/renderer/src/App.tsx test/info-model.test.ts
git commit -m "feat(inspector): preview wipe and info grid for the focused file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Generate, Tools, Completed and Settings views; menu, dialog and error screen

**Files:**

- Create in `src/renderer/src/components/views/`: `GenerateView.tsx`, `ToolsView.tsx`, `CompletedView.tsx`, `SettingsView.tsx`, `ToolStatus.tsx`
- Modify: `src/renderer/src/components/inspector/infoModel.ts` (add `genInfoRows`)
- Modify: `src/renderer/src/state.ts` (add `dismissAny`)
- Modify: `src/renderer/src/components/ContextMenu.tsx`, `ConfirmDialog.tsx`, `ErrorBoundary.tsx` (restyle; `Boundary` export deleted)
- Modify: `src/renderer/src/App.tsx` (centre per view, Completed actions across queues, Generate preview/info, menu icon names, one user-facing em-dash)
- Modify: `src/renderer/src/theme/views.css`
- Delete: `src/renderer/src/components/ToolsGrid.tsx`, `PromptBox.tsx`, `CompletedView.tsx` (the old one at `components/`)
- Test: `test/queues.test.ts` (extend), `test/info-model.test.ts` (extend)

**Interfaces:**

- Consumes: `EmptyState` (Task 12), `SettingGroup`, `Setting`, `SmallButton`, `Checkbox`, `ProgressBar`, `Icon`; `moveItem` (Task 11) and `useRailPrefs` (Task 11); `CompletedItem`, `collectCompleted` from `components/completed.ts`; `rowView`, `kindLabel` (Task 5).
- Produces:
  - Action `{ type: 'dismissAny'; ids: string[]; column: 'input' | 'output' }`: hides that view of each id in whichever queue holds it (the Completed view's actions work from any tab).
  - `genInfoRows(path: string, meta: { model: string; width: number; height: number; seed: number } | null): InfoRow[]`
  - `GenerateView({ prompt, onPrompt, running, slots, results, aspect, canRun, focused, onRun, onCancel, onFocus, onOpen, onMenu })`
  - `ToolsView({ onPick })`: `<section aria-label="Tools">` with an `<h1>Tools</h1>` header row
  - `CompletedView({ entries, thumbs, onOpen, onReveal, onMenu, onDelete, onClear })` with `role="grid"` `aria-label="Completed"` and an `<h1>Completed</h1>`
  - `SettingsView({ rail })` with an `<h1>Settings</h1>`; `rail` is the `useRailPrefs()` result

Fix carried here: on the Completed tab `cur` is the empty `completed` queue, so the old output menu's Delete found no item and silently did nothing. Output actions now look items up across all queues and dismiss with `dismissAny`.

- [ ] **Step 1: Write the failing tests**

Append to `test/queues.test.ts`:

```ts
describe('dismissAny', () => {
  it('hides a result in its own queue while another tab is open', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')], key: CONVERT })
    const id = s.queues[CONVERT]!.items[0].id
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'done', outputPath: 'C:/x/a.webp' } })
    const result = s.queues[CONVERT]!.items.find((i) => i.isResult)!
    s = reducer(s, { type: 'setTab', tab: 'completed' })
    s = reducer(s, { type: 'dismissAny', ids: [result.id], column: 'output' })
    expect(s.queues[CONVERT]!.items.some((i) => i.id === result.id)).toBe(false)
    expect(s.queues[CONVERT]!.items.some((i) => i.id === id)).toBe(true) // the source stays
  })
})
```

Append to `test/info-model.test.ts`:

```ts
import { genInfoRows } from '../src/renderer/src/components/inspector/infoModel'

describe('genInfoRows', () => {
  it('shows model, size, seed and a revealable path', () => {
    expect(
      genInfoRows('C:/g/a.png', { model: 'flux1-dev', width: 1024, height: 768, seed: -1 })
    ).toEqual([
      { k: 'model', v: 'flux1-dev' },
      { k: 'size', v: '1024 × 768' },
      { k: 'seed', v: 'random' },
      { k: 'path', v: 'C:/g/a.png', reveal: 'C:/g/a.png' }
    ])
  })
  it('still shows the path for an image from an earlier session', () => {
    expect(genInfoRows('C:/g/b.png', null)).toEqual([
      { k: 'path', v: 'C:/g/b.png', reveal: 'C:/g/b.png' }
    ])
  })
})
```

(Merge the import into the file's existing `infoModel` import.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/queues.test.ts test/info-model.test.ts`
Expected: FAIL (unknown action; `genInfoRows` missing).

- [ ] **Step 3: Implement**

In `state.ts`, add to the `Action` union `| { type: 'dismissAny'; ids: string[]; column: 'input' | 'output' }` and the case:

```ts
    case 'dismissAny': {
      const ids = new Set(action.ids)
      const queues = { ...state.queues }
      for (const [k, q] of Object.entries(queues) as [QueueKey, QueueState][]) {
        if (!q.items.some((i) => ids.has(i.id))) continue
        const items = q.items.map((i) =>
          ids.has(i.id) ? (action.column === 'input' ? { ...i, hiddenInput: true } : { ...i, hiddenOutput: true }) : i
        )
        const kept = items.filter((i) => inInput(i) || inOutput(i))
        const selectable = new Set(kept.filter(inInput).map((i) => i.id))
        queues[k] = {
          items: kept,
          selected: q.selected.filter((s) => selectable.has(s)),
          anchor: q.anchor && selectable.has(q.anchor) ? q.anchor : null
        }
      }
      return { ...state, queues }
    }
```

In `infoModel.ts`:

```ts
export function genInfoRows(
  path: string,
  meta: { model: string; width: number; height: number; seed: number } | null
): InfoRow[] {
  const rows: InfoRow[] = []
  if (meta) {
    rows.push({ k: 'model', v: meta.model })
    rows.push({ k: 'size', v: `${meta.width} × ${meta.height}` })
    rows.push({ k: 'seed', v: meta.seed < 0 ? 'random' : String(meta.seed) })
  }
  rows.push({ k: 'path', v: path, reveal: path })
  return rows
}
```

Run: `npx vitest run test/queues.test.ts test/info-model.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the views**

```tsx
// src/renderer/src/components/views/ToolsView.tsx
import type { JSX } from 'react'
import { TOOL_CARDS, toolGroups } from '@shared/tabs'
import { Icon } from '../icons/Icon'
import { SettingGroup } from '../ui/Setting'

/** A dense list rather than cards (spec 5.2): no colour swatches, no inspector. */
export function ToolsView({ onPick }: { onPick: (id: string) => void }): JSX.Element {
  return (
    <>
      <div className="vhead">
        <h1>Tools</h1>
        <span>
          {TOOL_CARDS.length} tool{TOOL_CARDS.length === 1 ? '' : 's'}
        </span>
      </div>
      <section className="vbody scroll-thin" aria-label="Tools">
        {toolGroups().map((g) => (
          <SettingGroup key={g.name} title={g.name.toUpperCase()}>
            <ul className="tlist">
              {g.cards.map((c) => (
                <li key={c.id}>
                  <button type="button" className="trow" onClick={() => onPick(c.id)}>
                    <Icon name={c.icon} />
                    <span className="tlab">{c.label}</span>
                    <span className="tdesc">{c.desc}</span>
                  </button>
                </li>
              ))}
            </ul>
          </SettingGroup>
        ))}
      </section>
    </>
  )
}
```

```tsx
// src/renderer/src/components/views/GenerateView.tsx
import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { EmptyState } from '../queue/EmptyState'
import { ProgressBar } from '../ui/ProgressBar'

const mediaUrl = (p: string): string => `fsmedia://local/${encodeURIComponent(p)}`

export function GenerateView({
  prompt,
  onPrompt,
  running,
  slots,
  results,
  aspect,
  canRun,
  focused,
  onRun,
  onCancel,
  onFocus,
  onOpen,
  onMenu
}: {
  prompt: string
  onPrompt: (v: string) => void
  running: boolean
  slots: { pct: number; path?: string }[]
  results: string[]
  aspect: string
  canRun: boolean
  focused: string | null
  onRun: () => void
  onCancel: () => void
  onFocus: (path: string) => void
  onOpen: (path: string) => void
  onMenu: (path: string, x: number, y: number) => void
}): JSX.Element {
  const tile = (path: string, key: string): JSX.Element => (
    <button
      key={key}
      type="button"
      className={`gtile${focused === path ? ' sel' : ''}`}
      style={{ aspectRatio: aspect }}
      title={path}
      onClick={() => onFocus(path)}
      onDoubleClick={() => onOpen(path)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(path, e.clientX, e.clientY)
      }}
    >
      <img src={mediaUrl(path)} alt="" />
    </button>
  )
  return (
    <>
      <div className="toolbar" role="toolbar" aria-label="Generate actions">
        <button
          type="button"
          className="tbtn add"
          disabled={!canRun}
          onClick={onRun}
          title="Generate (Ctrl+Enter)"
        >
          <Icon name="play" />
          Generate
        </button>
        {running && (
          <button type="button" className="tbtn" onClick={onCancel}>
            <Icon name="close" />
            Cancel
          </button>
        )}
      </div>
      <div className="vbody scroll-thin">
        <textarea
          className="prompt"
          aria-label="Prompt"
          placeholder="Describe the image you want"
          rows={6}
          spellCheck={false}
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
        />
        {running || results.length > 0 ? (
          <div className="gen-grid">
            {running &&
              slots.map((s, i) =>
                s.path ? (
                  tile(s.path, `slot-${i}`)
                ) : (
                  <div key={`slot-${i}`} className="gtile pending" style={{ aspectRatio: aspect }}>
                    <span className="mono">{s.pct > 0 ? `${s.pct}%` : '…'}</span>
                    <ProgressBar wide value={s.pct > 0 ? s.pct : null} label="Generating" />
                  </div>
                )
              )}
            {results.map((p) => tile(p, p))}
          </div>
        ) : (
          <EmptyState
            icon="generate"
            title="Nothing generated yet"
            line="Write a prompt, then press Generate"
          />
        )}
      </div>
    </>
  )
}
```

```tsx
// src/renderer/src/components/views/CompletedView.tsx
import { useState, type JSX, type MouseEvent } from 'react'
import { formatBytes } from '@shared/compress'
import type { QueueItem } from '../../state'
import type { CompletedItem } from '../completed'
import { Icon } from '../icons/Icon'
import { EmptyState } from '../queue/EmptyState'
import { ResultCell } from '../queue/ResultCell'
import { kindLabel, rowView } from '../queue/rowModel'
import { RowAction } from '../ui/Button'

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const extOf = (p: string): string => {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i) : ''
}

/** The files table in read-only mode (spec 5.3): name | from | kind | size | result | action. */
export function CompletedView({
  entries,
  thumbs,
  onOpen,
  onReveal,
  onMenu,
  onDelete,
  onClear
}: {
  entries: CompletedItem[]
  thumbs: Record<string, string | null>
  onOpen: (item: QueueItem) => void
  onReveal: (path: string) => void
  onMenu: (item: QueueItem, x: number, y: number, ids: string[]) => void
  onDelete: (ids: string[]) => void
  onClear: (ids: string[]) => void
}): JSX.Element {
  const [picked, setPicked] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const ids = entries.map((e) => e.item.id)
  const selected = picked.filter((id) => ids.includes(id))

  function click(id: string, e: MouseEvent): void {
    if (e.shiftKey && anchor && ids.includes(anchor)) {
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y)
      setPicked(ids.slice(a, b + 1))
      return
    }
    if (e.ctrlKey || e.metaKey)
      setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    else setPicked([id])
    setAnchor(id)
  }

  return (
    <>
      <div className="vhead">
        <h1>Completed</h1>
        <span>
          {entries.length} file{entries.length === 1 ? '' : 's'}
        </span>
        <div className="tb-right">
          <button
            type="button"
            className="tbtn"
            disabled={!selected.length}
            onClick={() => onDelete(selected)}
          >
            <Icon name="trash" />
            Delete selected
          </button>
          <button
            type="button"
            className="tbtn"
            disabled={!entries.length}
            onClick={() => onClear(ids)}
            title="Hides the list; files stay on disk"
          >
            <Icon name="close" />
            Clear list
          </button>
        </div>
      </div>
      <section
        className="qtable done-table"
        role="grid"
        aria-label="Completed"
        aria-multiselectable="true"
      >
        <div className="thead ccols" role="row">
          {['name', 'from', 'kind', 'size', 'result', ''].map((h, i) => (
            <div key={i} className={`th${h === 'size' ? ' num' : ''}`} role="columnheader">
              {h}
            </div>
          ))}
        </div>
        <div className="qbody scroll-thin" role="rowgroup">
          {entries.length === 0 ? (
            <EmptyState
              icon="completed"
              title="Nothing finished yet"
              line="Files you convert, compress or resize land here"
            />
          ) : (
            entries.map(({ item, from }) => {
              const out = item.outputPath as string
              const thumb = thumbs[out] ?? null
              const sel = selected.includes(item.id)
              return (
                <div
                  key={item.id}
                  role="row"
                  aria-selected={sel}
                  tabIndex={-1}
                  className={`tr ccols${sel ? ' sel' : ''}`}
                  onClick={(e) => click(item.id, e)}
                  onDoubleClick={() => onOpen(item)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onMenu(item, e.clientX, e.clientY, sel ? selected : [item.id])
                  }}
                >
                  <div className="td" role="gridcell">
                    {thumb ? (
                      <img className="thumb" src={thumb} alt="" />
                    ) : (
                      <span className="thumb">{kindLabel(extOf(out)).slice(0, 3)}</span>
                    )}
                    <span className="name" title={out}>
                      {baseName(out)}
                    </span>
                  </div>
                  <div className="td" role="gridcell">
                    <span className="meta">{from.toLowerCase()}</span>
                  </div>
                  <div className="td" role="gridcell">
                    <span className="meta">{kindLabel(extOf(out))}</span>
                  </div>
                  <div className="td num" role="gridcell">
                    <span className="size">{formatBytes(item.file.size)}</span>
                  </div>
                  <ResultCell result={rowView(item).result} />
                  <div className="td" role="gridcell">
                    <RowAction
                      icon="folder"
                      label="Show in folder"
                      ghost
                      onClick={(e) => {
                        e.stopPropagation()
                        onReveal(out)
                      }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </>
  )
}
```

```tsx
// src/renderer/src/components/views/ToolStatus.tsx
import { useEffect, useState, type JSX } from 'react'
import { SmallButton } from '../ui/Button'
import { Setting } from '../ui/Setting'

/** Read-only status of the bundled and on-demand tools (spec 5.4), from the
 * status calls the app already makes, plus the existing folder actions. */
export function ToolStatus(): JSX.Element {
  const [rar, setRar] = useState<boolean | null>(null)
  const [bg, setBg] = useState<{ ready: boolean; uvAvailable: boolean } | null>(null)
  const [comfy, setComfy] = useState<string | null | undefined>(undefined)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void window.filesmith.archiveStatus().then((s) => alive && setRar(s.rar))
    void window.filesmith.removebgStatus().then((s) => alive && setBg(s))
    void window.filesmith.comfyStatus().then((s) => alive && setComfy(s.folder ?? null))
    return () => {
      alive = false
    }
  }, [])
  async function changeComfy(): Promise<void> {
    const folder = await window.filesmith.comfyPickFolder()
    if (!folder) return
    const r = await window.filesmith.comfySetFolder(folder)
    if (r.ok) setComfy(folder)
    setNote(r.ok ? null : (r.error ?? 'That folder could not be used.'))
  }
  return (
    <>
      <Setting
        title="WinRAR"
        desc={
          rar == null
            ? 'Checking'
            : rar
              ? 'Found. RAR and CBR targets are available.'
              : 'Not found. RAR and CBR targets stay disabled.'
        }
      />
      <Setting
        title="Background removal"
        desc={
          bg == null
            ? 'Checking'
            : bg.ready
              ? 'Ready, works offline.'
              : bg.uvAvailable
                ? 'Downloads its model on first use.'
                : 'Needs the free uv tool (winget install astral-sh.uv).'
        }
      />
      <Setting
        title="ComfyUI folder"
        desc={note ?? (comfy === undefined ? 'Checking' : comfy ? <code>{comfy}</code> : 'Not set')}
      >
        <SmallButton icon="folder" onClick={() => void changeComfy()}>
          Change folder
        </SmallButton>
      </Setting>
      <Setting title="Upscale models" desc="Drop your own Real-ESRGAN models into this folder.">
        <SmallButton icon="folder" onClick={() => void window.filesmith.upscaleOpenModelsFolder()}>
          Open folder
        </SmallButton>
      </Setting>
      <Setting title="Model registry" desc="Your added generation models live here.">
        <SmallButton icon="folder" onClick={() => void window.filesmith.registryOpenFolder()}>
          Open folder
        </SmallButton>
      </Setting>
    </>
  )
}
```

Before writing `ToolStatus`, check the exact return shapes of `archiveStatus`, `removebgStatus` and `comfyStatus` in `src/preload/index.ts` and adapt the three `.then` lines to them (for example `comfyStatus()` may expose the folder under a different key; `useComfyModels.ts` shows how the app reads it).

```tsx
// src/renderer/src/components/views/SettingsView.tsx
import { useRef, useState, type JSX, type PointerEvent } from 'react'
import { tabById, type TabId } from '@shared/tabs'
import { Icon } from '../icons/Icon'
import { moveItem } from '../shell/railPrefs'
import { Checkbox } from '../ui/Checkbox'
import { SettingGroup } from '../ui/Setting'
import { ToolStatus } from './ToolStatus'

type Rail = {
  order: TabId[]
  hidden: TabId[]
  setOrder: (o: TabId[]) => void
  toggleHidden: (id: TabId) => void
}

/** Sidebar order and visibility (moved from the old rail edit mode, spec 3.2 /
 * 5.4) and tool status. Same pointer sortable as before, plus Alt+Up/Down. */
export function SettingsView({ rail }: { rail: Rail }): JSX.Element {
  const [drag, setDrag] = useState<{ index: number; offset: number } | null>(null)
  const dragRef = useRef<{ index: number; offset: number } | null>(null)
  const PITCH = 36

  function begin(index: number, e: PointerEvent): void {
    e.preventDefault()
    const startY = e.clientY
    const set = (d: { index: number; offset: number } | null): void => {
      dragRef.current = d
      setDrag(d)
    }
    set({ index, offset: 0 })
    const move = (ev: globalThis.PointerEvent): void => set({ index, offset: ev.clientY - startY })
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      set(null)
      if (!d) return
      const target = Math.max(
        0,
        Math.min(rail.order.length - 1, d.index + Math.round(d.offset / PITCH))
      )
      if (target !== d.index) rail.setOrder(moveItem(rail.order, d.index, target))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const target = drag
    ? Math.max(0, Math.min(rail.order.length - 1, drag.index + Math.round(drag.offset / PITCH)))
    : null
  function shift(i: number): number {
    if (!drag || target == null) return 0
    if (i === drag.index) return drag.offset
    if (drag.index < target && i > drag.index && i <= target) return -PITCH
    if (drag.index > target && i < drag.index && i >= target) return PITCH
    return 0
  }

  return (
    <>
      <div className="vhead">
        <h1>Settings</h1>
        <span>sidebar and tools</span>
      </div>
      <section className="vbody scroll-thin vs" aria-label="Settings">
        <SettingGroup title="SIDEBAR">
          <ul className="sortlist" aria-label="Sidebar order">
            {rail.order.map((id, i) => {
              const t = tabById(id)
              const shown = !rail.hidden.includes(id)
              return (
                <li
                  key={id}
                  className={`sortrow${drag?.index === i ? ' lifted' : ''}`}
                  style={{
                    transform: `translateY(${shift(i)}px)`,
                    transition: drag && drag.index !== i ? 'transform .15s' : undefined
                  }}
                  tabIndex={0}
                  aria-label={`${t.label}, position ${i + 1}. Alt+Up or Alt+Down to move`}
                  onKeyDown={(e) => {
                    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                    e.preventDefault()
                    const to = e.key === 'ArrowUp' ? i - 1 : i + 1
                    if (to >= 0 && to < rail.order.length)
                      rail.setOrder(moveItem(rail.order, i, to))
                  }}
                >
                  <span className="grip" onPointerDown={(e) => begin(i, e)} aria-hidden="true">
                    <Icon name="grip" />
                  </span>
                  <Icon name={t.icon} />
                  <span className="slab">{t.label}</span>
                  <Checkbox
                    checked={shown}
                    onChange={() => rail.toggleHidden(id)}
                    label={`Show ${t.label} in the sidebar`}
                    size="md"
                    focusable
                  />
                </li>
              )
            })}
          </ul>
        </SettingGroup>
        <SettingGroup title="TOOLS">
          <ToolStatus />
        </SettingGroup>
      </section>
    </>
  )
}
```

- [ ] **Step 5: Restyle the menu, the dialog and the error screen**

`ContextMenu.tsx`: change the import to `import { Icon } from './icons/Icon'` and `import type { IconName } from '@shared/icons'`; keep every effect (measure and flip, the five close listeners). Replace the container classes with `className="ctx-pop menu"` and render items as:

```tsx
{
  menu.items.map((item, i) =>
    item.sep ? (
      <div key={i} className="menu-sep" role="separator" />
    ) : (
      <button
        key={i}
        role="menuitem"
        className={`menu-item${item.danger ? ' danger' : ''}`}
        onClick={() => {
          item.onClick()
          onClose()
        }}
      >
        <Icon name={item.icon} />
        {item.label}
      </button>
    )
  )
}
```

`ConfirmDialog.tsx`: keep the native `<dialog>` logic, `autoFocus` rules and `onCancel`/backdrop click. Replace the markup classes:

```tsx
    <dialog ref={ref} onCancel={...unchanged} onClick={...unchanged} className="modal-pop dlg">
      <div className="dlg-body">
        <h2>
          {state.danger && <Icon name="warning" />}
          {state.title}
        </h2>
        <p className="select-text">{state.body}</p>
      </div>
      <div className="dlg-foot">
        {!state.hideCancel && (
          <SmallButton autoFocus={state.danger} onClick={onClose}>
            Cancel
          </SmallButton>
        )}
        <button
          type="button"
          className="dlg-ok"
          autoFocus={!state.danger}
          onClick={() => {
            state.onConfirm()
            onClose()
          }}
        >
          {state.confirmLabel}
        </button>
      </div>
    </dialog>
```

`ErrorBoundary.tsx`: delete the unused `Boundary` export; render the fallback as

```tsx
<div className="crash" role="alert">
  <Icon name="warning" />
  <h1>Something went wrong</h1>
  <p className="mono select-text">{this.state.error.message}</p>
  <div className="crash-actions">
    <SmallButton icon="retry" onClick={() => window.location.reload()}>
      Reload
    </SmallButton>
    <SmallButton
      icon="trash"
      onClick={this.reset}
      title="Clears the saved queues and options, then reloads"
    >
      Reset session
    </SmallButton>
  </div>
</div>
```

keeping its existing reset handler (the `sessionSave(null)` then reload logic at `:26-32`) under whatever name it has today.

Append to `theme/views.css`:

```css
/* view header row (Tools, Completed, Settings): 32px, title like .ihead */
.vhead {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-left: 16px;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.vhead h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.vhead > span {
  font: 12px var(--mono);
  color: var(--fg3);
}
.vhead .tb-right {
  align-self: stretch;
}
.vhead .tbtn {
  border-right: 0;
  border-left: 1px solid var(--line);
  color: var(--fg2);
}
.vhead .tbtn:hover:not(:disabled),
.toolbar .tbtn:not(.add):hover {
  background: var(--hover);
  color: var(--fg1);
}
.tbtn:disabled {
  color: var(--fg-disabled);
}
.tbtn.add:disabled {
  background: var(--selected);
}
.vbody {
  min-height: 0;
  overflow-y: auto;
}

/* tools list */
.tlist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.trow {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  text-align: left;
  color: var(--fg2);
}
.trow:hover {
  background: var(--hover);
  color: var(--fg1);
}
.trow .tlab {
  font-weight: 500;
  color: var(--fg1);
  min-width: 120px;
}
.trow .tdesc {
  font-size: 12px;
  color: var(--fg3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* generate */
.prompt {
  display: block;
  width: 100%;
  min-height: calc(6 * 1.4em + 24px);
  resize: vertical;
  padding: 12px 16px;
  background: var(--bg-0);
  color: var(--fg1);
  caret-color: var(--fg1);
  border: 0;
  border-bottom: 1px solid var(--line);
  font: 13px/1.4 var(--sans);
}
.prompt::placeholder {
  color: var(--fg3);
}
.prompt:focus {
  outline: 1px solid var(--focus);
  outline-offset: -1px;
}
.gen-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--line);
  border-bottom: 1px solid var(--line);
}
@media (max-width: 1279px) {
  .gen-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.gtile {
  position: relative;
  display: block;
  overflow: hidden;
  background: var(--bg-0);
}
.gtile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gtile:hover {
  outline: 1px solid var(--fg3);
  outline-offset: -1px;
}
.gtile.sel {
  outline: 2px solid var(--fg1);
  outline-offset: -2px;
}
.gtile.pending {
  display: grid;
  place-items: center;
  background: var(--bg-1);
  color: var(--fg2);
}
.gtile.pending .mini {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}

/* completed table */
.done-table {
  --cols: 1fr 120px 64px 88px 184px 48px;
}
.ccols {
  display: grid;
  grid-template-columns: var(--cols);
  align-items: center;
}
.done-table .th {
  cursor: default;
}

/* settings: sortable sidebar list */
.sortlist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.sortrow {
  position: relative;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: var(--bg-0);
  color: var(--fg2);
}
.sortrow:hover {
  background: var(--hover);
  color: var(--fg1);
}
.sortrow.lifted {
  z-index: 1;
  background: var(--selected);
  outline: 1px solid var(--line-strong);
}
.sortrow .grip {
  cursor: grab;
  color: var(--fg3);
  display: grid;
}
.sortrow .slab {
  flex: 1;
}

/* context menu: flush, square, no blur, no shadow */
.menu {
  position: fixed;
  z-index: 50;
  min-width: 196px;
  padding: 4px 0;
  background: var(--bg-0);
  border: 1px solid var(--line-strong);
}
.menu-item {
  width: 100%;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  font-size: 12px;
  color: var(--fg2);
  text-align: left;
}
.menu-item:hover,
.menu-item:focus-visible {
  background: var(--hover);
  color: var(--fg1);
}
.menu-item.danger {
  font-weight: 600;
  color: var(--fg1);
}
.menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--line);
}

/* confirm dialog */
.dlg {
  margin: auto;
  padding: 0;
  max-width: 420px;
  background: var(--bg-0);
  color: var(--fg1);
  border: 1px solid var(--line-strong);
}
.dlg::backdrop {
  background: var(--backdrop);
}
.dlg-body {
  padding: 18px 20px 16px;
}
.dlg-body h2 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.dlg-body p {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--fg2);
}
.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 16px;
}
.dlg-foot .sbtn {
  height: 28px;
}
.dlg-ok {
  height: 28px;
  padding: 0 14px;
  background: var(--inv-bg);
  color: var(--inv-fg);
  font-weight: 600;
  font-size: 12px;
}
.dlg-ok:hover {
  background: var(--inv-hover);
}
.dlg-ok:active {
  background: var(--inv-active);
}

/* render crash */
.crash {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
  background: var(--bg-0);
  color: var(--fg1);
}
.crash h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.crash p {
  max-width: 520px;
  margin: 0;
  font-size: 12px;
  color: var(--fg3);
  overflow-wrap: anywhere;
}
.crash-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
```

- [ ] **Step 6: Wire the views into `App.tsx`**

1. Delete the inline `GenTile` (`:59-90`) and the imports of `ToolsGrid`, `PromptBox` and the old `CompletedView`; import the four views and `genInfoRows`.
2. Menu icons: `'expand'` becomes `'eye'` (Open) and `'upload'` becomes `'arrow'` (Open in default app). Replace the em-dash in the "Could not delete" body with a comma: `` `${failed.join(', ')} could not be moved to the Recycle Bin, the file may be open in another app.` ``
3. Output actions across queues:

```ts
const allItems = Object.values(state.queues).flatMap((q) => q?.items ?? [])
```

In `trashOutputs`, look items up in `allItems` instead of `cur.items`, and dispatch `{ type: 'dismissAny', ids: [id], column: 'output' }` instead of `dismiss`. In `openMenu`, add an optional fifth parameter `targetIds?: string[]`; on the output side use `targetIds ?? [item.id]` for `targets` (the Completed view passes its own selection).

4. Generate metadata for Info: `const genMeta = useRef<Record<string, { model: string; width: number; height: number; seed: number }>>({})`, and in `generate()`'s `onGenerateImage` handler, when `p.id === id`, record `genMeta.current[p.path] = { model: String(opts.model ?? ''), width: Number(opts.width ?? 1024), height: Number(opts.height ?? 1024), seed: Number(opts.seed ?? -1) }`. Add `const [genFocus, setGenFocus] = useState<string | null>(null)`.
5. Centre content by context:

```tsx
            {onCompleted ? (
              <CompletedView
                entries={completed}
                thumbs={outThumbs}
                onOpen={(item) => openExternally('output', item)}
                onReveal={(p) => window.filesmith.reveal(p)}
                onMenu={(item, x, y, ids) => openMenu('output', item, x, y, ids)}
                onDelete={(ids) =>
                  setConfirm({
                    title: ids.length === 1 ? 'Delete this file?' : `Delete ${ids.length} files?`,
                    body: 'They will be moved to the Recycle Bin.',
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => void trashOutputs(ids)
                  })
                }
                onClear={(ids) => dispatch({ type: 'dismissAny', ids, column: 'output' })}
              />
            ) : state.tab === 'settings' ? (
              <SettingsView rail={rail} />
            ) : onToolsGrid ? (
              <ToolsView onPick={(id) => dispatch({ type: 'setActiveTool', tool: id })} />
            ) : tool === 'generate' ? (
              <GenerateView
                prompt={String(curOptions.prompt ?? '')}
                onPrompt={(v) => onSet('prompt', v)}
                running={genRun.running}
                slots={genRun.slots}
                results={genResults}
                aspect={genAspect}
                canRun={runCount > 0}
                focused={genFocus}
                onRun={() => void run()}
                onCancel={() => {
                  if (genActiveId.current) window.filesmith.generateCancel(genActiveId.current)
                }}
                onFocus={setGenFocus}
                onOpen={(p) => window.filesmith.openFile(p)}
                onMenu={openGenMenu}
              />
            ) : (
              /* the Task 12 toolbar + table */
            )}
```

6. Generate in the inspector: when `tool === 'generate'` and `inspTab !== 'options'`, render for `genFocus` instead of `focused`: Preview is `<div className="wipe"><img className="wimg" src={`fsmedia://local/${encodeURIComponent(genFocus)}`} alt="" /><span className="tag l">png</span></div>`; Info is a `dl.dgrid` over `genInfoRows(genFocus, genMeta.current[genFocus] ?? null)` rendered exactly like `InfoPane`'s rows. With no `genFocus`, show the same `EmptyState` as before. The inspector title for Generate on Preview/Info is the file's base name.
7. `previewGen` (used by the old tile) is replaced by `setGenFocus` plus `setInspTab('preview')`; keep the menu's "Open in default app" item calling `window.filesmith.openFile`.

- [ ] **Step 7: Delete the replaced components**

```bash
git rm src/renderer/src/components/ToolsGrid.tsx src/renderer/src/components/PromptBox.tsx src/renderer/src/components/CompletedView.tsx
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

Run: `npm run dev` and check: Generate (prompt with a bottom hairline, toolbar Generate and Cancel, square tiles separated by 1px lines, pending tiles with a mono % and a bottom bar, startup message in the status bar with the indeterminate bar, Preview and Info of a clicked image); Tools (header `Tools`, `PDF` group, 40px rows, a click opens the workspace titled with the card label, breadcrumb `tools / merge` goes back); Completed (empty state, then rows with from / kind / size / result and the split arrow, Show in folder, Delete selected asks first and really moves the file to the Recycle Bin, Clear list hides rows but keeps files); Settings (drag a verb by its grip, Alt+Up/Down moves it, unticking hides it from the sidebar, the order survives a restart, tool status reads correctly, Change folder works); right-click menu (square, no blur, danger items bold not red); the large-upscale confirm (warning glyph, Cancel focused); and the crash screen (temporarily `throw` in a component under `npm run dev`, check it, then remove the throw).

- [ ] **Step 9: Commit**

```bash
git add -A src/renderer/src src/renderer/src/theme/views.css test/queues.test.ts test/info-model.test.ts
git commit -m "feat(views): generate, tools, completed and settings in the workbench language; fix completed delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Monochrome sweep, colour fields removed, dead code, guard test

**Files:**

- Modify: `src/shared/tabs.ts` (drop `color` from `Tab`, `ToolCard` and every entry)
- Modify: `src/renderer/src/components/queueGroups.ts` (drop `GROUP_COLOR`)
- Modify: `test/group-naming.test.ts` (drop the `GROUP_COLOR` block)
- Delete: `src/renderer/src/components/Icon.tsx` (the old 24px registry)
- Test: `test/monochrome-source.test.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: no colour literal outside `theme/tokens.css` in `src/renderer/src`, enforced by a test.

- [ ] **Step 1: Write the failing guard**

```ts
// test/monochrome-source.test.ts
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = join(__dirname, '../src/renderer/src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const grey = (h: string): boolean => {
  const x =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  return x.slice(0, 2) === x.slice(2, 4) && x.slice(2, 4) === x.slice(4, 6)
}

describe('strict monochrome source', () => {
  it('has no non-grey colour literal outside theme/tokens.css', () => {
    const bad: string[] = []
    for (const f of walk(ROOT)) {
      if (!/\.(tsx?|css)$/.test(f) || f.endsWith(`theme${sep}tokens.css`)) continue
      const src = readFileSync(f, 'utf-8')
      for (const m of src.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g))
        if (!grey(m[1].toLowerCase())) bad.push(`${relative(ROOT, f)}: #${m[1]}`)
      for (const m of src.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g))
        if (!(m[1] === m[2] && m[2] === m[3])) bad.push(`${relative(ROOT, f)}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })

  it('carries no light-theme utility classes', () => {
    const bad: string[] = []
    const light =
      /\b(text-ink|text-muted|text-dim|bg-canvas|bg-accent|text-accent|border-accent|bg-white|border-black\/|rounded-(lg|xl|2xl|full|\[))/
    for (const f of walk(ROOT)) {
      if (!/\.tsx?$/.test(f)) continue
      const src = readFileSync(f, 'utf-8')
      if (light.test(src)) bad.push(relative(ROOT, f))
    }
    expect(bad).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/monochrome-source.test.ts`
Expected: FAIL, listing `components/queueGroups.ts` (`GROUP_COLOR`) and the old `components/Icon.tsx` if it still holds literals, plus anything earlier tasks missed.

- [ ] **Step 3: Remove the colour data and the old registry**

```bash
sed -i -E "/^\s*color: '#[0-9a-fA-F]{6}',?$/d; /^\s*color: string$/d" src/shared/tabs.ts
grep -n "color" src/shared/tabs.ts
grep -rn "components/Icon'\|from './Icon'\|from '../Icon'" src/renderer/src
git rm src/renderer/src/components/Icon.tsx
```

Expected: the first `grep` prints nothing (re-check the `Tab` / `ToolCard` interfaces by eye for any leftover `color` doc comment), the second prints nothing before the `git rm`. Delete the `GROUP_COLOR` constant and its comment from `queueGroups.ts`, and the `describe('GROUP_COLOR', ...)` block from `test/group-naming.test.ts` (its `groupNoun` tests stay).

- [ ] **Step 4: Fix every remaining hit**

Re-run `npx vitest run test/monochrome-source.test.ts` and fix each listed file by replacing the literal or class with a token or a `views.css` rule. Then sweep user-facing copy for em-dashes:

```bash
grep -rnP "\x{2014}" src/renderer/src --include=*.tsx | grep -v "^\s*//\|{/\*"
```

Rewrite every hit that is user-visible text (JSX text, `title`, `aria-label`, dialog bodies, menu labels) with a comma or a colon.

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run lint && npx prettier --check .`
Expected: all green. If prettier fails, run `npm run format` and re-check.

- [ ] **Step 6: Commit**

```bash
git add -A src test
git commit -m "refactor(ui): enforce strict monochrome, drop verb and group colours and the old icon registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: End-to-end: selector updates, UI behaviour, screenshots

**Files:**

- Modify: `e2e/smoke.spec.ts:74-80`, `e2e/workflows.spec.ts:172-203`
- Create: `e2e/ui.spec.ts`, `e2e/visual.spec.ts`

**Interfaces:**

- Consumes: the DOM contracts from Tasks 11 to 15: `nav[aria-label="Operations"]` with one button per tab; inspector `<h1>`; `data-testid="run"`; `role="grid"` named `Files`; `section[aria-label="Tools"]`; the `Back to Tools` breadcrumb button; the sidebar toggle's `aria-expanded`; `role="tab"` inspector tabs; env `FILESMITH_USER_DATA` (Task 1).
- Produces: e2e coverage for navigation, sidebar collapse and persistence, inspector tabs, the empty queue, and screenshots in `docs/mockups/terminal-v5/shots/impl-*.png`.

- [ ] **Step 1: Update the smoke boot test**

Replace the body of `test('the app boots to the Convert workspace', ...)` with:

```ts
await expect(page.locator('h1', { hasText: 'Convert' }).first()).toBeVisible()
// The pinned Run button is reachable without scrolling and names the verb.
const run = page.getByTestId('run')
await expect(run).toBeVisible()
await expect(run).toHaveText(/Convert/)
```

(Keep any surrounding lines of that test that are not about these two locators.)

- [ ] **Step 2: Update the workflow navigation tests**

```ts
/** Tools always opens on its grid, however you last left it. */
async function openToolsGrid(p: Page): Promise<void> {
  await p
    .getByRole('navigation', { name: 'Operations' })
    .getByRole('button', { name: 'Tools' })
    .click()
  await expect(p.locator('h1', { hasText: 'Tools' }).first()).toBeVisible()
}

test('the rail lists every verb and opens its workspace', async () => {
  const nav = page.getByRole('navigation', { name: 'Operations' })
  for (const verb of ['Convert', 'Compress', 'Resize', 'Upscale', 'Remove BG', 'Generate']) {
    await nav.getByRole('button', { name: verb }).click()
    await expect(page.locator('h1', { hasText: verb }).first()).toBeVisible()
  }
  await openToolsGrid(page)
  await nav.getByRole('button', { name: 'Convert' }).click()
})

test('Tools groups its one-off verbs and opens one as a workspace', async () => {
  await openToolsGrid(page)
  const tools = page.getByRole('region', { name: 'Tools' })
  for (const t of ['Extract text', 'Pages to PNG', 'Merge', 'Split', 'Burst'])
    await expect(tools.getByText(t, { exact: true }).first()).toBeVisible()
  await expect(page.locator('text=Archive to PDF')).toHaveCount(0)
  await expect(page.locator('text=PDF to CBZ')).toHaveCount(0)
  await tools.getByRole('button', { name: /^Merge/ }).click()
  await expect(page.locator('h1', { hasText: 'Merge' }).first()).toBeVisible()
  await expect(page.getByRole('grid', { name: 'Files' })).toBeVisible()
  await page.locator('button[aria-label="Back to Tools"]').first().click()
  await expect(page.locator('h1', { hasText: 'Tools' }).first()).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Operations' })
    .getByRole('button', { name: 'Convert' })
    .click()
})
```

Keep the existing test names (other tooling may grep them) and replace only these bodies and the helper.

- [ ] **Step 3: Add `e2e/ui.spec.ts`**

```ts
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIN, ROOT } from './helpers'

// UI behaviour the unit suite cannot reach: the sidebar, the inspector tabs and
// the empty workspace. A private userData keeps the user's real session and
// sidebar preference out of it.
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  userData = mkdtempSync(join(tmpdir(), 'filesmith-ui-'))
  app = await _electron.launch({
    args: [ROOT],
    env: { ...process.env, FILESMITH_USER_DATA: userData }
  })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
})

test.afterAll(async () => {
  await app?.close()
  if (userData) rmSync(userData, { recursive: true, force: true })
})

test('the app is dark and square', async () => {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(10, 10, 10)')
  const radius = await page.getByTestId('run').evaluate((el) => getComputedStyle(el).borderRadius)
  expect(radius).toBe('0px')
})

test('the sidebar collapses with its toggle and Ctrl+B, and remembers it', async () => {
  const nav = page.getByRole('navigation', { name: 'Operations' })
  const toggle = nav.getByRole('button', { name: /sidebar/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await nav.boundingBox())?.width).toBe(48)
  await page.reload()
  await expect(
    page.getByRole('navigation', { name: 'Operations' }).getByRole('button', { name: /sidebar/ })
  ).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Control+B')
  await expect(
    page.getByRole('navigation', { name: 'Operations' }).getByRole('button', { name: /sidebar/ })
  ).toHaveAttribute('aria-expanded', 'true')
  await expect
    .poll(
      async () => (await page.getByRole('navigation', { name: 'Operations' }).boundingBox())?.width
    )
    .toBe(208)
})

test('inspector tabs switch with a click and the arrow keys', async () => {
  const tabs = page.getByRole('tablist', { name: 'Inspector' })
  const options = tabs.getByRole('tab', { name: 'Options' })
  const preview = tabs.getByRole('tab', { name: 'Preview' })
  const info = tabs.getByRole('tab', { name: 'Info' })
  await preview.click()
  await expect(preview).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(info).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(options).toHaveAttribute('aria-selected', 'true')
  // Switching tab must not shift the row: the bold width is reserved.
  const before = await options.boundingBox()
  await info.click()
  expect((await options.boundingBox())?.width).toBe(before?.width)
  await options.click()
})

test('an empty workspace offers Add files and a disabled Run', async () => {
  await expect(page.getByText('No files yet')).toBeVisible()
  await expect(
    page.getByRole('grid', { name: 'Files' }).getByRole('button', { name: 'Add files' })
  ).toBeVisible()
  await expect(page.getByTestId('run')).toBeDisabled()
  await expect(page.getByText('no files', { exact: true })).toBeVisible()
})
```

Add `export` to `ROOT` and `MAIN` in `e2e/helpers.ts` if they are not already exported (the map says they are).

- [ ] **Step 4: Add `e2e/visual.spec.ts`** (screenshots for the owner's side-by-side; no pixel assertions, spec 7.3)

```ts
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAGICK, MAIN, ROOT, magickEnv } from './helpers'

const SHOTS = join(ROOT, 'docs', 'mockups', 'terminal-v5', 'shots')
let app: ElectronApplication
let page: Page
let userData: string
let files: string

const NAMES = [
  'IMG_2041.heic',
  'beach-panorama.png',
  'scan_0007.tiff',
  'portrait.jpg',
  'diagram.png',
  'IMG_2042.heic'
]

function make(name: string, size: string): string {
  const p = join(files, name)
  // A noisy image so sizes look realistic; HEIC falls back to JPG bytes if this magick lacks the encoder.
  execFileSync(MAGICK, ['-size', size, 'plasma:', p], { env: magickEnv })
  return p
}

test.beforeAll(async () => {
  // Opt-in: the shots are tracked files, so a routine `npm run test:e2e` must not rewrite them.
  test.skip(
    !process.env['FILESMITH_SHOTS'],
    'set FILESMITH_SHOTS=1 to capture the redesign screenshots'
  )
  test.skip(!existsSync(MAIN) || !existsSync(MAGICK), 'needs `npm run build` and resources/bin')
  userData = mkdtempSync(join(tmpdir(), 'filesmith-visual-'))
  files = join(userData, 'files')
  mkdirSync(files)
  const paths = NAMES.map((n, i) =>
    make(
      n.endsWith('.heic') ? n.replace('.heic', '.jpg') : n,
      i === 2 ? '6000x4000' : i === 1 ? '3000x2000' : '1600x1200'
    )
  )
  const outs = [make('IMG_2041.webp', '800x600'), make('beach-panorama.webp', '1200x800')]
  const info = (
    p: string
  ): { path: string; name: string; ext: string; kind: string; size: number } => {
    const name = p.split(/[\\/]/).pop() as string
    return {
      path: p,
      name,
      ext: '.' + name.split('.').pop(),
      kind: 'image',
      size: statSync(p).size
    }
  }
  const item = (i: number, over: Record<string, unknown>): Record<string, unknown> => ({
    id: `seed-${i}`,
    file: info(paths[i]),
    thumb: null,
    status: 'ready',
    percent: 0,
    ...over
  })
  const session = {
    version: 2,
    lastTool: null,
    options: { 'convert:image': { format: '.webp', quality: 'balanced' } },
    genResults: [],
    queues: {
      convert: {
        items: [
          item(0, {
            status: 'done',
            percent: 100,
            outputPath: outs[0],
            outputSize: statSync(outs[0]).size,
            runOptions: { format: '.webp', quality: 'balanced' }
          }),
          item(1, {
            status: 'done',
            percent: 100,
            outputPath: outs[1],
            outputSize: statSync(outs[1]).size,
            runOptions: { format: '.webp', quality: 'balanced' }
          }),
          item(2, {}),
          item(3, {}),
          item(4, {}),
          item(5, {
            status: 'failed',
            error: 'Unsupported compression in this TIFF variant. Convert it to PNG first.'
          })
        ]
      }
    }
  }
  writeFileSync(join(userData, 'session.json'), JSON.stringify(session))
  app = await _electron.launch({
    args: [ROOT],
    env: { ...process.env, FILESMITH_USER_DATA: userData }
  })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await expect(
    page.getByRole('grid', { name: 'Files' }).getByRole('row', { name: /portrait/ })
  ).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  if (userData) rmSync(userData, { recursive: true, force: true })
})

test('capture the redesign next to the mockup', async () => {
  // Select one row, as the mockup does, then start a real job on another so a
  // running row with NN%(Ns) is on screen.
  await page.getByRole('row', { name: /beach-panorama/ }).click()
  await page.evaluate(
    ({ input }) =>
      window.filesmith.runJob({
        id: 'seed-2',
        tool: 'resize',
        input,
        options: { mode: 'percent', percent: 300 }
      }),
    { input: join(files, NAMES[2]) }
  )
  await expect(page.getByRole('row', { name: /scan_0007/ }).getByText(/%/)).toBeVisible({
    timeout: 20_000
  })
  await page.screenshot({ path: join(SHOTS, 'impl-10-s2.png') })

  await page
    .getByRole('navigation', { name: 'Operations' })
    .getByRole('button', { name: /sidebar/ })
    .click()
  await page.screenshot({ path: join(SHOTS, 'impl-collapsed.png') })
  await page.keyboard.press('Control+B')

  await page.getByRole('tab', { name: 'Preview' }).click()
  await page.screenshot({ path: join(SHOTS, 'impl-preview.png') })
  await page.getByRole('tab', { name: 'Info' }).click()
  await page.screenshot({ path: join(SHOTS, 'impl-info.png') })
  await page.getByRole('tab', { name: 'Options' }).click()

  const nav = page.getByRole('navigation', { name: 'Operations' })
  for (const [label, file] of [
    ['Compress', 'impl-empty.png'],
    ['Generate', 'impl-generate.png'],
    ['Tools', 'impl-tools.png'],
    ['Completed', 'impl-completed.png'],
    ['Settings', 'impl-settings.png']
  ]) {
    await nav.getByRole('button', { name: label }).click()
    await page.screenshot({ path: join(SHOTS, file) })
  }
})
```

The seeded `running`/`queued` states cannot be written into the session (restore settles them to `ready`, `state.ts:189-199`), so the running row comes from a real slow job; the two "queued" mockup rows show as ready (blank status). Say so in the PR.

- [ ] **Step 5: Run the whole e2e suite**

Run: `npm run build && npm run test:e2e`
Expected: every spec passes (engine specs unchanged; `smoke`, `workflows`, `ui` green; `visual` skipped).

Run: `FILESMITH_SHOTS=1 npx playwright test e2e/visual.spec.ts` (PowerShell: `$env:FILESMITH_SHOTS='1'; npx playwright test e2e/visual.spec.ts; Remove-Item Env:FILESMITH_SHOTS`)
Expected: PASS, and the nine `impl-*.png` files are written next to the mockup shot.

- [ ] **Step 6: Compare by hand**

Open `docs/mockups/terminal-v5/shots/10-s2-vscode-grouped.png` and `impl-10-s2.png` side by side. Check, and fix in the owning task's files before continuing: 32/24px bars; 208px sidebar; table column widths; the split arrow position; the selected row's 2px bar; inspector 340px with the 48px footer; group headers FORMAT / OUTPUT / FILES; the estimate card; IBM Plex in every text; no colour anywhere.

- [ ] **Step 7: Commit**

```bash
git add e2e docs/mockups/terminal-v5/shots/impl-*.png
git commit -m "test(e2e): scoped selectors, sidebar and inspector behaviour, redesign screenshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Version, docs, full gate, install, PR

**Files:**

- Modify: `package.json`, `package-lock.json` (version `0.5.0`)
- Modify: `CLAUDE.md` (including the owner's pending uncommitted edit)
- Modify: `README.md`, `docs/screenshots/*.png`

**Interfaces:**

- Consumes: everything above.
- Produces: PR `feat/<N>-terminal-redesign` into `main`, unmerged, with the gate results and screenshots.

- [ ] **Step 1: Bump the version**

```bash
npm version 0.5.0 --no-git-tag-version
```

- [ ] **Step 2: Update `CLAUDE.md`**

First run `git diff CLAUDE.md` and keep the owner's pending edit intact. Then:

- In "Design process", replace "The current renderer is a deliberately plain placeholder until that design work happens." with: "The renderer implements the signed-off terminal design (`docs/mockups/terminal-v5/10-s2-vscode-grouped.html`, rules in `docs/design/redesign-direction.md`). Dark only, strict monochrome: every colour is a token in `src/renderer/src/theme/tokens.css`, and `test/monochrome-source.test.ts` fails on any other colour literal. New screens still go through mockups first."
- In "Project layout", replace the `renderer/` line with `renderer/    React UI: shell/ (title bar, sidebar, status bar), queue/ (files table), inspector/ (Options, Preview, Info), options/ (one settings file per verb), views/ (Generate, Tools, Completed, Settings), ui/ (primitives), icons/, theme/ (tokens and CSS)`.
- In "Working with the owner", replace "README-only changes commit directly." with "Every change, README included, goes through a branch and PR (global rule)."

Keep it under 200 lines.

- [ ] **Step 3: Refresh the README screenshots**

Copy `impl-10-s2.png` to `docs/screenshots/queue.png`, `impl-generate.png` to `docs/screenshots/generate.png` and `impl-preview.png` to `docs/screenshots/image-preview.png`. Capture an Upscale workspace with a file selected (run the app with the visual userData from Task 17, or add one more entry to the visual loop) as `docs/screenshots/upscale.png`. In `README.md`, rewrite the four `alt` and caption texts that the redesign changed (the viewer caption becomes "Preview, side by side with the result"), using commas instead of em-dashes on every line you touch.

- [ ] **Step 4: Run the full gate**

```bash
npm test && npm run typecheck && npm run lint && npx prettier --check . && npm run build && npm run test:e2e
```

Expected: every step green. Record the counts (unit tests passed, e2e specs passed) for the PR body.

- [ ] **Step 5: Package, install, launch**

```bash
npm run package
```

Wait for electron-builder to finish (the installer is written incrementally). Then, in PowerShell:

```powershell
Get-Process Filesmith -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -Wait "dist\Filesmith-Setup-x64-0.5.0.exe" -ArgumentList '/S'
Start-Process "$env:LOCALAPPDATA\Programs\Filesmith\Filesmith.exe"
(Get-Item "$env:LOCALAPPDATA\Programs\Filesmith\Filesmith.exe").VersionInfo.ProductVersion
```

Expected: the installed app launches dark and reports `0.5.0`. Check every view by hand at 1440x900 and at the 1100x640 minimum (sidebar auto-collapsed below 1280, no horizontal scroll, name column ellipsis), once with the keyboard only, and once with Windows "Show animations" off (reduced motion: the sidebar snaps, no sweep).

- [ ] **Step 6: Commit and push**

```bash
git add package.json package-lock.json CLAUDE.md README.md docs/screenshots
git commit -m "chore: 0.5.0, docs and screenshots for the terminal redesign

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/<N>-terminal-redesign
```

- [ ] **Step 7: Open the PR**

```bash
gh pr create --base main --title "feat: terminal redesign (S2 VS Code grouped)" --body "Closes #<N>.

Implements docs/superpowers/specs/2026-10-04-terminal-redesign-design.md against the signed-off mockup docs/mockups/terminal-v5/10-s2-vscode-grouped.html.

What changes
- Dark-only, strictly monochrome, square workbench: title bar with breadcrumb, collapsible sidebar (Ctrl+B, remembered), files table with result arrow on the size/result split and NN%(Ns) progress, Options / Preview / Info inspector, status bar.
- Options split into one grouped settings file per verb; estimate card; OUTPUT > Location (new optional engine outDir, collision safety unchanged).
- Remaining-seconds estimate for non-ffmpeg jobs; per-row and batch size estimates.
- Settings view (sidebar order and visibility, tool status); Completed as a read-only table.
- Fixes: archive from-pdf page quality now reaches the engine; Completed delete now works from the Completed tab.

Owner checks O1 to O10 are built as proposed in spec section 5 (O7: Location shipped, If file exists fixed, Naming and Keep metadata deferred).

Verification
- npm test, typecheck, lint, prettier --check, build, test:e2e: all green (<counts>).
- Installed dist/Filesmith-Setup-x64-0.5.0.exe locally; launched and checked every view at 1440x900 and 1100x640, keyboard only, reduced motion.
- Screenshots: docs/mockups/terminal-v5/shots/impl-*.png next to 10-s2-vscode-grouped.png. The two queued mockup rows appear as ready because a restored session settles in-flight rows.

Unsigned build, as before.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 8: Stop and ask**

Report the PR link, the gate results and a one-line recommendation, then ask "merge?" once. Do not merge, enable auto-merge or push to `main` without the owner's explicit approval of this PR. After an approved squash-merge: delete the branch locally and remotely, install the merged release build and confirm it reports `0.5.0`.

---

## Self-Review

**Spec coverage**

| Spec section                                                                                         | Task                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 hard rules (dark, monochrome, square, flush, buttons, no drop row, no row bar, no Wind signatures) | 8, 10, 12, 16 (guard test), 17 (dark and square e2e)                                                                                                                |
| M1 window, nativeTheme, background                                                                   | 1                                                                                                                                                                   |
| M2 ETA for ticker jobs                                                                               | 2                                                                                                                                                                   |
| M3 output folder                                                                                     | 3, 13 (OUTPUT > Location)                                                                                                                                           |
| M4 userData override                                                                                 | 1, 17                                                                                                                                                               |
| M5 bundled fonts                                                                                     | 8                                                                                                                                                                   |
| 2.1 tokens + Tailwind mirror + monochrome tests                                                      | 8, 16                                                                                                                                                               |
| 2.2 type, 2.3 lines / focus / motion                                                                 | 8, 10                                                                                                                                                               |
| 2.4 icons, typed `IconName`                                                                          | 9 (window controls keep their own 10x10 paths in `TitleBar`, so `minimize`/`maximize` are not registry entries)                                                     |
| 2.5 component inventory                                                                              | 10, 11, 12, 13, 15                                                                                                                                                  |
| 2.6 cross-group rows                                                                                 | 12 (`.tr.dim`)                                                                                                                                                      |
| 2.7 select popup                                                                                     | 10                                                                                                                                                                  |
| 3.1 title bar and breadcrumb                                                                         | 11                                                                                                                                                                  |
| 3.2 sidebar, collapse, Ctrl+B, rail edit moved                                                       | 11, 15                                                                                                                                                              |
| 3.3 toolbar, table, group rows                                                                       | 12                                                                                                                                                                  |
| 3.4 inspector, 3.5 status bar                                                                        | 11, 13                                                                                                                                                              |
| 3.6 views replacing the table                                                                        | 15                                                                                                                                                                  |
| 3.7 window size, auto-collapse under 1280, kind fold under 1180                                      | 1, 11, 12 (`.ktag` and the `max-width: 1179px` rule; at the 1100px minimum with the sidebar auto-collapsed the name column gets about 170px instead of about 100px) |
| 4.1 selection, checkbox column, keyboard, sorting, run scope                                         | 4, 6, 11, 12                                                                                                                                                        |
| 4.2 options per verb + clean-ups + pageQuality fix                                                   | 13                                                                                                                                                                  |
| 4.3 result and status columns, retry                                                                 | 5, 12                                                                                                                                                               |
| 4.4 totals, 4.5 batch estimate                                                                       | 5, 7, 12, 13                                                                                                                                                        |
| 4.6 Preview, 4.7 Info                                                                                | 14, 15 (Generate)                                                                                                                                                   |
| 4.8 toolbar actions                                                                                  | 4 (`hideFinished`), 12                                                                                                                                              |
| 4.9 drops                                                                                            | 11, 12                                                                                                                                                              |
| 4.10 menu, 4.11 dialogs                                                                              | 15                                                                                                                                                                  |
| 4.12 empty states                                                                                    | 12, 15                                                                                                                                                              |
| 5.1 to 5.6 undrawn screens                                                                           | 13 (setup cards), 15                                                                                                                                                |
| 6.1 source-to-result link                                                                            | 4                                                                                                                                                                   |
| 6.2 estimates, 6.3 ETA, 6.4 totals and batch, 6.5 short error                                        | 7, 2, 5, 11                                                                                                                                                         |
| 7.1 unit tests                                                                                       | 1 to 7, 9 to 11, 13 to 16                                                                                                                                           |
| 7.2 e2e selectors                                                                                    | 17                                                                                                                                                                  |
| 7.3 screenshots, 7.4 gate                                                                            | 17, 18                                                                                                                                                              |
| 9 delivery                                                                                           | 0, 18                                                                                                                                                               |

**Deviations and additions to flag in review**

- `window.filesmith.pickFolder()` is a new, additive preload method and IPC channel (Task 1, listed in spec M3). OUTPUT > Location needs a folder picker and the existing `comfyPickFolder` is titled and seeded for ComfyUI. No existing method changes.
- Run scope (spec O10): today Run acts only on the selection; spec 4.1 says it acts on the whole first group when nothing is selected. Task 12 implements the spec. This is a behaviour change worth the owner's eye.
- Found while reviewing: a retried PDF merge row would fail (its stored options had no input list); Task 12 stores `mergeInputs` in `runOptions`. A stale ETA would freeze at `(1s)` once a ticker ran past its estimate; Task 4 clears it. Non-runnable Generate models stay selectable (Task 13), as today.
- The `Settings` id joins `TabId` (Task 4) but not `TABS`, so `tabs.test.ts`'s seven-verb pin holds.
- OUTPUT / FILES groups render only on Convert (non-archive routes), exactly as spec 4.2 lists them; the engine honours `outDir` for every tool if a later design adds the setting elsewhere.
- Found while planning: deleting from the Completed tab was a silent no-op (its lookups used the empty `completed` queue). Fixed in Task 15 with `dismissAny`.

**Type consistency check**

`SetOption`, `SizeRow`, `SelectOption`, `RowActionKind`, `SortState`, `CheckState`, `Totals`, `StatusSummary`, `InspTab`, `Crumb` and `InfoRow` are each defined once (Tasks 5, 6, 10, 11, 13, 14) and imported by those names wherever used. `reserveOutPath`'s fourth parameter and `ToolContext.outDir` (Task 3) are the only engine signature changes; `estimateProgress`'s callback gains a second argument (Task 2), and every caller is updated in the same task.

**Review Focus cross-check**

Each Review Focus line has its test: missing output folder (Task 3, `resolveOutDir`), zero-byte and folder outputs (Task 5, `pctChange` and `rowView` folder case), re-run and old-session rows (Task 4 `markQueued` clears, Task 5 "done from an old session"), header checkbox across groups (Task 6), estimator nulls and partial batches (Task 7).
