# Terminal redesign (S2 "VS Code grouped") – design

Date: 2026-10-04
Status: proposed

Target: `docs/mockups/terminal-v5/10-s2-vscode-grouped.html`
(screenshot `docs/mockups/terminal-v5/shots/10-s2-vscode-grouped.png`), locked in by the owner on
2026-10-04. The feedback trail and hard rules are in `docs/design/redesign-direction.md`.

## 1. Goal and scope

Rebuild the renderer so that it matches the signed-off mockup: a dark, strictly monochrome, square,
flush-panel workbench made up of a title bar with a breadcrumb, a collapsible labelled sidebar, a
details table of files, a right inspector (Options / Preview / Info) and a status bar.

The redesign changes the renderer only. Behaviour stays the same: verb-first navigation, one queue per
workspace, convert groups, the rule that a selection never spans two groups, every option each verb
has today, Generate, Tools, Completed, session persistence, and the never-overwrite rule.

Hard rules (from `redesign-direction.md`; not negotiable in this work):

- **Dark only.** The light theme is removed entirely: no `dark:` variants, no toggle and no
  `prefers-color-scheme` branch. Themes may come later. To make that possible, every colour is a CSS
  custom property.
- **Strict monochrome.** Every colour is a grey with r=g=b. Errors, warnings and danger actions use a
  glyph, font weight and inverted fill, never red, green or amber. This includes the window close button,
  per-verb rail colours and `GROUP_COLOR`.
- **Every corner is square** (`border-radius: 0` globally).
- **Flush panels**, separated only by 1px lines. There are no shadows and no cards, apart from the
  estimate box.
- **Controls read as buttons**: they are boxed, outlined or inverted. Underlined or dotted-link words are
  not used as controls. The two exceptions are drawn in the signed-off mockup itself: the breadcrumb's
  parent segment (underlined on hover) and the status bar's `1 failed` item. Neither is the only way to do
  anything: the sidebar also returns to the Tools grid, and the failed rows carry their own Retry.
- **No "Drop files here" row.** Files are added through the toolbar's Add files button, and the whole
  window still accepts drops.
- **No progress bar under a running row.** Progress shows as `62%(4s)` in the status column.
- **Avoid Wind's signatures**: the floating progress-plus-button pill, the icon-tile header band, and big
  rounded cards of right-aligned setting rows.

Main process, IPC, preload and tool modules stay untouched, except for the small additions listed
below. Each one is also tracked in section 6.

| #   | Change outside the renderer                                                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                 | Size                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| M1  | `src/main/index.ts`: `backgroundColor` becomes `#0a0a0a`; `nativeTheme.themeSource = 'dark'`; default window 1440×900 (clamped to the work area), minimum 1100×640                                                                                                                                                                                                                                           | No light flash before the first paint; dark native scrollbars and dialogs; the layout needs the width (section 3.7) | a few lines                                                            |
| M2  | `src/main/tools/estimate.ts` plus its callers: `estimateProgress` also reports a remaining-seconds estimate through the existing `onProgress(pct, msg, etaSec)`                                                                                                                                                                                                                                              | Image, PDF and rembg jobs can show `62%(4s)` and not only ffmpeg jobs                                               | small; the signature only gains a value the job queue already forwards |
| M3  | `src/main/output.ts` and `registry.ts`: optional `outDir` job option. When it is set, outputs are reserved in that folder rather than next to the source; collision safety is unchanged. A chosen folder that no longer exists fails the job ("Output folder not found"), never falls back. Plus one additive IPC channel `files:pick-folder` and preload method `pickFolder()` for the Choose folder button | The OUTPUT › Location setting                                                                                       | moderate; **owner decision O7**                                        |
| M4  | Test-only: `FILESMITH_USER_DATA` env override for `app.setPath('userData', …)`, read only when it is set                                                                                                                                                                                                                                                                                                     | Lets e2e seed a session so the screenshot test has rows                                                             | 3 lines                                                                |
| M5  | `package.json`: add `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` (400/500/600)                                                                                                                                                                                                                                                                                                                | The mockup uses IBM Plex. Fonts are bundled so they work offline and stay within the CSP (no Google Fonts)          | dependency only                                                        |

No existing IPC channel or preload signature changes; the only addition is `pickFolder()` (M3).
`FilesmithApi` keeps every method the e2e specs drive.

## 2. Design system

### 2.1 Tokens

All tokens are CSS custom properties on `:root` in `src/renderer/src/theme/tokens.css`. They are mirrored
into Tailwind v4 `@theme` so that utility classes (`bg-bg-0`, `text-fg2`, `border-line`) resolve to the
variables. A future theme then only has to redefine the variables. The old tokens (`ink`, `muted`, `dim`,
`canvas`, `line`, `accent*`) are deleted. So is the inline black-accent override in `OptionsPanel`.

| Token           | Value     | Use                                                                                      |
| --------------- | --------- | ---------------------------------------------------------------------------------------- |
| `--bg-0`        | `#0a0a0a` | app, panels, body; the patch behind the split arrow; preview tags                        |
| `--bg-1`        | `#0f0f0f` | setting block hover and focus-within                                                     |
| `--hover`       | `#1a1a1a` | hover on any neutral surface                                                             |
| `--selected`    | `#202020` | selected row; `:active` on neutral surfaces                                              |
| `--field`       | `#141414` | select and text-field fill                                                               |
| `--track`       | `#2a2a2a` | progress track; segment `:active`                                                        |
| `--line`        | `#262626` | every 1px hairline                                                                       |
| `--line-strong` | `#3a3a3a` | table head bottom, totals top, control outlines, thumbnails, estimate box, preview frame |
| `--fg1`         | `#ededed` | primary text, active bars, focus                                                         |
| `--fg2`         | `#b4b4b4` | secondary text, idle icons                                                               |
| `--fg3`         | `#8c8c8c` | labels, meta, placeholders, checkbox border                                              |
| `--fg-disabled` | `#5c5c5c` | disabled text (for example a RAR target without WinRAR)                                  |
| `--inv-bg`      | `#ededed` | inverted fills: primary, Add files, selected segment, checked box, badge, failed pill    |
| `--inv-fg`      | `#0a0a0a` | text on inverted fills                                                                   |
| `--inv-hover`   | `#ffffff` | hover on inverted surfaces                                                               |
| `--inv-active`  | `#bdbdbd` | `:active` on inverted surfaces                                                           |
| `--focus`       | `#ededed` | focus outlines                                                                           |

