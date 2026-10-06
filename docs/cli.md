# Filesmith command line

## What it is

`filesmith` runs every Filesmith operation from a terminal: convert, compress, resize, upscale,
removebg, generate and the PDF tools, plus the helpers `formats`, `doctor`, `setup` and `skill`. It
uses the same engine and the same bundled tools as the app (ffmpeg, ImageMagick, mutool, CaesiumCLT,
7-Zip, Ghostscript, LibreOffice, Real-ESRGAN), so results match the app's. It works offline, except for
the one-time setup of the AI tools. It never overwrites anything: outputs get a collision-free name next
to each source or in `--out`. It runs fine while the app is open, and its jobs never appear in the app's
queue or Completed view.

## Install and PATH

- The installer puts the command line in `<install>\resources\cli` (by default
  `%LOCALAPPDATA%\Programs\Filesmith\resources\cli`) and adds that folder to the per-user PATH. Terminals
  opened after the install see it; terminals that were already open do not.
- cmd and PowerShell run `filesmith.cmd`. Git Bash, MSYS and Claude Code's Bash tool run the
  extensionless `filesmith` sh shim (LF endings). Both start the installed `Filesmith.exe` in Node mode
  (`ELECTRON_RUN_AS_NODE=1`) with `--use-system-ca` and `NODE_USE_ENV_PROXY=1`.
- cmd expands `%NAME%` inside arguments, even quoted. For file names that contain `%`, use PowerShell or
  Git Bash.
