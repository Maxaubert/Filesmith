# Archive conversion (comic archives) — design

Date: 2026-08-31
Status: proposed

## Goal

Filesmith converts between archive containers, with comic archives (`.cbz` / `.cbr` /
`.cb7` / `.cbt`) as the driving use case, and bridges those archives to and from PDF.

## Why it fits

`.cbz` / `.cbr` / `.cb7` / `.cbt` are ZIP / RAR / 7z / tar with a renamed extension and
images inside, ordered by filename. So "convert" here is extract-and-repack, not
transcoding. Filesmith already orchestrates external CLIs, already owns collision-safe
output naming, and already bundles the two tools the PDF bridges need (mutool,
ImageMagick). The only new dependency is 7-Zip.

## The RAR asymmetry

Reading RAR is free. Writing RAR is not: only WinRAR's `Rar.exe` creates RAR archives,
it is proprietary, and it cannot be bundled. 7-Zip's own licence carries the unRAR
restriction that forbids using its RAR code to build a RAR compressor.

Resolution: RAR/CBR is always readable. RAR/CBR **output** is enabled only when
`Rar.exe` is found on the machine. When it is not, the CBR and RAR target chips render
greyed out with a `WinRAR not found` tooltip on hover, rather than disappearing — a user
looking for CBR gets an answer instead of a missing option.

## Scope

### Formats read

`.zip` `.rar` `.7z` `.tar` `.cbz` `.cbr` `.cb7` `.cbt`

Deliberately out of v1: `.tar.gz` / `.tgz` / `.tar.bz2`. The codebase models `ext` as a
single lowercased extension (`FileInfo.ext`, `extname`), so compound extensions need a
classifier change, and gzipped tars need a two-pass extract. Neither serves comics.
Deferred, not forgotten.

### Formats written

| Target | Container | Availability               |
| ------ | --------- | -------------------------- |
| `.cbz` | zip       | always                     |
| `.zip` | zip       | always                     |
| `.cb7` | 7z        | always                     |
| `.7z`  | 7z        | always                     |
| `.cbt` | tar       | always                     |
| `.tar` | tar       | always                     |
| `.cbr` | rar       | only with WinRAR installed |
| `.rar` | rar       | only with WinRAR installed |

### Operations

New `archives` category, three operation cards:

1. **Convert** (`repack`) — archive to archive. Extract to a temp dir, repack into the
   target container.
2. **Extract** (`extract`) — archive to a collision-free folder next to the source.
3. **To PDF** (`to-pdf`) — comic archive to PDF, images in natural page order.

One new card on the existing **PDF** category:

4. **To CBZ** (`from-pdf`) — render pages, pack them into a comic archive.

Cards 3 and 4 both carry `tool: 'archive'`; the catalog already supports a category
hosting a card from another tool, so no catalog structure change is needed.

## Architecture

### New dependency: 7-Zip

`7z.exe` + `7z.dll` (~2 MB) copied into `resources/bin` by `scripts/fetch-binaries.mjs`,
which already locates a local 7-Zip install (`scripts/fetch-binaries.mjs:245-247`) for the
Ghostscript step. This follows the existing magick / caesium "copy from a local install,
print install guidance if absent" pattern; only ffmpeg downloads. `electron-builder`
already packs `resources/bin`, so packaging needs no change. 7-Zip's licence text is
copied alongside the binary.

Standalone `7zr.exe` is not an option: it handles only the 7z format, and this feature
needs zip, rar and tar.

### `src/main/tools/archive.ts` — the tool module

Owns its format catalog and every argument builder, and is independently testable in the
way `pdf.ts` and `convert.ts` are. Pure functions only:

- `ARCHIVE_FORMATS: FormatOption[]` and `CONTAINER_OF: Record<string, Container>` mapping
  each extension to `'zip' | '7z' | 'tar' | 'rar'`.
- `archiveTargets(sourceExt, hasRar): FormatOption[]` — every target except the source's
  own format, RAR entries dropped when `hasRar` is false. Shared with the renderer so the
  UI and the engine cannot drift.
- `buildExtractArgs(input, outDir)` gives `['x', input, '-o' + outDir, '-y', '-bsp2']`
- `buildPackArgs(output, container, level)` gives `['a', '-t' + container, '-mx' + level,
output, '*', '-y', '-bsp2']`, run with `cwd` set to the temp dir so the archive holds
  the contents, not a wrapper folder. A wrapper folder breaks comic readers.