A unit test parses `tokens.css` and asserts that every colour token has r=g=b. That is the monochrome
guard. A lint-style test also greps `src/renderer/src/**/*.{ts,tsx,css}` for hex or `rgb(` literals
outside `tokens.css` and fails on any non-grey value.

### 2.2 Type

- `--sans: "IBM Plex Sans", system-ui, sans-serif`; `--mono: "IBM Plex Mono", Consolas, monospace`.
  Weights 400, 500 and 600, bundled through `@fontsource` (M5).
- Body: `13px/1.4 var(--sans)`, antialiased, `--fg1`. Every number uses `tabular-nums`.
- The scale is fixed to the sizes the mockup uses: 16/600 mono (estimate value), 14/600 sans (inspector
  head), 13 sans/mono (body, names, controls), 12 sans/mono (meta, tabs, status, descriptions),
  11.5 mono (`code` in descriptions), 11 mono (table head, group heads at 600 with `.09em` tracking,
  badges), 9 mono (collapsed badge). The sizes live in the component rules (`theme/workbench.css`,
  `controls.css`, `views.css`), ported from the mockup; there is no separate type-utility file. The ad hoc
  Tailwind pixel sizes in the current components go away.
- Labels are lowercase where the mockup has them lowercase: the table head (`name kind size result
status`), the sidebar head (`operations`), the segment values and the estimate head. Group heads
  (`FORMAT`, `OUTPUT`, `FILES`) are uppercase literals.

### 2.3 Spacing, lines, focus and motion

- Fixed heights, each including its border: 32 (title bar, sidebar head, toolbar, tab bar, table row,
  info row), 28 (table head, select, input, segment, in-row button), 36 (sidebar item), 30 (totals),
  48 (primary footer), 24 (status bar).
- Every border is 1px. Active markers are 2px `--fg1` bars: left edge for a sidebar item, a selected row
  and a focused setting; bottom edge for a tab.
- Focus defaults to `:focus-visible { outline: 1px solid var(--focus); outline-offset: -1px }`. The
  offsets per component are given in 2.5. The primary button uses a 2px outline with an inset gap ring.
- Motion: sidebar width `.18s cubic-bezier(.2,.7,.2,1)`; toggle mirror `.18s`; label and badge opacity
  `.12s`; control colour, background and border `.1s`. Under `prefers-reduced-motion: reduce`, all of
  these are `none` and the `i-sync` spin (if added) stops. The `ctx-pop` and `modal-pop` animations are
  kept only as an opacity fade, with no scale and no radius.

### 2.4 Icons

One module, `src/renderer/src/components/icons/Icon.tsx`. Its 16×16 viewBox, stroke-only registry
replaces the current 24×24 `PATHS`. The attributes are `fill:none`, `stroke:currentColor`,
`stroke-width:1.25`, square caps, miter joins and `vector-effect: non-scaling-stroke`. Sizes are 16
(default) and 12; window controls use their own 10×10 paths at stroke 1.

The registry holds the mockup set: `convert compress resize upscale removebg generate tools completed
settings addfile folder play stop retry close check warning clock sync chev-r chev-d trash eye info arrow
sidebar anvil`. It adds the icons the current code needs and the mockup lacks, drawn in the same
16px/1.25 language: `image pdf text merge split burst pull archive video audio doc unpack topdf tocbz edit
grip dots`. Minimize and maximize are not registry entries; they are the window controls' own 10×10 paths. `IconName` is a string-literal union. `Tab.icon` and `ToolCard.icon` in
`src/shared/tabs.ts` are typed as that union, through a shared `IconName` type in `src/shared/icons.ts`,
so a bad name fails typecheck instead of being cast. Unused media icons (`play/pause/volume*/fullscreen`
from the removed viewer) are dropped. `play` is redrawn as the primary-button triangle.

The brand mark changes from the white-tiled `fmark.png` to the `i-anvil` glyph. The app/installer icon
is out of scope (section 8).

### 2.5 Component inventory

Each primitive lives in `src/renderer/src/components/ui/` and covers every state the mockup defines.
Disabled is not drawn in the mockup; its rule is `--fg-disabled` text, `--line` border, no hover change
and `cursor: default`.

