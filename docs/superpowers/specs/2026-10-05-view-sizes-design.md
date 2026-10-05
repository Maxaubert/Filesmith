# View sizes ("Explorer style") – design

Date: 2026-10-05
Status: approved (owner chose concept 04 and approved "spec and plan, then implement" without a further sign-off)
Issue: #36, branch `feat/36-view-sizes`

Target: `docs/mockups/view-zoom/04-explorer-style.html` (interactive: Ctrl+wheel, `#size=0..4`, `#menu`),
screenshots `docs/mockups/view-zoom/shots/04-explorer-style-size0..4.png` and `-menu.png`. The design rules
in `docs/design/redesign-direction.md` still hold: dark only, strict monochrome (r=g=b, the `--stop-*` red is
the one exception), square, flush, IBM Plex Sans + Mono, no em-dashes.

## 1. Goal and scope

The files view (the queue of Convert, Compress, Resize, Upscale, Remove BG and the PDF tool cards) gets six
view sizes, named like Windows File Explorer (Large details added 2026-10-05 at the owner's request: "two list
stages, one with slightly bigger rows"):

| #   | Id        | Label             | Layout                                                                    |
| --- | --------- | ----------------- | ------------------------------------------------------------------------- |
| 1   | `details`   | Details           | today's table: head, columns, 32px rows, 18px thumb (unchanged)         |
| 2   | `details-l` | Large details     | the same table with 44px rows, a 32px thumb and 14px names (else equal) |
| 3   | `tiles`     | Tiles             | two columns of 64px two-line tiles with a 48px thumb                    |
| 4   | `medium`    | Medium icons      | grid of 132px cards: square thumb, name (2 lines), compact status line  |
| 5   | `large`     | Large icons       | grid of 196px cards; status line adds the change % / estimate / size    |
| 6   | `xl`        | Extra large icons | grid of 274px cards; status line adds the source size for done rows     |

Behaviour stays the same in every size. Only the layout of the rows changes. Completed, Generate, Tools and
Settings are not part of this work.

## 2. Switching sizes

- **Ctrl+wheel over the files view** (the `.qtable` section: list, head, totals) steps one size per notch.
  Wheel up = bigger, like Explorer. Trackpad deltas accumulate: a step fires once the accumulated delta reaches
  40px, at most one step per 90ms, and an accumulation older than 250ms is dropped. `deltaMode` 1 (lines) is
  scaled by 40. Ctrl+wheel anywhere else (inspector, sidebar) does nothing special; Electron does not zoom the
  page on Ctrl+wheel, and the files view listener is the only one that calls `preventDefault`.
- **Keyboard**, whenever the files view is shown: `Ctrl+=` / `Ctrl++` (also numpad +, and Ctrl+Shift+= ) =
  bigger, `Ctrl+-` (also numpad -) = smaller, `Ctrl+0` = reset to Details, `Ctrl+Shift+1..6` jump to a size.
  Digits are matched on `KeyboardEvent.code` (`Digit1..6`) so Nordic layouts, where Shift+1 is `!`, work.
  The handler calls `preventDefault`, which also keeps Electron's default menu zoom accelerators
  (zoomIn / zoomOut / resetZoom) from zooming the whole page; e2e asserts the zoom factor stays 1.
- **View menu button** at the right end of the files toolbar, after the count: view glyph, current label
  (min-width 96px so the toolbar does not jump), chevron. `aria-haspopup="menu"`, `aria-expanded`,
  `title="View (Ctrl+wheel to resize)"`. It flashes `--inv-bg` for 450ms when the size changes by wheel or key
  (no flash under reduced motion). Its menu (anchored under the button, right-aligned, `.menu` styling,
  min-width 272px) lists the six sizes as `menuitemradio` with a tick, the size glyph, label and
  `Ctrl+Shift+N`; a separator; `Reset to Details  Ctrl+0`; a separator; two hint lines
  (`Ctrl + wheel over the list`, `Bigger, smaller  Ctrl+= / Ctrl+-`). Focus lands on the checked entry; arrows
  walk the entries, Home/End jump, Enter/Space/click picks and closes, Escape or an outside click closes and
  focus returns to the button.
- Clamped at both ends: stepping past Details or Extra large icons does nothing (no flash, no announcement).
- A polite live region announces `View: <label>` on every change.
- **Motion:** a 150ms fade of the list body (`opacity .25 -> 1`, `cubic-bezier(.2,.7,.2,1)`) through the Web
  Animations API. No view transition (it would fight React's rendering). Under
  `prefers-reduced-motion: reduce` there is no fade, no flash and no checkbox fade on cards.

## 3. Persistence

One value per app (not per workspace), like the sidebar: `localStorage['filesmith.viewSize']` holds the size
id. Unknown or missing values read as `details`; storage errors are swallowed (the size still works for the
session). An e2e run with a private `FILESMITH_USER_DATA` starts from a fresh store.

## 4. What every size keeps

- **Selection**: click, Shift+click range, Ctrl+click toggle, the checkbox, Ctrl+A (selects the active group),
  group header buttons (select the whole group), and the one-convert-group rule (the reducer, unchanged).
  Rows from another group than the selection stay dimmed (`.dim`). The header select-all checkbox lives in the
  Details head only; in the other sizes the group headers and Ctrl+A do that job. Sorting is set from the
  Details head and is kept (the grids show the current sort order).
- **Right-click menu** and Shift+F10 / the ContextMenu key: same `rowMenuModel`, same targets.
- **Double-click and Enter** open the file; **Delete** asks to remove; **Space** toggles.
- **Keyboard navigation**: one roving tab stop. Details: Up/Down (unchanged). Tiles and icon grids:
  Left/Right walk the visual order, Up/Down move one visual row (same column) and cross into the previous or
  next group at the nearest column; a short last row is reachable (Down from a row above it lands on the last
  item). Shift+arrow extends the range. The column count is read from the rendered grid.
- **Group headers** (one per convert group when the queue holds more than one): a full-width header row above
  each group's tiles or cards, as in Details.
- **States**: running `62%(4s)` with the sync glyph; done result size (bold) with change %; queued; failed as
  the inverted pill (`Failed` on Medium icons, the short error on Large and up, full error in `title`);
  canceled. Tiles line 2: source size, the result (arrow, size, %) unless queued, status at the right; a failed
  tile shows only the pill. Card status line per size:

| State    | Medium            | Large                         | Extra large                         |
| -------- | ----------------- | ----------------------------- | ----------------------------------- |
| done     | check, **result** | check, **result**, %          | check, **result**, %, source size   |
| running  | sync, **62%**(4s) | sync, **62%**(4s), ~estimate  | same as Large                       |
| queued   | clock, Queued     | clock, Queued, source size    | same as Large                       |
| failed   | warning, Failed   | warning, short error          | same as Large                       |
| canceled | close, Canceled   | close, Canceled, source size  | same as Large                       |
| ready    | source size (fg3) | source size (fg3)             | source size (fg3)                   |

- **Row action button** (ghost Retry / Cancel / Show in folder) stays in Details only; in the other sizes those
  actions are in the right-click menu, as the mockup draws them.
- **Totals**: Details keeps the column-aligned totals row; other sizes show a flat line
  (`9 files, 194 MB   163 MB -> 33 MB so far   4 of 9 done`).
- **Empty state and drop**: unchanged in every size (the whole window accepts drops).
- **Accessibility**: the section stays `role="grid"`, each tile or card is `role="row"` with `aria-selected`,
  so the existing row locators and screen reader semantics carry over. Checkboxes in cards are visible on
  hover, focus-within, selection, or when any row is selected.

## 5. Thumbnails

The renderer requests a 128px thumbnail per item (`window.filesmith.thumbnail(path, 128, kind)`; main
`thumbnail.ts`: OS shell first, then magick / ffmpeg). Bigger sizes ask for a bigger one, sized to the
screen (revised 2026-10-05: the owner's 4K screen at 225% made the old fixed 256px look pixelated):

- `thumbPxFor(size, devicePixelRatio)` (`queue/thumbSize.ts`) returns the smallest bucket of
  128 / 256 / 512 / 768 / 1024 that covers the size's thumb width (Details 18, Large details 32, Tiles 48,
  cards their `--cw` 132 / 196 / 274) times the DPR. At DPR 1: 128, 128, 128, 256, 256, 512. At DPR 2.25:
  128, 128, 128, 512, 512, 768.
- Above 128 the request is lazy, only for the current queue's items while that size is shown, once per
  `${path}@${px}`, cached in renderer memory (never persisted). The best one on hand is shown meanwhile: the
  wanted bucket, else a bigger cached one (stepping back down asks for nothing), else a smaller one, else the
  128px one. A failure keeps what is shown.
- The DPR is watched (`useDevicePixelRatio`: a `(resolution: Ndppx)` media query plus resize), so moving the
  window to another monitor recomputes the bucket.
- Main: the Windows shell provider often caps at 256px whatever is asked. When an OS result's longer side is
  more than 2px under a request above 128 (`osTooSmall`), images, video and audio also go through the tool
  path (magick `-thumbnail NxN>`, an ffmpeg frame or cover art scaled with `min(N,iw)`), and the bigger of the
  two wins. Neither path upscales beyond the source. All of it stays under the 3-slot limiter.
- Card images use `object-fit: cover` and default (smooth) image rendering.

Without a thumbnail, cards show the kind's glyph (image, video, audio, pdf, doc, archive) centred in a
`--line-strong` frame. Cards at Medium and up show the kind tag (`PNG`) at the bottom right of the thumb;
video thumbs get a centred play glyph.

## 6. Changes by file

| Area      | Change                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------- |
| renderer  | `queue/viewSize.ts` (model, keys, wheel), `queue/gridKeys.ts`, `queue/cardModel.ts` (pure, tested)          |
| renderer  | `queue/useViewSize.ts` (persisted hook), `queue/ViewMenu.tsx`, `queue/QueueTile.tsx`, `queue/QueueCard.tsx`, `queue/Thumb.tsx` |
| renderer  | `QueueTable` (size switch, wheel, keyboard grid nav, fade), `QueueToolbar` (menu slot), `TotalsRow` (flat), `StatusCell` / `ResultCell` (extract inline parts), `tableKeys` (Left/Right) |
| renderer  | `theme/viewsizes.css` (new, imported from `index.css`), 7 new icons (`view-details`, `view-details-l`, `view-tiles`, `view-medium`, `view-large`, `view-xl`, `mouse`) |
| renderer  | `queue/thumbSize.ts` (bucket per size and DPR, cache lookup, pure, tested), `queue/useDevicePixelRatio.ts` |
| App       | `useViewSize`, keyboard shortcuts, DPR-sized thumbnail requests                                            |
| main      | `thumbnail.ts`: fall back to magick / ffmpeg when the OS thumbnail is smaller than a big request           |
| e2e       | new `e2e/viewsizes.spec.ts`; `ui.spec.ts` toolbar test also expects the View button; `visual.spec.ts` captures `docs/mockups/view-zoom/shots/impl-size0..5.png` and `impl-menu.png` (opt-in, `FILESMITH_SHOTS=1`) |
| version   | 0.6.0 -> **0.7.0** (minor: a feature)                                                                     |

## 7. Testing

- Vitest: view-size model (order, step, clamp, parse, key mapping incl. Nordic and numpad, wheel
  accumulation), grid neighbour navigation (columns, short last row, group crossing), card line per state and
  size, `tableKey` Left/Right, icon registry, no em-dash scan of the new files.
- Playwright (`npm run build` first): Ctrl+wheel over the list changes the size and Ctrl+wheel over the
  inspector does not; the View menu lists six sizes and picks one; Ctrl+Shift+3 / Ctrl+0 / Ctrl+= / Ctrl+-;
  the page zoom factor stays 1; the size survives a reload; selection, Shift+click and right-click work on
  cards; arrow keys move focus in a grid.
- Gate: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`.

## 8. Out of scope

Per-workspace sizes, a free zoom slider, column resizing or hiding in Details, view sizes for Completed,
virtualised rendering (queues are small enough today), persisting larger thumbnails.
