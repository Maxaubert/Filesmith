# In-app console ("Bottom panel") – design

Date: 2026-10-06
Status: draft for the owner's single approval (spec and plan together)
Issue: #39, branch `feat/39-console`, one PR, version 0.7.0 -> **0.8.0**

Target: `docs/mockups/console/01-bottom-panel.html` (interactive: `#state=closed | open-idle | running | error |
rejected | completion | history`), screenshots `docs/mockups/console/shots/01-bottom-panel-*.png`. The owner
picked concept 01 ("option 1"). The design rules in `docs/design/redesign-direction.md` still hold: dark only,
strict monochrome (r=g=b; the `--stop-*` red is the one hue and is used only for Stop), square, flush,
IBM Plex Sans + Mono, no em-dashes.

**Base:** this branch builds on `main` after PR #42 (`fix/41-view-menu`) is merged and is rebased onto it. That
PR already ships the View menu change from the same owner message: three entries (Details, Tiles, Extra large
icons) as plain text rows with a check mark on the current one, Ctrl+Shift+1..6 removed, Ctrl+wheel stepping
all six sizes, and Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 still changing the size. The console does not touch the
View menu; it only keeps those size keys from firing while the user types (section 4).

## 1. Goal and scope

A **limited** console inside the app: a VS Code style panel under the center column that runs `filesmith`
commands (the CLI from #30, `docs/cli.md`) without leaving the app, and nothing else.

In scope:

- A bottom panel in the center column, on every tab, toggled by a **Console** button in the bottom strip and
  by **Ctrl+`** anywhere; resizable; open state, height and history persisted.
- Commands are typed **without** the `filesmith` prefix (a pasted leading `filesmith` is stripped). Only CLI
  commands and four built-ins (`cd`, `clear`/`cls`, `help`, `history`) run. Anything else is refused in one
  line with an inline **Open in terminal** action (the only place it appears).
- **Open in terminal** starts the real Windows terminal (Windows Terminal if installed, else PowerShell) in the
  console's folder with `filesmith` on PATH.
- Live progress, a red **Stop** (and Ctrl+C) while a command runs, Up/Down history, Tab completion of commands,
  sub-commands, flags, values and file names, **Show in File Explorer** under finished runs.
- Console runs never join the app's queue; their output stays in the console.

Out of scope: a general shell, pipes or redirection, several console sessions or tabs, running two console
commands at once, `-` (file names from stdin), colour output, saving scrollback across restarts, a console
toggle in the heads of Completed, Settings, Tools and Generate (Ctrl+` works there; see 11, Q1). Any change to the View menu (done in PR #42).

## 2. Layout

- **Mount point:** the last child of `<main className="center">` in `App.tsx`, after the view ternary. It is
  therefore under the files view on the queue tabs and under Completed, Settings, Tools and Generate on theirs.
  The inspector is a sibling of `<main>`, so it keeps its full height on the right (mockup shot
  `01-bottom-panel-running.png`). On tabs without the inspector the panel spans to the right edge.
- **Grid:** `.center` is `32px minmax(0,1fr) 30px` (the last row is the bottom strip); with the panel open it
  becomes `32px minmax(0,1fr) var(--ch)`: the strip is hidden and the panel takes the bottom row, flush with
  the window bottom (class `con-open` on `.center`, `--ch` set inline on `.center`, not on `:root`).
- **One instance:** the panel stays mounted while closed (`display:none`), so scrollback and a running command
  survive a close and every tab switch.
- **Panel:** `section.console` (`aria-label="Console"`, `id="console"`), rows `28px minmax(0,1fr)`,
  `border-top: 1px solid var(--line-strong)`, `--bg-0`. CSS copied from the mockup (`.console`, `.sash`,
  `.chead`, `.hib`, `.stopbtn`, `.cbody`, `.ln`, `.blk`, `.cmd`, `.pline`, `.comp`) into a new
  `theme/console.css`.
- **Head (owner feedback 2026-10-06, "just an open and close, keep it simple"):** a slim 28px row, right-aligned:
  the red **Stop** (only while a command runs) and an icon-only close X (`aria-label="Close console"`).
  Nothing else: no label, folder button, note, Open in terminal or Clear. The folder shows in the prompt and
  changes with `cd`; `clear`/`cls` and Ctrl+L clear.
- **Body:** scrollback then the prompt line. The body scrolls (`.scroll-thin`), the output is selectable
  (`.select-text`; `body` is `user-select:none`).

## 3. Open, close, resize

- **Toggle (owner feedback on 0.8.0):** the files list has no totals row any more. In its place, at the bottom
  of the centre column on every tab, a 30px strip (`.constrip`, `role="toolbar"`, `Console strip`) holds only
  the `Console` button: console glyph, `Console`, `Ctrl+`` hint in `--fg3`; `aria-pressed`,
  `aria-controls="console"`. The strip shows only while the panel is closed, flush with the window bottom;
  open, it is hidden (kept mounted) and the panel takes its place at the window bottom. The files toolbar is
  Add files and View. While a command runs and the panel is closed, the button shows the live
  percentage (`.live`).
- **Ctrl+`** toggles everywhere except under an open modal (`dialog[open]`). It is matched on
  `KeyboardEvent.code === 'Backquote'`, because on Nordic layouts the key is a dead key and `e.key` is
  unreliable.
- **Focus:** opening focuses the prompt, or the body while a command runs. Closing returns focus to the element
  that had it before opening (the Console button, shown again, when it was used). **Esc** in the panel first
  closes the completion list, then moves focus back to the files view without closing the panel
  (VS Code behaviour). The panel closes only by Ctrl+` or the close X.
- **Resize:** a 7px sash on the top edge (`role="separator"`, `aria-orientation="horizontal"`,
  `aria-label="Resize console"`, `tabindex=0`, `aria-valuenow/min/max`), a 2px `--fg3` line on hover or drag,
  `cursor: row-resize`. Pointer events with `setPointerCapture`; during the drag `--ch` is written straight to
  the element (no React re-render); the height is committed and stored on pointer up. ArrowUp / ArrowDown on
  the focused sash resize by 20px.
- **Clamp:** `min 120px`, `max = centerHeight - 32 - 120` (the files view keeps at least 120px), re-clamped on
  window resize. Default 280px.

## 4. The prompt

- `D:\Photos\Trip> filesmith ` (folder and fixed prefix in `--fg3`) then the input (mono 12px, 500,
  `--fg1`), placeholder `convert *.heic --to webp` while the scrollback is empty, and at the right the key
  hints `Tab complete` and `Up Down history`.
- **Enter** runs the line. Empty lines do nothing. A non-empty line is pushed onto history first.
- While a command runs, the input is replaced by `Running. Ctrl+C or Stop cancels it; the app's queue keeps
  working.` (mockup `.pline.wait`). Typing ahead is not supported (one command at a time).
- **Ctrl+C** in the panel: while a command runs and no text is selected, cancels it; with a selection, copies;
  idle with text in the input, clears the input (terminal behaviour). **Ctrl+L** clears the scrollback.
- **Ctrl+Enter** inside the panel does nothing (the app's Run shortcut is skipped while focus is in the panel).
- **View-size keys while typing:** while focus is in the console input, or in any other text input or
  textarea, Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 do **not** change the files view size. They still call
  `preventDefault`, so Electron's default menu zoom accelerators do not zoom the page; only the size change is
  skipped. A pure helper `isTextEntryTarget(el)` (text-like `<input>`, `<textarea>`, contenteditable; not
  checkboxes, radios, buttons, ranges) decides. **Ctrl+wheel** over the console panel does not change the view
  size either (the size listener stays on the files section; the panel swallows Ctrl+wheel so the page does
  not zoom).

## 5. Folder

- Every command runs in the console's folder (its working directory), shown in the prompt.
- **Default:** the last console folder (`localStorage['filesmith.console.cwd']`) if it still exists, else the
  Downloads folder, else the home folder. Main checks existence (`consoleDir`).
- No folder menu (removed 2026-10-06 with the head buttons): the folder changes only with `cd`, which prints a
  note `Folder is now <path>.`
- **`cd`** (built-in): `cd <path>` resolves against the console folder (relative, `..`, quoted, `~`, a bare
  drive `D:`, absolute) in main and refuses in one line when it is not a folder
  (`cd: D:\Nope is not a folder.`); `cd` alone prints the folder; `cd -` returns to the previous one. It changes
  only the console's folder, never the app's.

## 6. Built-ins and rejected commands

| Line                        | Result                                                                          |
| --------------------------- | ------------------------------------------------------------------------------- |
| `clear`, `cls`, Ctrl+L      | empties the scrollback                                                          |
| `help`                      | the console help (mockup lines 685-693), then `Add --help to a command for its options. Other programs: Open in terminal.` |
| `history`                   | numbered past lines, oldest first                                               |
| `cd ...`                    | section 5                                                                       |
| `<command> --help`, `help <command>` | passed to the CLI (its own help text)                                  |
| a CLI command               | runs (section 7)                                                                |
| a line with `-` as an input | refused: `Reading file names from stdin is not available here. Use Open in terminal.` |
| anything else               | refused (below)                                                                 |

The CLI commands are the first words of the catalog (`convert`, `compress`, `resize`, `upscale`, `removebg`,
`generate`, `pdf`, `formats`, `doctor`, `setup`, `skill`) and the aliases `remove-bg` and `remove-background`,
optionally after the CLI's global flags (`--json`, `--dry-run`, `--version`, `--help`, `-h`; the flags alone
run too). Case-insensitive. A pasted prefix `filesmith`, `filesmith.exe` or `filesmith.cmd` is stripped once;
after a prefix the built-ins do not apply (`filesmith cd ..` is refused, `filesmith help x` goes to the CLI),
and a bare `filesmith` prints the CLI's help.

**Refusal** (mockup `01-bottom-panel-rejected.png`): the echoed command with `not run` at the right, then one
line: info glyph, `` `del` is not a filesmith command. This console only runs filesmith; use a terminal for
anything else. `` and a small **Open in terminal** button. Nothing is started. The check runs in the renderer
for the message and again in main before anything is spawned (section 9).

## 7. Output

Each command is a block: the echo line (`D:\Photos\Trip> filesmith <line>`), its output, and a status at the
right of the echo line (`running`, then `exit 0  3.3 s` with a check, or `exit 1` / `exit 2` / `exit 130` bold
with a warning glyph, or `not run`).

- **Text:** what the CLI prints in human mode, line by line, exactly as in a terminal (the reporter sees pipes,
  so no colour and no carriage-return redraws). Lines are styled by their start, never re-worded:
  `ok`, `skip`, `fail`, `stop`, `plan` result rows (fail rows `--fg1` bold, skip rows `--fg3`),
  `hint:` / `fix:` sub-lines, the `N files: ...` summary, `filesmith: ...` errors (bold), the rest `--fg2`.
  stderr lines render like stdout lines (the CLI already prefixes errors).
- **Progress:** one live row below the results while a job runs, drawn from the CLI's events, not its text:
  `[2/4]  screenshot_01.png 62%(4s)` and a 120px 2px bar (`--track` / `--fg1`). Steps (`setup`, `generate`
  downloads) show `step 41%(12s)` the same way; heartbeats show the step and the elapsed time. The row goes
  away when the job ends. The strip's Console button shows the same percentage while the panel is closed.
- **Show in File Explorer:** after the summary of a finished run that produced at least one output, a small
  button. It selects the first output in Explorer (`shell.showItemInFolder`). Outputs come from the CLI's `done`
  events (`output`), so they are full paths even though the text rows show base names. Right-clicking a result
  row (`ok`) offers `Show in File Explorer` and `Open in default app` for that row's output (the existing
  `ContextMenu`).
- **Scrollback:** kept in memory, capped at 5,000 lines (oldest whole blocks dropped first); it stays across
  close and tab switches, not across restarts. The body follows the output while it is scrolled to the bottom
  and stays put when the user scrolled up.
- **User `--json`:** the NDJSON lines are shown as they come (the CLI writes them to stdout); progress still
  comes from the event channel.

## 8. History and completion

- **History:** Up / Down walk past lines (the draft is kept and restored past the newest), only when the
  completion list is closed. The last 100 distinct-in-a-row lines are stored in
  `localStorage['filesmith.console.history']`.
- **Completion** (mockup `01-bottom-panel-completion.png`): Tab opens a list above the caret, or inserts at once
  when there is exactly one candidate. Tab / Shift+Tab or Up / Down move, Enter or a click inserts, Esc closes;
  typing refilters while it is open. Up to eight rows: the value (matched prefix bold `--fg1`) and a short
  description in `--fg3`; a footer with the keys. Group title per context:
  - first word: `COMMANDS` (every CLI command and the built-ins, with their one-line summary);
  - after `pdf` / `skill`: `PDF TOOLS` / `SKILL` sub-commands;
  - a word starting with `-`: `<COMMAND> OPTIONS` (the command's flags with their help, aliases match too,
    flags already on the line are left out, plus the global `--json`, `--dry-run`, `--help`);
  - after a flag with values (`enum`, `format`, `enumOrInt`, `bool` is never followed): its values
    (`TO`, `QUALITY`, ...);
  - otherwise for a file-taking command or a `path` flag: `FILES IN <FOLDER>` (names and sizes of the matching
    entries in the console folder or in the typed sub-folder, folders first with a trailing `\`).
- All command data comes from the CLI's own catalog (`src/cli/catalog.ts`), sent once to the renderer as a slim
  copy, so completion cannot drift from the CLI.

## 9. Architecture

### 9.1 How a command runs

Each command is a **separate child process**: the same `out/main/cli.js` the `filesmith` shims run, started by
the main process with `child_process.fork` and Electron as Node:

```
fork(join(__dirname, 'cli.js'), argv, {
  execPath: process.execPath, execArgv: ['--use-system-ca'], cwd: folder,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_USE_ENV_PROXY: '1' },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
```

`__dirname` of the main bundle is `out/main` in dev and `app.asar/out/main` packaged, next to `cli.js`; Electron
in Node mode reads asar, as the shims already rely on.

Not in-process, because the engine's state is process-wide: the engine env (`host: 'app'` vs `'cli'`, which
decides the `Run: filesmith setup X` hints), the tool registry `killAllToolsSync` kills (it would kill the app's
queue jobs), the atomic-output set, the ComfyUI and sidecar shutdown in `generate`'s `finally`, and the
pid-keyed install locks. A child behaves exactly like the external CLI, which the app already arbitrates with
(locks, `comfy-live.json`), and an engine crash cannot take the app down.

### 9.2 The event channel

The CLI keeps its human output on stdout/stderr and, when it has an IPC channel, **also** sends its NDJSON
events over it:

- `CliIO` gets an optional `events?: Out`. `main()` then reports through a `TeeReporter` (human + `JsonReporter`
  on `events`). In `--json` mode stdout already carries the events, so nothing is teed.
- `bootstrap.ts` sets `events` only when `process.send` exists, writing each NDJSON line as one IPC message.
- Main splits stdout and stderr into lines (a pure line splitter, flushed on exit), parses event messages, and
  sends `console:event` messages `{ id, kind: 'out' | 'err', text }`, `{ id, kind: 'event', ev }` and
  `{ id, kind: 'exit', code }` to the window that started the run. `console:run` resolves with the exit code.

### 9.3 Cancellation

- Stop or Ctrl+C sends `console:cancel(id)`. Main sends the child the IPC message `'interrupt'`; `bootstrap.ts`
  treats it like Ctrl+C in a terminal (its existing `interrupt()`): the jobs are canceled, part files removed,
  `canceled` rows printed, exit **130**. Stop stays visible and turns into `Stopping...`.
- A second Stop sends `'interrupt'` again: the CLI's own second-Ctrl+C path kills its tools, discards outputs
  and exits 130 at once. If the child is still alive 5 s later, main runs `taskkill /PID <pid> /T /F`; the CLI's
  watchdog (armed because `process.versions.electron` is set) cleans up what is left.
- The child also interrupts itself when its IPC channel disconnects (the app crashed or quit).
- App quit (`before-quit`) interrupts every console child, then kills any still alive after 2 s.
- `bootstrap.ts` disconnects its IPC channel when `main()` returns and every event send has been flushed (an
  early disconnect can drop the last `summary`), so the child exits promptly.
- A run ended by the tree kill reports `exit 130`, not taskkill's exit code 1.

### 9.4 Concurrency

- **One console command at a time.** The prompt waits (section 4). Recommended because the output is one stream
  and a second run would interleave blocks.
- **With the app's queue:** fully independent. Console jobs run on the CLI's own `JobQueue` in its own process
  and never appear in the app's queue, Completed or session. The per-queue GPU limit (`TOOL_LIMIT`) is per
  process, so an app upscale and a console upscale can load the GPU twice; this is the same as the external CLI
  today (`doctor` warns about it). A console `generate` reuses a ComfyUI the app started (`comfy-live.json`).

### 9.5 IPC surface (additive)

| Preload                                                                    | Main                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------- |
| `consoleCatalog(): Promise<ConsoleCatalog>`                                | `console:catalog` (handle; built once from `COMMANDS`) |
| `consoleRun(id, line, cwd): Promise<ConsoleRunResult>`                     | `console:run` (handle; validates, forks, streams)    |
| `consoleCancel(id): void`                                                  | `console:cancel` (on; interrupt, then kill)          |
| `onConsoleEvent(cb): () => void`                                           | pushes `console:event`                              |
| `consoleDir(path): Promise<string \| null>`                                | `console:dir` (the folder if it exists, else null)   |
| `consoleDefaultDir(): Promise<string>`                                     | `console:default-dir` (Downloads, else home)         |
| `consoleCd(base, arg): Promise<{ ok: true; dir: string } \| { ok: false; error: string }>` | `console:cd`                        |
| `consoleList(dir, prefix): Promise<ConsoleEntry[]>`                        | `console:list` (names for completion, max 200)       |
| `consoleOpenTerminal(cwd): Promise<{ ok: boolean; error?: string }>`       | `console:terminal`                                  |
| `reveal(path)` (exists)                                                    | `reveal` handler **restored** (it was dropped in #21, so every Show in folder in the app is broken today) |

Types live once in `src/shared/console.ts`.

### 9.6 Open in terminal

- **PATH:** packaged, `join(process.resourcesPath, 'cli')` (the folder the installer puts on the user PATH;
  prepended anyway because the installer's change only reaches terminals started after it). Dev: main writes a
  shim `userData/dev-cli/filesmith.cmd` that runs `"<execPath>" "<appPath>\out\main\cli.js" %*` with
  `ELECTRON_RUN_AS_NODE=1` (a `%` in either path doubled, since cmd expands it inside quotes), and prepends
  that folder.
- **PATH is set inside the shell**, not through the spawn env (a running Windows Terminal ignores the caller's
  env for a new window): PowerShell `-NoExit -NoLogo -EncodedCommand <base64 UTF-16LE of
  $env:Path = '<dir>;' + $env:Path>`.
- **Windows Terminal:** `wt.exe -w new -d <folder> powershell.exe -NoExit -NoLogo -EncodedCommand <b64>`
  (`;` in the folder escaped as `\;`), detached. When `wt.exe` fails to start (ENOENT), fall back to
  `powershell.exe` with `cwd` = the folder, detached, its own window.
- The console prints a note: `Opened a terminal in <folder>. filesmith is on its PATH.` or the error.

### 9.7 Files

| Area     | Files                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------- |
| shared   | `console.ts` (types), `consoleLine.ts` (tokenize, classify), `consoleComplete.ts` (completion)       |
| cli      | `io.ts` (`events?`), `events.ts` (`TeeReporter`), `main.ts` (tee), `bootstrap.ts` (IPC interrupt, disconnect, events) |
| main     | `console/catalog.ts`, `console/lines.ts`, `console/runCli.ts`, `console/dirs.ts`, `console/validate.ts`, `console/terminal.ts`, `console/ipc.ts`; `ipc.ts` (`reveal`), `index.ts` (register, quit) |
| preload  | `index.ts` (the methods above)                                                                      |
| renderer | `components/console/{consoleModel.ts, consoleHeight.ts, useConsolePanel.ts, ConsolePanel.tsx, ConsoleOutput.tsx, CompletionList.tsx}`, `theme/console.css`, icons `console`, `external`, `ConsoleStrip.tsx` (the bottom strip, hidden while open), `shortcuts.ts` (Ctrl+`, `inConsole`, `isTextEntryTarget`), `App.tsx` (mount, keys) |
| docs     | `docs/cli.md` (a Console section), `CLAUDE.md` (layout lines), this spec and the plan                |

## 10. Security

- **Only filesmith:** main re-checks every line with the same pure `classifyLine` before forking; a line whose
  first word (after the optional prefix and global flags) is not a catalog command or alias is refused in main
  even if the renderer was bypassed. Main takes the raw line, never an argv from the renderer, and refuses
  any IPC argument that is not a plain string (id: `[\w-]{1,64}`). The program run is always
  `process.execPath` with the fixed `cli.js`; the renderer never names a program. Program names, paths,
  `.exe`/`.cmd` words, operators and an empty first word are all refused (a table of such lines is a test).
- **What the CLI itself can start:** the console exposes exactly the CLI's surface, nothing more. The CLI
  starts only its bundled or downloaded tools; `setup comfy --folder` records a ComfyUI folder that
  `generate` later starts, exactly as the Settings tab does.
- **No console takeover:** a forked CLI has an IPC channel and therefore skips `watchConsoleCtrlC`, so it never
  puts a terminal the app was launched from into raw mode.
- **No shell:** `fork` with an argument array, no `shell: true`, no `cmd /c`. `&`, `|`, `>`, `%VAR%`, `$(...)`
  are ordinary characters inside arguments. Globs are expanded by the CLI itself (`inputs.ts`).
- **No env injection:** the renderer cannot pass environment variables; the child gets the app's environment
  plus the two fixed variables. The CLI deletes `ELECTRON_RUN_AS_NODE` before starting tools, as today.
- **Folder:** `cwd` must be an absolute path to an existing directory, checked in main.
- **Never overwrite:** unchanged, the CLI's own collision-safe output rules apply.
- **Open in terminal:** the folder is the only input; it is passed as an argument (`-d`) or `cwd`, and the
  encoded script contains only the CLI folder chosen by main, single quotes doubled.
- **Limits:** a line is capped at 8,000 characters; one run per window at a time (main refuses a second id).

## 11. Open questions for the owner (with recommended answers)

1. **Console button only in the files toolbar?** Superseded: it lives in the bottom strip on every tab, plus Ctrl+` everywhere and the panel's own
   close button; the other tabs' heads stay as they are (no new design there). Once opened, the panel stays
   open across tabs.
2. **One command at a time?** Recommended: yes (9.4).
3. **Default folder?** Recommended: the last console folder, else Downloads (5).
4. **Scrollback across restarts?** Recommended: no; history yes (100 lines).

## 12. Testing

- **Vitest (pure):** tokenizer (quotes, Windows paths with trailing `\`, empty quotes, unclosed quote), line
  classification (prefix strip, aliases, built-ins, refusal, `-` refusal, case), completion (each context,
  aliases, used flags, values, files), catalog builder (every command present, globals), `TeeReporter` and
  `main()` with `io.events` (events and human text both written), line splitter (CRLF, partial chunks,
  flush), cancel stages of the runner with a fake child (interrupt, second interrupt, kill after 5 s, exit),
  `resolveCd` (relative, `..`, `~`, `D:`, quoted, `-`), terminal launch arguments (WT, fallback, `;` escaping,
  encoded command), console model (blocks, line styling, progress row, exit status, scrollback cap, history
  ring and draft), height clamp, `shortcutFor` Ctrl+` by code, preload/main channel parity,
  icons, `isTextEntryTarget` (text inputs, textarea, contenteditable yes; checkbox, button, null no), no em-dash and monochrome scans of the new files.
- **Playwright** (`npm run build` first): Ctrl+`, the strip button and the close X open and close the panel
  and it survives a tab switch; open, the strip is hidden and the panel is flush with the window bottom; the
  head holds only the close X (plus Stop while running); `clear` and Ctrl+L empty the scrollback; a real `convert` of a fixture PNG to webp in a temp folder shows `ok`, the summary and Show in File
  Explorer, and does not add a row to the queue; `del *.*` is refused with Open in terminal on the refusal line (never in the head); Tab completes
  `conv` to `convert` and lists `--to` values; Up recalls the last line; a long `upscale`-free run (a 40-file
  convert) is stopped with Stop and ends `exit 130`; `cd ..` changes the prompt; the sash drag changes the
  height; with focus in the console prompt Ctrl+= / Ctrl+- / Ctrl+0 leave the files view size unchanged and
  the zoom factor stays 1, Ctrl+wheel over the panel leaves the size unchanged, and Ctrl+= with focus in the
  files view still steps the size (control). Visual capture `docs/mockups/console/shots/impl-*.png` (opt-in, `FILESMITH_SHOTS=1`).
- **Gate:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`, then
  package, install and launch the branch build for hands-on testing.