| Primitive                                     | Mockup class                        | States (hover / active / on / focus / disabled)                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TitleBar`, `WinControls`                     | `.titlebar`, `.winctl`              | 46px buttons, left border; hover `--hover`/fg1; active inverted; close is **not** red                                                                                                                                                      |
| `Breadcrumb`                                  | `.crumb`                            | link segment: fg3, and fg1 with a 3px-offset underline on hover; current segment is `<b>` 500 fg1. Link segments are `<button>`s (section 7.2)                                                                                             |
| `Sidebar`, `SidebarItem`                      | `.side`, `.item`                    | hover `--hover`/fg1; active `--selected`; on: fg1, 600, 2px left bar, `aria-current="page"`, inverted count chip; collapsed: labels faded out, badge pinned top-right, only the active item's badge kept                                   |
| `ToolbarButton` (`add`, `icon`)               | `.tbtn.add`, `.ibtn`                | Add files inverted, hover `--inv-hover`, active `--inv-active`; icon buttons 36px, hover `--hover`, active `--selected`, disabled when there is nothing to act on                                                                          |
| `Table`, `TableHead`, `TableRow`, `TotalsRow` | `.thead/.th/.tr/.td/.totals`        | head cell hover `--hover`; sort chevron hidden until hover or sorted, `aria-sort`; row hover `--hover`, selected `--selected` plus a 2px left bar covering the borders above and below, focus outline inset, cross-group rows dimmed (2.6) |
| `Checkbox`                                    | `.box`                              | 14px (table) or 16px (setting); hover border fg1; on: inverted with a check; mixed: an 8×2 bar; focus offset 2                                                                                                                             |
| `RowAction`                                   | `.row-act`                          | 24×24 outlined; hover border fg2 + `--hover`; active inverted; `ghost` variant is hidden until row hover or focus-within; focus offset 1                                                                                                   |
| `StatusCell`                                  | `.st`                               | `done` (check, "Done", fg2), `run` (sync, `<b>62%</b>(4s)`), `queued` (clock, "Queued", fg3), `ready` (section 4.3), `canceled` (section 4.3), `fail` (inverted pill, warning glyph, short label)                                          |
| `ResultCell`                                  | `.rc`, `.arr.split`                 | arrow centred on the size/result boundary with a background patch matching the row state; done `<b>` 600 fg1 plus `.pct`; running `~est` fg2 plus `.pct`; empty otherwise                                                                  |
| `Tabs`                                        | `.tabs/.tab`                        | hover fg1/`--hover`; on 600 plus a 2px bottom bar; bold width reserved through `data-t` so the row never shifts; `role=tablist`, arrow-key roving                                                                                          |
| `InspectorHead`                               | `.ihead`                            | title `<h1>` (section 7.2) at 14/600 plus a 12px mono sub-label                                                                                                                                                                            |
| `SettingGroup`                                | `.vs-gh`                            | 11/600 mono uppercase with a hairline to the right edge                                                                                                                                                                                    |
| `Setting`                                     | `.vs-set/.vs-t/.vs-d`               | hover and focus-within `--bg-1`; focus-within shows a 2px left bar                                                                                                                                                                         |
| `Select`                                      | `.vs-sel`                           | filled `--field`; hover border fg3 and `--hover`; active `--selected`; focus border `--focus`; `half` width; optional option groups (replaces both `ChoiceSelect` and `ModelPicker`); popup list in 2.7                                    |
| `TextField`, `NumberField`                    | `.vs-in`                            | hover border fg3; focus border `--focus`; `spellcheck=false`; `NumberField` keeps `DimInput`'s commit-on-blur/Enter and clamping                                                                                                           |
| `Segmented`                                   | `.seg`                              | `role=radiogroup`, arrow keys; hover `--hover`; active `--track`; on inverted 600, on+hover `--inv-hover`; focus offset -3 (`--inv-fg` on the selected button)                                                                             |
| `CheckSetting`                                | `.vs-chk`                           | label + sub-line; Space/Enter toggle                                                                                                                                                                                                       |
| `SmallButton`                                 | `.sbtn`                             | outlined; hover `--hover`/fg3 border; active inverted; focus offset 1                                                                                                                                                                      |
| `ChipGrid`                                    | new (a segmented control in a grid) | the format, bitrate, factor, PDF op and style choices. Chips are square outlined cells; on is inverted; disabled uses `--fg-disabled` with a tooltip (`WinRAR not found`)                                                                  |
| `RangeField`                                  | new                                 | label, value readout in mono, a 2px `--track` slider with an `--fg1` fill and a square 10px thumb, end labels. Replaces about 9 copies                                                                                                     |
| `EstimateCard`                                | `.vs-est`                           | head `estimate … N files`; value `from → ~to` and `-N%`; full-sentence `aria-label`                                                                                                                                                        |
| `ProgressBar`                                 | `.mini`                             | 2px track with an fg1 fill; determinate or indeterminate (an fg1 segment sweeping, static under reduced motion). Replaces the 3 copies in CompanionDownload, ComfyImport and PidInstallCard                                                |
| `PrimaryButton`                               | `.ifoot .primary`                   | inverted, `i-play`; hover `--inv-hover`; active `--inv-active`; disabled: `--selected` fill with `--fg-disabled` text; 2px focus ring with an inset gap                                                                                    |
| `StatusBar`, `StatusItem`                     | `.statusbar/.sitem`                 | hover `--hover`/fg1; right group uses left borders; `.warn` 600 fg1 with the warning glyph                                                                                                                                                 |
| `ContextMenu`                                 | restyled                            | section 4.10                                                                                                                                                                                                                               |
| `ConfirmDialog`                               | restyled                            | section 4.11                                                                                                                                                                                                                               |

### 2.6 Cross-group rows

A row from a different convert group than the current selection renders at fg3 text with its thumbnail
at 40% opacity. It keeps the existing tooltip "A different file type than the current selection".
Clicking it moves the selection, as today. This is the monochrome replacement for the current
`opacity-40` card.

### 2.7 Select popup (not drawn in the mockup)

Proposal: a native `<select>` is not used, because Chromium draws the popup list in light OS chrome. A
custom listbox drops directly below the field at the field's width, flush and square, `--bg-0` with a
`--line-strong` border. Items are 28px, 13px mono. Hover gives `--hover`; the current item is fg1 600
with an `i-check`; disabled items are `--fg-disabled` with a reason suffix (for example `WinRAR not
found`). An enabled item may carry a suffix too (Generate's `needs download`, see 4.2). Option group headings use the `SettingGroup` style. Keyboard: arrows, Home/End, type-ahead,
Enter, Esc. **Owner check O3.**

## 3. Layout

The `body` is a grid of `32px 1fr 24px` rows (title bar, workbench, status bar) at `100vw × 100vh`. The
workbench is a grid of `auto 1fr 340px` columns (sidebar, centre, inspector) with `min-height: 0`.

### 3.1 Title bar

A 32px drag region with brand (anvil + "Filesmith"), a 1px separator, the breadcrumb and window
controls pushed right. Every control inside it is `no-drag`. The window stays `frame: false`.
Minimize/maximize/close keep calling `window.filesmith.minimize/toggleMaximize/close`.

Breadcrumb content per context:

| Context                             | Breadcrumb                                                        |
| ----------------------------------- | ----------------------------------------------------------------- |
| Verb workspace, no selection        | `convert` (current)                                               |
| Verb workspace with an active group | `convert / images` (group label, lowercase)                       |
| Tools grid                          | `tools`                                                           |
| Tools card                          | `tools / merge` (the `tools` segment is the Back to Tools button) |
| Generate                            | `generate`                                                        |
| Completed                           | `completed`                                                       |
| Settings                            | `settings`                                                        |

### 3.2 Sidebar

208px expanded, 48px collapsed, each including a 1px right border.

- Head: the lowercase label `operations` and the toggle (`i-sidebar`, mirrored when collapsed).
- Top group: the six verbs from `TABS` in their current order. Then a separator and Tools. Then a
  spacer. The bottom group (top border) is Completed and Settings.
- Badges: the input count for verbs and Tools (rolled up from `tools:*` queues, as today); Completed shows
  the completed count.
- **Collapse state** is a `useSidebar()` hook backed by localStorage key `filesmith.sidebar` (a per-user
  view preference, like the existing `filesmith.rail.*` keys). It defaults to expanded. The toggle and
  **Ctrl+B** flip it. `aria-expanded`, `aria-label` ("Collapse sidebar" / "Expand sidebar") and `title`
  ("… (Ctrl+B)") stay in sync. Every item has a `title` attribute, which is the tooltip when collapsed.
- **Rail edit mode** (reorder and hide, today a pencil in the rail header) cannot live in the head
  anymore, because the head holds only the label and the toggle. Proposal: it moves to Settings › Sidebar
  as a list with grip, label and a visibility checkbox. It keeps the same localStorage keys
  (`filesmith.rail.tabOrder`, `filesmith.rail.tabHidden`) and the same pointer sortable. **Owner check
  O6.**

### 3.3 Centre: toolbar and table

- **Toolbar** (32px): Add files (inverted) | Remove selected | Retry failed | Clear finished … right: `N
files, M selected` | Stop all. Section 4.8 describes what each does.
- **Table**: columns `40px 1fr 64px 88px 184px 232px` (checkbox, name, kind, size, result, status).
  The head and totals are fixed; only the rows region scrolls (`.scroll-thin` restyled to a square 8px
  `--line-strong` thumb on `--bg-0`). The totals row pins to the bottom even when there are few rows.
- In a mixed queue (two or more groups), a 28px group row (`SettingGroup` style: `IMAGES  6` and a
  hairline) sits above each group's rows. It is not selectable, and clicking it selects the whole group.
  In a single-group queue there is no group row, as the mockup shows. **Owner check O4** (the mixed table
  is not designed).

### 3.4 Inspector

340px with a 1px left border. Rows `32px 1fr auto`: tabs, a scrolling body and a 48px footer.

- Tabs: Options (`settings`), Preview (`eye`), Info (`info`). The selected tab is per-session view state
  in App, not persisted.
- `ihead`: Options shows `<Verb>` with `all N files` / `N selected` / `no files`. Preview and Info show the
  focused file's name with `selected`.
- Footer: the primary Run button (section 4.1).

### 3.5 Status bar

24px, 12px mono: `[sync] Converting 3 of 6 [mini]` | `2 of 6 done` … right: `[warning] 1 failed`.
Items with nothing to say are not rendered. Clicking `1 failed` selects the failed rows of the current
workspace.

### 3.6 Views that replace the table

Generate, Tools grid, Completed and Settings occupy the centre (toolbar row plus content), as described in
section 5. The inspector is shown for Generate and hidden for the Tools grid, Completed and Settings. In
those views the centre spans both columns, as today.

### 3.7 Window size

The fixed table columns add up to 608px. Expanded sidebar plus inspector is 548px. At today's 1160px
default, the name column would get about 4px. Proposal (M1): the default window becomes 1440×900, clamped
to the display work area, and the minimum becomes 1100×640. Below 1280px wide the sidebar auto-collapses
(not persisted, so the user's choice is restored when the window widens). Below 1180px the `kind` column
folds into the name cell as a trailing fg3 tag. **Owner check O5.**

## 4. Behaviour mapping

Nothing in `state.ts`'s reducer, keys or session schema changes meaning. The new view logic is pure
functions in sibling `.ts` files (section 7.1).

### 4.1 Common to every verb workspace

- **Queue and groups.** One queue per workspace (`queueKey`), possibly holding several convert groups.
  Selection modes stay as they are: click = single, Ctrl/Meta = toggle (moves to the clicked group if it
  differs), Shift = range within the anchor's group. **A selection never spans groups.**
- **Checkbox column.** A row checkbox toggles the row (same as Ctrl+click). The header checkbox shows
  none / mixed / all **for the active group** (the group of the current selection or, with no
  selection, the first group in display order). Clicking it selects all rows of that group, or clears
  the selection when all are selected. It never selects across groups. The checkbox is `tabindex=-1`;
  the row takes focus.
- **Keyboard (new).** In the table: Up/Down move focus; Space toggles; Shift+Up/Down extends the range;
  Ctrl+A selects all of the active group; Delete removes the selection from the list (the same as the
  menu item); Enter opens the focused file (as double-click does today); the context-menu key or
  Shift+F10 opens the menu. Global: Ctrl+B toggles the sidebar; Ctrl+O = Add files; Ctrl+Enter = Run
  when enabled. **Owner check O8** (shortcut set).
- **Sorting (new).** Clicking a header sorts by that column ascending, a second click sorts descending
  (the chevron flips), and a third click goes back to insertion order. The sort is view-only in App
  state (per workspace, not persisted) and applies within each group. Range selection follows the
  visible order.
- **Options.** The Options tab renders the verb's settings in grouped VS Code style (section 4.2). Options
  are keyed per group as today. With no selection, the panel shows the options of the first group in the
  queue rather than an empty panel; with an empty queue it shows `no files` and the Add files hint (4.12).
- **Run button.** The label is `<Verb> <groupNoun(optGroup, runCount)>` ("Convert 6 images"). The mockup's
  "Convert 6 files" uses the generic noun, while the code uses the group noun; the group noun is kept
  because it is more precise, which is a deliberate deviation. It is disabled when `runCount === 0`. The
  oversized-upscale confirm, PDF merge special case and per-file job dispatch in `run()` are unchanged.
- **Run scope.** Run acts on `runList`: the runnable selection or, when nothing is selected, every row of
  the first group in display order. Today an empty selection runs nothing, so the second half is new
  (**owner check O10**).

### 4.2 Options per verb (grouped settings)

Every existing control is kept. Headings group them; the setting title is the current label, and the
description is the current hint or help text. The `HelpTip` hover tooltips become `.vs-d` description
text.

| Verb / context                                       | Groups and settings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Convert** (image, video, audio, doc, sheet, slide) | FORMAT: Format (`Select` of `sharedTargets`; same-format and RAR-without-WinRAR targets disabled with reasons); Quality (`Segmented` smaller / balanced / best, images only). OUTPUT: Location (O7). FILES: If file exists (O7), Metadata (O7). Then the estimate card                                                                                                                                                                                                                                                                                                                                                     |
| **Convert** › archive repack                         | FORMAT: Format (archive targets); Compression (`Segmented` store / normal + hint)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Convert** › from-pdf                               | FORMAT: Format; PAGES: DPI (`RangeField` 72–400 step 2); Page format (`Segmented` jpg / png + hint); Page quality (`RangeField`, writes `pageQuality`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Compress** › image                                 | FORMAT: Format (keep / webp / avif); Quality (`RangeField` 10–100)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Compress** › video                                 | VIDEO: Codec (h264 / h265 / av1); Scale (`RangeField` 25–100, "original" at 100) with the output resolution list beneath it when below 100; Quality (`RangeField`)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Compress** › audio                                 | AUDIO: Codec (keep / mp3 / aac / opus); Bitrate (`ChipGrid` 320 … 64)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Compress** › pdf                                   | PDF: Level (lossless / high / balanced / smallest); Greyscale (`CheckSetting`; replaces the only toggle switch)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Resize**                                           | SIZE: Mode (`Segmented` percent / dimensions); Percent (`RangeField` 5–200) or Width and Height (`NumberField`, placeholder `auto`) plus Fit (`Segmented` contain / stretch); the output size list                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Upscale**                                          | MODEL: Factor (`ChipGrid` 2× 3× 4×); Model (category `Select`, then sub-`Select` for AI models; "Add your own model" as a `SmallButton` with `i-folder`); the GPU reason as description text; the PiD install card, PiD remove and Comfy import card (section 5). PERFORMANCE: GPU mode (`Segmented` full / background); the low-VRAM warning as a warning-glyph description. Then the output size list                                                                                                                                                                                                                    |
| **Remove BG**                                        | BACKGROUND: Fill (`Select`); Custom colour (a 28px swatch button opening the native colour input; the swatch shows the chosen colour, which is the one place a non-grey value appears, because it is user content); Background image (`SmallButton` "Choose image" + file name). The first-run download or missing-`uv` notice is a setting description with the warning glyph                                                                                                                                                                                                                                             |
| **Tools** › PDF cards                                | One card = one op, so there is no op chip grid. Pages to images: DPI. Split range: Range (`TextField`, placeholder `1-3,5,8-10`). Merge: the hint "Select 2 or more PDFs" as a description while `runCount < 2`                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Tools** › archive cards (when present)             | Extract / to-pdf: an info description only. From-pdf: reuses `PageRenderOptions`, which **fixes the existing bug** where `ArchiveOptions` wrote `quality` and the engine read `pageQuality`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Generate**                                         | MODEL: Model (`Select` with architecture option groups; non-runnable models stay selectable with a `needs download` suffix, as today, because selecting one is what reveals the download card or Try anyway); CompanionDownload / reason + Try anyway; Add model / Open folder / Change ComfyUI folder as `SmallButton`s. PROMPT: Negative (`TextField`, hidden when cfg is 1); Style (`ChipGrid`). OUTPUT: Count (`RangeField` 1–8); Size (`Select` + custom Width/Height `NumberField`s with clamping). ADVANCED: a collapsible `SettingGroup` (chevron) holding Steps, CFG, Guidance and Seed (+ Random `CheckSetting`) |

Engineering clean-ups that come with the split (no behaviour change except the bug fix):
`OptionsPanel.tsx` becomes `components/options/` with one file per verb plus `primitives`; a memoized
`onSet` (it is recreated every render today, re-running two effects); one `useArchiveStatus` call instead
of two; the stale "three toggles" comment removed.

### 4.3 Result and status columns

Derived per row by `rowView(item, ctx)` in `components/queue/rowModel.ts`.

| Status              | Status cell                                                                                      | Result cell                                                                                          | Row action                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ready` (never run) | blank, no glyph                                                                                  | empty                                                                                                | `i-close` Remove (ghost)                                                                                   |
| `queued`            | `i-clock` "Queued" fg3                                                                           | empty                                                                                                | `i-close` Remove (ghost): cancels the queued job **and** removes the row (today the inline × only cancels) |
| `running`           | `i-sync` + `<b>62%</b>(4s)`; `(4s)` only when `etaSec` is known; `!hasProgress` shows `<b>…</b>` | `~410 KB -77%` in fg2 when an estimate exists, otherwise empty                                       | `i-close` Cancel (ghost)                                                                                   |
| `done`              | `i-check` "Done" fg2                                                                             | `<b>640 KB</b> -80%`; a directory output shows `<b>N files</b>` or `<b>folder</b>` and no percentage | `i-folder` Show in folder (ghost), revealing the **output**                                                |
| `failed`            | inverted pill, `i-warning`, short label                                                          | empty                                                                                                | `i-retry` Retry, **always visible**                                                                        |
| `canceled`          | `i-close` "Canceled" fg3                                                                         | empty                                                                                                | `i-retry` Retry (ghost)                                                                                    |