- `buildRarPackArgs(output, srcDir)` gives WinRAR's `['a', '-ep1', '-r', '-y', output, '.']`
- `parse7zProgress(chunk): number | undefined` — the `47%` counter. `-bsp2` sends the
  progress stream to stderr, so it arrives through `RunOptions.onStderr` and `run.ts`
  needs no change.
- `naturalSort(names): string[]` — `page2` before `page10`. Comic page order is the whole
  point of the feature; plain lexicographic sort scrambles it.
- `batchImages(paths, budget): string[][]` — splits an image list into command lines that
  stay under the Windows 32767-character limit.

### `registry.ts` — `archiveTool: ToolModule`

An op switch mirroring `pdfTool`. Every op extracts to `mkdtempSync` and removes the temp
tree in a `finally`, so a cancel or failure leaves nothing behind.

- `repack` — extract, then pack. Output `reserveOutPath(source, targetExt, 'converted')`.
- `extract` — `uniqueOutDir(dirname(source), basename)`, extract straight into it.
- `to-pdf` — extract, collect image entries, `naturalSort`, then ImageMagick. When the
  file list exceeds the command-line budget, `batchImages` splits it into part PDFs and
  `buildPdfMergeArgs` (already wired for PDF merge) joins them. Output
  `reserveOutPath(source, '.pdf', 'converted')`.
- `from-pdf` — `buildPdfImagesArgs` renders `page-%d.png` at the chosen DPI into a temp
  dir; when the target page format is JPEG, one `magick mogrify -format jpg -quality N`
  pass converts them and the PNGs are dropped; then pack to the chosen comic container.
  JPEG is the default: a 200-page PNG CBZ runs to hundreds of megabytes.

Guard: an op targeting `.cbr` / `.rar` with no `Rar.exe` fails the job with
`WinRAR not found — CBR output needs WinRAR installed`. The UI already prevents this, but
options can arrive from a restored session, so the engine checks too.

### `toolResolver.ts` — `resolveRar(): string | null`

`Program Files\WinRAR\Rar.exe`, then the x86 root, then bare `Rar` on PATH. Returns
`null` when absent, in the shape `resolveRembg()` already uses for an optional tool.

### IPC and preload

`archive:status` returns `{ rar: boolean }`, exposed as `archiveStatus()`, consumed by a
`useArchiveStatus` hook alongside `usePidStatus` / `useGenerateStatus`.

### Shared types

- `ToolId` gains `'archive'`.
- `FileKind` gains `'archive'`.
- `fileKind.ts` gains `ARCHIVE_EXTS` and the classifier branch.
- `catalog.ts` gains the `archives` category and its operations, plus the To CBZ card
  under `pdf`.

### Renderer

`OptionsPanel` gains an archive branch: target chips (RAR entries greyed with the
tooltip), and a compression control for repack — **Store** (default; comic pages are
already-compressed images, so deflate buys nothing and costs time) or **Normal**. Extract
has no options. From-PDF reuses the DPI control the existing Pages-to-PNG card already
has, plus page format and JPEG quality.

Everything else reuses existing components. The one genuinely new visual asset is the
archive category's rail icon and colour, which needs the owner's sign-off under the
project's design rule.

## Error handling

- Missing 7-Zip gives `ToolMissingError`, surfaced through the existing
  `toolMissingMessage`.
- Encrypted archive: 7-Zip exits non-zero on the password prompt; the job fails with
  `Archive is password-protected`. No password UI in v1.
- `to-pdf` on an archive with no images fails with `No images found in this archive`
  rather than writing an empty PDF.
- Never overwrite: every output goes through `reserveOutPath` / `uniqueOutDir`, per the
  project's hard rule.
- Path handling routes through `runToOutput`'s `argsFor` pattern, so the known
  `%`-in-path expansion gotcha for magick and mutool stays covered.

## Testing

Unit (vitest, matching the arg-builder / catalog / collision focus):
container mapping; `archiveTargets` gating on `hasRar`; extract, pack and rar arg
builders; `parse7zProgress`; `naturalSort` including the page2/page10 case;
`batchImages` boundary behaviour; `fileKind` on every archive extension.

E2E (Playwright `_electron`): a small fixture `.cbz` converts to `.cb7` and the output
exists and is non-empty; a fixture PDF converts to `.cbz` and the archive lists the
expected page count.

## Deferred

`.tar.gz` / `.tgz`; flattening a single wrapper folder during repack; password-protected
archives; per-archive thumbnails drawn from the first page inside; browsing an archive's
contents in the preview window.
