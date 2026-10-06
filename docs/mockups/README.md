# Mockups

Only the designs the owner signed off are kept here, with the screenshots the build was checked
against. Open the `.html` files directly in a browser. The design rules and feedback trail are in
[`../design/redesign-direction.md`](../design/redesign-direction.md).

## Kept

| Path                                      | What it is                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `terminal-v5/10-s2-vscode-grouped.html`   | The signed-off app design (2026-10-04): dark, monochrome, files table, right inspector.                                              |
| `terminal-v5/shots/10-s2-vscode-grouped.png` | Screenshot of that mockup.                                                                                                       |
| `terminal-v5/shots/impl-*.png`            | The built app next to the mockup. Written by `e2e/visual.spec.ts`.                                                                  |
| `view-zoom/04-explorer-style.html`        | The chosen view sizes design (2026-10-05). Interactive: Ctrl+wheel, `#size=0..4`, `#menu`.                                          |
| `view-zoom/shots/04-explorer-style-*.png` | Screenshots of that mockup, one per size plus the View menu.                                                                        |
| `view-zoom/shots/impl-*.png`              | The built app at each size. Written by `e2e/visual.spec.ts`.                                                                        |
| `console/01-bottom-panel.html`            | The chosen console design (2026-10-06). Interactive: `#state=closed`, `open-idle`, `running`, `error`, `rejected`, `completion`, `history`. |
| `console/shots/01-bottom-panel-*.png`     | Screenshots of that mockup, one per state.                                                                                          |
| `console/shots/impl-*.png`                | The built console. Written by `e2e/visual.spec.ts`.                                                                                 |
| `generate-empty/*.png`                    | The Generate screen with no model, before and after, plus Settings. `after.png` and `settings.png` are written by `e2e/generate-empty.spec.ts`. |
| `cli-settings-skill.png`                  | Settings with the CLI and Claude skill section. Written by `e2e/skill.spec.ts`.                                                     |

The `impl-*` and spec-written shots are refreshed with `FILESMITH_SHOTS=1 npm run test:e2e` after
`npm run build`.

## Removed rounds

The rejected rounds were removed on 2026-10-06 (issue #25). The last commit that still has all of
them is `cc639ad`. To get one back:

```powershell
git checkout cc639ad -- docs/mockups/terminal-v4
```

| Folder or file                       | What it was                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `claude/` to `claude-v6/`            | File-type navigation concepts and switcher/pill variations (July 2026).         |
| `codex/`                             | Operation placement concepts made with Codex (July 2026).                       |
| `icons/icon-sheet.html`              | An early icon set sheet.                                                        |
| `terminal/`                          | Round 1 of the terminal redesign, 20 mockups. Rejected: too cluttered.          |
| `terminal-v2/`                       | Round 2, 20 mockups. Rejected: too minimal.                                     |
| `terminal-v3/`                       | Round 3, 20 mockups. Too close to Wind's settings page.                         |
| `terminal-v4/`                       | Round 4, 20 IDE-inspired mockups. `10-explorer-details` led to v5.              |
| `terminal-v5/` (all but `10-s2`)     | The v5 variations and their gallery `index.html`.                               |
| `view-zoom/01` to `03`, `index.html` | The other view size options and their gallery.                                  |
| `console/02` to `04`, `index.html`   | The other console options and their gallery.                                    |
| `../design/mockup-*.png`             | Two early mockup images (active convert, empty state) that nothing referenced.  |