**Ready** shows a blank status, because the mockup has no ready label. **Owner check O4.**

- The split arrow is drawn on the size/result boundary only when the result cell has content.
- Compact ETA: `formatEtaCompact(sec)` gives `(4s)`, `(2m)`, `(1h 5m)`. The existing `formatEta` stays
  for any other uses. A progress update without an ETA clears the stored one, and a re-queue resets it, so
  an overdue row reads `62%`, never a frozen `62%(1s)`.
- **Percentage** is `round((out - src) / src * 100)`, signed, with `-` meaning smaller. A growth result
  shows `+N%` in **600 weight** (the monochrome replacement for amber) and the tooltip "Larger than the
  original".
- **Short failure label:** `shortError(message)` maps known messages to a short label (for example
  `Unsupported compression`, `WinRAR not found`, `Password-protected`, `Tool missing`). Otherwise it
  takes the first clause, capped at 32 characters with an ellipsis. The full text is the pill's tooltip,
  and it appears selectable in the Info tab.
- **Retry** marks the row queued with its stored `runOptions` and dispatches the job, which is the same
  path as `run()` for one item. A PDF merge stores its ordered input list in `runOptions`, so a merge
  retries with the same files.

### 4.4 Totals row

`queueTotals(items)` in `rowModel.ts`, over the input rows of the current workspace (all groups):

