# Archive Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Archives category to Filesmith that converts between `.zip` / `.rar` / `.7z` / `.tar` / `.cbz` / `.cbr` / `.cb7` / `.cbt`, extracts archives to a folder, and bridges comic archives to and from PDF.

**Architecture:** A new `archive` tool module owns the format catalog and every 7-Zip / WinRAR argument builder as pure functions; `registry.ts` gains an `archiveTool` that dispatches four ops through temp directories and the existing collision-safe output helpers. 7-Zip ships bundled in `resources/bin`; WinRAR is detected at runtime and only unlocks RAR output.

**Tech Stack:** Electron + TypeScript, React renderer, Vitest unit tests, Playwright `_electron` e2e, 7-Zip CLI, ImageMagick, mutool.

**Spec:** `docs/superpowers/specs/2026-08-31-archive-conversion-design.md`

## Global Constraints

- TypeScript strict. Main-process code is Node; the renderer never touches `fs` or `child_process`.
- Never overwrite a source or an existing output. Every output path comes from `reserveOutPath` or `uniqueOutDir` in `src/main/output.ts`.
- Tool modules own their own format catalog and argument builders, and are independently unit-testable as pure functions.
- All spawns go through `run()` in `src/main/run.ts` with an argument array, never a shell string.
- Paths containing `%` must not reach magick or mutool unescaped: route outputs through the `runToOutput` `argsFor` pattern already used in `registry.ts`.
- Extensions are lowercased with a leading dot, single-component only (`.cbz`, not `.tar.gz`).
- No em-dashes in user-facing copy.
- Unit tests live in `test/*.test.ts`; e2e specs live in `e2e/*.spec.ts`.

---

### Task 1: Archive format catalog and container mapping

**Files:**
- Create: `src/shared/archive.ts`
- Test: `test/archive-catalog.test.ts`

**Interfaces:**
- Consumes: `FormatOption` from `src/shared/convert.ts`.
- Produces: `type ArchiveContainer = 'zip' | '7z' | 'tar' | 'rar'`; `ARCHIVE_FORMATS: FormatOption[]`; `CONTAINER_OF: Record<string, ArchiveContainer>`; `archiveTargets(sourceExt: string, hasRar: boolean): FormatOption[]`; `containerOf(ext: string): ArchiveContainer | null`; `needsRar(ext: string): boolean`.

This file is in `shared/` (not `main/tools/`) because the renderer needs `archiveTargets` to build the target chips, and the engine needs the identical list. Mirrors how `src/shared/convert.ts` is shared.

- [ ] **Step 1: Write the failing test**

```ts
// test/archive-catalog.test.ts
import { describe, expect, it } from 'vitest'
import { archiveTargets, containerOf, needsRar, ARCHIVE_FORMATS } from '@shared/archive'

describe('archive catalog', () => {
  it('maps every comic extension to its real container', () => {
    expect(containerOf('.cbz')).toBe('zip')
    expect(containerOf('.cbr')).toBe('rar')
    expect(containerOf('.cb7')).toBe('7z')
    expect(containerOf('.cbt')).toBe('tar')
    expect(containerOf('.zip')).toBe('zip')
    expect(containerOf('.7z')).toBe('7z')
    expect(containerOf('.tar')).toBe('tar')
    expect(containerOf('.rar')).toBe('rar')
  })

  it('returns null for a non-archive extension', () => {
    expect(containerOf('.png')).toBeNull()
  })

  it('offers eight formats in total', () => {
    expect(ARCHIVE_FORMATS).toHaveLength(8)
  })

  it('drops the source format from the target list', () => {
    const exts = archiveTargets('.cbz', true).map((f) => f.ext)
    expect(exts).not.toContain('.cbz')
    expect(exts).toContain('.cb7')
  })

  it('drops rar targets when WinRAR is absent', () => {
    const without = archiveTargets('.cbz', false).map((f) => f.ext)
    expect(without).not.toContain('.cbr')
    expect(without).not.toContain('.rar')
    const with_ = archiveTargets('.cbz', true).map((f) => f.ext)
    expect(with_).toContain('.cbr')
    expect(with_).toContain('.rar')
  })

  it('knows which extensions need WinRAR', () => {
    expect(needsRar('.cbr')).toBe(true)
    expect(needsRar('.rar')).toBe(true)
    expect(needsRar('.cbz')).toBe(false)
  })

  it('is case-insensitive on the source extension', () => {
    expect(archiveTargets('.CBZ', true).map((f) => f.ext)).not.toContain('.cbz')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/archive-catalog.test.ts`
Expected: FAIL, cannot resolve `@shared/archive`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/archive.ts
import type { FormatOption } from './convert'

// Comic archives are ordinary containers with a renamed extension: .cbz is a
// zip, .cbr a rar, .cb7 a 7z, .cbt a tar. Converting between them is
// extract-and-repack, so the only thing that varies is the container 7-Zip is
// told to write.
export type ArchiveContainer = 'zip' | '7z' | 'tar' | 'rar'

export const CONTAINER_OF: Record<string, ArchiveContainer> = {
  '.cbz': 'zip',
  '.zip': 'zip',
  '.cb7': '7z',
  '.7z': '7z',
  '.cbt': 'tar',
  '.tar': 'tar',
  '.cbr': 'rar',
  '.rar': 'rar'
}

// Comic formats first: they are the reason this category exists.
export const ARCHIVE_FORMATS: FormatOption[] = [
  { label: 'CBZ', ext: '.cbz' },
  { label: 'CBR', ext: '.cbr' },
  { label: 'CB7', ext: '.cb7' },
  { label: 'CBT', ext: '.cbt' },
  { label: 'ZIP', ext: '.zip' },
  { label: 'RAR', ext: '.rar' },
  { label: '7Z', ext: '.7z' },
  { label: 'TAR', ext: '.tar' }
]