- Ctrl+C cancels: see [Ctrl+C and unfinished outputs](#ctrlc-and-unfinished-outputs) for how it works
  in the installed command and its one limit (output redirected in cmd or PowerShell).
- Windows PowerShell 5.1 decodes captured native output with the OEM code page, so non-ASCII paths in
  `--json` output come out garbled. Run `[Console]::OutputEncoding = [Text.Encoding]::UTF8` first, or use
  Git Bash. PowerShell 7 is not affected.
- Installing, updating or uninstalling Filesmith closes every running `Filesmith.exe`, a running CLI job
  included.

## Grammar

```
filesmith <verb> <inputs...> [options]
filesmith pdf <tool> <inputs...> [options]
filesmith generate "<prompt>" [options]
filesmith <helper> [args] [options]
```

- **Shape.** Verbs are the sidebar verbs: `convert`, `compress`, `resize`, `upscale`, `removebg`
  (also `remove-bg`, `remove-background`), `generate`. PDF tools: `merge`, `split`, `burst`,
  `extract-text`, `to-images`, `extract-images`, `compress`. Helpers: `formats`, `doctor`, `setup`,
  `skill`, `help`. Options may come before, between or after inputs; `--` ends options, so a file named
  `-x.png` is `filesmith resize --percent 50 -- -x.png`. Long flags only, plus `-o` (`--out`) and `-h`
  (`--help`); `--name value` and `--name=value` both work; verbs, flags and values are case-insensitive.
  A bare `filesmith` prints the help.
- **Inputs.** Files, folders (their own files; `--recursive` descends; files the verb cannot take are
  `skipped`; dot-files, `Thumbs.db` and `desktop.ini` are ignored), globs (`*.png`, `**/*.jpg`, expanded
  by Filesmith itself, case-insensitive, so they also work in cmd and PowerShell) and `-` (paths from
  stdin, one per line). Duplicates are dropped and the order is kept (it matters for `pdf merge`). A
  missing path is `NOT_FOUND`, a glob without matches is `NO_MATCH`.
- **Options mirror the app.** Each flag is the app's setting label in kebab-case, each value the label
  the app shows (`--quality smaller|balanced|best`, `--gpu full|balanced`). Units are optional
  (`--bitrate 192k`, `--factor 4x`, `--percent 50%`). Defaults are the app's defaults, except that
  `convert` requires `--to`. `filesmith formats [verb]` lists every target, value and model.
- **Never overwrite, and dry runs.** Output names follow the app's rule: `name.ext` if free, else
  `name (tag).ext`, else `name (tag 2).ext`; folders `base`, `base (2)`. There is no `--force`.
  `--dry-run` validates everything, prints the planned outputs and writes and downloads nothing. Planned
  names are predictions; the real names are in the `done` events. `--out` creates the folder (with
  parents) when it is missing; `generate` writes to the current folder unless `--out` is given.
- **Unfinished outputs never get the final name.** While a job runs, its final name holds an empty
  placeholder and the tool writes `name (tag).filesmith-part.ext` (folders: `base.filesmith-part`) in the
  same folder; only a job that succeeds renames it onto the final name. A failed or canceled job removes
  both. Treat `*.filesmith-part*` entries as work in progress, never as results.
- **Output formats.** Human output by default: one line per file (`ok`, `skip`, `fail`) and a summary on
  stdout, a progress line on stderr when it is a terminal. `--json` prints NDJSON events on stdout only
  (see below).
- **Exit codes.** `0` all ok or skipped; `1` some job failed (or `doctor` found a failure, or `setup`
  failed); `2` usage error or a requirement that fails for every input, nothing ran; `130` canceled
  with Ctrl+C.

### Ctrl+C and unfinished outputs

- **Ctrl+C** (once) cancels the run: every job emits `canceled`, the tools (ffmpeg and the rest) are
  stopped, unfinished outputs are removed, the summary is printed and the exit code is 130. In cmd there
  is no "Terminate batch job (Y/N)?" prompt any more. A second Ctrl+C leaves at once, still stopping the
  tools and removing this run's unfinished outputs.
- **How, in the installed command.** `Filesmith.exe` in Node mode is a GUI-subsystem program that Electron
  attaches to the terminal's console after start-up, and in that process Windows never delivers Ctrl+C
  to Node's `SIGINT` handler: the default handler ends the process at once (0xC000013A). So the CLI reads
  the console itself in raw mode, where the Ctrl+C key arrives as the byte 0x03 instead of a signal
  (`src/cli/consoleCtrlC.ts`). Plain Node (`npm run cli`) uses `SIGINT` as usual.
- **Ctrl+Break, closing the window, a hard kill** (`taskkill /F`, or Windows sending Ctrl+C
  programmatically with `GenerateConsoleCtrlEvent`) still end `Filesmith.exe` at once, with no summary and
  no exit 130. A small detached watchdog (`src/cli/watchdog.ts`, started with the first output) then stops
  the tools the run left running and removes its part files and placeholders, so nothing half-written
  stays behind.
- **Limit: output redirected in cmd or PowerShell** (`filesmith ... > out.txt`, `| findstr`). Then
  Windows starts `Filesmith.exe` without a console, so the Ctrl+C key never reaches it: the run finishes
  (cmd then asks "Terminate batch job (Y/N)?"). Close the run with `taskkill /IM Filesmith.exe /F` if you
  must; the watchdog cleans up. Git Bash pipes and Claude Code's Bash tool are not affected by this, as
  they do not cancel with a key press anyway.
- **Manual check** (also automated in `e2e/cli-packed.spec.ts`): in a new cmd window run
  `filesmith compress "<a long video>" --codec h265`, press Ctrl+C at about 20 %: `stop`, `1 canceled`,
  `echo %ERRORLEVEL%` prints 130, no `ffmpeg.exe` in Task Manager, and only the source in the folder.

### Examples

From the help pages (`filesmith <verb> --help`):

```
filesmith convert *.heic --to jpg
filesmith convert book.pdf --to cbz --resolution 200 --page-format png
filesmith convert comics\ --to cbz --compression normal --out D:\Out

filesmith compress *.jpg --quality 70
filesmith compress lecture.mov --codec h265 --scale 50
filesmith compress report.pdf --level smallest --greyscale

filesmith resize *.png --percent 25
filesmith resize hero.jpg --width 1920
filesmith resize photos\ --recursive --height 1080 --out D:\Small

filesmith upscale old.jpg --factor 2
filesmith upscale frame.png --model pid --dry-run
filesmith upscale scans\*.png --model anime --gpu balanced --json

filesmith removebg product.jpg --fill white
filesmith removebg portrait.png --image beach.jpg
filesmith removebg logo.png --color "#1e1e1e" --dry-run

filesmith generate "a lighthouse at dusk" --count 4 --size 1216x832
filesmith generate "a red kettle" --model flux1-dev --seed 42 --json
filesmith generate "a paper boat" --style anime --out D:\Art --dry-run

filesmith pdf merge cover.pdf body.pdf appendix.pdf
filesmith pdf split thesis.pdf --pages 1-3,10
filesmith pdf to-images slides.pdf --resolution 200 --out D:\Frames
```

## JSON events

With `--json`, stdout carries one JSON object per line (UTF-8, `\n`), and stderr carries nothing an
agent needs. Every line has `v` (1), `event` and `ts` (ISO time). Paths are absolute, sizes in bytes;
fields that do not apply are left out, never `null` (except `pct`).

| `event`     | Fields                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`       | `command`, `version`, `dryRun`, `inputs`, `options`                                                                                                                                      |
| `plan`      | `id`, `input` (array for merge), `inSize`, `op`, `output`, `outputKind`, `ready`, `code`, `message`, `hint`                                                                              |
| `start`     | `id`, `input`, `inSize`, `op`                                                                                                                                                            |
| `progress`  | `id`, `pct` (or null), `etaSec`, `message`                                                                                                                                               |
| `done`      | files: `id`, `input`, `output`, `outputKind`, `inSize`, `outSize` or `files`, `ms`, `seed` (generate); setup: `tool`, `path`, `alreadyDone`; skill: `path`, `updated`, `previousVersion` |
| `skipped`   | `id`, `input`, `code`, `message`                                                                                                                                                         |
| `error`     | `id`, `input` (both absent for run-level errors), `code`, `message`, `hint`                                                                                                              |
| `warning`   | `code`, `message`                                                                                                                                                                        |
| `canceled`  | `id`, `input`                                                                                                                                                                            |
| `check`     | doctor, setup: `id`, `group`, `status` (ok, warn, fail, skip), `detail`, `fix`                                                                                                           |
| `step`      | setup: `step`, `pct`, `bytes`, `totalBytes`, `etaSec`, `detail` (dry run)                                                                                                                |
| `heartbeat` | setup: `step`, `elapsedSec` (every 5 s while a step has no percentage)                                                                                                                   |
| `formats`   | `data`                                                                                                                                                                                   |
| `version`   | `version`                                                                                                                                                                                |
| `summary`   | `ok`, `failed`, `skipped`, `canceled`, `inBytes`, `outBytes`, `ms`, `exitCode`                                                                                                           |

`id` is the 1-based job number in input order, the same in a dry run and the real run. Error codes:
`USAGE`, `NOT_FOUND`, `NO_MATCH`, `UNSUPPORTED_KIND`, `SAME_FORMAT`, `OUT_DIR_MISSING`, `TOOL_MISSING`,
`SETUP_REQUIRED`, `GPU_UNSUPPORTED`, `RAR_MISSING`, `PASSWORD`, `TOOL_FAILED`, `CANCELED`, `INTERNAL`.

Schema v1 is additive-only: new events, fields and codes may appear; renaming or removing one bumps `v`.
The source of this table is `resources/skill/filesmith/reference.md` (Events section).

## In-app console

The app has a console panel at the bottom of the files view (spec
`docs/superpowers/specs/2026-10-06-console-design.md`). Open or close it with Ctrl+` (anywhere in the
app), the **Console** button in the bottom strip (hidden while the panel is open), or the close X in
the panel's top-right corner.

- Type commands without the prefix: `convert *.heic --to webp`, `doctor`, `formats`. The line is split
  into plain arguments and handed to the CLI; nothing runs through a shell, so `&`, `|` and `>` are
  just text. Anything that is not a filesmith command is refused, in the panel and again in the main
  process.
- Built-ins: `cd <folder>` (the folder commands run in; the last one is remembered, else Downloads),
  `clear` (or Ctrl+L), `help`, `history` (the last 100 commands; Up and Down recall them). Tab
  completes commands, flags, values and file names.
- One command at a time. Console runs do not join the app's queue, and the queue keeps working while
  one runs. Outputs use the same never-overwrite naming as the CLI; a finished run offers **Show in File
  Explorer**.
- **Stop** or Ctrl+C cancels a run: the current file is stopped, part files are removed and the run
  ends with exit 130. A second Stop ends it at once (the process tree is killed after 5 s at most).
- Plumbing: each command forks `out/main/cli.js` with `ELECTRON_RUN_AS_NODE`. When `CliIO.events` is
  set, the CLI tees its NDJSON events to it; under a fork they travel over the IPC channel. The parent
  cancels with the `'interrupt'` IPC message (twice for a hard stop), never with a console Ctrl+C.

## AI tools

Jobs never download anything. `filesmith setup <tool>` is the only command that does, with byte progress,
ETA, heartbeats and a cross-process lock (the app and the CLI never install the same tool at once). Every
setup takes `--dry-run`, which lists the steps, sizes, disk and GPU verdicts.

| Command                          | Downloads, and where                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setup removebg`                 | uv (if absent) into `%APPDATA%\Filesmith\uv`, rembg as a uv tool into `%APPDATA%\Filesmith\uv-tools`, the model into `%APPDATA%\Filesmith\models\rembg`. CPU only. |
| `setup pid`                      | The PiD upscaler (repo, Python env, weights) into `%APPDATA%\Filesmith\pid`, about 6 GB. Reuses weights found in ComfyUI.                                          |
| `setup spandrel [--comfy <dir>]` | Nothing when a ComfyUI Python already has torch and spandrel; otherwise the shared engine env in `%APPDATA%\Filesmith\pid`.                                        |
| `setup comfy --folder <path>`    | Nothing. Records the ComfyUI folder (or `--url <http://host:port>`) and rescans its models.                                                                        |
| `setup generate --model <name>`  | The missing companion files for one model, sha256-checked. Never installs ComfyUI itself.                                                                          |
| `setup realesrgan`               | Nothing (bundled). Prints the models and the user model folder.                                                                                                    |

- **GPU gates.** PiD and spandrel need an NVIDIA GPU with compute capability 7.5 or higher and driver
  525 or newer; a failing gate is `GPU_UNSUPPORTED` (exit 2). Real-ESRGAN needs any Vulkan GPU, which
  is not probed up front (`doctor --deep` runs a tiny upscale). Generate has no gate; removebg is CPU.
- **Removing.** `setup remove <removebg|pid|spandrel>` moves the folders to the Recycle Bin, up to 5 GB
  and 5,000 files (the Recycle Bin's practical limit). Larger folders (a PiD install) need
  `--permanent`, otherwise the command stops with exit 1 and names the size and the flag.
- `filesmith doctor` (read-only) shows what is installed, what is missing and the exact `fix` command.

## For agents

Filesmith ships a Claude Code skill (`resources/skill/filesmith`: `SKILL.md` with the working rules and
`reference.md` with every flag, event and code). Install it into `%USERPROFILE%\.claude\skills\filesmith`
with `filesmith skill install` (or `--dry-run` to preview; `filesmith skill status` checks it), or with
the **Install Claude skill** button in Settings > CLAUDE. Both write the absolute shim path into the skill
as a fallback for sessions started before PATH changed, and stamp the app version
(`metadata.filesmith-version`). Files other than `SKILL.md` and `reference.md` in that folder are left
alone; replaced files go to the Recycle Bin. The installer never installs the skill on its own.

## Implementation notes

Verified 2026-10-04 on this machine, source: running `node_modules/electron/dist/electron.exe` with
`ELECTRON_RUN_AS_NODE=1`:

- Electron 43 runs Node 24.18.
- `fs.globSync` exists (the CLI's glob expansion uses it).
- `--use-system-ca` is accepted, so downloads trust the Windows certificate store.
- `NODE_USE_ENV_PROXY=1` routes `fetch` through `HTTPS_PROXY`.
- `process.resourcesPath` is the install's `resources` folder in Node mode.
- `require('electron')` returns a path string in Node mode, so the engine never imports `electron`; it
  reads its paths from `src/main/env.ts` (set by `src/main/index.ts` for the app and by
  `src/cli/bootstrap.ts` for the CLI).
- Ctrl+C never reaches a `SIGINT` / `SIGBREAK` handler in Node mode: the process ends with 0xC000013A.
  Measured 2026-10-05 with a 6-line script under `electron.exe` and plain `node.exe`; the same loss
  reproduces in any GUI-subsystem process (pythonw) that registers a console control handler before
  `AttachConsole`, while one registered after it works. Raw-mode console input does reach the process
  (see Ctrl+C above). With stdout redirected, Electron does not attach a console at all.
- The `runAsNode` Electron fuse must stay on, or the shims stop working (the release workflow's packed-CLI
  smoke test fails loudly if it is ever turned off).

## Development

- `npm run build && npm run cli -- <args>` runs the CLI from `out/main/cli.js` with your system Node
  (for example `npm run cli -- convert photo.png --to webp --json`).
- Unit tests: `test/cli-*.test.ts` (parser, catalog, help, options, inputs, planner, runner, reporters,
  helpers), plus `test/env.test.ts`, `test/skill.test.ts`, `test/path-ps1.test.ts` and
  `test/cli-graph.test.ts` (the CLI's import graph never reaches `electron`). Run `npm test`.
- Process-level tests: `e2e/cli.spec.ts` runs `out/main/cli.js` end to end (build first), and
  `e2e/skill.spec.ts` covers the Settings > CLAUDE button. Run `npm run test:e2e`.
- `e2e/cli-packed.spec.ts` runs the shims in the install layout and skips unless `dist/win-unpacked`
  exists. It includes the console Ctrl+C test: `e2e/ctrlc-console.ps1` runs the cmd shim in a new
  (minimized) console, writes a Ctrl+C key record into the console input and reports the exit code and
  the console text. Build it with `npx electron-builder --win dir --publish never` (after `npm run build`), then
  `npx playwright test e2e/cli-packed.spec.ts`.