- `N files` | `<sum of sizes>` | `<done source sum> → <b>done result sum</b> so far` (shown only when at
  least one done row has a file output) | `<b>D of N done</b>`.
- "Done" counts the status as it stands, so it can include rows done in earlier runs (there is no batch
  concept in the data; this matches what the user sees in the status column).

### 4.5 Batch estimate card

Shown in Options under the last group, before Run, whenever `runList` is non-empty and an estimate exists:
`estimate … N files`; `<sum src> → ~<sum est> -N%`. Hidden when no estimator applies (for example PDF
split, extract text, Generate). The source is section 6.2.

### 4.6 Preview tab

For the focused row (the last-clicked row, or the first selected one):

- **Done image or PDF-to-image output:** a 208px wipe frame with the source on the left and the result on
  the right, a 1px fg1 divider and tags (`jpg 2.1 MB` / `webp 486 KB`). The divider drags horizontally
  (pointer and arrow keys, `role=slider`). Images come from the existing 128px thumbnail calls at a larger
  size (`thumbnail(path, 640)`).
- **Not yet done:** the source only, with a single tag.
- **Video, audio, document, archive:** the thumbnail if there is one, otherwise the extension in a 208px
  frame. There is no player (the in-app viewer was removed earlier, and this is not reintroduced).
