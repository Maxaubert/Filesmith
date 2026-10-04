# Filesmith command line and Claude skill – design

Date: 2026-10-04
Status: proposed

Source: the owner decisions of 2026-10-04 (CLI plus skill, verb-first grammar, everything in v1, no
auto-download, independent of the app) and four read-only codebase maps (Electron coupling, option
catalog, AI setup flows, packaging). Everything marked **O#** in section 10 needs the owner's answer before
the plan is executed; every other choice in this document is a proposal that the single approval covers.

## 1. Goal and scope

Ship a `filesmith` command that runs every operation the desktop app can run, from any terminal, with the
same engine, the same bundled tools, the same option names and the same never-overwrite rule. Ship a
Claude Code skill next to it that teaches an agent to drive the command safely.

Hard rules (owner decisions, not negotiable in this work):

- **Verb first, mirroring the sidebar.** `filesmith <verb> <files...> [options]`. PDF tools nest as
  `filesmith pdf <tool>`.
- **Options mirror the app.** Flag names and values are the app's setting names and values. Where the app
  stores a value under a different name than it shows, the CLI uses the **shown** word (section 2.3).
- **Every command supports `--dry-run`.** There is no `--force`. Nothing is ever overwritten.
- **Human output by default, `--json` opt-in** (newline-delimited JSON). Results on stdout, diagnostics on
  stderr. Exit codes 0 / 1 / 2.
- **Everything in v1**, including upscale, removebg and generate.
- **AI tools never auto-download from the CLI.** A missing model or runtime fails with a pointer to
  `filesmith setup <tool>`, which is the only command that downloads.
- **Independent of the app.** CLI jobs never appear in the app's queue or Completed view. The CLI works while
  the app is open.
- **Always on PATH**, per-user installer, no admin. **Ctrl+C cancels cleanly.**
- **A skill, not an MCP server.** It lives in the repo, ships with the app, and is installed by
  `filesmith skill install` and by a button in Settings.
- **Delivery:** one issue, branch `feat/<N>-cli`, one PR, version 0.5.2 → **0.6.0**, no em-dashes anywhere,
  renderer untouched except the Settings button, never merged without the owner's explicit yes.

Changes outside the new `src/cli/` folder:

