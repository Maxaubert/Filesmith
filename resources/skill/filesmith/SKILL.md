---
name: filesmith
description: Use when the user asks to convert, compress, resize, upscale or remove the background of files, generate an image, or merge, split or extract from PDFs on this Windows machine - runs the local Filesmith CLI, never overwrites.
metadata:
  filesmith-version: {{VERSION}}
---

# Filesmith CLI

Filesmith is installed on this machine. Its command line runs the app's own engine and bundled tools (ffmpeg, ImageMagick, mutool, 7-Zip, LibreOffice, Ghostscript, Real-ESRGAN), works offline except for the AI tools' one-time setup, and writes NEW files next to each source (or into `--out`). It never overwrites anything.

## Run it

`filesmith` is on PATH. If the shell cannot find it (a session started before Filesmith was installed), use the full path: `{{FILESMITH}}`.

```bash
filesmith convert "photo.heic" --to jpg --json
filesmith compress "talk.mp4" --codec h265 --scale 50 --json
filesmith resize "hero.png" --width 1920 --json
filesmith upscale "old.jpg" --factor 2 --json
filesmith removebg "product.jpg" --fill white --json
filesmith generate "a red kettle on a table" --count 2 --json
filesmith pdf merge "a.pdf" "b.pdf" --json        # pages in argument order
filesmith pdf split "thesis.pdf" --pages 1-3,10 --json
filesmith formats --json                            # every --to value, option and model
filesmith doctor --json                             # what is installed, what is missing
```

Every command has `--help`. Every flag, event field and error code: [reference.md](reference.md).

## Rules

- **Always pass `--json`** and read stdout one JSON object per line. Ignore stderr.
- **Dry run first** (`--dry-run`) for bulk work (more than a handful of files, globs, folders, `--recursive`) and for anything slow or large (upscale, generate, setup). Show the user the planned outputs, then run the same command without `--dry-run`. Planned names are predictions; report the real names from the `done` events.
- **Quote every path.** In cmd a `%` inside an argument can be expanded; use Git Bash or PowerShell for such names.
- **Never run `filesmith setup` without the user's go-ahead.** It downloads up to several GB. On `SETUP_REQUIRED`, show the user the `hint` command and what it would download (`filesmith setup <tool> --dry-run --json`), then ask.
- **Outputs never replace inputs.** Report `output` paths from `done` events; never guess names. For predictable names, write into an empty `--out` folder.
- **Exit 1**: report each `error` event's `input`, `message` and `hint`. **Exit 2**: nothing ran; fix the arguments (the message names the flag and its valid values) instead of retrying.
- **Never run `filesmith setup remove ...`** (it deletes installed AI tools) unless the user asked for exactly that, and never add `--permanent` without their explicit yes.
- **Run it from the Bash tool** (Git Bash). Windows PowerShell 5.1 garbles non-ASCII paths in captured output.
- **Avoid AI jobs** (`upscale --model pid` or `comfy:...`, `generate`) while the user runs one in the app: both load the GPU. Do not install or update Filesmith while a CLI job runs: the installer closes every `Filesmith.exe`, the CLI included.

## Reading results

| `event`              | Meaning                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `run`                | first line: command, version, dryRun, input count, resolved options                      |
| `plan`               | dry run only: predicted `output`; `ready: false` with `code`, `message`, `hint`          |
| `start`, `progress`  | a job began; `pct` 0-100 or null, `etaSec`                                               |
| `done`               | `input`, `output`, `outputKind` (`file` or `dir`), `inSize`, `outSize` or `files`        |
| `skipped`            | not run and not a failure (`SAME_FORMAT`: already that format)                           |
| `error`              | `code`, `message`, `hint` (an exact command when one exists)                             |
| `warning`            | a flag had no effect, or a value was clamped                                             |
| `summary`            | last line: `ok`, `failed`, `skipped`, `canceled`, `exitCode`                             |

Exit codes: `0` all ok or skipped, `1` some failed, `2` bad arguments or a missing requirement (nothing ran), `130` canceled.

While a job runs, its output name is an empty placeholder next to a `*.filesmith-part*` file or folder; only the `done` event's `output` is a result.

| `code`                  | What to do                                                                  |
| ----------------------- | --------------------------------------------------------------------------- |
| `SETUP_REQUIRED`        | Tell the user the `hint` (`filesmith setup ...`); run it only after a yes   |
| `GPU_UNSUPPORTED`       | That model needs an NVIDIA GPU; offer `--model photo` (any GPU)             |
| `TOOL_MISSING`          | Run `filesmith doctor --json` and report the failing check                  |
| `RAR_MISSING`           | CBR and RAR output need WinRAR; offer `cbz` or `zip`                        |
| `UNSUPPORTED_KIND`      | That file cannot take this operation; `filesmith formats --json` lists what can |
| `NOT_FOUND`, `NO_MATCH` | Check the path or the pattern                                               |
| `OUT_DIR_MISSING`       | `--out` is a file, or could not be created                                  |
| `PASSWORD`              | The archive is password-protected; ask the user                             |
| `USAGE`                 | Fix the arguments from the message                                          |
| `TOOL_FAILED`           | Report the message; the file may be damaged                                 |

## When something is missing

Run `filesmith doctor --json`. Every check that is not `ok` has a `fix`: a command (ask first if it is `filesmith setup ...`) or an instruction for the user.