- Below it, a grid of `size`, `saved`, `pixels`.
- **Owner check O9** (draggable wipe and non-image fallbacks are undesigned).

### 4.7 Info tab

A `dl` grid for the focused row: `format` (`jpg to webp`), `pixels`, `size`, `colour` (only when known
from the probe), `metadata` (O7), `output` (path, revealable), and for failed rows `error` (full text,
selectable). Values use the word "to", not an arrow.

### 4.8 Toolbar actions

| Button          | Does                                                                | Enabled when                |
| --------------- | ------------------------------------------------------------------- | --------------------------- |
| Add files       | `browse()`                                                          | always on a queue workspace |
| Remove selected | `dismiss` on the selection (cancels in-flight jobs first, as today) | selection is non-empty      |
| Retry failed    | Retry every failed row in the active group                          | any failed row              |
| Clear finished  | Hide done and canceled input rows (results stay in Completed)       | any done or canceled row    |
| Stop all        | `cancelJob` for every queued or running row in this workspace       | any in flight               |

The toolbar count reads `N files, M selected` (or just `N files`).

### 4.9 Drops

The whole window accepts drops, routed to the current workspace through `accepts()` as today. While
dragging, a 1px `--fg1` inset outline is drawn around the centre panel, and the toolbar count reads `Drop
to add`. There is no drop row.

### 4.10 Context menu

The current items and logic are unchanged: input menu, output menu, generated-tile menu. Restyle: flush
`--bg-0`, 1px `--line-strong` border, no blur, no shadow, square, 28px items with 16px icons, 12px sans
labels. Hover is `--hover`/fg1; separators are `--line`. Danger items (Remove, Delete) show the label at
600 with `i-trash` or `i-close`; they are **not** red. Flip and close behaviour is unchanged.

### 4.11 Dialogs

`ConfirmDialog` keeps its API and uses. Restyle: a square `--bg-0` panel with a 1px `--line-strong`
border, a backdrop of `rgba(0,0,0,.6)`, a 14/600 title, a 13px fg2 body and a footer of `SmallButton`
Cancel plus inverted confirm. A `danger` confirm keeps focus on Cancel and shows `i-warning` before the
title.

### 4.12 Empty states (owner check O2)

- **Empty queue:** the table head and the totals row stay. The body shows a single centred block: `i-addfile`,
  "No files yet", the fg3 line "Add files or drop them anywhere in the window" and an outlined
  `SmallButton` "Add files". There is no drop zone. The inspector shows `no files` and a disabled Run.
- **No completed items:** the same pattern: "Nothing finished yet" / "Files you convert, compress or
  resize land here".

### 4.13 Per-verb notes

- **Convert, Compress, Resize, Upscale, Remove BG:** the table view described above. The inline output
  size lists (video scale, resize, upscale) render as a mono two-column list under their setting. The
  oversized-upscale confirm is unchanged.
- **Generate:** section 5.1.
- **Tools:** the grid (section 5.2); a card opens a normal table workspace titled with the card's label.
- **Completed:** section 5.3.

## 5. Screens the mockup does not show

The project rule is "make NO visual assumptions". Every item here is a proposal in the established
language. The owner checks below are collected as **open items O1 to O10** for the single approval, and the
plan builds each one as a quick static check (a screenshot from the running branch) before it is wired
in.

### 5.1 Generate (O1)

Centre: the toolbar row holds `Generate` controls (an inverted `Generate` button with `i-play` and a
`Cancel` `SmallButton` while running). Below it is the prompt as a full-width borderless textarea on
`--bg-0` with a 1px bottom line, 13px sans, min 6 lines. Under that is the results grid: square cells
separated by 1px lines (no gaps, no radius), aspect from width/height, 2 or 3 columns. Pending slots show
`--bg-1` with a centred mono `42%` and a 2px `ProgressBar` along the bottom edge. The startup message is a
status-bar item with the indeterminate mini bar rather than a card. The inspector Options tab holds
`GenerateOptions` (4.2). Preview shows the focused image larger; Info shows the seed, model, size and path.
The Run button reads `Generate` (or `Generate 4 images`).

