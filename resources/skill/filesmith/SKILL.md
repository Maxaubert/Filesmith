---
name: filesmith
description: Use when the user wants to do something to files on this PC, even phrased casually ("compress this image", "shrink this video", "make this a webp", "convert to jpg/pdf/mp4", "resize to 1920", "upscale this", "remove the background", "make me an image of...", "merge/split these PDFs", "pull the text out of this PDF"). Runs the local Filesmith CLI; never overwrites originals.
metadata:
  filesmith-version: {{VERSION}}
---

# Filesmith

Local file toolkit on PATH as `filesmith` (full path if not found: `{{FILESMITH}}`). It writes NEW files next to each source, or into `--out <folder>`, and never overwrites. Run it from the Bash tool and always add `--json`.

| User says                     | Run                                                    |
| ----------------------------- | ------------------------------------------------------ |
| compress / shrink / smaller   | `filesmith compress "<file>" --json`                   |
| convert / make it a X         | `filesmith convert "<file>" --to webp --json`          |
| resize / smaller dimensions   | `filesmith resize "<file>" --width 1920 --json`        |
| upscale / enlarge / sharpen   | `filesmith upscale "<file>" --factor 2 --json`         |
| remove / cut out background   | `filesmith removebg "<file>" --json`                   |
| make / generate an image      | `filesmith generate "<prompt>" --json`                 |
| merge / split / text from PDF | `filesmith pdf merge\|split\|extract-text "<pdf>" --json` |
| what can it do / is it set up | `filesmith formats --json`, `filesmith doctor --json`  |

Many files: pass several paths, a glob (`"*.png"`) or a folder (`--recursive` for subfolders). Add `--help` to any command for its options.

## Rules

- **Dry run** (`--dry-run`) first for bulk or slow jobs (upscale, generate); show the plan, then run.
- **Read results** from stdout, one JSON object per line: `done` has `input`, `output`, `inSize`, `outSize`; `error` has `message` and `hint`; the last line is `summary`. Report the real `output` paths.
- **Never run `filesmith setup ...` without asking.** On `SETUP_REQUIRED` show the user the `hint`; it downloads up to several GB.
- **Exit codes:** `0` ok, `1` some files failed (report each error), `2` bad arguments, nothing ran (fix them, do not retry blindly).

Every flag, event, error code and safety rule: [reference.md](reference.md).
