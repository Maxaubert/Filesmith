# Redesign direction (owner feedback, 2026-10-04)

**LOCKED IN (2026-10-04): `docs/mockups/terminal-v5/10-s2-vscode-grouped.html`** is the target design.
Build the renderer to match it. The rest of this file is the feedback trail that led there.

Mockup rounds live in `docs/mockups/terminal*/` (each has an `index.html` gallery and `shots/`).

- **Dark only.** Light mode is being removed. Black or near-black background. Themes come later.
- **Strict monochrome.** Greys only (r=g=b). Errors use a glyph and weight, never red.
- **Round 1** (`terminal/`): rejected. Too cluttered, too much information, too colourful.
- **Round 2** (`terminal-v2/`): better, but too minimal. Wants icons on tabs and controls.
- **Round 3** (`terminal-v3/`): "more the look", but a straight copy of Wind's settings page. Do our own thing.
- **Round 4** (`terminal-v4/`): IDE-inspired (VS Code settings editor, JetBrains settings/tool windows, Zed,
  Xcode). Keep round 3's density, icons everywhere, simple and easy to navigate.
- **Pick from round 4:** `terminal-v4/10-explorer-details` (details table + right inspector). Wanted changes:
  left sidebar collapsible, expanded shows icon + label; no "Drop files here" row (files are added from the
  top). Variations in `terminal-v5/`.
- **Pick from v5:** `terminal-v5/05-e-flush-panels` (flush, square, mono). Controls must clearly read as
  buttons: plain words with an underline or dotted link styling were not obvious enough.
- Running rows: no progress line under the row. Show progress compactly as `62%(4s)`, not "about 4 s left",
  in the status column.
- Result column: the arrow sits on the size/result split. Done = actual result, running = grey `~estimate`,
  queued/failed = empty. The batch estimate shows in the right panel before you press Convert.
- Post-build feedback (2026-10-04): Add files is grey (not white); no white left bars on selected rows or the
  active sidebar item; the active item's count is a plain number, not an inverted box. Add files has no fill,
  like the other toolbar buttons. No white fills anywhere: selected segments, chips, checkboxes and the primary
  button use grey `#2a2a2a` with light text (the `--inv-*` tokens). The Tools tab is "PDF Tools", with no
  divider line above it.
- Files toolbar is only Add files + count. Row actions live in a right-click menu (Open, Show in File
  Explorer, Retry, Stop, Clear finished, Remove from list, Delete); destructive ones confirm first. While work
  runs, the run button becomes a red Stop (`--stop-*`, the app's one hue). Preview/Info show nothing for a
  multi-selection ("Select one file to preview").
- Wind is a reference, not a template. Avoid its signatures: the floating progress+button pill, the icon-tile
  header band, and big rounded cards of right-aligned setting rows.
- View sizes (2026-10-05): the files view has Explorer-style sizes (Details, Tiles, Medium / Large / Extra
  large icons), Ctrl+wheel and a View menu. Chosen: `docs/mockups/view-zoom/04-explorer-style.html`; spec
  `docs/superpowers/specs/2026-10-05-view-sizes-design.md`.