### 5.2 Tools grid (O1)

A dense list rather than cards: a `SettingGroup` heading per group (`PDF`), then 40px rows with a 16px
icon, label (13/500) and description (12 fg3), with hover `--hover` and Enter/click to open. The title is
an `<h1>` "Tools" in a 32px header row, styled like `ihead`. No colour swatches. No inspector.

### 5.3 Completed (O1)

The same table component in read-only mode: columns `name | from | kind | size | result | ` (no
checkbox, status replaced by the row action `i-folder`). `name` is the output file name; `from` is the
verb label; `size` the source size; `result` the output size and percentage with the split arrow. Newest
first by default. The toolbar has `Delete selected` (with the existing confirm) and `Clear list` (hides
rows, does not delete files). The context menu is the existing output menu.

### 5.4 Settings (O6)

A new view behind the sidebar Settings item. It uses the grouped settings style in the centre (no
inspector):

- SIDEBAR: reorder and visibility (moved from rail edit mode).
- TOOLS: status of the bundled and on-demand tools (read-only, from the existing status calls), plus the
  existing ComfyUI folder change and the models-folder buttons.

No new preferences are introduced beyond what exists.

### 5.5 Tool setup cards: ComfyImport, PiD install, CompanionDownload, LocateComfy (O1)

They stay inline in the Upscale and Generate options, restyled as `Setting` blocks rather than cards: a
title, a description (licence notice, VRAM requirement, missing file list in mono), a `SmallButton`
action and a full-width `ProgressBar` with a mono percentage while running. Remove/uninstall actions are
`SmallButton`s with `i-trash`.

### 5.6 ErrorBoundary (O1)

A centred block in the workbench: `i-warning`, "Something went wrong" (14/600), the error message in
mono fg3, and `SmallButton`s Reload and Reset session.

### 5.7 Select popup, mixed-group table, ready status, window size, shortcuts, run scope

See O3, O4, O5, O8 and O10.

### Open items for the owner's single approval

| #   | Item                                                                       | Proposal                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Generate, Tools grid, Completed, tool setup cards, ErrorBoundary           | Sections 5.1, 5.2, 5.3, 5.5, 5.6                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| O2  | Empty states                                                               | Section 4.12                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| O3  | Select popup list                                                          | Section 2.7                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| O4  | Mixed-group table (group rows) and the `ready` / `canceled` status display | Sections 3.3, 4.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| O5  | Window size and narrow-width behaviour                                     | Section 3.7                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| O6  | Settings view, and moving rail edit mode into it                           | Sections 3.2, 5.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| O7  | OUTPUT and FILES settings: Location, Naming, If file exists, Keep metadata | Ship **Location** (next to source / chosen folder, needs M3). Show **If file exists** as a fixed, disabled select reading `add (2)` with the description "Existing files are never overwritten" (the never-overwrite rule makes it the only value). **Defer Naming and Keep metadata** (both need per-tool engine work; metadata stripping differs per tool). Alternative: defer all four and drop the OUTPUT/FILES groups                                                         |
| O8  | Keyboard shortcut set                                                      | Section 4.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| O9  | Preview: draggable wipe, non-image fallbacks                               | Section 4.6                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| O10 | Run scope versus the mockup                                                | The mockup shows one selected row while Options reads `all 6 files` and Run reads `Convert 6 files`, which suggests "selection is only the focus, Run takes the whole batch". The proposal keeps today's rule (Run takes the selection, header `N selected`) and adds: with nothing selected, Run and Options take the whole first group (`all N files`). Alternative: checkboxes alone set the run scope, and a plain click only focuses a row for Preview and Info (section 4.1) |

## 6. Data gaps

### 6.1 Source-to-result link

On a `done` event the reducer appends a separate result item and leaves the source with no link to it.
**Minimal approach, renderer only:** in the `jobEvent` done branch, also write `outputPath` and
`outputSize` onto the source item (the fields already exist on `QueueItem`). `normalizeItem` and the
session snapshot already carry these fields. The result item, Completed and the output menu are
unchanged. `markQueued` already resets `outputPath` on re-run; it also resets `outputSize`. Tests:
`queues.test.ts` gains a case.

### 6.2 Size estimates (per file and batch)

No estimator exists. **Minimal approach:** a pure `estimateOutputBytes(file, tool, options)` in
`src/shared/sizeEstimate.ts`:

1. **Batch extrapolation first.** Once one or more rows with the same group and run options are done in
   this workspace, use their median output/source ratio, applied to `file.size`.
2. **Otherwise a ratio table** keyed by tool, target format and quality preset (for example image
   convert to webp/balanced ≈ 0.22, avif ≈ 0.16; video compress by codec × quality; audio by bitrate ×
   duration is not available, so a bitrate ratio against the source bitrate is used only when the
   probe has it, otherwise none).
3. **Otherwise none**, and the cell stays empty. Resize and Upscale estimate pixels from the existing
   dimension probes × a bytes-per-pixel ratio for the format.

The batch card sums the same function over `runList`. The values are always shown with `~`. The ratio
table starts conservative and lives with its tests; it is the one piece of new tuning in this work.

### 6.3 ETA for non-ffmpeg jobs

Only ffmpeg jobs report `etaSec`. **Minimal approach (M2):** `estimateProgress` already knows
`expectedSec`; it reports `max(0, expectedSec - elapsed)` alongside the percentage through the existing
`onProgress` third argument. Nothing else changes in main. Without M2, those rows show `62%` with no
`(…)`, which is acceptable as a fallback.

### 6.4 Kind, totals, status counts

All derivable in the renderer: kind = `ext.slice(1).toUpperCase()`; totals and status counts are sums
and counts over input rows (4.4). "Converting 3 of 6" in the status bar uses a renderer-only **batch**:
the ids passed to the last `run()` in that workspace (kept in App state, not persisted). It shows
`<verb>ing <done+running> of <batch size>` while any batch item is in flight, and disappears when the
batch settles.