| #   | Change                                                                                                                                                                                                                                                                                                                | Why                                                                                             | Size                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- |
| M1  | New `src/main/env.ts` (engine environment provider). About 25 call sites in `toolResolver`, `pid/paths`, `tools/ncnnModels`, `comfy/store`, `generate/{index,comfy}`, `net/{download,integrity}`, `registry/{load,channel}` read paths and `fetch` from it instead of `electron`. `index.ts` sets it from `app`/`net` | The CLI runs in Node mode where `electron.app` and `electron.net` do not exist (section 4.1)    | mechanical, about 25 lines plus one new file |
| M2  | New `src/main/boot.ts`: `configureBundledMagickEnv()`, `sweepStaleTempDirs()`, `ensureUserLayers()` move out of `index.ts` so both entry points call them                                                                                                                                                             | Without the Magick env every image job fails on a clean install ("no decode delegate")          | small                                        |
| M3  | `generate/index.ts`: `GenerateOptions.outDir?: string`, default `engineEnv().downloadsDir` (app behaviour unchanged)                                                                                                                                                                                                  | `filesmith generate --out`                                                                      | a few lines                                  |
| M4  | Pure output planners: `planOutPath` / `planOutDir` in `output.ts` (the name logic of `reserveFileInDir` / `uniqueOutDir` without the exclusive create), plus `planOutput(file, options, outDir)` on each `ToolModule`                                                                                                 | `--dry-run` must predict names without writing placeholder files                                | moderate                                     |
| M5  | `ToolContext.allowDownload?: boolean` (app: true, CLI: false) and a `readiness(options)` check on the upscale and removebg tools; job-time messages gain a CLI wording (`Run: filesmith setup pid`)                                                                                                                   | Enforces the no-auto-download rule inside the engine, not only in the CLI                       | small                                        |
| M6  | removebg moves from `uv tool run` to a deterministic `uv tool install` plus a pinned model folder `%APPDATA%\Filesmith\models\rembg` (`U2NET_HOME`) for **both** app and CLI. Fixes the app's always-false `removebg:status.ready`. `ensureUv` moves from `pid/install.ts` to `uv.ts` and becomes public              | "Ready" becomes detectable, so the CLI can refuse instead of downloading; owner decision **O5** | moderate                                     |
| M7  | Cross-process lock files under `%APPDATA%\Filesmith\locks\` (PID plus timestamp, stale detection) taken by `installPid`, `installComfyEngine`, companion downloads and rembg setup, in the app and the CLI. `comfy/store.ts` writes become write-then-rename                                                          | The app and the CLI can now install at the same time; the existing locks are in-process only    | small                                        |
| M8  | App writes the URL of a ComfyUI it launched to `%APPDATA%\Filesmith\comfy-live.json` (removed on stop); `candidateComfyUrls()` tries it                                                                                                                                                                               | The CLI attaches to the app's ComfyUI instead of launching a second one (about 2x VRAM)         | small                                        |
| M9  | Installer: `resources/cli/` shims, HKCU PATH add and remove, `extraResources` for `cli` and `skill` (section 7)                                                                                                                                                                                                       | `filesmith` on PATH                                                                             | moderate                                     |
| M10 | Settings view: one `SettingGroup` with an "Install Claude skill" button; IPC `skill:install`, preload `installSkill()`                                                                                                                                                                                                | Owner decision; the only renderer change. Look covered by **O9**                                | small                                        |
| M11 | `electron.vite.config.ts`: second `main` input `cli: src/cli/main.ts` → `out/main/cli.js`. `package.json`: version 0.6.0, script `cli`                                                                                                                                                                                | Build                                                                                           | a few lines                                  |
| M12 | `release.yml`: packed-CLI smoke step; `pull_request.paths` gains `src/cli/**`, `resources/cli/**`, `resources/skill/**`, `build/installer*/**`                                                                                                                                                                        | The CLI is verified in the packed app on every PR that touches it                               | a few lines                                  |

No existing IPC channel, preload signature or renderer component changes, apart from M10.

## 2. Command grammar and the general rules

These rules apply to every command. They are the contract the skill teaches and the tests pin.

### 2.1 Shape

```
filesmith <verb> <inputs...> [options]
filesmith pdf <tool> <inputs...> [options]
filesmith generate "<prompt>" [options]
filesmith <helper> [args] [options]
```

- **Verbs** are the sidebar verbs, lowercase, one word: `convert`, `compress`, `resize`, `upscale`,
  `removebg`, `generate`. `remove-bg` and `remove-background` are accepted aliases of `removebg` (the
  sidebar label is "Remove BG").
- **PDF tools** are kebab-case nouns or noun phrases under `pdf`: `merge`, `split`, `burst`,
  `extract-text`, `to-images`, `extract-images`, `compress`.
- **Helpers:** `formats`, `doctor`, `setup`, `skill`, `help`. Global flags `--version` and `--help`.
- **Inputs are positional.** Options may appear before, between or after inputs. `--` ends option
  parsing and everything after it is an input, so a file named `-x.png` is
  `filesmith resize --percent 50 -- -x.png`.
- **Flag syntax:** long flags only, kebab-case, `--name value` and `--name=value` both work. Booleans are
  bare (`--greyscale`); `--no-<flag>` negates a boolean whose default is true. The only short flags are
  `-h` (help) and `-o` (`--out`), and `-j` is reserved (not in v1). Unknown flags, a flag on a verb that does
  not own it, a missing value and an invalid value are usage errors (exit 2) that name the flag and list the
  valid values.
- **Case:** verbs, flags and enumerated values are case-insensitive; file paths keep their case.
- **Repeated flag:** the last one wins, except list flags (none in v1).

### 2.2 Inputs, globbing and folders

- cmd and PowerShell do not expand wildcards, so **the CLI expands them itself**. An input that contains
  `*`, `?` or `[` and does not exist literally is expanded as a glob (case-insensitive, `/` and `\` both
  accepted, `**` recursive). Git Bash expands globs before the CLI sees them; the result is the same.
- A glob that matches nothing is a per-argument error (`NO_MATCH`, exit 1 if anything else ran, exit 2 if
  nothing is left to run).
- **A folder input** takes the folder's direct files that the verb accepts; other files are reported as
  `skipped` (`UNSUPPORTED_KIND`). `--recursive` descends into subfolders. Hidden and system files are
  skipped. See **O7**.
- **`-` reads paths from stdin**, one per line (blank lines ignored). This lets an agent pipe a list in.
- Inputs are resolved to absolute paths and de-duplicated case-insensitively. Order is kept: the argument
  order, with each glob or folder expanded in natural sort order. Order matters only for `pdf merge`.
- A path that does not exist is a per-file error (`NOT_FOUND`).

### 2.3 Options mirror the app

- Each flag is the app's setting label, lowercased and kebab-cased, and each value is the label the app
  shows: `--quality smaller|balanced|best`, `--level lossless|high|balanced|smallest`,
  `--fill transparent|white|black|green|custom|image`, `--gpu full|balanced`.
- Where the stored value differs from the shown one, the CLI accepts the shown word and maps it (only
  `--gpu balanced` → `background` today). Where the app shows a unit, the CLI accepts the bare number and
  the suffixed form (`--bitrate 192` or `192k`, `--factor 4` or `4x`, `--percent 50` or `50%`).
- Defaults are the app's defaults (`DEFAULT_OPTIONS` in `state.ts`), with one deliberate exception:
  `convert` **requires** `--to`, because a silent default target is a surprise in a script.
- Flag tables, value lists and defaults are generated from the shared catalogs
  (`shared/{convert,compress,resize,removebg,archive,generate}.ts`) into `src/cli/catalog.ts`; a unit test
  fails if an app option key has no flag or a flag has no app key.
- **Output location:** every file verb takes `--out <folder>` (`-o`). Default: next to each source, as in
  the app. `generate` default: see **O4**. A folder that does not exist: see **O6**.

### 2.4 Never overwrite, and dry runs

- Output names use the app's collision-safe rule unchanged: `name.ext` if free, else `name (tag).ext`, else
  `name (tag 2).ext`, and folders `base`, `base (2)`. Tags: `converted`, `compressed`, `resized`, `upscaled`,
  `no-bg`, `merged`, `pages`, `text`, `generated`. There is no `--force` and no flag that changes this.
- **`--dry-run`** on every command validates everything (inputs, options, tool and setup readiness, RAR
  availability, GPU gate), prints the plan, writes nothing and downloads nothing. Planned output names are
  **predictions**: another process may take a name before the real run, in which case the real run picks the
  next free name. When two inputs of one run map to the same name (`photo.png` and `photo.jpg` with
  `--to webp`), the real run produces the same set of names as the dry run, but jobs run in parallel, so
  which input gets the untagged name can differ. Dry-run exit codes follow the real rules (a file that
  would fail gives exit 1).
- `setup --dry-run` prints the steps, URLs, approximate sizes, disk-space and GPU verdicts.
- `skill install --dry-run` prints source, destination and whether it would update.

### 2.5 Output formats

**Human (default).** One stdout line per finished file, stable enough to read and grep:

```
ok      photo.png -> photo.webp            2.4 MB -> 310 KB  (-87%)
ok      scan.pdf  -> scan (pages)\          12 files
skip    logo.webp                           already webp
fail    broken.jpg                          magick: improper image header
```

Then a summary line on stdout: `3 files: 1 ok, 1 skipped, 1 failed (4.2 s)`. While jobs run and stderr is a
terminal, a single redrawn progress line goes to stderr (`[2/3] photo.png 62% (4s)`); when stderr is not a
terminal, progress is silent. Warnings (`warn: --height is ignored with --fit contain and both sizes`) go to
stderr. `NO_COLOR` is honoured; colour is used only for `ok`/`skip`/`fail` and only on a TTY.

**JSON (`--json`).** stdout carries only NDJSON events, one per line, UTF-8, `\n` endings, flushed per
line. stderr carries nothing in JSON mode except a crash trace (an agent may ignore stderr). Progress events
are rate-limited to one per job per 250 ms, plus every whole 10%.

### 2.6 JSON event schema (version 1)

Every line has `v` (schema version, `1`), `event` and `ts` (ISO 8601 UTC). Paths are absolute with Windows
separators. Sizes are bytes. Fields that do not apply are omitted, never `null`, except where noted.

| `event`    | Emitted                                      | Fields                                                                                                                                                                                                                         |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run`      | once, first line                             | `command` (`"convert"`, `"pdf merge"`, ...), `version` (app version), `dryRun` (bool), `inputs` (count), `options` (the resolved option object, app key names)                                                                 |
| `plan`     | dry run only, one per job                    | `id`, `input` (path, or array for merge), `inSize`, `op` (engine route, e.g. `convert`, `archive/repack`), `output` (predicted path), `outputKind` (`file`\|`dir`), `ready` (bool), and `code`/`message`/`hint` when not ready |
| `start`    | a job starts running                         | `id`, `input`, `inSize`, `op`                                                                                                                                                                                                  |
| `progress` | while running                                | `id`, `pct` (0-100, number, or `null` when unknown), `etaSec` (number, omitted when unknown), `message` (omitted when none)                                                                                                    |
| `done`     | a job succeeded                              | `id`, `input`, `output`, `outputKind`, `inSize`, `outSize` (file outputs) or `files` (count, dir outputs), `ms`                                                                                                                |
| `skipped`  | a job was not run, and that is not a failure | `id`, `input`, `code` (`SAME_FORMAT`, `UNSUPPORTED_KIND` for folder members), `message`                                                                                                                                        |
| `error`    | a job failed, or a run-level failure         | `id` (omitted for run-level), `input` (omitted for run-level), `code`, `message`, `hint` (an exact command when one exists, e.g. `filesmith setup pid`)                                                                        |
| `warning`  | non-fatal notice                             | `code`, `message`, optional `id`                                                                                                                                                                                               |
| `canceled` | a job was stopped by Ctrl+C                  | `id`, `input`                                                                                                                                                                                                                  |
| `summary`  | once, last line                              | `ok`, `failed`, `skipped`, `canceled` (counts), `inBytes`, `outBytes` (file outputs only), `ms`, `exitCode`                                                                                                                    |

`id` is the 1-based job number in input order, as a string (`"1"`), so it is stable between a dry run and
the real run. `generate` uses one job per image (`id` `"1"` to `"<count>"`); `pdf merge` is one job.

Helper commands reuse the envelope (`v`, `event`, `ts`) with their own event names: `formats` emits one
`formats` event; `doctor` emits `check` events (`id`, `status` `ok|warn|fail|skip`, `detail`, `fix`) and a
`summary`; `setup` emits `run`, `step` (`step`, `pct` or `null`, `bytes`, `totalBytes`, `etaSec`),
`heartbeat` (every 5 s while `pct` is `null`), `done` (`tool`, `path`), `error`, `summary`; `skill install`
emits `done` (`path`, `updated`).

Stable error `code` values: `USAGE`, `NOT_FOUND`, `NO_MATCH`, `UNSUPPORTED_KIND`, `SAME_FORMAT`,
`OUT_DIR_MISSING`, `TOOL_MISSING`, `SETUP_REQUIRED`, `GPU_UNSUPPORTED`, `RAR_MISSING`, `PASSWORD`,
`TOOL_FAILED`, `CANCELED`, `INTERNAL`. A new code is additive; renaming or removing a field or code bumps `v`.

### 2.7 Exit codes

| Code  | Meaning                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`   | every job succeeded or was skipped (also `--help`, `--version`, a clean `doctor`)                                                                              |
| `1`   | at least one job failed (others may have succeeded), a `doctor` check failed, or `setup` failed                                                                |
| `2`   | usage error, nothing ran: unknown verb or flag, bad value, missing required option, no runnable inputs, a requirement that fails for every input (RAR missing) |
| `130` | canceled with Ctrl+C (the conventional 128 + SIGINT); see **O3**                                                                                               |

Run-level requirement failures are decided **before any file is touched**: if a requirement (setup,
GPU, RAR, LibreOffice) fails for all inputs, the run is exit 2 with one `error` event; if it fails for some
inputs, those are per-file `error`s and the rest run (exit 1). See **O11**.

### 2.8 stdout and stderr

- stdout: results only (human result lines and summary, or NDJSON). Piping stdout never captures progress.
- stderr: the progress line, warnings and usage-error text.
- Help requested with `--help` goes to stdout and exits 0; the short usage printed after a usage error goes
  to stderr and exits 2.
- Usage errors in `--json` mode still emit a single `error` event (`code` `USAGE`) and a `summary` on stdout,
  so an agent never has to parse stderr.

### 2.9 Help text conventions

- `--help`/`-h` on every level: `filesmith --help`, `filesmith convert --help`, `filesmith pdf --help`,
  `filesmith pdf merge --help`, `filesmith setup --help`. `filesmith help <verb> [tool]` is the same.
- Layout, 80 columns, no colour:
  ```
  Usage: filesmith compress <files...> [options]

  Shrink file size. Images, video, audio and PDF.          (the app's tab description, extended)

  Options:
    --quality <10-100>       Image and video quality (default 80)
    ...
    -o, --out <folder>       Output folder (default: next to each file)
    --dry-run                Show what would happen, write nothing
    --json                   Machine-readable events on stdout
    -h, --help               Show this help

  Examples:
    filesmith compress *.jpg --quality 70
    filesmith compress talk.mp4 --codec h265 --scale 50 --json
  ```
- Options are grouped by file kind where the app groups them (IMAGE, VIDEO, AUDIO, PDF), using the app's
  group titles. Every enumerated option lists its values; every option shows its default.
- Help text is generated from `src/cli/catalog.ts`, so it cannot drift from the parser.

## 3. Command reference

Common flags on every file verb and PDF tool: `-o, --out <folder>`, `--dry-run`, `--json`,
`--recursive`, `-h, --help`. Common on everything: `--json`, `--dry-run`, `--help`.

### 3.1 `convert`

`filesmith convert <files...> --to <format> [options]`

Accepts image, video, audio, document, text, pdf, archive. Engine route per file: archive → pdf runs
`archive/to-pdf`; archive → archive runs `archive/repack`; pdf → cbz/cbr/cb7/cbt runs `archive/from-pdf`;
everything else runs `convert` (magick, ffmpeg, soffice, or mutool for pdf → txt).

| Source group                     | `--to` values                                                      |
| -------------------------------- | ------------------------------------------------------------------ |
| image                            | png, jpg, webp, avif, jxl, tiff, bmp, gif, ico                     |
| video                            | mp4, mkv, mov, webm, avi, gif                                      |
| audio                            | mp3, m4a, aac, ogg, opus, flac, wav                                |
| doc (word documents, text, pdf)  | pdf, docx, odt, rtf, txt, html; a real pdf also cbz, cbr, cb7, cbt |
| sheet (xlsx, xls, ods, csv, tsv) | pdf, xlsx, ods, csv                                                |
| slide (pptx, ppt, odp)           | pdf, pptx, odp                                                     |
| archive                          | cbz, cbr, cb7, cbt, zip, rar, 7z, tar, pdf                         |

| Flag                           | Values                                    | Default  | Applies to                   |
| ------------------------------ | ----------------------------------------- | -------- | ---------------------------- |
| `--to <format>` (required)     | see table; `jpeg`, `.JPG`, `tif` accepted | none     | all                          |
| `--quality <preset>`           | `smaller`, `balanced`, `best`, or 1-100   | balanced | jpg, webp, avif, jxl targets |
| `--compression <mode>`         | `store`, `normal`                         | store    | archive → archive            |
| `--resolution <dpi>` (`--dpi`) | 36-600                                    | 150      | pdf → comic                  |
| `--page-format <fmt>`          | `jpg`, `png`                              | jpg      | pdf → comic                  |
| `--page-quality <n>`           | 1-100                                     | 100      | pdf → comic with jpg pages   |

Rules:

- A file whose kind has no route to `--to` is a per-file `UNSUPPORTED_KIND` error; if no file can reach
  `--to`, exit 2 listing the targets the inputs share. Mixed batches are allowed (unlike the app's one-group
  selection) because each file is validated on its own.
- A file already in the target format is `skipped` (`SAME_FORMAT`), mirroring the app. See **O8**.
- A RAR target (`cbr`, `rar`) without WinRAR's `Rar.exe` is exit 2 `RAR_MISSING` before anything runs.
- Documents need LibreOffice; if it is missing, those files fail `TOOL_MISSING` with a reinstall hint.
- An option that does not apply to any input is a warning, not an error (`--quality` with only video files).

Examples:

```
filesmith convert *.heic --to jpg
filesmith convert "D:\Scans\book.pdf" --to cbz --resolution 200 --page-format png
filesmith convert comics\ --to cbz --compression normal --out D:\Out
```

### 3.2 `compress`

`filesmith compress <files...> [options]`. Accepts image (jpg, png, webp, gif, tiff, avif, jxl only),
video, audio, pdf.

| Flag                          | Values                                                            | Default     | Kind                    |
| ----------------------------- | ----------------------------------------------------------------- | ----------- | ----------------------- |
| `--format <fmt>`              | `keep`, `webp`, `avif`                                            | keep        | image                   |
| `--quality <n>`               | 10-100                                                            | 80          | image, video            |
| `--codec <c>`                 | video: `h264`, `h265`, `av1`; audio: `keep`, `mp3`, `aac`, `opus` | h264 / keep | video, audio            |
| `--scale <percent>`           | 25-100, step 5                                                    | 100         | video                   |
| `--bitrate <kbps>`            | 320, 256, 192, 128, 96, 64 (`192k` ok)                            | 192         | audio                   |
| `--level <level>`             | `lossless`, `high`, `balanced`, `smallest`                        | balanced    | pdf                     |
| `--greyscale` (`--grayscale`) | boolean                                                           | off         | pdf (not with lossless) |

`--codec` mirrors the app, which labels both codecs "Codec". The value is validated against each file's
kind: in a mixed batch `--codec h265` applies to video and is a warning for audio files, which then use their
default. Separate `--video-codec` and `--audio-codec` flags are accepted as unambiguous aliases. Output
extensions follow the engine (video always `.mp4`; audio and image as in the option catalog). PDF levels
other than lossless need Ghostscript.

```
filesmith compress *.jpg --quality 70
filesmith compress lecture.mov --codec h265 --scale 50
filesmith compress report.pdf --level smallest --greyscale
```

### 3.3 `resize`

`filesmith resize <images...> [options]`. Images only.

| Flag            | Values                             | Default           |
| --------------- | ---------------------------------- | ----------------- |
| `--percent <n>` | > 0 (`50%` ok)                     | 50 (percent mode) |
| `--width <px>`  | integer ≥ 1                        | blank (auto)      |
| `--height <px>` | integer ≥ 1                        | blank (auto)      |
| `--fit <fit>`   | `contain` (Keep aspect), `stretch` | contain           |
| `--mode <mode>` | `percent`, `dimensions`            | inferred          |

Mode is inferred: `--width`/`--height` select dimensions, otherwise percent. `--percent` together with a
dimension is a usage error. A dimension with no effect (contain with both sizes) is a warning. The dry run
reports the resulting pixel size (`resizedSize()`).

```
filesmith resize *.png --percent 25
filesmith resize hero.jpg --width 1920
```

### 3.4 `upscale`

`filesmith upscale <images...> [options]`. Images only. Output is always `.png`. Runs one at a time.

| Flag              | Values                                                                                                                                     | Default |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `--factor <n>`    | `2`, `3`, `4` (`4x` ok)                                                                                                                    | 4       |
| `--model <model>` | `photo`, `anime`, any Real-ESRGAN model name (`realesrgan-x4plus-anime_6B`, user overlay models), `pid`, `comfy:<model file path or name>` | photo   |
| `--gpu <mode>`    | `full`, `balanced`                                                                                                                         | full    |

`filesmith formats upscale` lists every model value with its label, engine and readiness. `pid` is fixed at
4x (other factors are a usage error). `comfy:<name>` accepts a full path or a model file name from the
scanned list. Readiness and GPU rules are in section 5. An estimated output above 1 GB is a warning.

```
filesmith upscale old.jpg --factor 2
filesmith upscale frame.png --model pid --dry-run
```

### 3.5 `removebg`

`filesmith removebg <images...> [options]`. Images only. Output is always `.png` with tag `no-bg`. Runs one
at a time. CPU only.

| Flag             | Values                                                      | Default     |
| ---------------- | ----------------------------------------------------------- | ----------- |
| `--fill <fill>`  | `transparent`, `white`, `black`, `green`, `custom`, `image` | transparent |
| `--color <#hex>` | `#rrggbb` (`#` optional); implies `--fill custom`           | #ff0000     |
| `--image <path>` | an existing image, cover fit; implies `--fill image`        | none        |

An invalid hex or a missing background image is a usage error (the engine would silently fall back to
transparent). The model is the app's default (`birefnet-general`) and is not exposed, as in the app. Needs
`filesmith setup removebg` once.

```
filesmith removebg product.jpg --fill white
filesmith removebg portrait.png --image beach.jpg
```

### 3.6 `generate`

`filesmith generate "<prompt>" [options]`. Takes a prompt, no files.

| Flag                  | Values                                                                                                  | Default                                |
| --------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `--model <name>`      | a generation model name from `filesmith formats generate`                                               | the app's auto-pick (first runnable)   |
| `--negative <text>`   | text                                                                                                    | `blurry, low quality, watermark, text` |
| `--style <style>`     | `none`, `realistic`, `photo`, `anime`, `artsy`, `3d`, `fantasy`                                         | none                                   |
| `--count <n>`         | 1-8                                                                                                     | 1                                      |
| `--size <WxH>`        | `1024x1024`, `832x1216`, `1216x832`, `768x1344`, `1344x768`, `896x1152`, `1152x896`, or any custom size | 1024x1024                              |
| `--width`, `--height` | custom size, clamped per architecture (warning when clamped)                                            | from `--size`                          |
| `--steps <n>`         | per architecture, max 50                                                                                | architecture default                   |
| `--cfg <n>`           | 1-15, step 0.5                                                                                          | architecture default                   |
| `--guidance <n>`      | 1-10, step 0.5 (Flux architectures only)                                                                | architecture default                   |
| `--seed <n>`          | integer ≥ 0 (omitted means random)                                                                      | random                                 |
| `--try-anyway`        | boolean, only for models that allow it                                                                  | off                                    |
| `-o, --out <folder>`  | folder                                                                                                  | see **O4**                             |

Output names `<slug(prompt)>.png` with the `generated` tag. Each image is a job with its own `done` event.
The `done` event also carries `seed`.

```
filesmith generate "a lighthouse at dusk, oil painting" --count 4 --size 1216x832
filesmith generate "product shot of a red kettle" --model flux1-dev --seed 42 --json
```

### 3.7 `pdf <tool>`

| Command                                | Does                                     | Options                                | Output                                                   |
| -------------------------------------- | ---------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| `pdf merge <a.pdf> <b.pdf>...`         | Combine PDFs into one, in argument order | none                                   | one file next to the first input, `<first> (merged).pdf` |
| `pdf split <file.pdf> --pages <range>` | Keep only the listed pages               | `--pages 1-3,5,8-10` (required)        | `<name> (pages).pdf`                                     |
| `pdf burst <file.pdf>`                 | Save every page separately               | none                                   | folder `<name> (split)\<name>-NN.pdf`                    |
| `pdf extract-text <file.pdf>`          | Save the text layer as .txt              | none                                   | `<name>.txt`, tag `text`                                 |
| `pdf to-images <file.pdf>`             | Render each page to PNG                  | `--resolution <36-600>` (default 150)  | folder `<name> (pages)\page-N.png`                       |
| `pdf extract-images <file.pdf>`        | Pull out embedded images                 | none                                   | folder `<name> (images)\`                                |
| `pdf compress <file.pdf>`              | Alias of `compress` for PDFs             | `--level`, `--greyscale` (section 3.2) | as `compress`                                            |

`pdf merge` with fewer than two inputs and `pdf split` without a valid `--pages` are usage errors. Non-PDF
inputs are `UNSUPPORTED_KIND`.

```
filesmith pdf merge cover.pdf body.pdf appendix.pdf
filesmith pdf split thesis.pdf --pages 1-3,10
filesmith pdf to-images slides.pdf --resolution 200 --out D:\Frames
```

### 3.8 Helpers

| Command                                | Does                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filesmith formats [verb]`             | Lists `--to` targets per source group, compressible image formats, every enumerated option, upscale models with readiness, generate models (runnable or what is missing), rembg readiness, RAR availability. Read-only. |
| `filesmith doctor [--deep] [--verify]` | Read-only checklist (section 5.4). Exit 0 if nothing failed, 1 otherwise. `--deep` adds a 4x4 Real-ESRGAN smoke test; `--verify` hashes downloaded weights against `integrity.json`.                                    |
| `filesmith setup <tool>`               | The only command that downloads (section 5.3). Tools: `removebg`, `pid`, `spandrel`, `comfy`, `generate --model <name>`, `realesrgan`. `setup remove <tool>` uninstalls.                                                |
| `filesmith skill install`              | Copies the bundled skill to `%USERPROFILE%\.claude\skills\filesmith\` (section 6).                                                                                                                                      |
| `filesmith skill status`               | Installed or not, installed version against the app version, path.                                                                                                                                                      |
| `filesmith help [verb] [tool]`         | Same as `--help`.                                                                                                                                                                                                       |
| `filesmith --version`                  | Prints the app version (`0.6.0`); with `--json` a `{"v":1,"event":"version","version":"0.6.0"}` line.                                                                                                                   |

## 4. Architecture

### 4.1 How the CLI runs (recommended; **O1**)

The installed `Filesmith.exe` runs the CLI as a plain Node program. A shim on PATH sets
`ELECTRON_RUN_AS_NODE=1` and starts `Filesmith.exe <install>\resources\app.asar\out\main\cli.js <args>`.
This is the pattern VS Code's `code` command uses.

- **No second runtime.** The CLI uses Electron's own Node, the same engine code and the same bundled tools
  as the app.
- **Works while the app is open.** `src/main/index.ts` never runs in this mode, so there is no
  single-instance lock, no window, no protocol registration and no `session.json` access.
- **Real console behaviour.** In Node mode Electron attaches stdio to the parent console and keeps
  redirected handles, so pipes and `--json` work. The `.cmd` shim makes cmd and PowerShell wait for the
  process and pass the exit code through (a GUI-subsystem exe started directly would return immediately).
- **Startup** is Node-like (about 100-200 ms), with no Chromium.
- **Cost:** `electron.app`, `electron.net` and `nativeImage` do not exist in Node mode. M1 removes the
  engine's dependency on them; the CLI never imports `thumbnail.ts`, `session.ts` or `ipc.ts`.

Rejected: a `--cli` branch inside the Electron main process (starts Chromium, still needs a shim for the
console, touches the lock logic in `index.ts`); a separate Node SEA executable (about 70 MB of duplicate
runtime); patching the exe subsystem (a console window flashes on every app launch).

### 4.2 Engine seams

**`src/main/env.ts` (M1).**

```ts
export interface EngineEnv {
  userData: string // %APPDATA%\Filesmith
  resourcesDir: string // process.resourcesPath, or <repo>/resources in dev
  downloadsDir: string // generate default in the app
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  host: 'app' | 'cli'
}
export function setEngineEnv(e: EngineEnv): void
export function engineEnv(): EngineEnv // throws "engine env not configured" if unset
```

- App: `index.ts` calls `setEngineEnv` right after the `FILESMITH_USER_DATA` override, with
  `app.getPath('userData')`, `app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')`,
  `app.getPath('downloads')` and `net.fetch`. The registry channel's dynamic `import('electron')` moves to
  this app-only wiring.
- CLI: `userData` = `FILESMITH_USER_DATA` or `%APPDATA%\Filesmith` (the same folder as the app, so models,
  PiD env, ComfyUI store, registry user layer and `integrity.json` are shared; Windows paths are
  case-insensitive, so the `filesmith`/`Filesmith` spelling difference between the maps is harmless).
  `resourcesDir` = `dirname(process.execPath)\resources` when the exe is `Filesmith.exe`, else
  `<repo>/resources` from `__dirname`. `downloadsDir` from the Known Folder (`%USERPROFILE%\Downloads`
  fallback). `fetch` = global `fetch` (section 4.6).
- After M1 no module reachable from `src/cli/main.ts` imports `electron`. A unit test walks the CLI's import
  graph and a build check greps `out/main/cli.js` and its chunks for `require("electron")`. That also makes
  `node out/main/cli.js` work in dev and in tests with plain Node.
- Tests set the env in a Vitest setup file, replacing the silent "no electron" fallbacks in
  `registry/load` and `integrity` that previously made tests pass with wrong paths.

**`src/main/boot.ts` (M2)** runs `configureBundledMagickEnv()`, `sweepStaleTempDirs()` (age-guarded, safe
next to the app) and `ensureUserLayers()`. The CLI skips `scheduleChannelRefresh` (the channel is inert).

**Dry-run planners (M4).** `planOutPath(dir, name, ext, tag)` and `planOutDir(dir, base)` share the naming
code with `reserveFileInDir`/`uniqueOutDir` but never create anything. Each `ToolModule` gains
`planOutput(file, options, outDir): { path: string; kind: 'file' | 'dir' }`, and `readiness(options)`
for tools with setup requirements (M5).

**Generate (M3).** `GenerateOptions.outDir?: string`. `src/cli/commands/generate.ts` adapts
`generateImages(opts, onImage, onProgress, onStatus, signal)` to the same event stream as file jobs; it is
not forced into `ToolModule`.

### 4.3 CLI layout (`src/cli/`, one responsibility per file)

```
src/cli/
  main.ts            entry: main(argv, io: {stdout, stderr, stdin, env, isTTY}) => Promise<number>
  bootstrap.ts       setEngineEnv for the CLI, boot(), SIGINT wiring, process.exitCode
  parse.ts           node:util parseArgs + verb/subcommand router, aliases, `--` handling
  catalog.ts         flag specs generated from @shared catalogs (names, values, defaults, help text)
  options.ts         flag values -> JobOptions (app keys), per-kind validation, warnings
  inputs.ts          glob expansion, folders, stdin '-', de-duplication, kind classification
  plan.ts            per-file routing and readiness -> plan entries (dry run and pre-flight)
  runner.ts          JobQueue in the CLI process, JobEvent -> CLI events, exit-code reduction
  events.ts          event types (schema v1) and the NDJSON writer
  human.ts           human result lines, summary, TTY progress line
  help.ts            help text renderer
  exit.ts            exit codes and the UsageError class
  commands/
    files.ts         convert, compress, resize, upscale, removebg
    pdf.ts           pdf <tool>
    generate.ts      generate adapter
    formats.ts  doctor.ts  setup.ts  skill.ts
```

`main()` is injectable (no direct `process` access outside `bootstrap.ts`), so tests run it in-process.
Arguments are parsed with Node's built-in `util.parseArgs` (no dependency). Globs use `fs.globSync` from
Electron's Node; if it is still marked experimental there, the plan swaps in `tinyglobby` (a few KB).

### 4.4 Running jobs

- The CLI creates its own `JobQueue(emit)`; concurrency is the app's default (min(4, cpus-1), upscale and
  removebg 1). `--jobs` is not in v1.
- `JobEvent` maps to CLI events: `running` → `start`, `running` with percent → `progress`, `done` → `done`
  (adding `inSize` from `FileInfo`, `ms`, and `files` for folder outputs), `failed` → `error` (code from the
  error type: `ToolMissingError` → `TOOL_MISSING`, readiness → `SETUP_REQUIRED`, else `TOOL_FAILED`),
  `canceled` → `canceled`.
- Pre-flight (section 2.7) runs `plan.ts` for every input before the queue starts.
- The CLI's jobs never reach the app: the CLI has no IPC connection and never writes `session.json`, so they
  do not appear in the app's queue or Completed view.

### 4.5 Cancellation (Ctrl+C)

- `SIGINT` (and `SIGBREAK` on Windows) → `queue.cancelAll()` plus aborting a running generation (ComfyUI
  `/interrupt`) or setup download. `run()` already tree-kills children with `taskkill /T /F`, which covers
  uv, python and soffice.
- Then the CLI stops what it started: `pidSidecar.stop()`, `spandrelSidecar.stop()`, `stopComfyServer()`
  (only a ComfyUI this process launched; an attached one is left alone).
- Finished outputs stay. A canceled job's placeholder or partial output is removed by the tool's existing
  failure cleanup. A canceled download keeps its `.part` file so the next `setup` resumes.
- Each canceled job emits `canceled`, then `summary`, exit 130. A second Ctrl+C exits immediately.
- In cmd, the `.cmd` shim shows "Terminate batch job (Y/N)?" after the CLI exits; the work is already
  stopped, the prompt is cosmetic (**O3**).

### 4.6 Downloads in Node mode

The app downloads with Electron's `net.fetch`, which follows the Windows proxy settings and certificate
store. Node's `fetch` does neither by default. For `setup`, the CLI (recommended, **O2**):

- starts with `--use-system-ca` (Node's option to trust the Windows certificate store; verified
  2026-10-04 against Electron 43's Node 24.18), and
- honours `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` through Node's built-in `NODE_USE_ENV_PROXY=1`, which
  both shims set (verified on the same build; no undici dependency).
- The Windows system proxy (the one set in Settings, which the app follows) is not read; that is the
  remaining gap O2 accepts.
- `doctor` warns when Windows has a proxy configured but no proxy variable is set.

### 4.7 Running next to the app

| Shared thing                                | Handling                                                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single-instance lock                        | Not involved (`index.ts` never runs)                                                                                                                                                         |
| `session.json`                              | Never read or written by the CLI                                                                                                                                                             |
| Installs (PiD, spandrel, rembg, companions) | Cross-process lock files (M7); a CLI `setup` waiting on the app's lock reports it and waits up to 10 minutes, `--json` emits `heartbeat`                                                     |
| `integrity.json`, `comfy-upscalers.json`    | Atomic write-then-rename (M7)                                                                                                                                                                |
| ComfyUI                                     | The CLI attaches to a running one first (`comfy-live.json`, M8; then the stored URL, then :8188); otherwise it starts its own on a free port and stops it on exit                            |
| GPU and VRAM                                | Each process loads its own sidecar (PiD about 10 GB). Not locked in v1; `doctor` reports whether the app is running, and the skill tells agents to avoid AI jobs while the app is mid-AI-job |

## 5. AI tools

### 5.1 Readiness checks (run in pre-flight, never download)

| Tool                    | Ready when                                                                                                      | Not ready → `SETUP_REQUIRED` hint                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| upscale, Real-ESRGAN    | `realesrgan-ncnn-vulkan.exe` present, model `.param`/`.bin` present                                             | `TOOL_MISSING`: reinstall Filesmith                                                   |
| upscale `pid`           | `pidInstalled('flux')` (env marker, both weight files) and the CUDA gate passes                                 | `filesmith setup pid`                                                                 |
| upscale `comfy:<model>` | a ComfyUI Python with torch and spandrel, or our venv with the spandrel marker; the model is in the usable list | `filesmith setup spandrel` (plus `--comfy <folder>` if no folder is known)            |
| removebg                | rembg installed as a uv tool (M6) **and** `birefnet-general.onnx` present in the pinned model folder            | `filesmith setup removebg`                                                            |
| generate                | a reachable or launchable ComfyUI, and the chosen model is runnable (no missing companions)                     | `filesmith setup comfy --folder <path>`, or `filesmith setup generate --model <name>` |

Belt and braces: removebg runs `rembg.exe` from the installed tool (never `uv tool run` in CLI mode), and
the engine passes `allowDownload: false` (M5) so any code path that would fetch throws `SETUP_REQUIRED`.

### 5.2 GPU checks

- PiD and spandrel need NVIDIA with compute capability ≥ 7.5 and driver ≥ 525 (`cudaTierSupport`). A
  failing gate is `GPU_UNSUPPORTED`, exit 2 for the run (no input can pass it), with the reason from
  `cudaReason`.
- Real-ESRGAN needs any Vulkan GPU; nothing probes it up front. A Vulkan failure is a per-file
  `TOOL_FAILED`; `doctor --deep` runs the smoke test.
- Generate imposes no gate; ComfyUI's own torch decides.
- removebg is CPU only.

### 5.3 `filesmith setup <tool>`

Running `setup` is the consent; there is no `--yes`. Every setup takes `--dry-run` and `--json`, takes the
cross-process lock, checks disk space first, reports progress with bytes and ETA (`downloadFile` gains a
bytes callback), sends a heartbeat every 5 s during steps without a percentage, resumes `.part` files, and is
idempotent (already done → exit 0 "already set up").

| Command                                                       | Does                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup removebg`                                              | Ensure uv (download pinned uv into `%APPDATA%\Filesmith\uv` if absent), `uv tool install --python 3.11 "rembg[cli,cpu]>=2.0.75,<3"`, then fetch the default model into the pinned folder and record its sha256 in `integrity.json`. CPU, no GPU gate. |
| `setup pid` (alias `upscale-advanced`)                        | GPU gate, disk check, `installPid('flux')` (repo, uv, env, weights, reusing weights found in ComfyUI). About 6 GB.                                                                                                                                    |
| `setup spandrel` (alias `upscale-comfy`) `[--comfy <folder>]` | If a ComfyUI Python already has torch and spandrel: nothing to install, exit 0. Otherwise `installComfyEngine`. `--comfy` records the folder and scans models, printing their badges.                                                                 |
| `setup comfy --folder <path> [--url <http://host:port>]`      | Records the ComfyUI folder and/or server URL (as the app's folder picker does) and rescans. Downloads nothing.                                                                                                                                        |
| `setup generate --model <name>`                               | Downloads the missing companion files for one model, sha256-checked. Never installs ComfyUI itself (prints the comfy.org pointer).                                                                                                                    |
| `setup realesrgan`                                            | Nothing to download. Prints the models and the user model folder. Exit 0.                                                                                                                                                                             |
| `setup remove <removebg\|pid\|spandrel>`                      | Uninstalls. `pid` warns that the shared venv also serves spandrel. Removed folders go to the Recycle Bin.                                                                                                                                             |
| `setup` with no tool                                          | Lists tools with their readiness (same data as `doctor`'s AI section).                                                                                                                                                                                |

`installPid` and `installComfyEngine` gain an `AbortSignal` so Ctrl+C stops `uv` children and downloads.

### 5.4 `filesmith doctor`

Read-only, about 1-3 s. Each check is `ok`, `warn`, `fail` or `skip`, with `detail` and a `fix` string that is
an exact command where one exists. AI tools are optional, so their absence is `warn`.

- Core: ffmpeg, ffprobe, magick (with coders), mutool, caesiumclt, 7z, Ghostscript, LibreOffice,
  Real-ESRGAN plus model count; WinRAR (warn: only RAR output needs it).
- GPU: NVIDIA name, VRAM, compute capability, driver, CUDA verdict.
- Upscale: Real-ESRGAN models, PiD state, spandrel engine and which Python, ComfyUI folder and usable models.
- Remove background: uv location and version, rembg installed, models present.
- Generate: candidate URLs and which is alive, launchable ComfyUI, model count (runnable versus missing
  companions), registry warnings, channel disabled.
- Environment: user data folder writable, free disk space, `filesmith` on PATH, app running, setup locks
  held, proxy variables, skill installed and its version, CLI version equals the bundled resources.

## 6. The skill

### 6.1 Repo layout

```
resources/skill/filesmith/
  SKILL.md        frontmatter + the working rules (kept short; it is loaded into context)
  reference.md    full command and flag reference, event schema, error codes (loaded on demand)
```

Shipped through `extraResources` (`resources/skill` → `<install>\resources\skill`). The same files can be
wrapped later in a plugin-marketplace layout (`.claude-plugin/plugin.json` + `skills/filesmith/`) without
changes.

### 6.2 Content outline

- Frontmatter: `name: filesmith`; `description:` one line starting "Use when the user asks to convert,
  compress, resize, upscale or remove the background of files, generate an image, or merge, split or extract
  from PDFs on this Windows machine - runs the local Filesmith CLI, never overwrites."; and
  `metadata: { filesmith-version: 0.6.0 }` (nested under the standard `metadata` key, so strict skill
  validators and the plugin marketplace accept the frontmatter).
- `# Filesmith CLI`: one paragraph (local, offline for core tools, writes new files next to the source).
- `## Run it`: the command path (`filesmith`, plus the absolute shim path written in at install time as a
  fallback for sessions started before PATH changed), and one example per verb, every one with `--json`.
- `## Rules`:
  - **Always pass `--json`** and read stdout line by line; ignore stderr.
  - **Dry run first** for bulk work (more than a handful of files, globs, folders, `--recursive`) and for
    anything slow or large (upscale, generate, setup). Show the user the plan before the real run.
  - Never pass user-supplied text into a shell unquoted; quote every path.
  - Never run `setup` (it downloads gigabytes) without the user's go-ahead; on `SETUP_REQUIRED`, report the
    `hint` and ask.
  - Outputs never replace inputs; report the `output` paths from `done` events, never guess names.
  - On exit 1 report each `error` (`input`, `message`, `hint`); on exit 2 fix the arguments, do not retry
    blindly.
- `## Reading results`: the event table in brief, exit codes, error codes and what to do for each.
- `## When something is missing`: `filesmith doctor --json`, then follow `fix`.

### 6.3 Install

- `filesmith skill install` copies `<resources>\skill\filesmith\*` to `%USERPROFILE%\.claude\skills\filesmith\`,
  substituting the absolute shim path. It replaces only the files it ships (`SKILL.md`, `reference.md`);
  any other file in that folder is left alone. A replaced file goes to the Recycle Bin first. It reports
  `{ path, updated, previousVersion }`. `--dry-run` shows what would change.
- **Settings button (M10):** a new `SettingGroup` titled `CLAUDE` with one existing `Button` primitive,
  "Install Claude skill" (or "Update Claude skill" when an older version is installed), and a status line
  (`Installed 0.6.0`, `Not installed`). IPC `skill:install` and `skill:status` call the same function as
  the CLI (`src/main/skill.ts`); preload adds `installSkill()` and `skillStatus()`.
- **Versioning:** the skill's version is the app version, stamped at build time. `skill status` and
  `doctor` warn when the installed skill is older than the app. The installer does not install the skill
  silently (it writes into the user's Claude folder, which is the user's choice).

## 7. Packaging

### 7.1 PATH shims (`resources/cli/`, shipped to `<install>\resources\cli\`)

- `filesmith.cmd`:
  ```bat
  @echo off
  setlocal
  set ELECTRON_RUN_AS_NODE=1
  "%~dp0..\..\Filesmith.exe" --use-system-ca "%~dp0..\app.asar\out\main\cli.js" %*
  ```
  The exit code passes through `endlocal`.
- `filesmith` (no extension, POSIX sh, LF endings) for Git Bash and Claude Code's Bash tool, which do not
  resolve `.cmd`: resolves its own folder, exports `ELECTRON_RUN_AS_NODE=1` and `exec`s the same command.
- No `.ps1`: PowerShell would prefer it over the `.cmd`, and execution policy can block it.
- Only `<install>\resources\cli` goes on PATH, never `resources\bin` (that would shadow the user's own
  ffmpeg, magick and 7z).
- Known `.cmd` quirk: `%` inside an argument can be expanded by cmd (the "% path gotcha" in memory). The
  skill quotes paths and the human docs mention it; a native launcher (**O3**) removes it.

### 7.2 Installer

- `electron-builder.yml`: `extraResources` gains `resources/cli` → `cli` and `resources/skill` → `skill`. No
  `electronFuses` change; a comment pins that the RunAsNode fuse must stay enabled because the CLI depends
  on it.
- `build/installer/path.nsh` (new) defines the add and remove macros. They run
  `powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli\path.ps1" add|remove "<dir>"`
  and then broadcast `WM_SETTINGCHANGE` ("Environment"). `path.ps1` edits `HKCU\Environment\Path` through
  `Microsoft.Win32.Registry` with `DoNotExpandEnvironmentNames`, writes back as `REG_EXPAND_SZ`, and is
  idempotent (case-insensitive, trailing-slash-normalised compare). Pure NSIS string handling is avoided
  because long PATH values get truncated at 1024 characters.
- The add step goes inside the existing `customInstall` macro in `build/installer/pages.nsh` (a macro can be
  defined only once). Silent `/S` installs are covered.
- `customUnInstall` goes in `build/installer.nsh` **outside** the `BUILD_UNINSTALLER` guard and runs the
  remove step only when `${isUpdated}` is not set, so an update does not briefly drop the PATH entry.
- PATH changes reach new terminals only. The installer's finish page and the README say so; `doctor`
  reports it.

### 7.3 Release workflow

- `release.yml`, after "Verify bundled tools (packed app)": run
  `dist\win-unpacked\resources\cli\filesmith.cmd --version` (must equal `package.json`), `doctor --json`
  (must parse, core checks ok), and a one-file `convert --json` on a fixture.
- `scripts/verify-bundle.mjs` asserts the shims, `path.ps1` and the skill files are packed.
- `pull_request.paths` gains `src/cli/**`, `resources/cli/**`, `resources/skill/**`, `build/installer*/**`.
  The version bump touches `package.json`, so the PR runs the installer dry run anyway.
- Releases stay unsigned (as today); the shims are scripts, not new executables.

## 8. Testing and verification

### 8.1 Unit (Vitest, `test/cli-*.test.ts`)

- `cli-parse.test.ts`: every verb and alias, `pdf <tool>` nesting, `--name value` and `--name=value`,
  `--`, case-insensitivity, unknown flag / wrong verb / missing value / bad value → `UsageError` naming the
  flag and valid values, help routing at every level.
- `cli-catalog.test.ts`: every app option key has a flag and vice versa; defaults equal `DEFAULT_OPTIONS`;
  `--gpu balanced` → `background`; unit suffixes (`4x`, `192k`, `50%`).
- `cli-options.test.ts`: per-verb mapping to `JobOptions`, per-kind `--codec` validation, resize mode
  inference and conflicts, removebg hex and image validation, generate size clamping.
- `cli-inputs.test.ts`: globs (case-insensitive, `**`, no match), folders with and without `--recursive`,
  stdin `-`, de-duplication, natural order.
- `cli-plan.test.ts`: routing per file, `SAME_FORMAT` skip, RAR missing → exit 2, partial readiness →
  per-file errors, planners predict ` (2)` names and create nothing (temp dir listing unchanged).
- `cli-events.test.ts`: snapshot of every event shape (schema v1), rate limiting of progress, human lines
  and summary, `NO_COLOR`, TTY versus pipe.
- `cli-exit.test.ts`: reduction 0 / 1 / 2 / 130.
- `cli-cancel.test.ts`: an injected SIGINT aborts running jobs, stops sidecars once, emits `canceled` and
  `summary`.
- `cli-readiness.test.ts`: missing PiD, rembg, spandrel, ComfyUI and companions produce `SETUP_REQUIRED`
  with the exact hint, and no download function is called (spied).
- `env.test.ts`: CLI env derivation for packaged and dev; `engineEnv()` throws when unset.
- `cli-graph.test.ts`: no module reachable from `src/cli/main.ts` imports `electron`.
- `skill.test.ts`: install into a temp home, path substitution, update keeps foreign files, versions.
- `locks.test.ts`: lock acquire, contend, stale detection.

### 8.2 Integration (Playwright Test as runner, `e2e/cli.spec.ts`, after `npm run build`)

Spawns `node out/main/cli.js` with `resources/bin` and a temp `FILESMITH_USER_DATA`:

- PNG → webp with `--json`: parse every line, output next to the source, sizes reported.
- The same run twice: ` (converted 2)`-style naming, the first output unchanged (hash compare).
- `--dry-run` creates no files; its predicted names equal the real run's names.
- Bad flag → exit 2, nothing written. A corrupt input among good ones → exit 1, one `error`, others `done`.
- In JSON mode stdout is pure NDJSON and stderr is empty.
- `compress`, `resize`, `pdf merge` (order kept), `pdf split`, `pdf burst` (folder output), `formats --json`,
  `doctor --json`.
- `removebg` with no rembg installed → `SETUP_REQUIRED`, no network access (fetch is stubbed to fail).
- One case through the real runtime: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe
out/main/cli.js --version`.
- Next to the app: `_electron.launch` the app, run a CLI convert, assert it does not appear in the app's queue
  or Completed, and that the app keeps running.

### 8.3 E2E for the Settings button (`e2e/ui.spec.ts`)

With a temp `USERPROFILE`, open Settings, click "Install Claude skill", assert the files exist and the status
line reads `Installed 0.6.0`; a second visit shows the same state. One screenshot for the owner (**O9**).

### 8.4 PR gate and hands-on

`npm test && npm run typecheck && npm run lint && npx prettier --check . && npm run build && npm run test:e2e`.
Then `npm run package`, install the build on this machine and, in a new terminal, run `filesmith --version`,
a `--json` convert and `doctor` from cmd, PowerShell and Git Bash while the app is open; try Ctrl+C on a long
video compress; uninstall and reinstall to confirm the PATH entry is removed and re-added once.

## 9. Risks

| Risk                                                                                                                                                                              | Mitigation                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 touches many engine files the app depends on                                                                                                                                   | Mechanical change, full unit and e2e suite, the app passes the same values it used before                                                                                        |
| Node-mode loading from inside `app.asar` or `process.resourcesPath` behaves differently                                                                                           | First plan task proves it on a packed build; fallback `asarUnpack` for `out/main/cli*` and exe-relative paths                                                                    |
| A future change turns off the RunAsNode fuse (a common hardening step)                                                                                                            | Comment in `electron-builder.yml`, and the release smoke test fails loudly                                                                                                       |
| PATH edit corrupts a long user PATH                                                                                                                                               | Registry API with expand-string preserved, idempotent, covered by a silent-install CI check                                                                                      |
| Antivirus flags the installer running PowerShell                                                                                                                                  | One PowerShell call with a fixed script and argument list; fallback is the EnVar NSIS plugin                                                                                     |
| Corporate proxy or TLS inspection breaks `setup` while the app works                                                                                                              | System CA plus proxy variables (4.6), `doctor` warning                                                                                                                           |
| App and CLI both load a 10 GB GPU model                                                                                                                                           | Documented in the skill and `doctor`; a GPU lock is a later item                                                                                                                 |
| M6 changes how the app runs removebg                                                                                                                                              | The app's first removebg job calls the same installer inline; covered by the existing removebg tests plus new ones                                                               |
| `.cmd` `%` expansion and the "Terminate batch job" prompt                                                                                                                         | Documented; a native launcher later (**O3**)                                                                                                                                     |
| `--dry-run` names can differ from the real run under concurrency                                                                                                                  | Stated as predictions in output and skill                                                                                                                                        |
| JSON schema drift breaks agents                                                                                                                                                   | `v` field, snapshot tests, additive-only rule                                                                                                                                    |
| The CLI process is also named `Filesmith.exe`, so an install, update or uninstall treats a running CLI job as "the app is running" and closes it                                  | Documented in `docs/cli.md` and the skill ("do not update Filesmith while a CLI job runs"); finished outputs stay, the killed job's placeholder is left for the next run's sweep |
| `uniqueOutDir` checks then creates (not atomic); with the app and the CLI writing into the same folder at the same moment two folder outputs could pick the same name             | Pre-existing in the app; out of scope for v1, listed for a follow-up (exclusive `mkdirSync` without `recursive`)                                                                 |
| Node writes UTF-8 to pipes; Windows PowerShell 5.1 decodes captured native output with the OEM code page, so non-ASCII paths in `--json` read through PowerShell come out garbled | The skill runs the CLI from Git Bash (Claude Code's Bash tool); `docs/cli.md` gives the `[Console]::OutputEncoding` fix for PowerShell                                           |

## 10. Open questions for the owner

Each has a recommended answer. One reply covering all eleven approves this spec together with the plan.

| #   | Question                                                                                                                                                                                                                                         | Recommendation                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | **How the CLI starts.** The app's own exe in Node mode behind a small `filesmith.cmd` (VS Code's approach), or a separate executable?                                                                                                            | **Node mode behind the shim.** No extra runtime, works while the app is open, real console output and exit codes. Requires the engine refactor M1, which is mostly mechanical.                                                                      |
| O2  | **Downloads behind a company proxy.** The CLI cannot use the app's Windows-aware downloader. Accept that, or support proxy settings?                                                                                                             | **Support it:** trust the Windows certificate store and honour the standard `HTTPS_PROXY` variables. On a home network this changes nothing.                                                                                                        |
| O3  | **Ctrl+C in cmd** ends with Windows' "Terminate batch job (Y/N)?" after the work has already stopped. Accept for v1, or build a tiny native launcher now?                                                                                        | **Accept for v1.** The launcher (also removing the `%` quirk) can replace the shim later without changing anything else. Exit code on Ctrl+C is 130, the usual convention, on top of 0/1/2.                                                         |
| O4  | **Where `filesmith generate` saves** when `--out` is not given: Downloads like the app, or the current folder?                                                                                                                                   | **The current folder.** A command-line tool normally writes where you run it, and an agent working in a project expects images there. The app keeps Downloads.                                                                                      |
| O5  | **Remove background setup.** Today rembg downloads itself on first use, which the CLI must not do. Switch app and CLI to an explicit one-time install with a fixed model folder?                                                                 | **Yes.** It also fixes the app's "ready" flag, which is wrong today. In the app nothing visible changes: its first removebg job runs the same one-time install inline, with step messages in the row (no new screen, the renderer stays untouched). |
| O6  | **`--out` to a folder that does not exist:** create it, or stop with an error?                                                                                                                                                                   | **Create it** (including parents). It cannot overwrite anything, and it is what people and agents expect. The app's own behaviour is unchanged.                                                                                                     |
| O7  | **A folder as input:** process only its own files, or also subfolders?                                                                                                                                                                           | **Only its own files**, with `--recursive` to go deeper. Safer for bulk work.                                                                                                                                                                       |
| O8  | **A file already in the target format** (`photo.webp --to webp`): skip it quietly (exit 0), or count it as a failure (exit 1)?                                                                                                                   | **Skip it** with a `skipped` line and exit 0, the same as the app.                                                                                                                                                                                  |
| O9  | **The Settings button.** The project rule says every visual change goes through a mockup. One button and a status line from existing parts: build it and show a screenshot, or mockup first?                                                     | **Build it from the existing button and group, and approve it from a screenshot in the PR.**                                                                                                                                                        |
| O10 | **Archive extract** exists in the engine but has no place in the app's sidebar or your verb list. Add `filesmith extract <archives...>` now?                                                                                                     | **Not in v1.** Keep the CLI a mirror of the app; add it to both together later.                                                                                                                                                                     |
| O11 | **Exit code when a requirement is missing for every file** (for example `removebg` before `setup removebg`): your rule says 1 = some files failed, 2 = usage error. Count it as 2 ("nothing ran, fix something first") or 1 (every file failed)? | **2**, with one `error` event carrying the `setup` hint. An agent then knows nothing was attempted and the fix is a setup step, not a retry. If only some files lack the requirement, those fail and the run is 1.                                  |

Decided here without a question (covered by the single approval): `convert` requires `--to`; mixed-kind
batches validate per file; `--codec` validated per kind with `--video-codec`/`--audio-codec` aliases; the
removebg model and mask-only stay hidden as in the app; `pdf compress` is an alias of `compress`; upscale
model values are `photo`, `anime`, model names, `pid`, `comfy:<model>`; `--gpu full|balanced`; app-to-CLI
lock files and `comfy-live.json`; `setup` names are engine names with verb-facing aliases.

## 11. Out of scope / later

- MCP server (owner decision).
- Native `filesmith.exe` launcher (unless **O3** says now).
- `--jobs N`, a GPU lock shared with the app, `filesmith extract` (**O10**), a removebg `--model` flag.
- Publishing the skill to the plugin marketplace (the layout is ready for it).
- macOS and Linux shims.
- Code signing (unchanged: unsigned until the SignPath enrolment).

## 12. Delivery

One issue ("Command-line tool and Claude skill"), branch `feat/<N>-cli`, one PR containing the engine seams,
`src/cli/`, the skill, the installer and release changes, the Settings button, tests, the README section and
the version bump to **0.6.0**. CLAUDE.md gains a short "CLI" entry under Build, test, run (`npm run cli`) and
the layout. Before asking "merge?", the branch build is installed on this machine and exercised as in 8.4.
Never merged without the owner's explicit yes.