const norm = (ext: string): string => ext.toLowerCase()

export function containerOf(ext: string): ArchiveContainer | null {
  return CONTAINER_OF[norm(ext)] ?? null
}

/** True when writing this format requires WinRAR's Rar.exe (which cannot be
 * bundled: it is proprietary, and 7-Zip's unRAR licence forbids using its RAR
 * code to build a compressor). */
export function needsRar(ext: string): boolean {
  return containerOf(ext) === 'rar'
}

/** Targets offered for a source archive: everything but its own format, with
 * RAR formats removed when WinRAR is not installed. */
export function archiveTargets(sourceExt: string, hasRar: boolean): FormatOption[] {
  const src = norm(sourceExt)
  return ARCHIVE_FORMATS.filter((f) => f.ext !== src && (hasRar || !needsRar(f.ext)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/archive-catalog.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/archive.ts test/archive-catalog.test.ts
git commit -m "feat(archive): add archive format catalog and container mapping"
```

---

### Task 2: File-kind classification for archives

**Files:**
- Modify: `src/shared/types.ts` (the `FileKind` and `ToolId` unions)
- Modify: `src/shared/fileKind.ts`
- Test: `test/archive-kind.test.ts`

**Interfaces:**
- Consumes: `containerOf` from Task 1 is not used here; this task only extends the classifier.
- Produces: `ARCHIVE_EXTS: string[]` exported from `src/shared/fileKind.ts`; `FileKind` includes `'archive'`; `ToolId` includes `'archive'`.

- [ ] **Step 1: Write the failing test**

```ts
// test/archive-kind.test.ts
import { describe, expect, it } from 'vitest'
import { ARCHIVE_EXTS, fileKind } from '@shared/fileKind'

describe('archive file kind', () => {
  it('classifies every archive extension as archive', () => {
    for (const e of ARCHIVE_EXTS) expect(fileKind(e)).toBe('archive')
  })

  it('covers the eight supported extensions', () => {
    expect([...ARCHIVE_EXTS].sort()).toEqual(
      ['.7z', '.cb7', '.cbr', '.cbt', '.cbz', '.rar', '.tar', '.zip'].sort()
    )
  })

  it('accepts an extension without a leading dot, and any case', () => {
    expect(fileKind('cbz')).toBe('archive')
    expect(fileKind('.CBR')).toBe('archive')
  })

  it('leaves other kinds alone', () => {
    expect(fileKind('.png')).toBe('image')
    expect(fileKind('.pdf')).toBe('pdf')
    expect(fileKind('.xyz')).toBe('other')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/archive-kind.test.ts`
Expected: FAIL, `ARCHIVE_EXTS` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/shared/types.ts`, extend both unions:

```ts
export type ToolId =
  | 'convert'
  | 'compress'
  | 'resize'
  | 'upscale'
  | 'removebg'
  | 'pdf'
  | 'generate'
  | 'archive'

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'text' | 'archive' | 'other'
```

In `src/shared/fileKind.ts`, add the extension set above the `fileKind` function:

```ts
// Archive containers, including the comic variants (.cbz/.cbr/.cb7/.cbt are
// zip/rar/7z/tar with a renamed extension). Compound extensions (.tar.gz) are
// deliberately out: FileInfo.ext is a single lowercased extension.
export const ARCHIVE_EXTS = ['.zip', '.rar', '.7z', '.tar', '.cbz', '.cbr', '.cb7', '.cbt']
```

and add the branch inside `fileKind`, before the `DOC_EXTS` check:

```ts
  if (ARCHIVE_EXTS.includes(e)) return 'archive'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/archive-kind.test.ts && npm run typecheck`
Expected: tests PASS. Typecheck may report non-exhaustive switches on `FileKind` in the renderer; fix each by adding an `archive` case that falls through to the existing generic/`other` behaviour. Do not add archive-specific visuals here.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/fileKind.ts test/archive-kind.test.ts
git commit -m "feat(archive): classify archive extensions as a new file kind"
```

---

### Task 3: 7-Zip and WinRAR argument builders

**Files:**
- Create: `src/main/tools/archive.ts`
- Test: `test/archive-args.test.ts`

**Interfaces:**
- Consumes: `ArchiveContainer` from `src/shared/archive.ts` (Task 1).
- Produces: `buildExtractArgs(input: string, outDir: string): string[]`; `buildPackArgs(output: string, container: ArchiveContainer, store: boolean): string[]`; `buildRarPackArgs(output: string): string[]`; `parse7zProgress(chunk: string): number | undefined`; `naturalSort(names: string[]): string[]`; `batchImages(paths: string[], budget: number): string[][]`; `IMAGE_ENTRY_EXTS: string[]`.

`-bsp2` routes 7-Zip's progress stream to stderr so it arrives through the existing `RunOptions.onStderr` hook and `run.ts` needs no change.

Pack and rar commands run with `cwd` set to the extracted temp directory and reference `*` / `.`, so the archive holds the files themselves rather than a wrapper folder. A wrapper folder breaks comic readers.

- [ ] **Step 1: Write the failing test**

```ts
// test/archive-args.test.ts
import { describe, expect, it } from 'vitest'
import {
  batchImages,
  buildExtractArgs,
  buildPackArgs,
  buildRarPackArgs,
  naturalSort,
  parse7zProgress
} from '../src/main/tools/archive'

describe('7-Zip arguments', () => {
  it('extracts into a target directory without prompting', () => {
    expect(buildExtractArgs('C:\\in.cbr', 'C:\\tmp\\x')).toEqual([
      'x',
      'C:\\in.cbr',
      '-oC:\\tmp\\x',
      '-y',
      '-bsp2'
    ])
  })

  it('packs the directory contents, not a wrapper folder', () => {
    const args = buildPackArgs('C:\\out.cbz', 'zip', true)
    expect(args).toEqual(['a', '-tzip', '-mx0', 'C:\\out.cbz', '*', '-y', '-bsp2'])
    expect(args).not.toContain('C:\\tmp\\x')
  })

  it('uses normal compression when store is off', () => {
    expect(buildPackArgs('C:\\out.7z', '7z', false)).toContain('-mx5')
  })

  it('builds a WinRAR command that strips the leading path', () => {
    expect(buildRarPackArgs('C:\\out.cbr')).toEqual(['a', '-ep1', '-r', '-y', 'C:\\out.cbr', '.'])
  })
})

describe('parse7zProgress', () => {
  it('reads the percent counter', () => {
    expect(parse7zProgress('  47% 12 - page-012.jpg')).toBe(47)
  })

  it('takes the last percent in a multi-line chunk', () => {
    expect(parse7zProgress(' 10% a\r 62% b\r')).toBe(62)
  })

  it('returns undefined when there is no counter', () => {
    expect(parse7zProgress('Scanning the drive for archives')).toBeUndefined()
  })

  it('clamps a bogus value into range', () => {
    expect(parse7zProgress(' 340% x')).toBe(100)
  })
})

describe('naturalSort', () => {
  it('orders page 2 before page 10', () => {
    expect(naturalSort(['page10.jpg', 'page2.jpg', 'page1.jpg'])).toEqual([
      'page1.jpg',
      'page2.jpg',
      'page10.jpg'
    ])
  })

  it('is stable across mixed case and nested folders', () => {
    expect(naturalSort(['B/p2.png', 'a/p10.png', 'a/p2.png'])).toEqual([
      'a/p2.png',
      'a/p10.png',
      'B/p2.png'
    ])
  })
})

describe('batchImages', () => {
  it('keeps one batch when everything fits', () => {
    expect(batchImages(['a.jpg', 'b.jpg'], 1000)).toEqual([['a.jpg', 'b.jpg']])
  })

  it('splits when the joined length exceeds the budget', () => {
    const paths = Array.from({ length: 6 }, (_, i) => `C:\\tmp\\page-${i}.jpg`)
    const batches = batchImages(paths, 40)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flat()).toEqual(paths)
    for (const b of batches) expect(b.join(' ').length).toBeLessThanOrEqual(40)
  })

  it('never drops a path longer than the whole budget', () => {
    const long = 'C:\\' + 'x'.repeat(100) + '.jpg'
    expect(batchImages([long], 10)).toEqual([[long]])
  })

  it('returns nothing for an empty list', () => {
    expect(batchImages([], 100)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/archive-args.test.ts`
Expected: FAIL, module `../src/main/tools/archive` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/tools/archive.ts
import type { ArchiveContainer } from '@shared/archive'

// Archive operations via 7-Zip (extract + pack) and, when installed, WinRAR
// (pack only: nothing else can write RAR). Every function here is pure so the
// argument shapes are testable without spawning anything.

/** Image entries considered comic pages when converting an archive to PDF. */
export const IMAGE_ENTRY_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']

/** `7z x <in> -o<dir> -y -bsp2` — extract everything, overwriting inside our own
 * temp dir. `-bsp2` puts the progress stream on stderr, where run.ts already
 * listens. */
export function buildExtractArgs(input: string, outDir: string): string[] {
  return ['x', input, '-o' + outDir, '-y', '-bsp2']
}

/**
 * `7z a -t<container> -mx<n> <out> * -y -bsp2` — pack the CURRENT DIRECTORY's
 * contents. Run this with cwd set to the extracted temp dir: passing the dir
 * path instead would nest everything under a wrapper folder, which comic
 * readers show as an empty book. 7-Zip expands `*` itself, so no shell is
 * involved.
 *
 * `store` (-mx0) is the default for comic archives: the pages are already
 * compressed images, so deflate costs time and saves nothing.
 */
export function buildPackArgs(
  output: string,
  container: ArchiveContainer,
  store: boolean
): string[] {
  return ['a', '-t' + container, store ? '-mx0' : '-mx5', output, '*', '-y', '-bsp2']
}

/** `rar a -ep1 -r -y <out> .` — WinRAR packing the cwd. `-ep1` strips the base
 * path so entries are not prefixed with `./`. */
export function buildRarPackArgs(output: string): string[] {
  return ['a', '-ep1', '-r', '-y', output, '.']
}

/** Last percent counter in a 7-Zip progress chunk, clamped to 0..100. */
export function parse7zProgress(chunk: string): number | undefined {
  const matches = [...chunk.matchAll(/(\d{1,3})%/g)]
  if (matches.length === 0) return undefined
  const n = Number(matches[matches.length - 1][1])
  return Math.max(0, Math.min(100, n))
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Sort entry names the way a reader expects pages: page2 before page10. Plain
 * lexicographic order scrambles every comic with more than nine pages. */
export function naturalSort(names: string[]): string[] {
  return [...names].sort((a, b) => collator.compare(a, b))
}

/**
 * Split an image list into groups whose joined command line stays under
 * `budget` characters. Windows caps a command line at 32767, and a 400-page
 * comic blows past it. A single path longer than the budget still gets its own
 * batch rather than being dropped.
 */
export function batchImages(paths: string[], budget: number): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let len = 0
  for (const p of paths) {
    const add = current.length === 0 ? p.length : p.length + 1
    if (current.length > 0 && len + add > budget) {
      batches.push(current)
      current = []
      len = 0
    }
    current.push(p)
    len += current.length === 1 ? p.length : p.length + 1
  }
  if (current.length > 0) batches.push(current)
  return batches
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/archive-args.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/archive.ts test/archive-args.test.ts
git commit -m "feat(archive): add 7-Zip and WinRAR argument builders"
```

---

### Task 4: Bundle 7-Zip and detect WinRAR

**Files:**
- Modify: `src/main/toolResolver.ts`
- Modify: `scripts/fetch-binaries.mjs`
- Test: `test/archive-resolvers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveRar(): string | null` and `resolveSevenZip(): string` exported from `src/main/toolResolver.ts`.

Read `test/resolvers.test.ts` first: it already establishes how `app` from `electron` is mocked for resolver tests. Follow that mock rather than inventing a new one.

- [ ] **Step 1: Write the failing test**

```ts
// test/archive-resolvers.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => 'C:\\app' }
}))

const exists = vi.hoisted(() => ({ set: new Set<string>() }))
vi.mock('fs', async (orig) => {
  const real = await orig<typeof import('fs')>()
  return { ...real, existsSync: (p: string) => exists.set.has(String(p)) }
})

import { resolveRar, resolveSevenZip } from '../src/main/toolResolver'

describe('resolveSevenZip', () => {
  beforeEach(() => exists.set.clear())

  it('prefers the bundled binary', () => {
    exists.set.add('C:\\app\\resources\\bin\\7z.exe')
    expect(resolveSevenZip()).toBe('C:\\app\\resources\\bin\\7z.exe')
  })

  it('falls back to the bare name so PATH can resolve it', () => {
    expect(resolveSevenZip()).toBe('7z')
  })
})

describe('resolveRar', () => {
  beforeEach(() => exists.set.clear())

  it('returns null when WinRAR is not installed', () => {
    expect(resolveRar()).toBeNull()
  })

  it('finds WinRAR under Program Files', () => {
    exists.set.add('C:\\Program Files\\WinRAR\\Rar.exe')
    expect(resolveRar()).toBe('C:\\Program Files\\WinRAR\\Rar.exe')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/archive-resolvers.test.ts`
Expected: FAIL, `resolveRar` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/main/toolResolver.ts`, next to `resolveGhostscript`:

```ts
/** 7-Zip's console binary. Bundled in resources/bin like ffmpeg and magick;
 * falls back to the bare name so a PATH install still works in dev. */
export function resolveSevenZip(): string {
  return resolveTool('7z')
}

/**
 * WinRAR's `Rar.exe`, the only thing that can WRITE a rar (and therefore a
 * .cbr). It is proprietary and cannot be bundled, so this returns null when
 * absent and the UI greys out the RAR targets. Reading rar needs none of this:
 * bundled 7-Zip handles it.
 */
export function resolveRar(): string | null {
  if (process.platform !== 'win32') return null
  for (const root of programFilesRoots()) {
    const p = join(root, 'WinRAR', 'Rar.exe')
    if (existsSync(p)) return p
  }
  return null
}
```

In `scripts/fetch-binaries.mjs`, add a step alongside the magick and caesium copy steps. The 7-Zip install path is already located for the Ghostscript step near line 245; reuse that lookup:

```js
function sevenZip() {
  const candidates = [
    'C:\\Program Files\\7-Zip',
    'C:\\Program Files (x86)\\7-Zip'
  ]
  const dir = candidates.find((d) => existsSync(join(d, '7z.exe')))
  if (!dir) {
    log('7-Zip: not found. Install it (winget install 7zip.7zip) and re-run.')
    return
  }
  // 7z.exe needs 7z.dll beside it; License.txt travels with the binary because
  // 7-Zip is LGPL with the unRAR restriction.
  for (const f of ['7z.exe', '7z.dll', 'License.txt']) {
    const src = join(dir, f)
    if (existsSync(src)) copyFileSync(src, join(BIN, f))
  }
  log(`7-Zip: copied from ${dir} (${mb(join(BIN, '7z.exe'))} MB)`)
}
```

Call `sevenZip()` from the script's main sequence next to the other copy steps.

- [ ] **Step 4: Run the tests and the fetch script**

Run: `npx vitest run test/archive-resolvers.test.ts`
Expected: PASS, 4 tests.

Run: `node scripts/fetch-binaries.mjs`
Expected: a 7-Zip line in the output, and `resources/bin/7z.exe` plus `7z.dll` on disk. Confirm with `ls resources/bin/7z*`.

- [ ] **Step 5: Commit**

```bash
git add src/main/toolResolver.ts scripts/fetch-binaries.mjs test/archive-resolvers.test.ts
git commit -m "feat(archive): bundle 7-Zip and detect an installed WinRAR"
```

---

### Task 5: The archive tool in the engine registry

**Files:**
- Modify: `src/main/tools/registry.ts`
- Test: `test/archive-tool.test.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 1, 3 and 4.
- Produces: `archiveTool: ToolModule` registered under the `archive` key in the registry's tool map; job options `{ op, format, store, dpi, pageFormat, quality }`.

Read `pdfTool` in `src/main/tools/registry.ts:302` first and mirror its op-switch shape, its use of `runToOutput`, and its temp-directory handling.

Op contract:

| `op` | Input | Output | Options used |
| --- | --- | --- | --- |
| `repack` | archive | archive | `format`, `store` |
| `extract` | archive | directory | none |
| `to-pdf` | archive | `.pdf` | none |
| `from-pdf` | `.pdf` | archive | `format`, `dpi`, `pageFormat`, `quality` |

- [ ] **Step 1: Write the failing test**

```ts
// test/archive-tool.test.ts
import { describe, expect, it } from 'vitest'
import { needsRar } from '@shared/archive'
import { IMAGE_ENTRY_EXTS, naturalSort } from '../src/main/tools/archive'

// The tool's spawn behaviour is covered end to end in e2e/workflows.spec.ts.
// Here we pin the decisions the tool makes before it spawns anything.
describe('archive tool preconditions', () => {
  it('treats a rar target as needing WinRAR', () => {
    expect(needsRar('.cbr')).toBe(true)
  })

  it('selects page images by extension in natural order', () => {
    const entries = ['cover.png', 'p10.jpg', 'p2.jpg', 'notes.txt', 'thumbs.db']
    const pages = naturalSort(
      entries.filter((e) => IMAGE_ENTRY_EXTS.some((x) => e.toLowerCase().endsWith(x)))
    )
    expect(pages).toEqual(['cover.png', 'p2.jpg', 'p10.jpg'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/archive-tool.test.ts`
Expected: FAIL, `IMAGE_ENTRY_EXTS` import resolves only once Task 3 is merged; if Task 3 is in place this test passes immediately and you proceed to Step 3 for the engine work, which the e2e in Task 9 verifies.

- [ ] **Step 3: Write the implementation**

Add to `src/main/tools/registry.ts`. Imports first:

```ts
import { containerOf, needsRar } from '@shared/archive'
import {
  batchImages,
  buildExtractArgs,
  buildPackArgs,
  buildRarPackArgs,
  IMAGE_ENTRY_EXTS,
  naturalSort,
  parse7zProgress
} from './archive'
import { resolveRar, resolveSevenZip } from '../toolResolver'
```

Then the tool:

```ts
/** Walk a directory tree and return every file path, relative to `root`. */
function listFilesRec(root: string, rel = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? join(rel, e.name) : e.name
    if (e.isDirectory()) out.push(...listFilesRec(root, r))
    else out.push(r)
  }
  return out
}

/** Extract `input` into a fresh temp dir and return its path. Caller removes it. */
async function extractToTemp(input: string, ctx: ToolContext): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'filesmith-arc-'))
  const res = await run(resolveSevenZip(), buildExtractArgs(input, dir), {
    signal: ctx.signal,
    onStderr: (c) => {
      const p = parse7zProgress(c)
      if (p !== undefined) ctx.onProgress(p, 'Extracting')
    }
  })
  if (res.code !== 0) {
    rmSync(dir, { recursive: true, force: true })
    // 7-Zip exits non-zero on the password prompt rather than blocking.
    if (/wrong password|encrypted|Cannot open encrypted/i.test(res.stderr + res.stdout))
      throw new Error('Archive is password-protected')
    throw new Error(res.stderr.trim() || 'Could not read this archive')
  }
  return dir
}

/** Pack the contents of `dir` into `output`, choosing 7-Zip or WinRAR by target. */
async function packDir(
  dir: string,
  output: string,
  targetExt: string,
  store: boolean,
  ctx: ToolContext
): Promise<void> {
  const container = containerOf(targetExt)
  if (!container) throw new Error(`Unsupported archive format: ${targetExt}`)

  const onStderr = (c: string): void => {
    const p = parse7zProgress(c)
    if (p !== undefined) ctx.onProgress(p, 'Packing')
  }

  if (container === 'rar') {
    const rar = resolveRar()
    // Guarded in the UI too, but session-restored options can still land here.
    if (!rar) throw new Error('WinRAR not found. CBR output needs WinRAR installed.')
    const res = await run(rar, buildRarPackArgs(output), { signal: ctx.signal, cwd: dir, onStderr })
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'WinRAR could not write the archive')
    return
  }

  const res = await run(resolveSevenZip(), buildPackArgs(output, container, store), {
    signal: ctx.signal,
    cwd: dir,
    onStderr
  })
  if (res.code !== 0) throw new Error(res.stderr.trim() || '7-Zip could not write the archive')
}

const archiveTool: ToolModule = {
  async run(file, options, ctx) {
    const op = String(options.op ?? 'repack')

    if (op === 'extract') {
      const dir = uniqueOutDir(dirname(file.path), basename(file.path, extname(file.path)))
      const res = await run(resolveSevenZip(), buildExtractArgs(file.path, dir), {
        signal: ctx.signal,
        onStderr: (c) => {
          const p = parse7zProgress(c)
          if (p !== undefined) ctx.onProgress(p, 'Extracting')
        }
      })
      if (res.code !== 0) {
        rmSync(dir, { recursive: true, force: true })
        throw new Error(res.stderr.trim() || 'Could not read this archive')
      }
      return dir
    }

    if (op === 'repack') {
      const targetExt = normalizeExt(String(options.format ?? '.cbz'))
      if (needsRar(targetExt) && !resolveRar())
        throw new Error('WinRAR not found. CBR output needs WinRAR installed.')
      const store = options.store !== false
      const temp = await extractToTemp(file.path, ctx)
      const output = reserveOutPath(file.path, targetExt, 'converted')
      try {
        await packDir(temp, output, targetExt, store, ctx)
        return output
      } catch (e) {
        rmSync(output, { force: true })
        throw e
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
    }

    if (op === 'to-pdf') {
      const temp = await extractToTemp(file.path, ctx)
      try {
        const pages = naturalSort(
          listFilesRec(temp).filter((p) =>
            IMAGE_ENTRY_EXTS.some((x) => p.toLowerCase().endsWith(x))
          )
        ).map((p) => join(temp, p))
        if (pages.length === 0) throw new Error('No images found in this archive')

        const output = reserveOutPath(file.path, '.pdf', 'converted')
        // Windows caps a command line at 32767 chars; leave room for the exe
        // and the output path.
        const batches = batchImages(pages, 30000)
        try {
          if (batches.length === 1) {
            await runToOutput(resolveTool('magick'), (o) => [...batches[0], o], output, ctx)
          } else {
            const parts: string[] = []
            for (const [i, b] of batches.entries()) {
              const part = join(temp, `part-${i}.pdf`)
              await runToOutput(resolveTool('magick'), (o) => [...b, o], part, ctx)
              parts.push(part)
              ctx.onProgress(Math.round(((i + 1) / batches.length) * 90), 'Building PDF')
            }
            await runToOutput(
              resolveTool('mutool'),
              (o) => buildPdfMergeArgs(parts, o),
              output,
              ctx
            )
          }
          return output
        } catch (e) {
          rmSync(output, { force: true })
          throw e
        }
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
    }

    if (op === 'from-pdf') {
      const targetExt = normalizeExt(String(options.format ?? '.cbz'))
      if (needsRar(targetExt) && !resolveRar())
        throw new Error('WinRAR not found. CBR output needs WinRAR installed.')
      const dpi = Number(options.dpi ?? 150)
      const pageFormat = String(options.pageFormat ?? 'jpg')
      const quality = Number(options.quality ?? 85)

      const temp = mkdtempSync(join(tmpdir(), 'filesmith-arc-'))
      const output = reserveOutPath(file.path, targetExt, 'converted')
      try {
        ctx.onProgress(undefined, 'Rendering pages')
        const draw = await run(
          resolveTool('mutool'),
          buildPdfImagesArgs(file.path, temp, dpi),
          { signal: ctx.signal }
        )
        if (draw.code !== 0) throw new Error(draw.stderr.trim() || 'Could not render this PDF')

        if (pageFormat === 'jpg') {
          // mutool draw has no jpeg writer, so convert the rendered PNGs in one
          // mogrify pass. A 200-page PNG comic runs to hundreds of megabytes.
          ctx.onProgress(50, 'Compressing pages')
          const mog = await run(
            resolveTool('magick'),
            ['mogrify', '-format', 'jpg', '-quality', String(quality), '*.png'],
            { signal: ctx.signal, cwd: temp }
          )
          if (mog.code !== 0) throw new Error(mog.stderr.trim() || 'Could not compress the pages')
          for (const f of readdirSync(temp))
            if (f.toLowerCase().endsWith('.png')) rmSync(join(temp, f), { force: true })
        }

        await packDir(temp, output, targetExt, true, ctx)
        return output
      } catch (e) {
        rmSync(output, { force: true })
        throw e
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
    }

    throw new Error(`Unknown archive operation: ${op}`)
  }
}
```

Register it in the tool map at the bottom of the file, next to `pdf: pdfTool`:

```ts
  archive: archiveTool
```

- [ ] **Step 4: Run the unit suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all green. If `runToOutput`'s signature differs from the sketch above, adapt the calls to the real one rather than changing `runToOutput`; the `argsFor` callback shape is what keeps `%`-in-path safe.

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/registry.ts test/archive-tool.test.ts
git commit -m "feat(archive): add the archive tool with repack, extract and PDF bridges"
```

---

### Task 6: WinRAR status over IPC

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts` (the `window.filesmith` type, if the API surface is typed there)
- Create: `src/renderer/src/components/useArchiveStatus.ts`

**Interfaces:**
- Consumes: `resolveRar` from Task 4.
- Produces: `window.filesmith.archiveStatus(): Promise<{ rar: boolean }>`; `useArchiveStatus(): { rar: boolean }`.

Read `usePidStatus.ts` first and follow its shape exactly.

- [ ] **Step 1: Add the IPC handler**

In `src/main/ipc.ts`, next to `removebg:status`:

```ts
  ipcMain.handle('archive:status', () => ({ rar: resolveRar() !== null }))
```

with `resolveRar` added to the existing `../toolResolver` import.

- [ ] **Step 2: Expose it in the preload bridge**

In `src/preload/index.ts`, next to `removebgStatus`:

```ts
  archiveStatus: (): Promise<{ rar: boolean }> => ipcRenderer.invoke('archive:status'),
```

- [ ] **Step 3: Add the renderer hook**

```ts
// src/renderer/src/components/useArchiveStatus.ts
import { useEffect, useState } from 'react'

/** Whether WinRAR is installed. Only RAR/CBR *output* depends on it: reading a
 * .cbr always works through bundled 7-Zip. */
export function useArchiveStatus(): { rar: boolean } {
  const [rar, setRar] = useState(false)
  useEffect(() => {
    let live = true
    window.filesmith.archiveStatus().then((s) => {
      if (live) setRar(s.rar)
    })
    return () => {
      live = false
    }
  }, [])
  return { rar }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/env.d.ts src/renderer/src/components/useArchiveStatus.ts
git commit -m "feat(archive): report WinRAR availability to the renderer"
```

---

### Task 7: Catalog entries for the Archives category

**Files:**
- Modify: `src/shared/catalog.ts`
- Modify: `src/renderer/src/components/Icon.tsx`
- Test: `test/archive-catalog-nav.test.ts`

**Interfaces:**
- Consumes: `ToolId` including `'archive'` (Task 2).
- Produces: `CategoryId` includes `'archives'`; `OPERATIONS.archives` with ids `convert`, `extract`, `to-pdf`; `OPERATIONS.pdf` gains id `to-cbz`.

Note: the archive rail icon and colour are the one new visual asset in this feature, and the project rule sends anything touching the look through the owner's mockup process. Use the placeholder below only after the owner has signed off on the glyph and colour.

- [ ] **Step 1: Write the failing test**

```ts
// test/archive-catalog-nav.test.ts
import { describe, expect, it } from 'vitest'
import { acceptsKind, defaultOperation, findOperation, operationsFor } from '@shared/catalog'

describe('archives category', () => {
  it('accepts archive files and nothing else', () => {
    expect(acceptsKind('archives', 'archive')).toBe(true)
    expect(acceptsKind('archives', 'image')).toBe(false)
  })

  it('lands on Convert', () => {
    expect(defaultOperation('archives')).toBe('convert')
  })

  it('offers convert, extract and to-pdf', () => {
    expect(operationsFor('archives').map((o) => o.id)).toEqual(['convert', 'extract', 'to-pdf'])
  })

  it('routes every archives operation to the archive tool', () => {
    for (const o of operationsFor('archives')) expect(o.tool).toBe('archive')
  })

  it('adds a To CBZ card under PDF that runs the archive tool', () => {
    const card = findOperation('pdf', 'to-cbz')
    expect(card?.tool).toBe('archive')
    expect(card?.opKey).toBe('from-pdf')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/archive-catalog-nav.test.ts`
Expected: FAIL, `'archives'` is not a `CategoryId`.

- [ ] **Step 3: Write minimal implementation**

In `src/shared/catalog.ts`:

```ts
export type CategoryId = 'images' | 'video' | 'audio' | 'pdf' | 'documents' | 'archives'
```

Append to `CATEGORIES`:

```ts
  { id: 'archives', label: 'Archives', kinds: ['archive'], color: '#a16207', icon: 'archive' }
```

Append to `OPERATIONS`:

```ts
  archives: [
    {
      id: 'convert',
      label: 'Convert',
      desc: 'Repack as CBZ, CBR, CB7 or ZIP',
      color: '#5b5bd6',
      icon: 'convert',
      tool: 'archive',
      opKey: 'repack'
    },
    {
      id: 'extract',
      label: 'Extract',
      desc: 'Unpack into a folder',
      color: '#22b364',
      icon: 'resize',
      tool: 'archive',
      opKey: 'extract'
    },
    {
      id: 'to-pdf',
      label: 'To PDF',
      desc: 'Turn a comic archive into a PDF',
      color: '#ef4444',
      icon: 'pdf',
      tool: 'archive',
      opKey: 'to-pdf'
    }
  ]
```

Append to the existing `pdf` operations array:

```ts
    {
      id: 'to-cbz',
      label: 'To CBZ',
      desc: 'Pack the pages as a comic archive',
      color: '#a16207',
      icon: 'archive',
      tool: 'archive',
      opKey: 'from-pdf'
    }
```

In `src/renderer/src/components/Icon.tsx`, add the `archive` glyph next to `pdf` (a lidded box):

```tsx
  archive: (
    <path d="M3.5 7.5h17v3h-17zM5 10.5v9h14v-9M10 14h4" />
  ),
```

- [ ] **Step 4: Run test and launch the app**

Run: `npx vitest run test/archive-catalog-nav.test.ts && npm run typecheck`
Expected: PASS.

Run: `npm run dev`
Expected: an Archives entry in the category rail with three operation cards, and a To CBZ card on the PDF category.

- [ ] **Step 5: Commit**

```bash
git add src/shared/catalog.ts src/renderer/src/components/Icon.tsx test/archive-catalog-nav.test.ts
git commit -m "feat(archive): add the Archives category and its operation cards"
```

---

### Task 8: Options panel for archive operations

**Files:**
- Modify: `src/renderer/src/components/OptionsPanel.tsx`
- Test: manual, through `npm run dev`

**Interfaces:**
- Consumes: `archiveTargets`, `needsRar` (Task 1); `useArchiveStatus` (Task 6); operation `opKey` values (Task 7).
- Produces: job options `{ op, format, store, dpi, pageFormat, quality }` matching the contract in Task 5.

Read how the PDF branch of `OptionsPanel` builds its controls and reuse the same chip and select components. Introduce no new visual vocabulary.

- [ ] **Step 1: Add the archive branch**

For `tool === 'archive'`:

- `op` is always the current operation's `opKey`.
- **Convert (`repack`)**: target chips from `archiveTargets(file.ext, rar)` — but render the full `ARCHIVE_FORMATS` list minus the source, and when `needsRar(f.ext) && !rar` render the chip `disabled` with `title="WinRAR not found"` so hovering explains it, instead of hiding the option. Plus a Compression control: `Store` (default, `store: true`) and `Normal` (`store: false`), with the helper line "Comic pages are already compressed, so Store is faster and the same size."
- **Extract**: no options. Show the standard "no options" state the panel already uses for option-free operations.
- **To PDF (`to-pdf`)**: no options.
- **To CBZ (`from-pdf`)**: a DPI control matching the existing Pages-to-PNG card (`dpi`, default 150); a page format toggle `JPEG` / `PNG` (`pageFormat`, default `'jpg'`); a quality slider shown only for JPEG (`quality`, default 85); and target chips limited to the comic formats `.cbz` / `.cb7` / `.cbt` / `.cbr`, with the same disabled-plus-tooltip treatment for `.cbr`.

- [ ] **Step 2: Verify the greyed-out CBR chip by hand**

Run: `npm run dev`

With WinRAR **not** installed: open Archives, drop a `.cbz`, confirm the CBR and RAR chips are visibly disabled, are not selectable, and show `WinRAR not found` on hover.

If WinRAR is installed on this machine, temporarily make `resolveRar` return `null` to check the disabled state, then revert.

- [ ] **Step 3: Verify the enabled path**

With WinRAR installed, confirm the CBR chip is selectable and a `.cbz` converts to a `.cbr` that opens in a comic reader.

- [ ] **Step 4: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/OptionsPanel.tsx
git commit -m "feat(archive): add archive options with a WinRAR-gated CBR target"
```

---

### Task 9: End-to-end coverage

**Files:**
- Modify: `e2e/workflows.spec.ts`
- Create: `e2e/fixtures/sample.cbz` (three tiny PNG pages named `p1.png`, `p2.png`, `p10.png`)
- Create: `e2e/fixtures/sample-pages.pdf` (a 3-page PDF)

**Interfaces:**
- Consumes: the full chain from Tasks 1 through 8.
- Produces: two e2e cases proving the preload / IPC / engine path unit tests cannot reach.

- [ ] **Step 1: Build the fixtures**

```bash
mkdir -p e2e/fixtures/_pages
npx --yes magick -size 200x300 xc:white e2e/fixtures/_pages/p1.png
npx --yes magick -size 200x300 xc:gray  e2e/fixtures/_pages/p2.png
npx --yes magick -size 200x300 xc:black e2e/fixtures/_pages/p10.png
"resources/bin/7z.exe" a -tzip e2e/fixtures/sample.cbz ./e2e/fixtures/_pages/*
"resources/bin/magick.exe" e2e/fixtures/_pages/p1.png e2e/fixtures/_pages/p2.png e2e/fixtures/_pages/p10.png e2e/fixtures/sample-pages.pdf
rm -rf e2e/fixtures/_pages
```

- [ ] **Step 2: Write the failing e2e cases**

Follow the existing structure in `e2e/workflows.spec.ts` for launching the app, adding a file and running a job. Add:

```ts
test('converts a CBZ to a CB7', async () => {
  // Add e2e/fixtures/sample.cbz, choose Archives > Convert, pick CB7, Run.
  // Assert: a "sample (converted).cb7" appears next to the fixture, is
  // non-empty, and the queue row reports done.
})

test('converts a PDF to a CBZ', async () => {
  // Add e2e/fixtures/sample-pages.pdf, choose PDF > To CBZ, Run.
  // Assert: "sample-pages (converted).cbz" exists and `7z l` on it lists 3
  // entries.
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npm run build && npm run test:e2e`
Expected: FAIL until the assertions are filled in against the real UI selectors.

- [ ] **Step 4: Fill in the assertions and go green**

Run: `npm run build && npm run test:e2e`
Expected: PASS, both new cases.

- [ ] **Step 5: Run the full gate and commit**

```bash
npm test && npm run typecheck && npm run lint && npm run build && npm run test:e2e
git add e2e/workflows.spec.ts e2e/fixtures/sample.cbz e2e/fixtures/sample-pages.pdf
git commit -m "test(archive): cover CBZ to CB7 and PDF to CBZ end to end"
```

---

### Task 10: Version bump, docs and PR

**Files:**
- Modify: `package.json` (minor version bump: this is a feature)
- Modify: `CLAUDE.md` (project layout section: note `tools/archive.ts` and the bundled 7-Zip)
- Modify: `README.md` (the operations list)

- [ ] **Step 1: Bump the minor version**

`0.2.2` becomes `0.3.0`. Features take the minor number.

- [ ] **Step 2: Update the project docs**

In `CLAUDE.md`, add `archive.ts` to the `src/main/tools/` list and add 7-Zip to the bundled-tools sentence. In `README.md`, add archive conversion to the operations the app performs.

- [ ] **Step 3: Run the full PR gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run test:e2e`
Expected: all green.

- [ ] **Step 4: Package and install locally**

Run: `npm run package`
Install the built `Filesmith-Setup-x64-0.3.0.exe` and confirm a real `.cbr` from disk converts to `.cbz` and opens in a reader.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/archive-conversion
gh pr create --title "feat: archive conversion (CBZ, CBR, CB7, CBT) with PDF bridges" --body "Implements docs/superpowers/specs/2026-08-31-archive-conversion-design.md"
```

---

## Self-Review

**Spec coverage.** Formats read: Task 2. Formats written and the RAR gate: Tasks 1, 4, 5, 8. The four operations: Tasks 5 and 7. 7-Zip bundling: Task 4. `archive.ts` pure functions: Tasks 1 and 3. `archiveTool`: Task 5. `resolveRar`: Task 4. IPC and preload: Task 6. Shared types: Task 2. Renderer: Tasks 7 and 8. Error handling: Task 5 (password, no-images, WinRAR guard, output cleanup on failure). Testing: unit coverage in Tasks 1 through 4, e2e in Task 9. Deferred items are not implemented, as intended.

**Type consistency.** `containerOf` / `needsRar` / `archiveTargets` (Task 1) are used unchanged in Tasks 5 and 8. `buildExtractArgs` / `buildPackArgs` / `buildRarPackArgs` / `parse7zProgress` / `naturalSort` / `batchImages` / `IMAGE_ENTRY_EXTS` (Task 3) are used unchanged in Task 5. `resolveSevenZip` / `resolveRar` (Task 4) are used unchanged in Tasks 5 and 6. The job-option names in Task 5's table match the options Task 8 emits.

**Open dependency.** Task 7 introduces the Archives rail icon and colour, the one new visual asset. Under the project's design rule that needs the owner's sign-off before the placeholder glyph and `#a16207` are treated as final.