### 6.5 Short error label

Renderer-only `shortError()` (4.3). No engine error codes are introduced.

### 6.6 Output folder and file naming

Section 5, O7, and M3.

## 7. Testing and verification

### 7.1 Unit tests (Vitest, `test/*.test.ts`)

The new pure logic lives in `.ts` files beside the components (react-refresh rule):

- `row-model.test.ts`: `rowView` for every status, including directory outputs, growth percentages and
  unknown estimates; `queueTotals`; `formatEtaCompact`; `kindLabel`; `shortError`.
- `table-sort.test.ts`: sort comparators and the three-click cycle; sorting stays within groups.
- `select-all.test.ts`: the header checkbox none/mixed/all for the active group; never across groups.
- `table-keys.test.ts`, `shell-model.test.ts`, `ui-nav.test.ts`, `info-model.test.ts`, `icons.test.ts`,
  `window-size.test.ts`, `generate-restore.test.ts`: the remaining pure modules (keyboard maps,
  breadcrumb, sidebar collapse, status bar, select popup keys, Preview/Info rows, icon registry).
- `size-estimate.test.ts`: batch extrapolation (median), ratio table fallbacks, "none" cases, batch sum.
- `estimate.test.ts`: extend for the remaining-seconds value (M2).
- `output.test.ts`: extend for `outDir` (M3, only if O7 keeps Location).
- `theme-tokens.test.ts`: every colour token in `tokens.css` has r=g=b. `monochrome-source.test.ts`: no
  non-grey literal in the renderer source outside `tokens.css` (the Remove BG swatch is user data, not a
  literal), and no light-theme utility classes.
- `queues.test.ts`: the done event writes `outputPath`/`outputSize` on the source; ETA reset; clear
  finished; `dismissAny`.
- `group-naming.test.ts`: kept. `GROUP_COLOR` is deleted (no longer used, it was the only coloured group
  data), so its assertion is removed in the same PR.
- `tabs.test.ts`: still pins the seven verbs in rail order; the `IconName` typing change is covered by
  typecheck.

### 7.2 E2E selector updates

There are no `data-testid`s today, and Playwright's `has-text` is case-insensitive, so the lowercase
breadcrumb `convert` would capture `button:has-text("Convert").first()`. The specs move to scoped role
selectors, and the DOM keeps the contracts they need:

| Today                                     | After                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `h1` hasText `<Verb>`                     | The inspector `ihead` title is an `<h1>`; Tools grid, Completed and Settings have their own `<h1>`. Specs keep `h1` |
| `button:has-text("<verb>").first()`       | `page.getByRole('navigation', { name: 'Operations' }).getByRole('button', { name: '<verb>' })`                      |
| `button:has-text("Convert").last()` (Run) | `page.getByTestId('run')`                                                                                           |
| `text=Files`                              | `page.getByRole('grid', { name: 'Files' })` (the table's `aria-label`)                                              |
| `button[aria-label="Back to Tools"]`      | kept: the breadcrumb `tools` segment is a button with that `aria-label`                                             |
| Tools card labels visible                 | kept; labels come from `TOOL_CARDS`                                                                                 |

`window.filesmith.*` contracts used by the engine specs are untouched.

### 7.3 Screenshot comparison

A new `e2e/visual.spec.ts` launches the built app with `FILESMITH_USER_DATA` (M4) pointing at a temp
folder seeded with a session that approximates the mockup's six rows (fixture images generated with the
bundled magick: 2 done, 1 failed, the rest ready). A restored session settles in-flight rows, so the
running row comes from one real slow job started by the spec, and the mockup's two queued rows appear as
ready. It sets the window to 1440×900 and saves `docs/mockups/terminal-v5/shots/impl-10-s2.png` next to
the mockup shot, plus collapsed-sidebar, Preview, Info, empty-queue, Generate, Tools, Completed and
Settings shots. It runs only with `FILESMITH_SHOTS=1`, so a routine e2e run does not rewrite tracked
images. A separate `e2e/ui.spec.ts` (also on a private userData) covers dark and square, sidebar collapse
and persistence, inspector tab keys and the empty workspace.
Comparison with the mockup is a manual side-by-side in the PR (thumbnails and the running state differ,
so a pixel diff is not meaningful). After the owner approves, the shots become `toHaveScreenshot`
baselines for regressions.

### 7.4 PR gate

```
npm test && npm run typecheck && npm run lint && npx prettier --check . && npm run build && npm run test:e2e
```

Then `npm run package`, install the NSIS build locally and launch it (per the global shipping rules and
the always-install-and-open note), check every view by hand at 1440×900 and at the minimum size, with the
keyboard only, and with reduced motion on.

## 8. Out of scope / later

- **Themes** (the token layer makes them possible), including any light theme. Light mode is removed, not
  deferred.
- Naming patterns and Keep metadata (unless O7 says otherwise).
- A real trial-encode size estimator; the ratio table is the v1.
- An in-app media viewer or player.
- New verbs, operations or engine options beyond M1 to M5.
- The app and installer icon (the title bar uses the anvil glyph; the `.ico` stays).
- `toHaveScreenshot` baselines before the owner approves the shots.
- Dead code clean-up beyond what the rewrite deletes anyway (the old viewer CSS, `DropZone`, `Boundary`,
  `OperationTitle`, the media icons go with the files they live in).

## 9. Delivery

- One GitHub issue "Terminal redesign (S2 VS Code grouped)", linking this spec and the mockup.
- One branch `feat/<issue>-terminal-redesign`, one PR, squash-merged after the owner's explicit approval.
- The PR carries everything: the renderer rewrite, M1 to M5, the test updates, the version bump to
  **0.5.0** (minor, a feature), the `CLAUDE.md` update (the renderer is no longer a placeholder; the
  design rules and the token file are pointed to) and the README screenshot refresh.
- The untracked `docs/design/redesign-direction.md` and `docs/mockups/terminal*/` go into the same PR,
  so the design record ships with the code.
- Before asking "merge?": the full gate (7.4), the packaged build installed and launched on this machine,
  and the screenshots attached to the PR.
