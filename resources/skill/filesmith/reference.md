# Filesmith CLI reference (version {{VERSION}})

`filesmith <verb> <inputs...> [options]`, `filesmith pdf <tool> <inputs...> [options]`, `filesmith generate "<prompt>" [options]`. Options may come before, between or after inputs; `--` ends options. Long flags only (plus `-o` for `--out` and `-h` for `--help`), `--name value` or `--name=value`, case-insensitive. Unknown flags and bad values are exit 2 and name the valid values.

## Inputs

- Files, folders (their own files; `--recursive` for subfolders; files the verb cannot take are `skipped`), globs (`*.png`, `**/*.jpg`; expanded by Filesmith, case-insensitive), and `-` (paths from stdin, one per line).
- Duplicates are dropped; order is kept (it matters for `pdf merge`).

## Common options

| Flag                 | Meaning                                                    |
| -------------------- | ---------------------------------------------------------- |
| `-o`, `--out <folder>` | output folder, created if missing (default: next to each file; `generate`: the current folder) |
| `--recursive`        | folder inputs include subfolders                           |
| `--dry-run`          | validate and plan, write nothing, download nothing         |
| `--json`             | NDJSON events on stdout                                    |
| `-h`, `--help`       | help                                                       |

## Commands

### convert `--to <format>` (required)

Targets: image png, jpg, webp, avif, jxl, tiff, bmp, gif, ico; video mp4, mkv, mov, webm, avi, gif; audio mp3, m4a, aac, ogg, opus, flac, wav; documents and text pdf, docx, odt, rtf, txt, html (a pdf also cbz, cbr, cb7, cbt); sheets pdf, xlsx, ods, csv; slides pdf, pptx, odp; archives cbz, cbr, cb7, cbt, zip, rar, 7z, tar, pdf. A file already in the target format is `skipped`.

`--quality smaller|balanced|best|1-100` (jpg, webp, avif, jxl), `--compression store|normal` (archive to archive), `--resolution <36-600>` (also `--dpi`), `--page-format jpg|png`, `--page-quality <1-100>` (pdf to comic).

### compress

`--format keep|webp|avif` (images), `--quality <10-100>` (images, video), `--codec` (video h264, h265, av1 or audio keep, mp3, aac, opus, checked per file), `--video-codec`, `--audio-codec`, `--scale <25-100>` (video, steps of 5), `--bitrate 320|256|192|128|96|64` (audio, `192k` ok), `--level lossless|high|balanced|smallest` (pdf), `--greyscale` (also `--grayscale`; pdf).

### resize

`--percent <n>` (`50%` ok) or `--width <px>` / `--height <px>`, `--fit contain|stretch`, `--mode percent|dimensions`.

### upscale

`--factor 2|3|4` (`4x` ok), `--model photo|anime|<Real-ESRGAN model>|pid|comfy:<model file>` (list: `filesmith formats upscale`), `--gpu full|balanced`. Output is PNG. `pid` is 4x only and needs `filesmith setup pid`; `comfy:` models need `filesmith setup spandrel`.

### removebg

`--fill transparent|white|black|green|custom|image`, `--color <#rrggbb>` (implies custom), `--image <path>` (implies image). Output is PNG. Needs `filesmith setup removebg` once.

### generate "<prompt>"

`--model <name>` (default: the first runnable model), `--negative <text>`, `--style none|realistic|photo|anime|artsy|3d|fantasy`, `--count <1-8>`, `--size <WxH>`, `--width`, `--height`, `--steps <1-50>`, `--cfg <1-15>`, `--guidance <1-10>`, `--seed <n>`, `--try-anyway`. Needs a ComfyUI (`filesmith setup comfy --folder <path>`).

### pdf merge | split | burst | extract-text | to-images | extract-images | compress

`merge` (two or more PDFs, argument order, one output `<first> (merged).pdf`), `split --pages <range>` (e.g. `1-3,5`), `burst` (folder of single pages), `extract-text`, `to-images --resolution <36-600>` (folder of PNGs), `extract-images` (folder), `compress --level ... --greyscale`.

### formats [verb]

Every target, option value and model, with readiness.

### doctor [--deep] [--verify]

Read-only checklist; exit 1 if a check failed. `--deep` runs a tiny GPU upscale; `--verify` hashes downloaded model files.

### setup <tool>

The only command that downloads: `removebg`, `pid`, `spandrel [--comfy <folder>]`, `comfy --folder <path> | --url <http://host:port>`, `generate --model <name>`, `realesrgan`, `remove <pid|spandrel|removebg> [--permanent]`. With no tool: what is ready.

### skill install | status

Install or check this skill.

## Events (schema v1)

Every line: `v` (1), `event`, `ts` (ISO time). Paths are absolute, sizes in bytes; fields that do not apply are left out.

- `run`: `command`, `version`, `dryRun`, `inputs`, `options`
- `plan`: `id`, `input` (array for merge), `inSize`, `op`, `output`, `outputKind`, `ready`, `code`, `message`, `hint`
- `start`: `id`, `input`, `inSize`, `op`
- `progress`: `id`, `pct` (or null), `etaSec`, `message`
- `done` (files): `id`, `input`, `output`, `outputKind`, `inSize`, `outSize` or `files`, `ms`, `seed` (generate; the chosen seed when `--seed` is omitted, so an image can be repeated)
- `done` (setup): `tool`, `path`, `alreadyDone`; (skill): `path`, `updated`, `previousVersion`
- `skipped`: `id`, `input`, `code`, `message`
- `error`: `id`, `input` (both absent for run-level errors), `code`, `message`, `hint`
- `warning`: `code`, `message`
- `canceled`: `id`, `input`
- `check` (doctor, setup): `id`, `group`, `status` ok|warn|fail|skip, `detail`, `fix`
- `step` (setup): `step`, `pct`, `bytes`, `totalBytes`, `etaSec`, `detail` (dry run)
- `heartbeat` (setup): `step`, `elapsedSec` (every 5 s while a step has no percentage)
- `formats`: `data`
- `version`: `version`
- `summary`: `ok`, `failed`, `skipped`, `canceled`, `inBytes`, `outBytes`, `ms`, `exitCode`

`id` is the 1-based job number in input order, the same in a dry run and the real run.

## Error codes

`USAGE`, `NOT_FOUND`, `NO_MATCH`, `UNSUPPORTED_KIND`, `SAME_FORMAT`, `OUT_DIR_MISSING`, `TOOL_MISSING`, `SETUP_REQUIRED`, `GPU_UNSUPPORTED`, `RAR_MISSING`, `PASSWORD`, `TOOL_FAILED`, `CANCELED`, `INTERNAL`.

## Exit codes

`0` all ok or skipped; `1` some failed (or doctor found a failure, or setup failed); `2` usage error or a requirement that fails for every input, nothing ran; `130` canceled.

## Unfinished outputs

A running job writes `name (tag).filesmith-part.ext` (folders: `base.filesmith-part`) next to an empty placeholder at the final name, and renames it onto the final name only on success. A failed or canceled job removes both. Never use a `*.filesmith-part*` entry as a result.
