# Command Line and Claude Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `filesmith` command that runs every Filesmith operation (convert, compress, resize, upscale, removebg, generate, the PDF tools, plus `formats`, `doctor`, `setup`, `skill`) from any terminal with the app's engine, option names and never-overwrite rule, and a Claude Code skill that teaches an agent to drive it safely.

**Architecture:** The installed `Filesmith.exe` runs a second build entry (`out/main/cli.js`) as plain Node (`ELECTRON_RUN_AS_NODE=1`) behind `filesmith.cmd` and an extensionless sh shim that the per-user installer puts on PATH. The engine stops importing `electron` (one `EngineEnv` provider, set by `index.ts` for the app and by `src/cli/bootstrap.ts` for the CLI), so the CLI reuses `JobQueue`, the tool modules and the bundled tools unchanged, never touches the single-instance lock, and runs next to an open app. The CLI is layered as pure, unit-tested modules (catalog, parser, options, inputs, planner, event writers) under thin command adapters whose engine access is injected.

**Tech Stack:** Electron 43 (its Node is 24.18; verified 2026-10-04 on this machine: `fs.globSync` exists, `--use-system-ca` is accepted, `NODE_USE_ENV_PROXY=1` routes `fetch` through `HTTPS_PROXY`), TypeScript strict, electron-vite 5 (Vite/Rollup), Node's `util.parseArgs`, Vitest 3, Playwright Test, electron-builder 26 NSIS, Windows PowerShell 5.1 (PATH edit only).

**Spec:** `docs/superpowers/specs/2026-10-04-cli-and-skill-design.md` (read it fully before any task; section numbers below refer to it).

## Owner decisions this plan builds

The spec's open questions O1 to O11 are built with the spec's recommended answers. They are approved together with this plan (single approval). If the owner answers one differently, only the tasks listed change:

| #   | Built as                                                           | Tasks that change if the answer differs |
| --- | ------------------------------------------------------------------ | --------------------------------------- |
| O1  | Node mode behind `filesmith.cmd` + sh shim                         | 1, 2, 11, 16, 18 (whole runtime)        |
| O2  | `--use-system-ca` + `NODE_USE_ENV_PROXY=1` in the shims            | 16, 15 (doctor proxy check)             |
| O3  | Accept "Terminate batch job (Y/N)?"; exit 130 on Ctrl+C            | 6, 11, 16                               |
| O4  | `generate` writes to the current folder unless `--out`             | 13                                      |
| O5  | Explicit rembg install with a pinned model folder, app and CLI     | 5, 14                                   |
| O6  | `--out` folder is created (with parents) when missing              | 11, 13                                  |
| O7  | Folder input takes its own files; `--recursive` descends           | 9                                       |
| O8  | Same-format file is `skipped`, exit 0                              | 10                                      |
| O9  | Settings button built from existing primitives, approved by screenshot | 17                                  |
| O10 | No `filesmith extract` in v1                                       | none                                    |
| O11 | A requirement missing for every input is exit 2 (nothing ran)      | 10, 11 (`reduceExit` and the e2e removebg case) |

## Spec deviations decided in this plan (covered by the same approval)

- **D-a** The Rollup input is `src/cli/bootstrap.ts` (it owns `process`), not `src/cli/main.ts`; `main.ts` stays the injectable `main(io, deps)`. The output is still `out/main/cli.js`.
- **D-b** Dry-run planners live in one new module `src/main/tools/plan.ts` (`planOutput(tool, file, options, outDir, claimed)`) instead of a method on each `ToolModule`, so the 1384-line `tools/registry.ts` does not grow. Same contract as spec M4.
- **D-c** M6's "the app shows a one-time Set up step": the renderer stays untouched (the hard rule wins). The app's first removebg job runs the same installer inline, with step messages in the row, exactly where today's first job downloads silently.
- **D-d** Hidden files skipped in folder inputs are dot-files, `Thumbs.db` and `desktop.ini` (Node cannot read the Windows hidden attribute without a native call).
- **D-e** `setup remove <tool>` moves folders to the Recycle Bin up to 5 GB and 5,000 files (the Recycle Bin's practical limit, same as the owner's `trash` rule). Larger folders (a PiD install is about 6 GB) need an explicit `--permanent`, otherwise exit 1 with the size and the flag. Additive flag.
- **D-f** `skipped` events for folder members that the verb cannot take carry no `id` (they are not jobs). `step` events gain an optional `detail` (used by `setup --dry-run`). Both additive to schema v1.
- **D-g** LibreOffice presence is not checked at plan time (a PATH-only install cannot be detected without spawning it); a missing LibreOffice fails those files at run time with `TOOL_MISSING`, as the spec requires.
- **D-h** `filesmith` with no arguments prints the root help on stdout and exits 0.
- **D-i** The README stays logo and badges only (the owner stripped it on purpose in `e2c7b39`); the user documentation is `docs/cli.md`, linked from CLAUDE.md. Spec 12 asked for a README section; the PR raises it.
- **D-j** `removebg:status.uvAvailable` is now always true (setup bootstraps uv itself), so the existing Settings and Remove BG wording stays correct without touching the renderer.
- **D-k** The Settings button e2e lives in a new `e2e/skill.spec.ts` (it needs its own app launch with a temporary `USERPROFILE`), not in `e2e/ui.spec.ts`.

## Global Constraints

- **No em-dashes anywhere**: code, comments, help text, skill text, docs, commit messages, PR text. Use commas, en-dashes or rephrase. A test in Task 7 scans every new file for U+2014.
- **Renderer boundary:** the only renderer change is the Settings `CLAUDE` group (Task 17). No existing IPC channel, preload signature or renderer component changes; `skill:install`, `skill:status`, `installSkill()`, `skillStatus()` are additive.
- **Never overwrite:** outputs come from `reserveOutPath` / `reserveFileInDir` / `uniqueOutDir` at run time and from `planFileInDir` / `planOutDir` in dry runs. No `--force` flag exists anywhere.
- **No auto-download from the CLI:** only `filesmith setup` downloads. Engine jobs run with `allowDownload: false` in the CLI.
- **The CLI never imports `electron`:** a test walks the import graph from `src/cli/bootstrap.ts` (Task 11), and an e2e test greps `out/main/cli.js` and its chunks.
- **JSON schema v1 is additive-only:** every line carries `v: 1`, `event`, `ts`; fields that do not apply are omitted, never `null` (except `pct`).
- **Exit codes:** `0` all ok or skipped, `1` some failed, `2` usage or run-level requirement failure (nothing ran), `130` Ctrl+C.
- **Option names mirror the app:** flags are generated in `src/cli/catalog.ts` from the `@shared` catalogs; a test pins every app option key to a flag and every default to `DEFAULT_OPTIONS` in `src/renderer/src/state.ts`.
- **userData** is `%APPDATA%\Filesmith` (or `FILESMITH_USER_DATA`), shared with the app.
- **Tests:** unit tests `test/*.test.ts` (Vitest, `npx vitest run test/<file>`); process-level tests `e2e/cli.spec.ts` (Playwright Test, after `npm run build`). Tests that spawn bundled binaries skip when `resources/bin` is empty (CI unit job).
- **Delivery:** one issue, branch `feat/<N>-cli`, one PR, version 0.5.2 to **0.6.0** inside the PR, squash-merge only after the owner's explicit "merge" for this PR. Commits `type(scope): subject` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Deleting files:** `trash "<absolute path>"` for anything outside this session's scratchpad or its own build output (`dist/`, `out/`); `git rm` for tracked files the change removes.
- **Style:** prettier (`semi: false`, `singleQuote: true`, `printWidth: 100`, `trailingComma: none`); `.tsx` files export components only.

## Review Focus

- **Two inputs that map to one output name in a single run** (`photo.png` and `photo.jpg` with `--to webp`): the dry run must predict `photo.webp` and `photo (converted).webp`, and the real run must produce exactly that set of names, neither overwriting the other. Which input gets the untagged name may differ, because jobs run in parallel and each reserves its name when it starts (spec 2.4). Pinned in Task 3 (`claimed` set) and Task 11 (e2e compares the sets, not the id mapping).
- **Paths with spaces, `&`, non-ASCII letters, and a file named like a flag** (`-x.png` after `--`): they must reach the engine byte for byte, through the parser and both shims. Pinned in Task 7 (parser), Task 9 (inputs) and Task 16 (shim smoke test).
- **stdout closed early** (`filesmith convert *.png --to webp --json | head -1`): no stack trace, running jobs are canceled, exit code 130, no orphaned tool processes. Pinned in Task 11 (bootstrap EPIPE handling, e2e).
- **`--out` pointing at an existing file, or at a folder that cannot be created:** exit 2 with `OUT_DIR_MISSING` before any job starts, nothing written. Pinned in Task 11.
- **Ctrl+C while jobs are still queued:** `JobQueue.cancelAll()` drops queued jobs silently, so the runner itself must emit `canceled` for every job that never started; the summary counts must add up to the job count and the process must exit. Pinned in Task 11 (runner test with a queue that models the silent drop).

## File Structure

```
src/main/
  env.ts                  NEW   EngineEnv provider: userData, resourcesDir, downloadsDir, fetch, host
  boot.ts                 NEW   bootEngine(): magick env, temp sweep, registry user layers
  atomicWrite.ts          NEW   writeFileAtomic(path, data) (pid-suffixed temp + rename)
  locks.ts                NEW   cross-process lock files under userData/locks
  recycle.ts              NEW   moveToRecycleBin(path), folderStats(path), RECYCLE_LIMIT
  uvInstall.ts            NEW   ensureUv() (moved out of pid/install.ts, now public)
  skill.ts                NEW   installSkill / skillStatus (shared by CLI and app)
  rembg/paths.ts          NEW   rembg tool dir, exe, pinned model folder, readiness probes
  rembg/setup.ts          NEW   setupRembg(): uv tool install + model warm-up
  tools/plan.ts           NEW   planOutput(): dry-run output prediction per tool
  tools/readiness.ts      NEW   upscale/removebg readiness, setupHint, notReadyMessage
  output.ts                     + planFileInDir / planOutDir (shared candidate generator)
  run.ts                        RunOptions.env
  jobQueue.ts                   allowDownload option -> ToolContext
  tools/tool.ts                 ToolContext.allowDownload
  tools/registry.ts             removebg uses installed rembg + U2NET_HOME; CLI-aware messages
  toolResolver.ts               paths from env; resolveRembg/removebgStatus via rembg/paths
  pid/paths.ts, pid/install.ts  env paths; file lock; signal + byte progress; ensureUv moved
  net/download.ts               fetch from env; onBytes
  net/integrity.ts              userData from env; atomic write
  comfy/store.ts                userData from env; atomic write
  generate/index.ts             outDir option (M3); slug exported
  generate/comfy.ts             userData from env; comfy-live.json (M8)
  generate/companions.ts        file lock; signal + bytes
  registry/load.ts, channel.ts  paths and fetch from env
  tools/ncnnModels.ts           userData from env
  index.ts                      setEngineEnv(app), bootEngine()
  ipc.ts                        + skill:install, skill:status
src/cli/
  bootstrap.ts            NEW   process entry: env, boot, SIGINT/SIGBREAK, EPIPE, exit code
  env.ts                  NEW   cliEngineEnv(facts) (pure)
  version.ts              NEW   VERSION (build-time define)
  main.ts                 NEW   main(io, deps): parse, dispatch, usage errors
  exit.ts                 NEW   EXIT codes, ErrorCode, CliError, UsageError, reduceExit
  events.ts               NEW   schema v1 types, Reporter, JsonReporter (rate-limited)
  human.ts                NEW   HumanReporter (result lines, summary, TTY progress)
  catalog.ts              NEW   CommandSpec / FlagSpec table from @shared catalogs
  parse.ts                NEW   parseArgv(): util.parseArgs + router + aliases
  help.ts                 NEW   renderHelp / renderRootHelp / renderGroupHelp
  options.ts              NEW   coerce(), buildOptions(), buildGenerateFlags()
  inputs.ts               NEW   expandInputs(): globs, folders, stdin, de-dup, natural order
  plan.ts                 NEW   planJobs(): routing, skips, per-file errors, predicted outputs
  planPdf.ts              NEW   planPdfJobs(): merge as one job, pdf tools
  io.ts                   NEW   CliIO: everything main() touches of the process
  runner.ts               NEW   runPlanned(): JobQueue -> events, cancel, classifyError
  deps.ts                 NEW   defaultDeps(): engine bindings for every command
  commands/files.ts       NEW   convert, compress, resize, upscale, removebg, pdf <tool>
  commands/generate.ts    NEW   generate adapter
  commands/setup.ts       NEW   setup <tool>, StepReporter
  commands/formats.ts     NEW   formats [verb]
  commands/doctor.ts      NEW   doctor checks
  commands/skill.ts       NEW   skill install | status
src/preload/index.ts            + installSkill(), skillStatus()
src/shared/ipc.ts               + SkillStatus, SkillInstallResult
src/shared/generate.ts          GenerateOptions.outDir
src/main/generate/comfy.ts      + firstLiveComfy() (doctor)
src/renderer/src/components/views/
  ClaudeSkill.tsx         NEW   Settings CLAUDE group body
  SettingsView.tsx              + <SettingGroup title="CLAUDE">
resources/cli/            NEW   filesmith.cmd, filesmith (sh, LF), path.ps1
resources/skill/filesmith/NEW   SKILL.md, reference.md
build/installer/path.nsh  NEW   PATH add/remove macros
build/installer.nsh             include path.nsh, customUnInstall
build/installer/pages.nsh       customInstall calls the PATH add
electron-builder.yml            extraResources cli, skill; RunAsNode fuse note
electron.vite.config.ts         cli input, __APP_VERSION__ define
vitest.config.ts                setupFiles, __APP_VERSION__ define
.gitattributes            NEW   LF for the sh shim, CRLF for .cmd/.ps1
.github/workflows/release.yml   packed-CLI smoke step, paths filter
scripts/verify-bundle.mjs       shims and skill files required
test/setup/engineEnv.ts   NEW   Vitest setup: setEngineEnv for tests
test/helpers/importGraph.ts NEW static import walker
test/*.test.ts            NEW   env, boot, engine-graph, plan-output, locks, comfy-live, readiness,
                                rembg-setup, recycle, path-ps1, skill, no-em-dash, cli-* (version,
                                exit, events, human, catalog, parse, help, options, inputs, plan,
                                plan-pdf, runner, main, graph, generate, setup, formats, doctor)
e2e/cli.spec.ts           NEW   process-level CLI tests (node out/main/cli.js)
e2e/cli-packed.spec.ts    NEW   the shims in the unpacked install layout
e2e/skill.spec.ts         NEW   Settings > CLAUDE button
docs/cli.md               NEW   user and agent reference, verified runtime facts
CLAUDE.md                       CLI entry (README unchanged, D-i)
package.json                    0.6.0, script cli
```

---

### Task 0: Issue, branch and design record

**Files:**
- Create: `docs/superpowers/plans/2026-10-04-cli-and-skill.md` (this file, already written)
- Track: `docs/superpowers/specs/2026-10-04-cli-and-skill-design.md` (currently untracked)

**Interfaces:**
- Consumes: nothing.
- Produces: issue number `<N>` and branch `feat/<N>-cli`, used by every later commit and the PR.

- [ ] **Step 1: Create the issue**

```bash
gh issue create --title "Command-line tool and Claude skill" --body "$(cat <<'EOF'
Ship a `filesmith` command bundled with the app (verb-first grammar mirroring the sidebar, --json events, --dry-run everywhere, never overwrite, exit codes 0/1/2/130), plus a Claude Code skill installed by `filesmith skill install` and a Settings button.

Spec: docs/superpowers/specs/2026-10-04-cli-and-skill-design.md
Plan: docs/superpowers/plans/2026-10-04-cli-and-skill.md
EOF
)"
```

Expected: a URL ending in `/issues/<N>`. Note `<N>`.

- [ ] **Step 2: Branch from an up-to-date main**

```bash
git switch main && git pull --ff-only && git switch -c feat/<N>-cli
```

Expected: `Switched to a new branch 'feat/<N>-cli'`. The untracked spec comes along.

- [ ] **Step 3: Keep prettier off the plan documents**

The plan's code blocks hold partial snippets (single indented lines, fragments of a function). `prettier --write` on this file dedents them and rewrites inline code spans, which corrupts the instructions, and `npx prettier --check .` (the PR gate and release.yml) fails on it as it stands. Append to `.prettierignore`:

```
# Design and plan documents: their code blocks are partial snippets, not code.
docs/superpowers
```

Run: `npx prettier --check .`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 4: Commit the spec and plan**

```bash
git add .prettierignore docs/superpowers/specs/2026-10-04-cli-and-skill-design.md docs/superpowers/plans/2026-10-04-cli-and-skill.md
git commit -m "docs(cli): design and implementation plan for the command line and skill" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: CLI build entry and the Node-mode proof (M11)

This task de-risks the whole design first (spec section 9, row 2): it proves that the packed `Filesmith.exe` runs a script from inside `app.asar` in Node mode and that `process.resourcesPath` points at the install's `resources` folder.

**Files:**
- Create: `src/cli/version.ts`, `src/cli/bootstrap.ts` (temporary probe body, replaced in Task 11), `test/cli-version.test.ts`
- Modify: `electron.vite.config.ts` (main input + define), `vitest.config.ts` (define), `tsconfig.node.json` (include `src/cli`), `eslint.config.mjs` (node globals for `src/cli`), `package.json` (script `cli`)

**Interfaces:**
- Consumes: nothing.
- Produces: `VERSION: string` from `src/cli/version.ts`; build output `out/main/cli.js`; the global compile-time constant `__APP_VERSION__` in both the main build and Vitest.

- [ ] **Step 1: Write the failing test**

`test/cli-version.test.ts`:

```ts
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/cli/version'

describe('VERSION', () => {
  it('is the package.json version, injected at build time', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
      version: string
    }
    expect(VERSION).toBe(pkg.version)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/cli-version.test.ts`
Expected: FAIL, `Failed to resolve import "../src/cli/version"`.

- [ ] **Step 3: Implement**

`src/cli/version.ts`:

```ts
// Replaced at build time by electron-vite (main build) and Vitest (tests) with
// the package.json version. The fallback only shows if a third bundler forgets
// the define, which makes the mistake visible instead of silent.
declare const __APP_VERSION__: string | undefined

export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'
```

`src/cli/bootstrap.ts` (probe body, replaced in Task 11):

```ts
import { VERSION } from './version'

// Task 1 probe: proves Node mode inside app.asar. Replaced in Task 11.
process.stdout.write(`${VERSION} ${process.resourcesPath ?? '(no resourcesPath)'}\n`)
```

`electron.vite.config.ts`, replace the `main` block and add the version read at the top:

```ts
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The command line (spec 4.1). Runs as plain Node under
          // ELECTRON_RUN_AS_NODE, so nothing it reaches may import electron.
          cli: resolve(__dirname, 'src/cli/bootstrap.ts')
        }
      }
    }
  },
```

(the `preload` and `renderer` blocks stay as they are).

`vitest.config.ts`, add the version define (keep everything else):

```ts
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Main-process modules import { app } from 'electron' at module scope;
      // this minimal stub lets unit tests load them without a running Electron.
      electron: resolve(__dirname, 'test/mocks/electron.ts')
    }
  },
  test: {
    include: ['test/**/*.test.ts']
  }
})
```

`tsconfig.node.json`: add `"src/cli/**/*"` to `include` (after `"src/main/**/*"`).

`eslint.config.mjs`: change the node-globals block's `files` to `['src/main/**/*.ts', 'src/cli/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.mjs']`.

`package.json` scripts: add `"cli": "node out/main/cli.js"` after `"start"`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/cli-version.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Prove the dev build under plain Node and under Electron's Node**

```bash
npm run build
node out/main/cli.js
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe out/main/cli.js
```

Expected: `0.5.2 (no resourcesPath)` from node; `0.5.2 C:\...\node_modules\electron\dist\resources` from Electron.

- [ ] **Step 6: Prove the packed layout (the spec's first-task risk)**

```bash
npx electron-builder --win dir --publish never
ELECTRON_RUN_AS_NODE=1 dist/win-unpacked/Filesmith.exe dist/win-unpacked/resources/app.asar/out/main/cli.js
ELECTRON_RUN_AS_NODE=1 dist/win-unpacked/Filesmith.exe --use-system-ca dist/win-unpacked/resources/app.asar/out/main/cli.js
```

Expected (both runs): `0.5.2 C:\...\Filesmith\dist\win-unpacked\resources`. electron-builder only warns about missing `resources/bin` etc. here; that is fine for this proof.

If Electron cannot load the script from inside `app.asar`: add to `electron-builder.yml` under `files:` a sibling key `asarUnpack: ['out/main/cli.js', 'out/main/chunks/**']`, rebuild, and use `resources/app.asar.unpacked/out/main/cli.js` as the script path everywhere this plan says `app.asar/out/main/cli.js` (Tasks 16 and 18). Record which path won in the commit message.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/cli electron.vite.config.ts vitest.config.ts tsconfig.node.json eslint.config.mjs package.json test/cli-version.test.ts
git commit -m "build(cli): second main entry out/main/cli.js with build-time version" -m "Proved: packed Filesmith.exe runs app.asar/out/main/cli.js under ELECTRON_RUN_AS_NODE, resourcesPath = <install>/resources." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Engine environment provider and shared boot (M1, M2)

**Files:**
- Create: `src/main/env.ts`, `src/main/boot.ts`, `src/main/atomicWrite.ts`, `src/cli/env.ts`, `test/setup/engineEnv.ts`, `test/helpers/importGraph.ts`, `test/env.test.ts`, `test/boot.test.ts`, `test/engine-graph.test.ts`
- Modify: `vitest.config.ts` (`setupFiles`), `src/main/index.ts:1-40,204-215`, `src/main/toolResolver.ts:3,28-32,75-78,100-103,157-161`, `src/main/pid/paths.ts:3,19-21,46-60`, `src/main/tools/ncnnModels.ts:3,22-24`, `src/main/comfy/store.ts:1-3,20-22,36-38`, `src/main/generate/comfy.ts:5,108`, `src/main/generate/index.ts:1,119`, `src/main/net/download.ts:14,24-39`, `src/main/net/integrity.ts:3,32-38,50-63`, `src/main/registry/load.ts:3,33-60`, `src/main/registry/channel.ts:4,59-63,129-131`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `src/main/env.ts`: `interface EngineEnv { userData: string; resourcesDir: string; downloadsDir: string; fetch: (url: string, init?: RequestInit) => Promise<Response>; host: 'app' | 'cli' }`, `setEngineEnv(e: EngineEnv): void`, `engineEnv(): EngineEnv` (throws `Error('engine env not configured')`), `resourcePath(...parts: string[]): string`, `userDataPath(...parts: string[]): string`, `resetEngineEnvForTests(): void`.
  - `src/main/boot.ts`: `sweepStaleTempDirs(now?: number, dir?: string): void`, `bootEngine(): void`.
  - `src/main/atomicWrite.ts`: `writeFileAtomic(path: string, data: string | Buffer): void`.
  - `src/cli/env.ts`: `interface ProcessFacts { execPath: string; resourcesPath?: string; env: Record<string, string | undefined>; homedir: string; moduleDir: string }`, `cliEngineEnv(f: ProcessFacts, fetchImpl: EngineEnv['fetch']): EngineEnv`.
  - `test/helpers/importGraph.ts`: `importGraph(entry: string): { files: string[]; externals: Set<string> }`.

- [ ] **Step 1: Write the failing tests**

`test/env.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  engineEnv,
  resetEngineEnvForTests,
  resourcePath,
  setEngineEnv,
  userDataPath,
  type EngineEnv
} from '../src/main/env'
import { cliEngineEnv } from '../src/cli/env'
import { resolveTool } from '../src/main/toolResolver'

const saved = engineEnv()
afterEach(() => setEngineEnv(saved))

const fakeFetch: EngineEnv['fetch'] = () => Promise.reject(new Error('no network in tests'))

describe('engineEnv', () => {
  it('throws a clear error when nothing configured it', () => {
    resetEngineEnvForTests()
    expect(() => engineEnv()).toThrow('engine env not configured')
  })

  it('joins resource and userData paths from the configured env', () => {
    setEngineEnv({ ...saved, resourcesDir: 'R:\\res', userData: 'U:\\data' })
    expect(resourcePath('bin', 'ffmpeg.exe')).toBe(join('R:\\res', 'bin', 'ffmpeg.exe'))
    expect(userDataPath('pid')).toBe(join('U:\\data', 'pid'))
  })

  it('resolveTool finds a bundled binary under resourcesDir/bin', () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-env-'))
    try {
      mkdirSync(join(root, 'bin'))
      writeFileSync(join(root, 'bin', 'ffmpeg.exe'), '')
      setEngineEnv({ ...saved, resourcesDir: root })
      expect(resolveTool('ffmpeg')).toBe(join(root, 'bin', 'ffmpeg.exe'))
      expect(resolveTool('nope')).toBe('nope')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('cliEngineEnv', () => {
  const base = {
    env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' },
    homedir: 'C:\\Users\\a',
    moduleDir: 'D:\\repo\\out\\main'
  }

  it('packaged: Filesmith.exe uses process.resourcesPath and %APPDATA%\\Filesmith', () => {
    const e = cliEngineEnv(
      {
        ...base,
        execPath: 'C:\\Users\\a\\AppData\\Local\\Programs\\Filesmith\\Filesmith.exe',
        resourcesPath: 'C:\\Users\\a\\AppData\\Local\\Programs\\Filesmith\\resources'
      },
      fakeFetch
    )
    expect(e.resourcesDir).toBe('C:\\Users\\a\\AppData\\Local\\Programs\\Filesmith\\resources')
    expect(e.userData).toBe(join('C:\\Users\\a\\AppData\\Roaming', 'Filesmith'))
    expect(e.downloadsDir).toBe(join('C:\\Users\\a', 'Downloads'))
    expect(e.host).toBe('cli')
  })

  it('packaged without resourcesPath falls back to <exe dir>\\resources', () => {
    const e = cliEngineEnv({ ...base, execPath: 'C:\\P\\Filesmith\\FILESMITH.EXE' }, fakeFetch)
    expect(e.resourcesDir).toBe(join('C:\\P\\Filesmith', 'resources'))
  })

  it('dev (node or electron.exe): the repo resources folder two levels above out/main', () => {
    const e = cliEngineEnv({ ...base, execPath: 'C:\\node\\node.exe' }, fakeFetch)
    expect(e.resourcesDir).toBe(join('D:\\repo', 'resources'))
  })

  it('FILESMITH_USER_DATA overrides the data folder (e2e isolation)', () => {
    const e = cliEngineEnv(
      { ...base, env: { ...base.env, FILESMITH_USER_DATA: 'T:\\ud' }, execPath: 'node.exe' },
      fakeFetch
    )
    expect(e.userData).toBe('T:\\ud')
  })
})
```

`test/boot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { sweepStaleTempDirs } from '../src/main/boot'

describe('sweepStaleTempDirs', () => {
  it('removes only filesmith- dirs older than an hour', () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-sweep-'))
    try {
      const old = join(root, 'filesmith-old')
      const fresh = join(root, 'filesmith-fresh')
      const other = join(root, 'someone-else')
      for (const d of [old, fresh, other]) mkdirSync(d)
      const now = Date.now()
      const twoHoursAgo = (now - 2 * 60 * 60 * 1000) / 1000
      utimesSync(old, twoHoursAgo, twoHoursAgo)
      utimesSync(other, twoHoursAgo, twoHoursAgo)
      sweepStaleTempDirs(now, root)
      expect(existsSync(old)).toBe(false)
      expect(existsSync(fresh)).toBe(true)
      expect(existsSync(other)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

`test/helpers/importGraph.ts`:

```ts
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

const ROOT = resolve(__dirname, '..', '..')
const IMPORT_RE =
  /^\s*(import|export)\s+(type\s+)?[^'"]*?\sfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm

function resolveSpec(from: string, spec: string): string | null {
  let base: string | null = null
  if (spec.startsWith('@shared/')) base = join(ROOT, 'src', 'shared', spec.slice('@shared/'.length))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  if (!base) return null
  for (const cand of [base + '.ts', base + '.tsx', join(base, 'index.ts'), base])
    if (existsSync(cand) && cand.match(/\.tsx?$/)) return cand
  return null
}

/** Every source file reachable from `entry` through value imports (type-only
 * imports are erased by the compiler and ignored here), plus the bare module
 * names it pulls in (node builtins, 'electron', npm packages). */
export function importGraph(entry: string): { files: string[]; externals: Set<string> } {
  const seen = new Set<string>()
  const externals = new Set<string>()
  const stack = [resolve(entry)]
  while (stack.length) {
    const file = stack.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf-8')
    for (const m of src.matchAll(IMPORT_RE)) {
      if (m[2]) continue // import type ... from
      const spec = m[3] ?? m[4] ?? m[5]
      if (!spec) continue
      const target = resolveSpec(file, spec)
      if (target) stack.push(target)
      else if (!spec.startsWith('.') && !spec.startsWith('@shared/')) externals.add(spec)
    }
  }
  return { files: [...seen], externals }
}
```

`test/engine-graph.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { importGraph } from './helpers/importGraph'

// The CLI runs as plain Node, where require('electron') is a path string and
// every app/net call throws. These are the engine roots the CLI will import.
const ROOTS = [
  'src/main/env.ts',
  'src/main/boot.ts',
  'src/main/jobQueue.ts',
  'src/main/generate/index.ts',
  'src/main/pid/install.ts',
  'src/main/comfy/discover.ts',
  'src/main/toolResolver.ts'
]

describe('engine import graph', () => {
  for (const root of ROOTS)
    it(`${root} never reaches electron`, () => {
      const { externals } = importGraph(resolve(__dirname, '..', root))
      expect([...externals]).not.toContain('electron')
    })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/env.test.ts test/boot.test.ts test/engine-graph.test.ts`
Expected: FAIL, unresolved imports `../src/main/env`, `../src/main/boot`, `../src/cli/env`.

- [ ] **Step 3: Implement the provider, boot and atomic write**

`src/main/env.ts`:

```ts
import { join } from 'path'

/**
 * Everything the engine needs from its host, in one place (spec 4.2, M1).
 *
 * The app sets it from Electron (`app.getPath`, `net.fetch`); the command line
 * sets it from plain Node, where `electron.app` does not exist. No engine module
 * may import 'electron' itself: a test walks the CLI's import graph.
 */
export interface EngineEnv {
  /** %APPDATA%\Filesmith, shared by the app and the CLI. */
  userData: string
  /** The folder holding bin/, libreoffice/, ghostscript/, realesrgan/, registry/ ... */
  resourcesDir: string
  /** The app's Generate output folder. */
  downloadsDir: string
  /** Electron's net.fetch in the app (system proxy, Windows trust store); Node's
   * fetch in the CLI (the shims add --use-system-ca and NODE_USE_ENV_PROXY=1). */
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  host: 'app' | 'cli'
}

let current: EngineEnv | null = null

export function setEngineEnv(e: EngineEnv): void {
  current = e
}

export function engineEnv(): EngineEnv {
  if (!current) throw new Error('engine env not configured')
  return current
}

export function resourcePath(...parts: string[]): string {
  return join(engineEnv().resourcesDir, ...parts)
}

export function userDataPath(...parts: string[]): string {
  return join(engineEnv().userData, ...parts)
}

/** Tests only: simulate a host that forgot to configure the engine. */
export function resetEngineEnvForTests(): void {
  current = null
}
```

`src/main/atomicWrite.ts`:

```ts
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/**
 * Write-then-rename, with a temp name unique to this process. The app and the
 * CLI can now write the same small state files (comfy-upscalers.json,
 * integrity.json) at the same time; a fixed `.part` name let one process rename
 * the other's half-written temp file into place.
 */
export function writeFileAtomic(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}
```

`src/main/boot.ts`:

```ts
import { readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { configureBundledMagickEnv } from './toolResolver'
import { ensureUserLayers } from './registry/load'

/**
 * Remove temp dirs orphaned by a previous HARD crash (normal runs delete their
 * own in a finally). Guarded by age so a concurrent app or CLI's in-use temp dir
 * is never swept out from under an active job. Best effort; never throws.
 */
export function sweepStaleTempDirs(now = Date.now(), dir = tmpdir()): void {
  try {
    const cutoff = now - 60 * 60 * 1000
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('filesmith-')) continue
      const p = join(dir, name)
      try {
        if (statSync(p).mtimeMs < cutoff) rmSync(p, { recursive: true, force: true })
      } catch {
        /* in use or already gone */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Startup shared by the app and the CLI (spec M2). The magick env is the one
 * that matters: without it every image job fails on a clean install with
 * "no decode delegate". */
export function bootEngine(): void {
  sweepStaleTempDirs()
  configureBundledMagickEnv()
  ensureUserLayers()
}
```

`src/cli/env.ts`:

```ts
import { basename, dirname, join } from 'path'
import type { EngineEnv } from '../main/env'

export interface ProcessFacts {
  execPath: string
  resourcesPath?: string
  env: Record<string, string | undefined>
  homedir: string
  /** The folder holding cli.js (out/main in dev, app.asar/out/main packed). */
  moduleDir: string
}

/** The CLI's engine env (spec 4.2). Pure, so packaged and dev layouts are tested
 * without either being present. */
export function cliEngineEnv(f: ProcessFacts, fetchImpl: EngineEnv['fetch']): EngineEnv {
  const packaged = basename(f.execPath).toLowerCase() === 'filesmith.exe'
  const resourcesDir = packaged
    ? (f.resourcesPath ?? join(dirname(f.execPath), 'resources'))
    : join(f.moduleDir, '..', '..', 'resources')
  const appData = f.env.APPDATA ?? join(f.homedir, 'AppData', 'Roaming')
  return {
    userData: f.env.FILESMITH_USER_DATA || join(appData, 'Filesmith'),
    resourcesDir,
    downloadsDir: join(f.homedir, 'Downloads'),
    fetch: fetchImpl,
    host: 'cli'
  }
}
```

`test/setup/engineEnv.ts`:

```ts
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { setEngineEnv } from '../../src/main/env'

// Every unit test runs against an explicit engine env: the repo's resources and
// a per-worker userData (the old electron mock's layout, so per-worker isolation
// is unchanged). Before M1 the engine silently fell back to cwd paths here.
const root = join(tmpdir(), `filesmith-test-userdata-${process.pid}`)
setEngineEnv({
  userData: join(root, 'userData'),
  resourcesDir: resolve(__dirname, '..', '..', 'resources'),
  downloadsDir: join(root, 'downloads'),
  fetch: (url, init) => fetch(url, init),
  host: 'app'
})
```

`vitest.config.ts`: in `test`, add `setupFiles: ['test/setup/engineEnv.ts']`.

- [ ] **Step 4: Rewire every engine call site**

Make each edit below and remove the module's `import ... from 'electron'` line.

`src/main/toolResolver.ts`: add `import { resourcePath } from './env'` and replace:

```ts
function bundledDir(): string {
  return resourcePath('bin')
}
```

```ts
  const loRoot = resourcePath('libreoffice')
```

```ts
  const gsRoot = resourcePath('ghostscript')
```

```ts
export function realesrganDir(): string {
  return resourcePath('realesrgan')
}
```

`src/main/pid/paths.ts`: add `import { resourcePath, userDataPath } from '../env'` and replace:

```ts
export function pidRoot(): string {
  return userDataPath('pid')
}
```

```ts
export function pidServerScript(): string {
  return resourcePath('pid', 'pid_server.py')
}
```

```ts
export function spandrelServerScript(): string {
  return resourcePath('spandrel', 'spandrel_server.py')
}
```

`src/main/tools/ncnnModels.ts`: add `import { userDataPath } from '../env'`;

```ts
export function userNcnnDir(): string {
  return userDataPath('models', 'realesrgan')
}
```

`src/main/comfy/store.ts`: imports become `import { existsSync, readFileSync } from 'fs'`, `import { userDataPath } from '../env'`, `import { writeFileAtomic } from '../atomicWrite'` (drop `join`);

```ts
function storePath(): string {
  return userDataPath('comfy-upscalers.json')
}
```

```ts
export function writeComfyStore(store: ComfyStore): void {
  writeFileAtomic(storePath(), JSON.stringify(store, null, 2))
}
```

`src/main/generate/comfy.ts`: add `import { userDataPath } from '../env'`; line 108 becomes `const file = userDataPath('comfy-extra-model-paths.yaml')`.

`src/main/generate/index.ts`: add `import { engineEnv } from '../env'`; line 119 becomes `const base = join(engineEnv().downloadsDir, \`${slug(opts.prompt)}.png\`)` (Task 13 replaces this line again for `outDir`).

`src/main/net/download.ts`: add `import { engineEnv } from '../env'`; replace `httpFetch`:

```ts
/** The host's fetch: Electron's net.fetch in the app (system proxy, Windows
 * trust store); Node's fetch in the CLI, whose shims add --use-system-ca and
 * NODE_USE_ENV_PROXY=1 for the same two reasons (spec 4.6). */
function httpFetch(url: string, init: RequestInit): Promise<Response> {
  return engineEnv().fetch(url, init)
}
```

`src/main/net/integrity.ts`: imports become `import { existsSync, readFileSync } from 'fs'`, `import { userDataPath } from '../env'`, `import { writeFileAtomic } from '../atomicWrite'`;

```ts
function ledgerPath(): string {
  return userDataPath('integrity.json')
}

function read(): Ledger {
  const p = ledgerPath()
  if (!existsSync(p)) return {}
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as Ledger
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {} // a corrupt ledger degrades to "no history", never to a crash
  }
}

function write(l: Ledger): void {
  try {
    writeFileAtomic(ledgerPath(), JSON.stringify(l, null, 2))
  } catch {
    /* best effort: a read-only profile still downloads, just without history */
  }
}
```

`src/main/registry/load.ts`: add `import { engineEnv } from '../env'`; replace `electronPath`, `builtinDir`, `userRegistryRoot`:

```ts
function builtinDir(): string {
  return join(engineEnv().resourcesDir, 'registry')
}

function userRegistryRoot(): string | null {
  return join(engineEnv().userData, 'registry')
}
```

(delete `electronPath` and its comment; `layerDir` keeps its `string | null` signature).

`src/main/registry/channel.ts`: add `import { engineEnv, userDataPath } from '../env'`; `stampPath` returns `userDataPath('registry', 'channel', '.last-check')` (keep the `string | null` type); replace the two lines at 130-131 with:

```ts
    const res = await engineEnv().fetch(CHANNEL_URL, { signal: AbortSignal.timeout(15_000) })
```

`src/main/index.ts`: change the electron import to `import { app, nativeTheme, net, protocol, screen, shell, BrowserWindow } from 'electron'`, remove the `readdirSync, rmSync` and `tmpdir` imports and the local `sweepStaleTempDirs` function, remove the `configureBundledMagickEnv` and `ensureUserLayers` imports, add `import { setEngineEnv } from './env'` and `import { bootEngine } from './boot'`. Right after the `FILESMITH_USER_DATA` override:

```ts
// The engine's view of its host (spec M1). Read after the e2e userData override
// so tests that seed a session still get their temp folder.
setEngineEnv({
  userData: app.getPath('userData'),
  resourcesDir: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
  downloadsDir: app.getPath('downloads'),
  fetch: (url, init) => net.fetch(url, init),
  host: 'app'
})
```

and in `whenReady` replace the three startup calls with:

```ts
    // Magick env, stale temp sweep, registry user layers (shared with the CLI).
    bootEngine()
    // Background, non-blocking, at most once a day, silent-fail-to-cache: the
    // lever that fixes a dead model URL for every install without a release.
    scheduleChannelRefresh()
```

- [ ] **Step 5: Run the new tests, then the whole suite**

Run: `npx vitest run test/env.test.ts test/boot.test.ts test/engine-graph.test.ts`
Expected: PASS (15 tests: 7 env, 1 boot, 7 engine-graph roots).

Run: `npm test`
Expected: PASS, same count as before plus 15. If `test/registry*.test.ts` or `test/user-registry.test.ts` fail on paths, they were relying on the removed cwd fallback; the setup file's `resourcesDir` is the same `resources` folder, so compare the failing path with `resolve('resources')` and fix the test's expectation, not the engine.

- [ ] **Step 6: Verify the app still runs**

Run: `npm run typecheck && npm run lint && npm run build && npx playwright test e2e/smoke.spec.ts`
Expected: all pass (the app's paths are unchanged values from a new place).

- [ ] **Step 7: Commit**

```bash
git add src/main src/cli/env.ts test vitest.config.ts
git commit -m "refactor(engine): EngineEnv provider replaces electron imports in the engine" -m "toolResolver, pid/paths, ncnnModels, comfy/store, generate, net, registry read paths and fetch from one provider set by the app (and later the CLI). Startup moves to boot.ts. comfy-upscalers.json and integrity.json are written atomically per process." -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dry-run output planners (M4)

**Files:**
- Create: `src/main/tools/plan.ts`, `test/plan-output.test.ts`
- Modify: `src/main/output.ts` (shared candidate generator, two planners)

**Interfaces:**
- Consumes: `reserveFileInDir`, `uniqueOutDir` (existing), `audioOutputExt(codec, sourceExt)` from `src/main/tools/compress.ts`.
- Produces:
  - `output.ts`: `planFileInDir(dir: string, name: string, ext: string, tag: string, claimed?: Set<string>): string`, `planOutDir(dir: string, base: string, claimed?: Set<string>): string`. `claimed` holds lower-cased paths already predicted earlier in the same run.
  - `tools/plan.ts`: `interface PlannedOutput { path: string; kind: 'file' | 'dir' }`, `planOutput(tool: ToolId, file: FileInfo, options: JobOptions, outDir: string | undefined, claimed: Set<string>): PlannedOutput` (throws `Error` for an unknown tool or op).

- [ ] **Step 1: Write the failing test**

`test/plan-output.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planFileInDir, planOutDir, reserveFileInDir } from '../src/main/output'
import { planOutput } from '../src/main/tools/plan'
import { fileKind } from '@shared/fileKind'
import type { FileInfo } from '@shared/types'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'filesmith-plan-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const info = (name: string): FileInfo => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return { path: join(dir, name), name, ext, kind: fileKind(ext), size: 10 }
}

describe('planFileInDir', () => {
  it('predicts the same names as reserveFileInDir and creates nothing', () => {
    writeFileSync(join(dir, 'photo.webp'), 'x')
    writeFileSync(join(dir, 'photo (converted).webp'), 'x')
    const before = readdirSync(dir).sort()
    const planned = planFileInDir(dir, 'photo', '.webp', 'converted')
    expect(readdirSync(dir).sort()).toEqual(before)
    const real = reserveFileInDir(dir, 'photo', '.webp', 'converted')
    expect(planned).toBe(real)
    expect(planned).toBe(join(dir, 'photo (converted 2).webp'))
  })

  it('treats names claimed earlier in the same run as taken (case-insensitive)', () => {
    const claimed = new Set<string>()
    const a = planFileInDir(dir, 'photo', 'webp', 'converted', claimed)
    const b = planFileInDir(dir, 'PHOTO', '.webp', 'converted', claimed)
    expect(a).toBe(join(dir, 'photo.webp'))
    expect(b).toBe(join(dir, 'PHOTO (converted).webp'))
  })
})

describe('planOutDir', () => {
  it('base, then base (2), honouring claims', () => {
    mkdirSync(join(dir, 'doc (pages)'))
    const claimed = new Set<string>()
    expect(planOutDir(dir, 'doc (pages)', claimed)).toBe(join(dir, 'doc (pages) (2)'))
    expect(planOutDir(dir, 'doc (pages)', claimed)).toBe(join(dir, 'doc (pages) (3)'))
  })
})

describe('planOutput', () => {
  const c = (): Set<string> => new Set()
  it.each([
    ['convert', 'a.png', { format: '.webp' }, 'a.webp'],
    ['convert', 'a.pdf', { format: '.txt' }, 'a.txt'],
    ['archive', 'a.cbz', { op: 'repack', format: '.cb7' }, 'a.cb7'],
    ['archive', 'a.cbz', { op: 'to-pdf' }, 'a.pdf'],
    ['archive', 'a.pdf', { op: 'from-pdf', format: '.cbz' }, 'a.cbz'],
    ['compress', 'a.jpg', { imageFormat: 'keep' }, 'a (compressed).jpg'],
    ['compress', 'a.png', { imageFormat: 'avif' }, 'a.avif'],
    ['compress', 'a.mov', {}, 'a.mp4'],
    ['compress', 'a.flac', { audioCodec: 'keep' }, 'a (compressed).flac'],
    ['compress', 'a.mp3', { audioCodec: 'opus' }, 'a.opus'],
    ['compress', 'a.pdf', { pdfLevel: 'smallest' }, 'a (compressed).pdf'],
    ['resize', 'a.gif', {}, 'a (resized).gif'],
    ['upscale', 'a.jpg', {}, 'a.png'],
    ['removebg', 'a.png', {}, 'a (no-bg).png'],
    ['pdf', 'a.pdf', { op: 'merge' }, 'a (merged).pdf'],
    ['pdf', 'a.pdf', { op: 'split-range', range: '1-2' }, 'a (pages).pdf'],
    ['pdf', 'a.pdf', { op: 'extract-text' }, 'a.txt']
  ] as const)('%s %s %j -> %s (file)', (tool, name, options, expected) => {
    writeFileSync(join(dir, name), 'x')
    const out = planOutput(tool, info(name), { ...options }, undefined, c())
    expect(out).toEqual({ path: join(dir, expected), kind: 'file' })
  })

  it.each([
    ['split-pages', 'a (split)'],
    ['extract-images', 'a (images)'],
    ['pages-to-images', 'a (pages)']
  ])('pdf %s -> folder %s', (op, expected) => {
    const out = planOutput('pdf', info('a.pdf'), { op }, undefined, c())
    expect(out).toEqual({ path: join(dir, expected), kind: 'dir' })
  })

  it('honours outDir', () => {
    const out = join(dir, 'out')
    mkdirSync(out)
    expect(planOutput('resize', info('a.png'), {}, out, c()).path).toBe(join(out, 'a.png'))
  })

  it('rejects an unknown pdf op', () => {
    expect(() => planOutput('pdf', info('a.pdf'), { op: 'nope' }, undefined, c())).toThrow(
      'Unknown pdf operation: nope'
    )
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/plan-output.test.ts`
Expected: FAIL, `planFileInDir is not a function` / unresolved `../src/main/tools/plan`.

- [ ] **Step 3: Implement**

`src/main/output.ts`, replace `reserveFileInDir` and `uniqueOutDir` with a shared generator plus the planners (keep the file's header comment and `reserveOutPath` / `resolveOutDir` unchanged):

```ts
/** Candidate names in collision order: `name.ext`, `name (tag).ext`,
 * `name (tag 2).ext`, ... One generator for the real reservation and the
 * dry-run prediction, so the two cannot drift. */
function* fileCandidates(dir: string, name: string, ext: string, tag: string): Generator<string> {
  const e = ext.startsWith('.') ? ext : '.' + ext
  yield join(dir, name + e)
  yield join(dir, `${name} (${tag})${e}`)
  for (let n = 2; ; n++) yield join(dir, `${name} (${tag} ${n})${e}`)
}

function* dirCandidates(dir: string, base: string): Generator<string> {
  yield join(dir, base)
  for (let n = 2; ; n++) yield join(dir, `${base} (${n})`)
}

/**
 * A collision-free file path that ATOMICALLY claims the chosen name by creating
 * an empty placeholder (openSync 'wx', exclusive create). Two jobs running
 * concurrently can otherwise pick the same free name before either has written
 * it; the exclusive create makes the second job skip to the next candidate. The
 * tool that runs next overwrites the placeholder. Callers MUST remove the
 * placeholder if the tool then fails (see the direct-write cleanup in registry).
 */
export function reserveFileInDir(dir: string, name: string, ext: string, tag: string): string {
  for (const cand of fileCandidates(dir, name, ext, tag)) {
    try {
      closeSync(openSync(cand, 'wx'))
      return cand
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error('unreachable')
}

/** The name reserveFileInDir WOULD pick, without creating anything (dry run).
 * `claimed` holds lower-cased paths predicted earlier in the same run, so two
 * sources that land on one name are predicted as the real run will name them.
 * A prediction: another process may take a name before the real run. */
export function planFileInDir(
  dir: string,
  name: string,
  ext: string,
  tag: string,
  claimed: Set<string> = new Set()
): string {
  for (const cand of fileCandidates(dir, name, ext, tag)) {
    if (existsSync(cand) || claimed.has(cand.toLowerCase())) continue
    claimed.add(cand.toLowerCase())
    return cand
  }
  throw new Error('unreachable')
}

/** Collision-free directory: `base` -> `base (2)` -> `base (3)` ... */
export function uniqueOutDir(dir: string, base: string): string {
  for (const cand of dirCandidates(dir, base)) if (!existsSync(cand)) return cand
  throw new Error('unreachable')
}

/** The folder uniqueOutDir WOULD pick, honouring earlier claims in the run. */
export function planOutDir(dir: string, base: string, claimed: Set<string> = new Set()): string {
  for (const cand of dirCandidates(dir, base)) {
    if (existsSync(cand) || claimed.has(cand.toLowerCase())) continue
    claimed.add(cand.toLowerCase())
    return cand
  }
  throw new Error('unreachable')
}
```

`src/main/tools/plan.ts`:

```ts
import { basename, dirname, extname } from 'path'
import type { FileInfo, JobOptions, ToolId } from '@shared/types'
import type { AudioCodec } from '@shared/compress'
import { isSameFormat, normalizeExt } from '@shared/convert'
import { planFileInDir, planOutDir } from '../output'
import { audioOutputExt } from './compress'

export interface PlannedOutput {
  path: string
  kind: 'file' | 'dir'
}

/**
 * The output a tool's run() would produce, predicted without touching disk
 * (spec M4). Mirrors the reserveOutPath / uniqueOutDir call in each branch of
 * tools/registry.ts; test/plan-output.test.ts pins every branch, and the CLI
 * e2e suite checks a dry run against the real run's names.
 */
export function planOutput(
  tool: ToolId,
  file: FileInfo,
  options: JobOptions,
  outDir: string | undefined,
  claimed: Set<string>
): PlannedOutput {
  const dir = outDir ?? dirname(file.path)
  const name = basename(file.path, extname(file.path))
  const f = (ext: string, tag: string): PlannedOutput => ({
    path: planFileInDir(dir, name, ext, tag, claimed),
    kind: 'file'
  })
  const d = (suffix: string): PlannedOutput => ({
    path: planOutDir(dir, `${name} (${suffix})`, claimed),
    kind: 'dir'
  })
  const format = normalizeExt(String(options.format ?? ''))

  switch (tool) {
    case 'convert':
      return f(file.kind === 'pdf' && isSameFormat(format, '.txt') ? '.txt' : format, 'converted')
    case 'archive': {
      const op = String(options.op ?? 'repack')
      if (op === 'to-pdf') return f('.pdf', 'converted')
      if (op === 'repack' || op === 'from-pdf') return f(format, 'converted')
      if (op === 'extract') return d('extracted')
      throw new Error(`Unknown archive operation: ${op}`)
    }
    case 'compress': {
      if (file.kind === 'pdf') return f('.pdf', 'compressed')
      if (file.kind === 'video') return f('.mp4', 'compressed')
      if (file.kind === 'audio')
        return f(
          audioOutputExt(String(options.audioCodec ?? 'keep') as AudioCodec, file.ext),
          'compressed'
        )
      const fmt = String(options.imageFormat ?? 'keep')
      return f(fmt === 'keep' ? file.ext : `.${fmt}`, 'compressed')
    }
    case 'resize':
      return f(file.ext, 'resized')
    case 'upscale':
      return f('.png', 'upscaled')
    case 'removebg':
      return f('.png', 'no-bg')
    case 'pdf': {
      const op = String(options.op ?? 'extract-text')
      if (op === 'merge') return f('.pdf', 'merged')
      if (op === 'split-range') return f('.pdf', 'pages')
      if (op === 'extract-text') return f('.txt', 'text')
      if (op === 'split-pages') return d('split')
      if (op === 'extract-images') return d('images')
      if (op === 'pages-to-images') return d('pages')
      throw new Error(`Unknown pdf operation: ${op}`)
    }
    default:
      throw new Error(`No output planner for ${tool}`)
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/plan-output.test.ts test/output.test.ts`
Expected: PASS (both files; `output.test.ts` proves the refactor kept the reservation behaviour).

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/main/output.ts src/main/tools/plan.ts test/plan-output.test.ts
git commit -m "feat(engine): dry-run output planners sharing the collision-safe naming" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Installer plumbing: cross-process locks, cancel, byte progress, public uv bootstrap, live ComfyUI (M7, M8)

**Files:**
- Create: `src/main/locks.ts`, `src/main/uvInstall.ts`, `test/locks.test.ts`, `test/comfy-live.test.ts`
- Modify: `src/main/pid/install.ts` (lock, signal, bytes, `ensureUv`/`winTar`/`uvVersionOk` moved out), `src/main/generate/companions.ts:38-` (lock, signal, bytes), `src/main/net/download.ts:75-84,220-230` (`onBytes`), `src/main/uv.ts:37-52` (new candidate), `src/main/generate/comfy.ts` (`comfy-live.json`)

**Interfaces:**
- Consumes: `userDataPath`, `engineEnv` (Task 2), `writeFileAtomic` (Task 2).
- Produces:
  - `locks.ts`: `interface LockInfo { pid: number; host: 'app' | 'cli'; since: number; what: string }`, `lockPath(name: string): string`, `readLock(name: string): LockInfo | null`, `pidAlive(pid: number): boolean`, `isStale(info: LockInfo | null, now?: number, alive?: (pid: number) => boolean): boolean`, `tryAcquire(name: string, what: string, now?: number): (() => void) | null`, `withFileLock<T>(name: string, what: string, fn: () => Promise<T>, opts?: { waitMs?: number; pollMs?: number; onWait?: (holder: LockInfo | null) => void; signal?: AbortSignal }): Promise<T>`. Lock names in use: `pid-env`, `companions`, `rembg`.
  - `uvInstall.ts`: `interface InstallProgress { (step: string, pct: number | null): void }`, `interface InstallOpts { signal?: AbortSignal; onBytes?: (got: number, total: number) => void }`, `winTar(): string`, `uvVersionOk(uv: string): Promise<boolean>`, `ensureUv(onProgress: InstallProgress, opts?: InstallOpts): Promise<string>`.
  - `pid/install.ts`: `installPid(backbone: string, onProgress: InstallProgress, opts?: InstallOpts): Promise<void>`, `installComfyEngine(onProgress: InstallProgress, opts?: InstallOpts): Promise<void>`, `pidWeightFiles(backbone: string): { path: string; url: string }[]`; re-exports `InstallProgress`, `InstallOpts`.
  - `generate/companions.ts`: `downloadCompanions(modelName: string, onProgress: (p: CompanionProgress) => void, opts?: InstallOpts): Promise<void>`.
  - `net/download.ts`: `DownloadOptions.onBytes?: (got: number, total: number) => void`.
  - `generate/comfy.ts`: `recordLiveComfy(url: string): void`, `clearLiveComfy(): void`, `liveComfyUrl(): string | null`.

- [ ] **Step 1: Write the failing tests**

`test/locks.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { isStale, lockPath, readLock, tryAcquire, withFileLock } from '../src/main/locks'

const NAME = `test-${process.pid}`
afterEach(() => rmSync(lockPath(NAME), { force: true }))

describe('file locks', () => {
  it('acquires, blocks a second taker, and releases', () => {
    const release = tryAcquire(NAME, 'a test')
    expect(release).not.toBeNull()
    expect(readLock(NAME)).toMatchObject({ pid: process.pid, what: 'a test' })
    expect(tryAcquire(NAME, 'again')).toBeNull()
    release?.()
    expect(existsSync(lockPath(NAME))).toBe(false)
  })

  it('takes over a lock whose owner process is gone', () => {
    mkdirSync(dirname(lockPath(NAME)), { recursive: true })
    writeFileSync(
      lockPath(NAME),
      JSON.stringify({ pid: 999_999_999, host: 'app', since: Date.now(), what: 'x' })
    )
    const release = tryAcquire(NAME, 'mine')
    expect(release).not.toBeNull()
    expect(readLock(NAME)?.pid).toBe(process.pid)
    release?.()
  })

  it('treats a lock older than six hours as stale even if the pid lives', () => {
    const now = Date.now()
    const info = { pid: process.pid, host: 'cli' as const, since: now - 7 * 3600_000, what: 'x' }
    expect(isStale(info, now, () => true)).toBe(true)
    expect(isStale({ ...info, since: now }, now, () => true)).toBe(false)
    expect(isStale(null, now)).toBe(true)
  })

  it('withFileLock waits for the holder, then runs', async () => {
    const release = tryAcquire(NAME, 'holder')
    const waits: number[] = []
    setTimeout(() => release?.(), 50)
    const result = await withFileLock(NAME, 'waiter', async () => 'ran', {
      pollMs: 10,
      onWait: () => waits.push(1)
    })
    expect(result).toBe('ran')
    expect(waits.length).toBeGreaterThan(0)
    expect(existsSync(lockPath(NAME))).toBe(false)
  })

  it('withFileLock gives up after waitMs with a message naming the holder', async () => {
    const release = tryAcquire(NAME, 'holder')
    await expect(
      withFileLock(NAME, 'the engine', async () => 'never', { waitMs: 30, pollMs: 10 })
    ).rejects.toThrow(/still installing the engine/)
    release?.()
  })

  it('withFileLock stops waiting when aborted', async () => {
    const release = tryAcquire(NAME, 'holder')
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 20)
    await expect(
      withFileLock(NAME, 'x', async () => 'never', { pollMs: 5, signal: ctrl.signal })
    ).rejects.toThrow()
    release?.()
  })
})
```

`test/comfy-live.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { engineEnv, setEngineEnv, userDataPath } from '../src/main/env'
import {
  candidateComfyUrls,
  clearLiveComfy,
  liveComfyUrl,
  recordLiveComfy
} from '../src/main/generate/comfy'

const saved = engineEnv()
afterEach(() => {
  clearLiveComfy()
  setEngineEnv(saved)
})

describe('comfy-live.json (M8)', () => {
  it('the app records the ComfyUI it launched and the CLI tries it first', () => {
    setEngineEnv({ ...saved, host: 'app' })
    recordLiveComfy('http://127.0.0.1:51234')
    expect(liveComfyUrl()).toBe('http://127.0.0.1:51234')
    setEngineEnv({ ...saved, host: 'cli' })
    const urls = candidateComfyUrls()
    expect(urls.indexOf('http://127.0.0.1:51234')).toBeLessThan(
      urls.indexOf('http://127.0.0.1:8188')
    )
  })

  it('a CLI-launched ComfyUI is never advertised (it dies with the CLI)', () => {
    setEngineEnv({ ...saved, host: 'cli' })
    recordLiveComfy('http://127.0.0.1:51235')
    expect(liveComfyUrl()).toBeNull()
  })

  it('ignores a record whose process is gone', () => {
    mkdirSync(dirname(userDataPath('comfy-live.json')), { recursive: true })
    writeFileSync(
      userDataPath('comfy-live.json'),
      JSON.stringify({ url: 'http://127.0.0.1:1', pid: 999_999_999 })
    )
    expect(liveComfyUrl()).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/locks.test.ts test/comfy-live.test.ts`
Expected: FAIL, unresolved `../src/main/locks`; `recordLiveComfy` is not exported.

- [ ] **Step 3: Implement the lock module**

`src/main/locks.ts`:

```ts
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'fs'
import { dirname } from 'path'
import { engineEnv, userDataPath } from './env'

/**
 * Cross-process lock files (spec M7). The app and the CLI can now install the
 * same engine at the same moment; the old guards (withInstallLock, the IPC
 * companion map) only covered one process, and two installers share .part
 * files and rmSync the same repo dir. A lock is a file created with 'wx'
 * holding the owner's pid; a dead owner or a six-hour-old lock is stale.
 */
export interface LockInfo {
  pid: number
  host: 'app' | 'cli'
  since: number
  what: string
}

const STALE_MS = 6 * 60 * 60 * 1000

export function lockPath(name: string): string {
  return userDataPath('locks', `${name}.lock`)
}

export function readLock(name: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(lockPath(name), 'utf-8')) as LockInfo
  } catch {
    return null
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function isStale(
  info: LockInfo | null,
  now = Date.now(),
  alive: (pid: number) => boolean = pidAlive
): boolean {
  if (!info || typeof info.pid !== 'number') return true
  return !alive(info.pid) || now - info.since > STALE_MS
}

/** Take the lock, or null when a live owner holds it. Returns the release. */
export function tryAcquire(name: string, what: string, now = Date.now()): (() => void) | null {
  const p = lockPath(name)
  mkdirSync(dirname(p), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(p, 'wx')
      const info: LockInfo = { pid: process.pid, host: engineEnv().host, since: now, what }
      writeSync(fd, JSON.stringify(info))
      closeSync(fd)
      return () => {
        try {
          if (readLock(name)?.pid === process.pid) rmSync(p, { force: true })
        } catch {
          /* best effort */
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      if (!isStale(readLock(name), now)) return null
      rmSync(p, { force: true })
    }
  }
  return null
}

/** Run `fn` holding the lock, waiting (default up to 10 minutes) for a live
 * holder to finish. `onWait` is called on every poll so callers can report
 * "waiting for the app" and a heartbeat. */
export async function withFileLock<T>(
  name: string,
  what: string,
  fn: () => Promise<T>,
  opts: {
    waitMs?: number
    pollMs?: number
    onWait?: (holder: LockInfo | null) => void
    signal?: AbortSignal
  } = {}
): Promise<T> {
  const waitMs = opts.waitMs ?? 10 * 60_000
  const pollMs = opts.pollMs ?? 1000
  const start = Date.now()
  let release = tryAcquire(name, what)
  while (!release) {
    opts.signal?.throwIfAborted()
    if (Date.now() - start > waitMs) {
      const h = readLock(name)
      throw new Error(
        `Another Filesmith ${h?.host ?? 'process'} (pid ${h?.pid ?? '?'}) is still installing ${what}. Try again when it finishes.`
      )
    }
    opts.onWait?.(readLock(name))
    await new Promise((r) => setTimeout(r, pollMs))
    release = tryAcquire(name, what)
  }
  try {
    return await fn()
  } finally {
    release()
  }
}
```

- [ ] **Step 4: Move the uv bootstrap out of the PiD installer**

`src/main/uvInstall.ts` (body moved from `pid/install.ts`; the download location becomes `%APPDATA%\Filesmith\uv` so removebg setup can use it without PiD):

```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { run } from './run'
import { userDataPath } from './env'
import { downloadFile } from './net/download'
import { expectedHash, recordHash } from './net/integrity'
import { resolveUv } from './toolResolver'

export interface InstallProgress {
  (step: string, pct: number | null): void
}

/** Cancel and byte-level progress for an install (spec 5.3). */
export interface InstallOpts {
  signal?: AbortSignal
  onBytes?: (got: number, total: number) => void
}

// PiD's pyproject requires a recent uv, and a stale system uv is worse than
// none: it is found first but cannot satisfy the floor. So a known-good uv is
// bootstrapped when the resolved one is missing or too old.
const UV_VERSION = '0.11.30'
const UV_MIN = [0, 11, 28] as const
const UV_ZIP = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`

/** Windows' bundled bsdtar, by full path: it handles >260-char paths, and a GNU
 * tar earlier on PATH (Git's) treats `C:\...` as a remote host. */
export function winTar(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

/** True when `uv --version` reports a version at or above UV_MIN. */
export async function uvVersionOk(uv: string): Promise<boolean> {
  try {
    const { code, stdout } = await run(uv, ['--version'])
    if (code !== 0) return false
    const m = /uv (\d+)\.(\d+)\.(\d+)/.exec(stdout)
    if (!m) return false
    const v = [Number(m[1]), Number(m[2]), Number(m[3])] as const
    for (let i = 0; i < 3; i += 1) {
      if (v[i] > UV_MIN[i]) return true
      if (v[i] < UV_MIN[i]) return false
    }
    return true
  } catch {
    return false
  }
}

/** A uv new enough for PiD and rembg: an installed one, else a pinned
 * standalone uv downloaded into %APPDATA%\Filesmith\uv. */
export async function ensureUv(onProgress: InstallProgress, opts: InstallOpts = {}): Promise<string> {
  const found = resolveUv()
  if (found && (await uvVersionOk(found))) return found
  const uvDir = userDataPath('uv')
  const uvExe = join(uvDir, 'uv.exe')
  if (existsSync(uvExe) && (await uvVersionOk(uvExe))) return uvExe

  opts.signal?.throwIfAborted()
  onProgress('Downloading uv', null)
  mkdirSync(userDataPath(), { recursive: true })
  const uvTmp = mkdtempSync(join(userDataPath(), 'uv-'))
  try {
    const zip = join(uvTmp, 'uv.zip')
    const r = await downloadFile(UV_ZIP, zip, {
      onPct: (p) => onProgress('Downloading uv', p),
      sha256: expectedHash(UV_ZIP),
      signal: opts.signal,
      onBytes: opts.onBytes
    })
    recordHash(r.url, r.sha256, r.bytes)
    rmSync(uvDir, { recursive: true, force: true })
    mkdirSync(uvDir, { recursive: true })
    const ex = await run(winTar(), ['-xf', zip, '-C', uvDir], { signal: opts.signal })
    if (ex.code !== 0) throw new Error(`uv extract failed: ${ex.stderr.slice(-400)}`)
  } finally {
    rmSync(uvTmp, { recursive: true, force: true })
  }
  if (!existsSync(uvExe)) throw new Error('uv bootstrap failed (no uv.exe after extract)')
  return uvExe
}
```

`src/main/uv.ts` `uvCandidates()`: inside the existing `try` (after the `pidRoot()` push) add `out.push(join(userDataPath(), 'uv', 'uv' + EXE))` and import `userDataPath` from `./env`; update the comment above the `try` to "The ones WE downloaded (PiD's older location, then the shared one)".

`src/main/net/download.ts`: in `DownloadOptions` add

```ts
  /** Bytes so far and the expected total (0 when unknown), for ETA. */
  onBytes?: (got: number, total: number) => void
```

and in the `counter` Transform, right after the `onPct` line, add `opts.onBytes?.(got, total)`.

- [ ] **Step 5: Lock, cancel and byte progress in the PiD installer**

In `src/main/pid/install.ts`:

1. Delete `UV_VERSION`, `UV_MIN`, `UV_ZIP`, `winTar`, `uvVersionOk`, `ensureUv` and the `InstallProgress` interface. Add imports `import { ensureUv, winTar, type InstallOpts, type InstallProgress } from '../uvInstall'` and `import { withFileLock } from '../locks'`, drop the now-unused `resolveUv` import, and add `export type { InstallOpts, InstallProgress } from '../uvInstall'` so existing importers keep compiling.
2. Below the imports add:

```ts
/** The running install's cancel signal and byte reporter. Module scope is safe:
 * withInstallLock admits one install per process. */
let active: InstallOpts = {}

function runI(cmd: string, args: string[], opts: { cwd?: string } = {}): ReturnType<typeof run> {
  return run(cmd, args, { ...opts, signal: active.signal })
}
```

3. Replace every `await run(` inside `ensureRepo`, `ensureEnv`, `ensureSpandrel` (lines 133, 215, 220, 237, 407 before this task) with `await runI(` (the argument lists are unchanged).
4. `ensureUv(onProgress)` calls (lines 211, 401) become `ensureUv(onProgress, active)`.
5. The private `download()` helper passes the signal and bytes:

```ts
  const result = await downloadFile(url, dest, {
    onPct,
    minBytes,
    sha256: expectedHash(url),
    signal: active.signal,
    onBytes: active.onBytes
  })
```

6. Make `active.signal?.throwIfAborted()` the first statement of `ensureRepo`, `ensureEnv`, `ensureWeights` and `ensureSpandrel`.
7. Replace `installPid` and `installComfyEngine`:

```ts
/** Full one-click PiD install (idempotent, interruption-safe, one per machine). */
export async function installPid(
  backbone: string,
  onProgress: InstallProgress,
  opts: InstallOpts = {}
): Promise<void> {
  return withInstallLock(() =>
    withFileLock(
      'pid-env',
      'the AI upscaler engine',
      async () => {
        active = opts
        try {
          await installPidInner(backbone, onProgress)
        } finally {
          active = {}
        }
      },
      {
        signal: opts.signal,
        onWait: (h) =>
          onProgress(`Waiting for another Filesmith (${h?.host ?? 'process'}) to finish`, null)
      }
    )
  )
}
```

```ts
export async function installComfyEngine(
  onProgress: InstallProgress,
  opts: InstallOpts = {}
): Promise<void> {
  // Shares both locks with installPid: both run ensureRepo/ensureEnv, write the
  // same temp paths and rmSync the same repo dir.
  return withInstallLock(() =>
    withFileLock(
      'pid-env',
      'the AI upscaler engine',
      async () => {
        active = opts
        try {
          await assertCudaCapable()
          mkdirSync(pidRoot(), { recursive: true })
          const space = checkDiskSpace(ENV_APPROX_BYTES)
          if (!space.ok) throw new Error(space.reason)
          await ensureRepo(onProgress)
          await ensureEnv(onProgress)
          await ensureSpandrel(onProgress)
          onProgress('Ready', 100)
        } finally {
          active = {}
        }
      },
      {
        signal: opts.signal,
        onWait: (h) =>
          onProgress(`Waiting for another Filesmith (${h?.host ?? 'process'}) to finish`, null)
      }
    )
  )
}
```

8. Export the weight list `doctor --verify` needs (next to `ensureWeights`, using the same `HF_BASE` and backbone fields `ensureWeights` uses):

```ts
/** The PiD weight files and the URL each was downloaded from (doctor --verify). */
export function pidWeightFiles(backbone: string): { path: string; url: string }[] {
  const bb = PID_BACKBONES[backbone]
  if (!bb) return []
  const ckpt = `${bb.checkpointDir}/model_ema_bf16.pth`
  return [
    { path: join(pidRepoDir(), ckpt), url: `${HF_BASE}/${ckpt}` },
    { path: join(pidRepoDir(), bb.vaeFile), url: `${HF_BASE}/${bb.vaeFile}` }
  ]
}
```

Before writing it, open `ensureWeights` and confirm it downloads `${HF_BASE}/${bb.checkpointDir}/model_ema_bf16.pth` and `${HF_BASE}/${bb.vaeFile}`; if it builds the URLs differently, copy its exact expressions here.

`src/main/generate/companions.ts`: rename the exported function to `async function downloadCompanionsInner(modelName: string, onProgress: (p: CompanionProgress) => void, opts: InstallOpts): Promise<void>`, add `signal: opts.signal, onBytes: opts.onBytes` to its `downloadFile(urls, dest, { ... })` options, add `opts.signal?.throwIfAborted()` at the top of its per-file loop, and add the exported wrapper:

```ts
/**
 * Download every missing companion for `modelName`. Skips files already present
 * (idempotent / resumable across runs). One companion download per machine at
 * a time: the app and the CLI share the models tree and its .part files.
 */
export async function downloadCompanions(
  modelName: string,
  onProgress: (p: CompanionProgress) => void,
  opts: InstallOpts = {}
): Promise<void> {
  return withFileLock(
    'companions',
    'model files',
    () => downloadCompanionsInner(modelName, onProgress, opts),
    { signal: opts.signal }
  )
}
```

with imports `import { withFileLock } from '../locks'` and `import type { InstallOpts } from '../uvInstall'`.

- [ ] **Step 6: Advertise the app's ComfyUI (M8)**

In `src/main/generate/comfy.ts`, add imports `readFileSync, rmSync` from `fs`, `engineEnv` from `../env`, `writeFileAtomic` from `../atomicWrite`, `pidAlive` from `../locks`, then add:

```ts
// The URL of a ComfyUI the APP launched, so a CLI run attaches to it instead of
// starting a second one (about 2x VRAM). The CLI never advertises its own: that
// one dies when the command ends.
function liveFile(): string {
  return userDataPath('comfy-live.json')
}

export function recordLiveComfy(url: string): void {
  if (engineEnv().host !== 'app') return
  try {
    writeFileAtomic(liveFile(), JSON.stringify({ url, pid: process.pid }))
  } catch {
    /* best effort */
  }
}

export function clearLiveComfy(): void {
  try {
    const cur = JSON.parse(readFileSync(liveFile(), 'utf-8')) as { pid?: number }
    if (cur.pid === process.pid) rmSync(liveFile(), { force: true })
  } catch {
    /* nothing recorded */
  }
}

export function liveComfyUrl(): string | null {
  try {
    const cur = JSON.parse(readFileSync(liveFile(), 'utf-8')) as { url?: string; pid?: number }
    return cur.url && typeof cur.pid === 'number' && pidAlive(cur.pid) ? cur.url : null
  } catch {
    return null
  }
}
```

In `candidateComfyUrls()`, after the `FILESMITH_COMFY_URL` push, add:

```ts
  const live = liveComfyUrl()
  if (live) out.push(live.replace(/\/+$/, ''))
```

In `ensureComfyServer`, change the readiness loop's success line to `if (await alive(ourUrl)) { recordLiveComfy(ourUrl); return ourUrl }`. In the `proc.on('exit', ...)` handler and in `stopComfyServer()`, call `clearLiveComfy()`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/locks.test.ts test/comfy-live.test.ts test/pid.test.ts test/comfy.test.ts test/resolvers.test.ts`
Expected: PASS. `pid.test.ts` and `resolvers.test.ts` still pass because `InstallProgress` is re-exported and `uvCandidates` only gained a candidate.

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/main test/locks.test.ts test/comfy-live.test.ts
git commit -m "feat(engine): cross-process install locks, cancellable installers, live ComfyUI record" -m "installPid, installComfyEngine and companion downloads take a machine-wide lock file, an AbortSignal and a byte-progress callback. ensureUv moves to uvInstall.ts (public, downloads to userData/uv). The app records the ComfyUI it launched in comfy-live.json." -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Explicit rembg install, readiness checks, no downloads in CLI jobs (M5, M6)

**Files:**
- Create: `src/main/rembg/paths.ts`, `src/main/rembg/setup.ts`, `src/main/tools/readiness.ts`, `test/rembg-setup.test.ts`, `test/readiness.test.ts`
- Modify: `src/main/run.ts:9-14,39-42` (`env`), `src/main/tools/tool.ts` (`allowDownload`), `src/main/jobQueue.ts:22-35,93-104` (option), `src/main/toolResolver.ts:170-234` (rembg resolution and status), `src/main/tools/registry.ts:722-724,969-1000` (removebg and PiD messages)

**Interfaces:**
- Consumes: `withFileLock` (Task 4), `ensureUv`, `InstallProgress`, `InstallOpts` (Task 4), `userDataPath`, `engineEnv` (Task 2), `recordHash` (existing).
- Produces:
  - `run.ts`: `RunOptions.env?: NodeJS.ProcessEnv`.
  - `tools/tool.ts`: `ToolContext.allowDownload?: boolean` (undefined means allowed).
  - `jobQueue.ts`: `new JobQueue(emit, concurrency?, opts?: { allowDownload?: boolean })`.
  - `rembg/paths.ts`: `REMBG_SPEC`, `rembgToolDir()`, `rembgExe()`, `legacyRembgExe()`, `rembgModelDir()`, `rembgModelFile(model: string)`, `installedRembgExe(): string | null`, `rembgModelPresent(model: string): boolean`, `rembgEnv(): NodeJS.ProcessEnv`.
  - `rembg/setup.ts`: `setupRembg(model: string, onProgress: InstallProgress, opts?: InstallOpts): Promise<void>`, `hashFile(path: string): Promise<string>`, `TINY_PNG: Buffer`, `legacyRembgModelFile(model: string, env?, home?): string` (reuses a pre-0.6 `~/.u2net` model instead of downloading it again).
  - `tools/readiness.ts`: `type ReadinessCode = 'SETUP_REQUIRED' | 'GPU_UNSUPPORTED' | 'TOOL_MISSING' | 'USAGE'`, `type Readiness = { ok: true } | { ok: false; code: ReadinessCode; message: string; hint?: string }`, `type SetupTool = 'pid' | 'spandrel' | 'removebg'`, `setupHint(tool: SetupTool): string`, `notReadyMessage(tool: SetupTool): string`, `interface ReadinessDeps`, `upscaleReadiness(options: JobOptions, deps: ReadinessDeps): Promise<Readiness>`, `removebgReadiness(options: JobOptions, deps: ReadinessDeps): Readiness`, `defaultReadinessDeps: ReadinessDeps`.
  - `toolResolver.ts`: `RembgCommand` gains `env: NodeJS.ProcessEnv`; `resolveRembg()` returns only an installed rembg (never `uv tool run`).

- [ ] **Step 1: Write the failing tests**

`test/readiness.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { engineEnv, setEngineEnv } from '../src/main/env'
import {
  notReadyMessage,
  removebgReadiness,
  upscaleReadiness,
  type ReadinessDeps
} from '../src/main/tools/readiness'

const saved = engineEnv()
afterEach(() => setEngineEnv(saved))

const deps = (over: Partial<ReadinessDeps> = {}): ReadinessDeps => ({
  pidInstalled: () => true,
  cuda: async () => ({ ok: true }),
  comfyEngineReady: () => true,
  comfyModelKnown: () => true,
  realesrganPresent: () => true,
  ncnnNames: () => ['realesrgan-x4plus', 'realesrgan-x4plus-anime'],
  rembgInstalled: () => true,
  rembgModelPresent: () => true,
  ...over
})

describe('upscaleReadiness', () => {
  it('bundled models are ready', async () => {
    expect(await upscaleReadiness({ upscaleModel: 'photo' }, deps())).toEqual({ ok: true })
    expect(
      await upscaleReadiness({ upscaleModel: 'esrgan:REALESRGAN-X4PLUS-ANIME' }, deps())
    ).toEqual({ ok: true })
  })

  it('an unknown Real-ESRGAN name is a usage error listing the installed ones', async () => {
    const r = await upscaleReadiness({ upscaleModel: 'esrgan:nope' }, deps())
    expect(r).toMatchObject({ ok: false, code: 'USAGE', hint: 'filesmith formats upscale' })
    expect(r.ok === false && r.message).toContain('realesrgan-x4plus')
  })

  it('missing Real-ESRGAN binary is TOOL_MISSING', async () => {
    const r = await upscaleReadiness({}, deps({ realesrganPresent: () => false }))
    expect(r).toMatchObject({ ok: false, code: 'TOOL_MISSING', hint: 'filesmith doctor' })
  })

  it('pid: GPU gate first, then install state', async () => {
    const gpu = await upscaleReadiness(
      { upscaleModel: 'pid' },
      deps({ cuda: async () => ({ ok: false, reason: 'Driver 470 is too old.' }) })
    )
    expect(gpu).toEqual({ ok: false, code: 'GPU_UNSUPPORTED', message: 'Driver 470 is too old.' })
    const setup = await upscaleReadiness(
      { upscaleModel: 'pid' },
      deps({ pidInstalled: () => false })
    )
    expect(setup).toMatchObject({ ok: false, code: 'SETUP_REQUIRED', hint: 'filesmith setup pid' })
  })

  it('comfy:<path>: engine, then the scanned list', async () => {
    const engine = await upscaleReadiness(
      { upscaleModel: 'comfy:C:\\m\\x.pth' },
      deps({ comfyEngineReady: () => false })
    )
    expect(engine).toMatchObject({ code: 'SETUP_REQUIRED', hint: 'filesmith setup spandrel' })
    const unknown = await upscaleReadiness(
      { upscaleModel: 'comfy:C:\\m\\x.pth' },
      deps({ comfyModelKnown: () => false })
    )
    expect(unknown).toMatchObject({ code: 'SETUP_REQUIRED' })
  })
})

describe('removebgReadiness', () => {
  it('needs the installed tool and the model file', () => {
    expect(removebgReadiness({}, deps())).toEqual({ ok: true })
    expect(removebgReadiness({}, deps({ rembgModelPresent: () => false }))).toMatchObject({
      ok: false,
      code: 'SETUP_REQUIRED',
      hint: 'filesmith setup removebg'
    })
  })
})

describe('notReadyMessage', () => {
  it('names the setup command in the CLI and keeps the app wording in the app', () => {
    setEngineEnv({ ...saved, host: 'cli' })
    expect(notReadyMessage('pid')).toBe('PiD is not installed. Run: filesmith setup pid.')
    setEngineEnv({ ...saved, host: 'app' })
    expect(notReadyMessage('pid')).toContain('Pick PiD in the options panel')
  })
})
```

`test/rembg-setup.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { engineEnv, setEngineEnv } from '../src/main/env'
import {
  installedRembgExe,
  legacyRembgExe,
  rembgEnv,
  rembgExe,
  rembgModelDir,
  rembgModelFile,
  rembgModelPresent
} from '../src/main/rembg/paths'
import { legacyRembgModelFile, setupRembg } from '../src/main/rembg/setup'
import { removebgStatus, resolveRembg } from '../src/main/toolResolver'
import { JobQueue } from '../src/main/jobQueue'
import type { JobEvent } from '@shared/types'

const saved = engineEnv()
const savedAppData = process.env.APPDATA
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fs-rembg-'))
  setEngineEnv({ ...saved, userData: join(root, 'ud') })
  process.env.APPDATA = join(root, 'appdata')
})
afterEach(() => {
  setEngineEnv(saved)
  process.env.APPDATA = savedAppData
  rmSync(root, { recursive: true, force: true })
})

const touch = (p: string): void => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, 'x')
}

describe('rembg paths (M6)', () => {
  it('the pinned model folder lives under userData', () => {
    expect(rembgModelDir()).toBe(join(root, 'ud', 'models', 'rembg'))
    expect(rembgModelFile('birefnet-general')).toBe(
      join(root, 'ud', 'models', 'rembg', 'birefnet-general.onnx')
    )
    expect(rembgEnv().U2NET_HOME).toBe(rembgModelDir())
  })

  it('prefers our tool dir, falls back to a pre-0.6 uv tool install', () => {
    expect(installedRembgExe()).toBeNull()
    touch(legacyRembgExe())
    expect(installedRembgExe()).toBe(legacyRembgExe())
    touch(rembgExe())
    expect(installedRembgExe()).toBe(rembgExe())
  })

  it('resolveRembg never falls back to uv tool run', () => {
    expect(resolveRembg()).toBeNull()
    touch(rembgExe())
    expect(resolveRembg()).toEqual({ cmd: rembgExe(), prefix: [], env: rembgEnv() })
  })

  it('removebg:status is ready only with the tool AND the default model', async () => {
    touch(rembgExe())
    expect((await removebgStatus()).ready).toBe(false)
    touch(rembgModelFile('birefnet-general'))
    expect((await removebgStatus()).ready).toBe(true)
  })
})

describe('setupRembg', () => {
  it('reuses a pre-0.6 model from U2NET_HOME instead of downloading it again', async () => {
    touch(rembgExe())
    const legacyHome = join(root, 'u2net')
    touch(join(legacyHome, 'birefnet-general.onnx'))
    const savedU2 = process.env.U2NET_HOME
    process.env.U2NET_HOME = legacyHome
    try {
      expect(legacyRembgModelFile('birefnet-general')).toBe(join(legacyHome, 'birefnet-general.onnx'))
      const steps: string[] = []
      await setupRembg('birefnet-general', (s) => steps.push(s))
      expect(rembgModelPresent('birefnet-general')).toBe(true)
      expect(steps).toEqual(['Reusing the birefnet-general model already on this PC', 'Ready'])
    } finally {
      if (savedU2 === undefined) delete process.env.U2NET_HOME
      else process.env.U2NET_HOME = savedU2
    }
  })

  it('is a no-op when the tool and model are present (no spawn, no download)', async () => {
    touch(rembgExe())
    touch(rembgModelFile('birefnet-general'))
    const steps: string[] = []
    await setupRembg('birefnet-general', (s) => steps.push(s))
    expect(steps).toEqual(['Ready'])
    expect(rembgModelPresent('birefnet-general')).toBe(true)
  })
})

describe('no downloads in CLI jobs (M5)', () => {
  it('a removebg job with allowDownload false fails with the setup command', async () => {
    setEngineEnv({ ...engineEnv(), host: 'cli' })
    const img = join(root, 'a.png')
    writeFileSync(img, 'x')
    const done = new Promise<JobEvent>((res) => {
      const q = new JobQueue(
        (e) => {
          if (e.status === 'failed' || e.status === 'done') res(e)
        },
        1,
        { allowDownload: false }
      )
      q.add({ id: '1', tool: 'removebg', input: img, options: {} })
    })
    const ev = await done
    expect(ev.status).toBe('failed')
    expect(ev.error).toBe('Background removal is not set up yet. Run: filesmith setup removebg.')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/readiness.test.ts test/rembg-setup.test.ts`
Expected: FAIL, unresolved `../src/main/tools/readiness` and `../src/main/rembg/paths`.

- [ ] **Step 3: Implement the engine pieces**

`src/main/run.ts`: add to `RunOptions`

```ts
  /** Child environment (defaults to this process's). rembg needs U2NET_HOME. */
  env?: NodeJS.ProcessEnv
```

and pass it: `const child = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd, env: opts.env })`.

`src/main/tools/tool.ts`, add to `ToolContext`:

```ts
  /** False in the CLI: a tool that would download a model or runtime must fail
   * with a "Run: filesmith setup <tool>" message instead (spec M5). */
  allowDownload?: boolean
```

`src/main/jobQueue.ts`: the constructor becomes

```ts
  constructor(
    private emit: Emit,
    concurrency?: number,
    private readonly opts: { allowDownload?: boolean } = {}
  ) {
    this.concurrency = concurrency ?? Math.max(1, Math.min(4, cpus().length - 1))
  }
```

and the `tool.run(...)` context gains `allowDownload: this.opts.allowDownload ?? true,` after `outDir,`.

`src/main/rembg/paths.ts`:

```ts
import { existsSync } from 'fs'
import { join } from 'path'
import { userDataPath } from '../env'

// rembg as an explicit, detectable install (spec M6). It used to run through
// `uv tool run`, which installs ~84 packages and then the model on first use,
// invisibly; "ready" could not be known, so the CLI could not refuse.

const EXE = process.platform === 'win32' ? '.exe' : ''

/** A RANGE, not an exact pin: the floor keeps the numba/Python-3.13 fix, the
 * ceiling keeps a major release from changing the CLI under us. */
export const REMBG_SPEC = 'rembg[cli,cpu]>=2.0.75,<3'

/** Our own uv tool dir, so the install never touches the user's uv tools. */
export function rembgToolDir(): string {
  return userDataPath('uv-tools')
}

export function rembgExe(): string {
  return join(rembgToolDir(), 'rembg', 'Scripts', 'rembg' + EXE)
}

/** Where `uv tool install rembg` put it before 0.6.0 (uv's default dir). */
export function legacyRembgExe(): string {
  return join(process.env.APPDATA ?? '', 'uv', 'tools', 'rembg', 'Scripts', 'rembg' + EXE)
}

/** The pinned model folder (U2NET_HOME), shared by the app and the CLI. */
export function rembgModelDir(): string {
  return userDataPath('models', 'rembg')
}

/** rembg's session classes save `<session name>.onnx` under U2NET_HOME. */
export function rembgModelFile(model: string): string {
  return join(rembgModelDir(), `${model}.onnx`)
}

export function installedRembgExe(): string | null {
  for (const p of [rembgExe(), legacyRembgExe()]) if (existsSync(p)) return p
  return null
}

export function rembgModelPresent(model: string): boolean {
  return existsSync(rembgModelFile(model))
}

export function rembgEnv(): NodeJS.ProcessEnv {
  return { ...process.env, U2NET_HOME: rembgModelDir() }
}
```

`src/main/rembg/setup.ts`:

```ts
import { createHash } from 'crypto'
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { run } from '../run'
import { withFileLock } from '../locks'
import { recordHash } from '../net/integrity'
import { ensureUv, type InstallOpts, type InstallProgress } from '../uvInstall'
import {
  REMBG_SPEC,
  installedRembgExe,
  rembgEnv,
  rembgExe,
  rembgModelDir,
  rembgModelFile,
  rembgModelPresent,
  rembgToolDir
} from './paths'

/** A 1x1 PNG: the warm-up input that makes rembg fetch its model. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

const lastLine = (s: string): string => s.trim().split('\n').pop()?.trim() ?? ''

/** Where pre-0.6 `uv tool run rembg` left its models: rembg's default
 * U2NET_HOME (~/.u2net), or the user's own U2NET_HOME. Reusing that file saves
 * an existing user a second download of about 1 GB. */
export function legacyRembgModelFile(model: string, env = process.env, home = homedir()): string {
  return join(env.U2NET_HOME || join(home, '.u2net'), `${model}.onnx`)
}

/**
 * One-time background-removal setup (spec 5.3, M6): uv (bootstrapped when
 * absent), `uv tool install` of rembg into our own tool dir, then a 1x1 warm-up
 * run with U2NET_HOME pinned so the model lands in a known file we can check
 * and hash. Idempotent; one setup per machine at a time.
 */
export async function setupRembg(
  model: string,
  onProgress: InstallProgress,
  opts: InstallOpts = {}
): Promise<void> {
  await withFileLock(
    'rembg',
    'background removal',
    async () => {
      if (!installedRembgExe()) {
        const uv = await ensureUv(onProgress, opts)
        onProgress('Installing the background-removal engine (rembg)', null)
        const res = await run(uv, ['tool', 'install', '--python', '3.11', REMBG_SPEC], {
          signal: opts.signal,
          env: {
            ...process.env,
            UV_TOOL_DIR: rembgToolDir(),
            UV_TOOL_BIN_DIR: join(rembgToolDir(), 'bin')
          }
        })
        if (res.code !== 0) throw new Error(`rembg install failed: ${lastLine(res.stderr)}`)
        if (!existsSync(rembgExe())) throw new Error('rembg install finished but rembg.exe is missing.')
      }
      const legacy = legacyRembgModelFile(model)
      if (!rembgModelPresent(model) && legacy !== rembgModelFile(model) && existsSync(legacy)) {
        mkdirSync(rembgModelDir(), { recursive: true })
        onProgress(`Reusing the ${model} model already on this PC`, null)
        const part = `${rembgModelFile(model)}.${process.pid}.tmp`
        copyFileSync(legacy, part)
        renameSync(part, rembgModelFile(model))
      }
      if (!rembgModelPresent(model)) {
        mkdirSync(rembgModelDir(), { recursive: true })
        const tmp = mkdtempSync(join(tmpdir(), 'filesmith-rembg-'))
        const step = `Downloading the ${model} model`
        try {
          const src = join(tmp, 'in.png')
          writeFileSync(src, TINY_PNG)
          onProgress(step, null)
          const res = await run(installedRembgExe() as string, ['i', '-m', model, src, join(tmp, 'out.png')], {
            signal: opts.signal,
            env: rembgEnv(),
            // pooch draws a tqdm bar: "  42%|####      |"
            onStderr: (s) => {
              const m = /(\d{1,3})%\|/.exec(s)
              if (m) onProgress(step, Number(m[1]))
            }
          })
          if (res.code !== 0 || !rembgModelPresent(model))
            throw new Error(`The ${model} model could not be downloaded: ${lastLine(res.stderr)}`)
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
        const file = rembgModelFile(model)
        recordHash(`rembg-model:${model}`, await hashFile(file), statSync(file).size)
      }
      onProgress('Ready', 100)
    },
    {
      signal: opts.signal,
      onWait: () => onProgress('Waiting for another Filesmith to finish setting up', null)
    }
  )
}
```

`src/main/tools/readiness.ts`:

```ts
import { existsSync } from 'fs'
import type { JobOptions } from '@shared/types'
import { engineEnv } from '../env'
import { resolveRealesrgan, toolMissingMessage } from '../toolResolver'
import { cudaTierSupport, detectNvidia } from '../pid/gpu'
import { comfyEngineReady, pidInstalled } from '../pid/paths'
import { comfyPythonReady } from '../comfy/pythonEnv'
import { comfyModelByPath } from '../comfy/store'
import { listNcnnModels } from './ncnnModels'
import { bgModelOf } from './removebg'
import { installedRembgExe, rembgModelPresent } from '../rembg/paths'

export type ReadinessCode = 'SETUP_REQUIRED' | 'GPU_UNSUPPORTED' | 'TOOL_MISSING' | 'USAGE'
export type Readiness = { ok: true } | { ok: false; code: ReadinessCode; message: string; hint?: string }
export type SetupTool = 'pid' | 'spandrel' | 'removebg'

const CLI_WORDING: Record<SetupTool, string> = {
  pid: 'PiD is not installed.',
  spandrel: 'The ComfyUI upscaler engine (spandrel) is not set up.',
  removebg: 'Background removal is not set up yet.'
}
const APP_WORDING: Record<SetupTool, string> = {
  pid: 'PiD is not installed. Pick PiD in the options panel and click Download first.',
  spandrel: 'The ComfyUI upscaler engine is not set up yet. Set it up from the Upscale options.',
  removebg: 'Background removal is not set up yet.'
}

export function setupHint(tool: SetupTool): string {
  return `filesmith setup ${tool}`
}

/** The job-time message when an AI tool is missing: the CLI names its exact
 * setup command (the runner lifts it into the event's `hint`). */
export function notReadyMessage(tool: SetupTool): string {
  return engineEnv().host === 'cli'
    ? `${CLI_WORDING[tool]} Run: ${setupHint(tool)}.`
    : APP_WORDING[tool]
}

export interface ReadinessDeps {
  pidInstalled(): boolean
  cuda(): Promise<{ ok: boolean; reason?: string }>
  comfyEngineReady(): boolean
  comfyModelKnown(path: string): boolean
  realesrganPresent(): boolean
  ncnnNames(): string[]
  rembgInstalled(): boolean
  rembgModelPresent(model: string): boolean
}

const setup = (tool: SetupTool): Readiness => ({
  ok: false,
  code: 'SETUP_REQUIRED',
  message: CLI_WORDING[tool],
  hint: setupHint(tool)
})

/** Pre-flight for upscale (spec 5.1). Never downloads. */
export async function upscaleReadiness(
  options: JobOptions,
  deps: ReadinessDeps
): Promise<Readiness> {
  const model = String(options.upscaleModel ?? 'photo')
  if (model === 'pid' || model.startsWith('comfy:')) {
    const gpu = await deps.cuda()
    if (!gpu.ok)
      return {
        ok: false,
        code: 'GPU_UNSUPPORTED',
        message: gpu.reason ?? 'This GPU cannot run the CUDA upscalers.'
      }
    if (model === 'pid') return deps.pidInstalled() ? { ok: true } : setup('pid')
    if (!deps.comfyEngineReady()) return setup('spandrel')
    if (!deps.comfyModelKnown(model.slice('comfy:'.length)))
      return {
        ok: false,
        code: 'SETUP_REQUIRED',
        message: 'That ComfyUI model is not in the scanned list.',
        hint: 'filesmith setup spandrel --comfy "<ComfyUI folder>"'
      }
    return { ok: true }
  }
  if (model === 'comfy')
    return {
      ok: false,
      code: 'USAGE',
      message: 'Name a ComfyUI model: --model comfy:<model file>.',
      hint: 'filesmith formats upscale'
    }
  if (!deps.realesrganPresent())
    return {
      ok: false,
      code: 'TOOL_MISSING',
      message: toolMissingMessage('realesrgan-ncnn-vulkan'),
      hint: 'filesmith doctor'
    }
  const names = deps.ncnnNames()
  const wanted = model.startsWith('esrgan:') ? model.slice('esrgan:'.length) : null
  if (wanted && !names.some((n) => n.toLowerCase() === wanted.toLowerCase()))
    return {
      ok: false,
      code: 'USAGE',
      message: `No Real-ESRGAN model named "${wanted}". Installed: ${names.join(', ') || 'none'}.`,
      hint: 'filesmith formats upscale'
    }
  return { ok: true }
}

/** Pre-flight for removebg: the installed tool AND the chosen model file. */
export function removebgReadiness(options: JobOptions, deps: ReadinessDeps): Readiness {
  const model = bgModelOf(options)
  return deps.rembgInstalled() && deps.rembgModelPresent(model) ? { ok: true } : setup('removebg')
}

export const defaultReadinessDeps: ReadinessDeps = {
  pidInstalled: () => pidInstalled('flux'),
  cuda: async () => cudaTierSupport(await detectNvidia()),
  comfyEngineReady: () => comfyEngineReady() || comfyPythonReady(),
  comfyModelKnown: (p) => comfyModelByPath(p) != null,
  realesrganPresent: () => existsSync(resolveRealesrgan()),
  ncnnNames: () => listNcnnModels().map((m) => m.name),
  rembgInstalled: () => installedRembgExe() != null,
  rembgModelPresent
}
```

`src/main/toolResolver.ts`: delete `REMBG_SPEC`, `rembgInstalledPath` and the long `uv tool run` comment block above them; import `{ installedRembgExe, rembgEnv, rembgModelPresent }` from `./rembg/paths` and `{ BG_DEFAULTS }` from `@shared/removebg`; change the uv import to `import { findUv } from './uv'` (keep `findUvAsync` exported from `uv.ts`; doctor uses it); replace the rembg section with:

```ts
export interface RembgCommand {
  cmd: string
  /** Prefix args before rembg's own arguments. */
  prefix: string[]
  /** U2NET_HOME pinned to the shared model folder. */
  env: NodeJS.ProcessEnv
}

export interface RembgStatus {
  /** rembg AND its default model are installed: the next run downloads nothing. */
  ready: boolean
  /** A first-use setup can proceed. Always true now: setupRembg bootstraps a
   * pinned uv itself (uvInstall.ts), so the Settings and Remove BG panels'
   * "needs uv" branch no longer applies and the renderer stays untouched. */
  uvAvailable: boolean
}

export async function removebgStatus(): Promise<RembgStatus> {
  return {
    ready: installedRembgExe() != null && rembgModelPresent(BG_DEFAULTS.bgModel),
    uvAvailable: true
  }
}

/** The installed rembg (spec M6), or null. Never `uv tool run`: that installs
 * packages and a model on first use, invisibly. setupRembg installs it. */
export function resolveRembg(): RembgCommand | null {
  const exe = installedRembgExe()
  return exe ? { cmd: exe, prefix: [], env: rembgEnv() } : null
}
```

`src/main/tools/registry.ts`:

1. `upscaleWithPid`: `throw new Error(notReadyMessage('pid'))` (import `notReadyMessage` from `./readiness`).
2. `removebgTool.run`: replace the `resolveRembg()` / uv error block at its top with

```ts
    const model = bgModelOf(options)
    let rembg = resolveRembg()
    if (!rembg || !rembgModelPresent(model)) {
      // The CLI never downloads from a job (spec M5); the app sets up inline,
      // where its first removebg job used to download invisibly.
      if (ctx.allowDownload === false) throw new Error(notReadyMessage('removebg'))
      ctx.onProgress(undefined, 'Setting up background removal (one time)...')
      await setupRembg(model, (step, pct) => ctx.onProgress(pct ?? undefined, step), {
        signal: ctx.signal
      })
      rembg = resolveRembg()
      if (!rembg) throw new Error('Background removal could not be set up.')
    }
```

and give the rembg `run(...)` call `env: rembg.env` in its options (next to `signal`). Imports: `bgModelOf` from `./removebg`, `rembgModelPresent` from `../rembg/paths`, `setupRembg` from `../rembg/setup`. `rembg` is now `let` inside the function; TypeScript narrows it after the guard.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/readiness.test.ts test/rembg-setup.test.ts test/removebg.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the real install once on this machine**

```bash
npm run build
```

Then in the app (`npm run dev`), run Remove BG on one PNG. Expected: the row shows "Setting up background removal (one time)..." and the download steps, then finishes; `%APPDATA%\Filesmith\models\rembg\birefnet-general.onnx` and `%APPDATA%\Filesmith\uv-tools\rembg\Scripts\rembg.exe` exist. If the model file has a different name, rembg's naming changed: update `rembgModelFile` to the observed name and re-run the tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/main test/readiness.test.ts test/rembg-setup.test.ts
git commit -m "feat(engine): explicit rembg install with a pinned model folder; AI readiness checks" -m "removebg runs an installed rembg with U2NET_HOME=%APPDATA%\\Filesmith\\models\\rembg; removebg:status.ready is now true only when the tool and model exist. Jobs take allowDownload; with false (the CLI) a missing AI runtime fails with 'Run: filesmith setup <tool>'." -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Exit codes, the event schema and both reporters

**Files:**
- Create: `src/cli/exit.ts`, `src/cli/events.ts`, `src/cli/human.ts`, `test/cli-exit.test.ts`, `test/cli-events.test.ts`, `test/cli-human.test.ts`

**Interfaces:**
- Consumes: `formatBytes` (`@shared/compress`), `baseName` (`@shared/fileKind`).
- Produces:
  - `exit.ts`: `EXIT = { OK: 0, FAILED: 1, USAGE: 2, CANCELED: 130 }`, `type ErrorCode` (the 14 spec codes), `class CliError extends Error { code: ErrorCode; hint?: string }` (`new CliError(code, message, hint?)`), `class UsageError extends CliError` (`new UsageError(message, commandPath?: string[], hint?)`, `.commandPath`), `interface Counts { ok: number; failed: number; skipped: number; canceled: number }`, `reduceExit(c: Counts): number`.
  - `events.ts`: `SCHEMA_VERSION = 1`, `type OutputKind`, `type EventBody` (union below), `interface Out { write(s: string): void }`, `interface Reporter { emit(e: EventBody): void; text(s: string): void; close(): void }`, `class JsonReporter implements Reporter` (`new JsonReporter(out, clock?, now?)`).
  - `human.ts`: `class HumanReporter implements Reporter` (`new HumanReporter(stdout, stderr, { color: boolean; stderrTTY: boolean })`), and the pure formatters `pctChange`, `fmtEta`, `resultLine`, `summaryLine`.

- [ ] **Step 1: Write the failing tests**

`test/cli-exit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CliError, EXIT, UsageError, reduceExit } from '../src/cli/exit'

describe('reduceExit', () => {
  const c = (ok: number, failed: number, skipped: number, canceled: number) => ({
    ok,
    failed,
    skipped,
    canceled
  })
  it.each([
    [c(3, 0, 0, 0), 0],
    [c(0, 0, 2, 0), 0],
    [c(2, 1, 0, 0), 1],
    [c(1, 1, 0, 1), 130],
    [c(0, 0, 0, 0), 0]
  ])('%j -> %i', (counts, code) => expect(reduceExit(counts)).toBe(code))
})

describe('errors', () => {
  it('UsageError is a CliError with code USAGE and the command path', () => {
    const e = new UsageError('bad', ['pdf', 'split'])
    expect(e).toBeInstanceOf(CliError)
    expect(e.code).toBe('USAGE')
    expect(e.commandPath).toEqual(['pdf', 'split'])
    expect(EXIT.USAGE).toBe(2)
  })
})
```

`test/cli-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { JsonReporter, type EventBody } from '../src/cli/events'

function collect(): { out: { write: (s: string) => void }; lines: () => Record<string, unknown>[] } {
  let buf = ''
  return {
    out: { write: (s) => (buf += s) },
    lines: () =>
      buf
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
  }
}

const fixedNow = (): Date => new Date('2026-10-04T12:00:00.000Z')

describe('JsonReporter', () => {
  it('writes one envelope per line: v, event, ts first, undefined fields omitted', () => {
    const c = collect()
    const r = new JsonReporter(c.out, () => 0, fixedNow)
    r.emit({ event: 'error', code: 'NOT_FOUND', message: 'nope', input: 'C:\\a.png' })
    let raw = ''
    const r2 = new JsonReporter({ write: (s) => (raw += s) }, () => 0, fixedNow)
    r2.emit({ event: 'done', id: '1', input: 'a', output: 'b', outputKind: 'file', inSize: 1, ms: 5 })
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw.indexOf('"v":1')).toBeLessThan(raw.indexOf('"event"'))
    expect(c.lines()).toEqual([
      {
        v: 1,
        event: 'error',
        ts: '2026-10-04T12:00:00.000Z',
        code: 'NOT_FOUND',
        message: 'nope',
        input: 'C:\\a.png'
      }
    ])
    expect(raw).not.toContain('outSize')
  })

  it('rate-limits progress to one per 250 ms per job, but always passes a new tenth', () => {
    const c = collect()
    let t = 0
    const r = new JsonReporter(c.out, () => t, fixedNow)
    const p = (id: string, pct: number | null): EventBody => ({ event: 'progress', id, pct })
    r.emit(p('1', 1)) // first: passes
    t = 100
    r.emit(p('1', 2)) // same tenth, 100 ms: dropped
    r.emit(p('2', 2)) // other job: passes
    t = 150
    r.emit(p('1', 10)) // new tenth: passes
    t = 300
    r.emit(p('1', 11)) // 150 ms since last: dropped
    t = 401
    r.emit(p('1', null)) // 251 ms since last: passes
    expect(c.lines().map((l) => [l.id, l.pct])).toEqual([
      ['1', 1],
      ['2', 2],
      ['1', 10],
      ['1', null]
    ])
  })

  it('text() writes nothing in JSON mode', () => {
    const c = collect()
    new JsonReporter(c.out).text('hello')
    expect(c.lines()).toEqual([])
  })
})
```

`test/cli-human.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HumanReporter, fmtEta, pctChange, summaryLine } from '../src/cli/human'

function sink(): { out: { write: (s: string) => void }; text: () => string } {
  let buf = ''
  return { out: { write: (s) => (buf += s) }, text: () => buf }
}

describe('formatters', () => {
  it('pctChange', () => {
    expect(pctChange(2_400_000, 310_000)).toBe('-87%')
    expect(pctChange(100, 112)).toBe('+12%')
    expect(pctChange(0, 5)).toBeNull()
  })
  it('fmtEta', () => {
    expect(fmtEta(4.4)).toBe('4s')
    expect(fmtEta(125)).toBe('2m05s')
  })
  it('summaryLine', () => {
    expect(summaryLine({ ok: 1, failed: 1, skipped: 1, canceled: 0, ms: 4200 }, false)).toBe(
      '3 files: 1 ok, 1 skipped, 1 failed (4.2 s)\n'
    )
    expect(summaryLine({ ok: 1, failed: 0, skipped: 0, canceled: 0, ms: 0 }, true)).toBe(
      '1 file: 1 would run, 0 skipped, 0 would fail (0.0 s)\n'
    )
  })
})

describe('HumanReporter', () => {
  it('prints result lines and the summary on stdout, warnings on stderr, no colour', () => {
    const o = sink()
    const e = sink()
    const r = new HumanReporter(o.out, e.out, { color: false, stderrTTY: false })
    r.emit({ event: 'run', command: 'convert', version: '0.6.0', dryRun: false, inputs: 3, options: {} })
    r.emit({ event: 'start', id: '1', input: 'C:\\x\\photo.png', inSize: 2_400_000, op: 'convert' })
    r.emit({ event: 'progress', id: '1', pct: 50 })
    r.emit({
      event: 'done',
      id: '1',
      input: 'C:\\x\\photo.png',
      output: 'C:\\x\\photo.webp',
      outputKind: 'file',
      inSize: 2_400_000,
      outSize: 310_000,
      ms: 900
    })
    r.emit({ event: 'skipped', id: '2', input: 'C:\\x\\logo.webp', code: 'SAME_FORMAT', message: 'already webp' })
    r.emit({
      event: 'error',
      id: '3',
      input: 'C:\\x\\broken.jpg',
      code: 'TOOL_FAILED',
      message: 'magick: improper image header'
    })
    r.emit({ event: 'warning', code: 'QUALITY_IGNORED', message: '--quality has no effect here' })
    r.emit({
      event: 'summary',
      ok: 1,
      failed: 1,
      skipped: 1,
      canceled: 0,
      inBytes: 0,
      outBytes: 0,
      ms: 4200,
      exitCode: 1
    })
    // label column 8, name column 34, one space, then the right-hand detail
    const row = (label: string, left: string, right: string): string =>
      `${label.padEnd(8)}${left.padEnd(34)} ${right}`
    expect(o.text()).toBe(
      [
        row('ok', 'photo.png -> photo.webp', '2.3 MB -> 303 KB  (-87%)'),
        row('skip', 'logo.webp', 'already webp'),
        row('fail', 'broken.jpg', 'magick: improper image header'),
        '3 files: 1 ok, 1 skipped, 1 failed (4.2 s)',
        ''
      ].join('\n')
    )
    expect(e.text()).toBe('warn: --quality has no effect here\n')
  })

  it('draws one redrawn progress line on a TTY stderr and clears it before results', () => {
    const o = sink()
    const e = sink()
    const r = new HumanReporter(o.out, e.out, { color: false, stderrTTY: true })
    r.emit({ event: 'run', command: 'compress', version: '0.6.0', dryRun: false, inputs: 2, options: {} })
    r.emit({ event: 'start', id: '2', input: 'C:\\a.mp4', inSize: 1, op: 'compress' })
    r.emit({ event: 'progress', id: '2', pct: 62, etaSec: 4 })
    r.emit({ event: 'canceled', id: '2', input: 'C:\\a.mp4' })
    expect(e.text()).toBe('\r\x1b[2K[2/2] a.mp4 62% (4s)\r\x1b[2K')
    expect(o.text()).toBe('stop    a.mp4\n')
  })

  it('prints a run-level error and its hint on stderr', () => {
    const o = sink()
    const e = sink()
    const r = new HumanReporter(o.out, e.out, { color: false, stderrTTY: false })
    r.emit({ event: 'error', code: 'SETUP_REQUIRED', message: 'PiD is not installed.', hint: 'filesmith setup pid' })
    expect(e.text()).toBe('filesmith: PiD is not installed.\n  hint: filesmith setup pid\n')
    expect(o.text()).toBe('')
  })

  it('colours only the status word, only when asked', () => {
    const o = sink()
    const r = new HumanReporter(o.out, sink().out, { color: true, stderrTTY: false })
    r.emit({ event: 'skipped', id: '1', input: 'a.webp', code: 'SAME_FORMAT', message: 'already webp' })
    expect(o.text().startsWith('\x1b[33mskip    \x1b[0m')).toBe(true)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/cli-exit.test.ts test/cli-events.test.ts test/cli-human.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

`src/cli/exit.ts`:

```ts
export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, CANCELED: 130 } as const

/** Stable error codes (spec 2.6). Adding one is fine; renaming one bumps `v`. */
export type ErrorCode =
  | 'USAGE'
  | 'NOT_FOUND'
  | 'NO_MATCH'
  | 'UNSUPPORTED_KIND'
  | 'SAME_FORMAT'
  | 'OUT_DIR_MISSING'
  | 'TOOL_MISSING'
  | 'SETUP_REQUIRED'
  | 'GPU_UNSUPPORTED'
  | 'RAR_MISSING'
  | 'PASSWORD'
  | 'TOOL_FAILED'
  | 'CANCELED'
  | 'INTERNAL'

/** A run-level failure decided before any file is touched: exit 2. */
export class CliError extends Error {
  readonly code: ErrorCode
  readonly hint?: string
  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.hint = hint
  }
}

/** Bad arguments. `commandPath` picks the usage line printed after it. */
export class UsageError extends CliError {
  readonly commandPath: string[]
  constructor(message: string, commandPath: string[] = [], hint?: string) {
    super('USAGE', message, hint)
    this.name = 'UsageError'
    this.commandPath = commandPath
  }
}

export interface Counts {
  ok: number
  failed: number
  skipped: number
  canceled: number
}

/** Spec 2.7: Ctrl+C wins, then any failure, else success (skips are success). */
export function reduceExit(c: Counts): number {
  if (c.canceled > 0) return EXIT.CANCELED
  if (c.failed > 0) return EXIT.FAILED
  return EXIT.OK
}
```

`src/cli/events.ts`:

```ts
import type { ErrorCode } from './exit'

export const SCHEMA_VERSION = 1

export type OutputKind = 'file' | 'dir'

/** Every event the CLI writes (spec 2.6), without the `v`/`ts` envelope. */
export type EventBody =
  | {
      event: 'run'
      command: string
      version: string
      dryRun: boolean
      inputs: number
      options: Record<string, unknown>
    }
  | {
      event: 'plan'
      id: string
      input: string | string[]
      inSize: number
      op: string
      output?: string
      outputKind?: OutputKind
      ready: boolean
      code?: ErrorCode
      message?: string
      hint?: string
    }
  | { event: 'start'; id: string; input: string; inSize: number; op: string }
  | { event: 'progress'; id: string; pct: number | null; etaSec?: number; message?: string }
  | {
      event: 'done'
      id: string
      input: string
      output: string
      outputKind: OutputKind
      inSize: number
      outSize?: number
      files?: number
      ms: number
      seed?: number
    }
  | { event: 'done'; tool: string; path?: string; alreadyDone: boolean }
  | { event: 'done'; path: string; updated: boolean; previousVersion?: string }
  | { event: 'skipped'; id?: string; input: string; code: ErrorCode; message: string }
  | { event: 'error'; id?: string; input?: string; code: ErrorCode; message: string; hint?: string }
  | { event: 'warning'; code: string; message: string; id?: string }
  | { event: 'canceled'; id: string; input: string }
  | {
      event: 'summary'
      ok: number
      failed: number
      skipped: number
      canceled: number
      inBytes: number
      outBytes: number
      ms: number
      exitCode: number
    }
  | { event: 'version'; version: string }
  | { event: 'formats'; data: Record<string, unknown> }
  | {
      event: 'check'
      id: string
      group: string
      status: 'ok' | 'warn' | 'fail' | 'skip'
      detail: string
      fix?: string
    }
  | {
      event: 'step'
      step: string
      pct: number | null
      bytes?: number
      totalBytes?: number
      etaSec?: number
      detail?: string
    }
  | { event: 'heartbeat'; step: string; elapsedSec: number }

export interface Out {
  write(s: string): void
}

/** Commands only ever emit events; a reporter decides what the user sees. */
export interface Reporter {
  emit(e: EventBody): void
  /** Free text for human mode (formats tables, help-like output); dropped in JSON. */
  text(s: string): void
  close(): void
}

/** NDJSON on stdout (spec 2.5): one line per event, flushed per write. */
export class JsonReporter implements Reporter {
  private last = new Map<string, { t: number; tenth: number }>()

  constructor(
    private readonly out: Out,
    private readonly clock: () => number = Date.now,
    private readonly now: () => Date = () => new Date()
  ) {}

  emit(e: EventBody): void {
    if (e.event === 'progress' && !this.allow(`p:${e.id}`, e.pct)) return
    if (e.event === 'step' && !this.allow(`s:${e.step}`, e.pct)) return
    const { event, ...rest } = e
    this.out.write(
      JSON.stringify({ v: SCHEMA_VERSION, event, ts: this.now().toISOString(), ...rest }) + '\n'
    )
  }

  text(): void {
    /* JSON mode carries only events */
  }

  close(): void {}

  /** One progress line per job per 250 ms, plus every whole 10%. */
  private allow(key: string, pct: number | null): boolean {
    const t = this.clock()
    const tenth = pct == null ? -1 : Math.floor(pct / 10)
    const prev = this.last.get(key)
    if (!prev || tenth > prev.tenth || t - prev.t >= 250) {
      this.last.set(key, { t, tenth: Math.max(tenth, prev?.tenth ?? -1) })
      return true
    }
    return false
  }
}
```

`src/cli/human.ts`:

```ts
import { formatBytes } from '@shared/compress'
import { baseName } from '@shared/fileKind'
import type { EventBody, Out, Reporter } from './events'

type Label = 'ok' | 'skip' | 'fail' | 'stop' | 'plan'
const COLOR: Partial<Record<Label, string>> = { ok: '\x1b[32m', skip: '\x1b[33m', fail: '\x1b[31m' }
const RESET = '\x1b[0m'
const CLEAR = '\r\x1b[2K'

export function pctChange(inSize: number, outSize: number): string | null {
  if (!(inSize > 0)) return null
  const d = Math.round(((outSize - inSize) / inSize) * 100)
  return `${d > 0 ? '+' : ''}${d}%`
}

export function fmtEta(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function resultLine(label: Label, left: string, right: string, color: boolean): string {
  const tag = label.padEnd(8)
  const c = color ? COLOR[label] : undefined
  return `${c ? `${c}${tag}${RESET}` : tag}${left.padEnd(34)} ${right}`.trimEnd() + '\n'
}

export function summaryLine(
  s: { ok: number; failed: number; skipped: number; canceled: number; ms: number },
  dryRun: boolean
): string {
  const n = s.ok + s.failed + s.skipped + s.canceled
  const parts = dryRun
    ? [`${s.ok} would run`, `${s.skipped} skipped`, `${s.failed} would fail`]
    : [`${s.ok} ok`, `${s.skipped} skipped`, `${s.failed} failed`]
  if (s.canceled) parts.push(`${s.canceled} canceled`)
  return `${n} ${n === 1 ? 'file' : 'files'}: ${parts.join(', ')} (${(s.ms / 1000).toFixed(1)} s)\n`
}

const nameOf = (input: string | string[]): string =>
  Array.isArray(input)
    ? `${baseName(input[0] ?? '')}${input.length > 1 ? ` +${input.length - 1}` : ''}`
    : baseName(input)

/** Human output (spec 2.5): results on stdout, progress and warnings on stderr. */
export class HumanReporter implements Reporter {
  private names = new Map<string, string>()
  private total = 0
  private dryRun = false
  private progressShown = false
  private lastStep = ''

  constructor(
    private readonly stdout: Out,
    private readonly stderr: Out,
    private readonly opts: { color: boolean; stderrTTY: boolean }
  ) {}

  private out(s: string): void {
    this.clearProgress()
    this.stdout.write(s)
  }

  private err(s: string): void {
    this.clearProgress()
    this.stderr.write(s)
  }

  private clearProgress(): void {
    if (!this.progressShown) return
    this.stderr.write(CLEAR)
    this.progressShown = false
  }

  private redraw(s: string): void {
    this.stderr.write(CLEAR + s)
    this.progressShown = true
  }

  emit(e: EventBody): void {
    const color = this.opts.color
    switch (e.event) {
      case 'run':
        this.dryRun = e.dryRun
        this.total = e.inputs
        return
      case 'plan': {
        const left = e.output
          ? `${nameOf(e.input)} -> ${baseName(e.output)}${e.outputKind === 'dir' ? '\\' : ''}`
          : nameOf(e.input)
        if (e.ready) this.out(resultLine('plan', left, `${e.op}${e.message ? `  ${e.message}` : ''}`, color))
        else {
          this.out(resultLine('fail', nameOf(e.input), `would fail: ${e.message ?? ''}`, color))
          if (e.hint) this.out(`        hint: ${e.hint}\n`)
        }
        return
      }
      case 'start':
        this.names.set(e.id, baseName(e.input))
        return
      case 'progress': {
        if (!this.opts.stderrTTY) return
        const pct = e.pct == null ? 'working' : `${Math.round(e.pct)}%`
        const eta = e.etaSec != null ? ` (${fmtEta(e.etaSec)})` : ''
        this.redraw(`[${e.id}/${this.total}] ${this.names.get(e.id) ?? ''} ${pct}${eta}`)
        return
      }
      case 'done': {
        if ('tool' in e) {
          this.out(resultLine('ok', e.tool, e.alreadyDone ? 'already set up' : 'set up', color))
          return
        }
        if ('updated' in e) {
          const prev = e.previousVersion ? ` (was ${e.previousVersion})` : ''
          this.out(resultLine('ok', 'skill', `${e.updated ? 'updated' : 'installed'} at ${e.path}${prev}`, color))
          return
        }
        const left = `${baseName(e.input)} -> ${baseName(e.output)}${e.outputKind === 'dir' ? '\\' : ''}`
        let right = ''
        if (e.outputKind === 'dir') right = `${e.files ?? 0} files`
        else if (e.outSize != null) {
          const change = pctChange(e.inSize, e.outSize)
          right = `${formatBytes(e.inSize)} -> ${formatBytes(e.outSize)}${change ? `  (${change})` : ''}`
        }
        this.out(resultLine('ok', left, right, color))
        return
      }
      case 'skipped':
        this.out(resultLine('skip', baseName(e.input), e.message, color))
        return
      case 'error':
        if (e.id || e.input) {
          this.out(resultLine('fail', e.input ? baseName(e.input) : `#${e.id}`, e.message, color))
          if (e.hint) this.out(`        hint: ${e.hint}\n`)
        } else {
          this.err(`filesmith: ${e.message}\n`)
          if (e.hint) this.err(`  hint: ${e.hint}\n`)
        }
        return
      case 'warning':
        this.err(`warn: ${e.message}\n`)
        return
      case 'canceled':
        this.out(resultLine('stop', baseName(e.input), '', color))
        return
      case 'summary':
        this.out(summaryLine(e, this.dryRun))
        return
      case 'version':
        this.out(`${e.version}\n`)
        return
      case 'check':
        this.out(`  ${e.status.padEnd(6)}${e.id.padEnd(18)}${e.detail}\n`)
        if (e.fix && e.status !== 'ok') this.out(`        fix: ${e.fix}\n`)
        return
      case 'step': {
        const pct = e.pct == null ? '' : ` ${Math.round(e.pct)}%`
        const eta = e.etaSec != null ? ` (${fmtEta(e.etaSec)})` : ''
        if (e.detail) this.out(`  - ${e.step}: ${e.detail}\n`)
        else if (this.opts.stderrTTY) this.redraw(`${e.step}${pct}${eta}`)
        else if (e.step !== this.lastStep) this.err(`${e.step}\n`)
        this.lastStep = e.step
        return
      }
      case 'heartbeat':
        if (this.opts.stderrTTY) this.redraw(`${e.step} (${fmtEta(e.elapsedSec)})`)
        return
      case 'formats':
        return
    }
  }

  text(s: string): void {
    this.out(s)
  }

  close(): void {
    this.clearProgress()
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/cli-exit.test.ts test/cli-events.test.ts test/cli-human.test.ts`
Expected: PASS. If the `ok` line's byte figures differ, `formatBytes` uses binary units (2_400_000 B is `2.3 MB`); fix the test literal to what `formatBytes` prints, never the formatter (the app shows the same numbers).

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/cli/exit.ts src/cli/events.ts src/cli/human.ts test/cli-exit.test.ts test/cli-events.test.ts test/cli-human.test.ts
git commit -m "feat(cli): exit codes, JSON event schema v1 and the human reporter" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Command catalog, argument parser and help

**Files:**
- Create: `src/cli/catalog.ts`, `src/cli/parse.ts`, `src/cli/help.ts`, `test/cli-catalog.test.ts`, `test/cli-parse.test.ts`, `test/cli-help.test.ts`, `test/no-em-dash.test.ts`

**Interfaces:**
- Consumes: `UsageError` (Task 6); `@shared/{convert,compress,resize,removebg,generate,tabs}` catalogs.
- Produces:
  - `catalog.ts`: `type FlagType = 'bool' | 'enum' | 'int' | 'number' | 'text' | 'path' | 'format' | 'enumOrInt'`; `interface FlagSpec { name: string; aliases?: string[]; short?: string; type: FlagType; values?: readonly string[]; numeric?: boolean; min?: number; max?: number; step?: number; suffix?: string; key?: string; map?: Readonly<Record<string, string>>; def?: string | number | boolean; required?: boolean; group?: string; valueName?: string; help: string }`; `type CommandId` (18 ids below); `interface CommandSpec { id: CommandId; path: string[]; args: string; summary: string; inputs: 'files' | 'prompt' | 'words' | 'none'; flags: FlagSpec[]; examples: string[] }`; `COMMANDS: CommandSpec[]`; `SUBCOMMANDS: Record<'pdf' | 'skill', string[]>`; `findCommand(path: string[]): CommandSpec | undefined`; `flagOf(cmd: CommandSpec, name: string): FlagSpec`; `CONVERT_TARGETS`, `VIDEO_CODEC_VALUES`, `AUDIO_CODEC_VALUES`.
  - `parse.ts`: `interface ParsedArgs { kind: 'run' | 'help' | 'version'; command: CommandSpec | null; group?: 'pdf' | 'skill'; positionals: string[]; values: Record<string, string | boolean>; json: boolean; dryRun: boolean }`; `parseArgv(argv: string[]): ParsedArgs` (throws `UsageError`); `detectJson(argv: string[]): boolean`.
  - `help.ts`: `usageLine(cmd)`, `renderHelp(cmd)`, `renderRootHelp()`, `renderGroupHelp(group)`, `wrap(text, width, indent)`.

`CommandId` values: `convert`, `compress`, `resize`, `upscale`, `removebg`, `generate`, `pdf merge`, `pdf split`, `pdf burst`, `pdf extract-text`, `pdf to-images`, `pdf extract-images`, `pdf compress`, `formats`, `doctor`, `setup`, `skill install`, `skill status`.

- [ ] **Step 1: Write the failing tests**

`test/cli-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { COMMANDS, findCommand, flagOf } from '../src/cli/catalog'
import { DEFAULT_OPTIONS } from '../src/renderer/src/state'
import type { ToolId } from '@shared/types'

// Every app option key a user can set has a CLI flag, and its default is the
// app's default (spec 2.3). Hidden keys are the ones the app never shows.
const HIDDEN: Partial<Record<ToolId, string[]>> = {
  removebg: ['bgModel', 'bgAlpha', 'bgAlphaFg', 'bgAlphaBg', 'bgErode', 'bgOnlyMask', 'bgPostProcess'],
  pdf: ['op'],
  archive: ['op'],
  generate: ['prompt']
}
const COMMAND_FOR: Record<ToolId, string[]> = {
  convert: ['convert'],
  archive: ['convert'],
  compress: ['compress'],
  resize: ['resize'],
  upscale: ['upscale'],
  removebg: ['removebg'],
  generate: ['generate'],
  pdf: ['pdf split', 'pdf to-images']
}

describe('catalog mirrors the app', () => {
  for (const [tool, opts] of Object.entries(DEFAULT_OPTIONS) as [ToolId, Record<string, unknown>][])
    it(`every visible ${tool} option has a flag`, () => {
      const keys = new Set(
        COMMAND_FOR[tool].flatMap((id) =>
          (COMMANDS.find((c) => c.id === id)?.flags ?? []).map((f) => f.key)
        )
      )
      for (const key of Object.keys(opts))
        if (!HIDDEN[tool]?.includes(key)) expect(keys, `${tool}.${key}`).toContain(key)
    })

  it.each([
    ['convert', 'quality', 'convert', 'quality'],
    ['convert', 'resolution', 'archive', 'dpi'],
    ['convert', 'page-format', 'archive', 'pageFormat'],
    ['convert', 'page-quality', 'archive', 'pageQuality'],
    ['compress', 'quality', 'compress', 'quality'],
    ['compress', 'format', 'compress', 'imageFormat'],
    ['compress', 'video-codec', 'compress', 'videoCodec'],
    ['compress', 'scale', 'compress', 'scale'],
    ['compress', 'audio-codec', 'compress', 'audioCodec'],
    ['compress', 'bitrate', 'compress', 'audioBitrate'],
    ['compress', 'level', 'compress', 'pdfLevel'],
    ['compress', 'greyscale', 'compress', 'pdfGray'],
    ['resize', 'percent', 'resize', 'percent'],
    ['resize', 'fit', 'resize', 'fit'],
    ['upscale', 'factor', 'upscale', 'upscaleFactor'],
    ['upscale', 'model', 'upscale', 'upscaleModel'],
    ['removebg', 'fill', 'removebg', 'bgFill'],
    ['removebg', 'color', 'removebg', 'bgCustomColor'],
    ['generate', 'negative', 'generate', 'negative'],
    ['generate', 'style', 'generate', 'style'],
    ['generate', 'count', 'generate', 'count'],
    ['pdf to-images', 'resolution', 'pdf', 'dpi']
  ] as const)('%s --%s defaults to %s.%s', (cmd, flag, tool, key) => {
    const f = flagOf(findCommand(cmd.split(' '))!, flag)
    const def = f.numeric || f.type === 'int' ? Number(f.def) : f.def
    expect(def).toEqual(DEFAULT_OPTIONS[tool][key])
  })

  it('convert --compression defaults to store, which the app stores as store: true', () => {
    expect(flagOf(findCommand(['convert'])!, 'compression').def).toBe('store')
    expect(DEFAULT_OPTIONS.archive.store).toBe(true)
  })

  it('--gpu uses the shown words and maps balanced to the stored background', () => {
    const gpu = flagOf(findCommand(['upscale'])!, 'gpu')
    expect(gpu.values).toEqual(['full', 'balanced'])
    expect(gpu.map?.balanced).toBe('background')
  })

  it('every command has a summary, an args line and at least one example', () => {
    for (const c of COMMANDS) {
      expect(c.summary.length, c.id).toBeGreaterThan(5)
      expect(c.examples.length, c.id).toBeGreaterThan(0)
    }
  })

  it('no two flags of one command share a name, alias or short', () => {
    for (const c of COMMANDS) {
      const names = c.flags.flatMap((f) => [f.name, ...(f.aliases ?? []), ...(f.short ? [`-${f.short}`] : [])])
      expect(new Set(names).size, c.id).toBe(names.length)
    }
  })
})
```

`test/cli-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectJson, parseArgv } from '../src/cli/parse'
import { UsageError } from '../src/cli/exit'

const p = (s: string[]): ReturnType<typeof parseArgv> => parseArgv(s)

describe('parseArgv', () => {
  it('verb, inputs and options in any order; both value syntaxes', () => {
    const a = p(['convert', 'a.png', '--to', 'webp', 'b.png', '--quality=best'])
    expect(a.kind).toBe('run')
    expect(a.command?.id).toBe('convert')
    expect(a.positionals).toEqual(['a.png', 'b.png'])
    expect(a.values).toEqual({ to: 'webp', quality: 'best' })
  })

  it('verbs and flag names are case-insensitive; values and paths keep case', () => {
    const a = p(['CONVERT', 'C:\\X\\A.PNG', '--TO', 'WebP'])
    expect(a.command?.id).toBe('convert')
    expect(a.positionals).toEqual(['C:\\X\\A.PNG'])
    expect(a.values.to).toBe('WebP')
  })

  it('aliases: remove-bg, --dpi, --grayscale, --no-<bool>', () => {
    expect(p(['remove-bg', 'x.png']).command?.id).toBe('removebg')
    expect(p(['remove-background', 'x.png']).command?.id).toBe('removebg')
    expect(p(['convert', 'a.pdf', '--to', 'cbz', '--dpi', '200']).values.resolution).toBe('200')
    expect(p(['compress', 'a.pdf', '--grayscale']).values.greyscale).toBe(true)
    expect(p(['compress', 'a.pdf', '--no-greyscale']).values.greyscale).toBe(false)
  })

  it('-o is --out, -h is help', () => {
    expect(p(['resize', 'a.png', '-o', 'D:\\Out']).values.out).toBe('D:\\Out')
    expect(p(['resize', '-h']).kind).toBe('help')
  })

  it('pdf tools nest; a bare pdf is a usage error naming the tools', () => {
    expect(p(['pdf', 'merge', 'a.pdf', 'b.pdf']).command?.id).toBe('pdf merge')
    expect(() => p(['pdf'])).toThrow(/merge, split, burst/)
    expect(() => p(['pdf', 'nope'])).toThrow(UsageError)
    expect(p(['pdf', '--help'])).toMatchObject({ kind: 'help', command: null, group: 'pdf' })
  })

  it('-- ends options: a file named like a flag', () => {
    const a = p(['resize', '--percent', '50', '--', '-x.png', '--json'])
    expect(a.positionals).toEqual(['-x.png', '--json'])
    expect(a.json).toBe(false)
  })

  it('keeps spaces, ampersands and non-ASCII letters in paths byte for byte', () => {
    const path = 'C:\\My Files\\Ä & b (1).png'
    expect(p(['convert', path, '--to', 'webp']).positionals).toEqual([path])
  })

  it('the last of a repeated flag wins', () => {
    expect(p(['convert', 'a', '--to', 'png', '--to', 'webp']).values.to).toBe('webp')
  })

  it('unknown flags name the flag and suggest the closest one', () => {
    expect(() => p(['convert', 'a', '--bogus'])).toThrow(/Unknown option --bogus for filesmith convert/)
    expect(() => p(['compress', 'a', '--levle', 'x'])).toThrow(/Did you mean --level\?/)
    expect(() => p(['convert', 'a.pdf', '--to', 'png', '--level', 'x'])).toThrow(
      /--level is an option of: compress, pdf compress/
    )
  })

  it('a flag without its value is a usage error', () => {
    expect(() => p(['convert', 'a', '--to'])).toThrow(/--to needs a value/)
  })

  it('help routing at every level', () => {
    expect(p([])).toMatchObject({ kind: 'help', command: null })
    expect(p(['--help'])).toMatchObject({ kind: 'help', command: null })
    expect(p(['help'])).toMatchObject({ kind: 'help', command: null })
    expect(p(['help', 'pdf', 'merge']).command?.id).toBe('pdf merge')
    expect(p(['help', 'pdf'])).toMatchObject({ kind: 'help', group: 'pdf' })
    expect(p(['pdf', 'merge', '--help']).command?.id).toBe('pdf merge')
    expect(() => p(['help', 'nope'])).toThrow(/Unknown command: nope/)
  })

  it('--version anywhere', () => {
    expect(p(['--version']).kind).toBe('version')
    expect(p(['convert', '--version']).kind).toBe('version')
  })

  it('commands without inputs refuse positionals', () => {
    expect(() => p(['doctor', 'extra'])).toThrow(/filesmith doctor takes no arguments/)
  })

  it('unknown commands', () => {
    expect(() => p(['frobnicate'])).toThrow(/Unknown command: frobnicate/)
  })

  it('json and dry-run are read from the parsed flags', () => {
    expect(p(['doctor', '--json'])).toMatchObject({ json: true, dryRun: false })
    expect(p(['resize', 'a.png', '--DRY-RUN'])).toMatchObject({ dryRun: true })
  })
})

describe('detectJson', () => {
  it('finds --json before -- only, case-insensitively', () => {
    expect(detectJson(['convert', '--JSON'])).toBe(true)
    expect(detectJson(['convert', '--', '--json'])).toBe(false)
    expect(detectJson(['convert'])).toBe(false)
  })
})
```

`test/cli-help.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { COMMANDS, findCommand } from '../src/cli/catalog'
import { renderGroupHelp, renderHelp, renderRootHelp, wrap } from '../src/cli/help'

describe('help', () => {
  it('compress help: usage, grouped options with values and defaults, examples', () => {
    const h = renderHelp(findCommand(['compress'])!)
    expect(h.startsWith('Usage: filesmith compress <files...> [options]\n')).toBe(true)
    expect(h).toContain('\nIMAGE:\n')
    expect(h).toContain('--quality <10-100>')
    expect(h).toContain('(default 80)')
    expect(h).toContain('-o, --out <folder>')
    expect(h).toContain('-h, --help')
    expect(h).toContain('\nExamples:\n  filesmith compress *.jpg --quality 70\n')
  })

  it('every help page fits 80 columns', () => {
    const pages = [
      renderRootHelp(),
      renderGroupHelp('pdf'),
      renderGroupHelp('skill'),
      ...COMMANDS.map(renderHelp)
    ]
    for (const page of pages)
      for (const line of page.split('\n')) expect(line.length, line).toBeLessThanOrEqual(80)
  })

  it('root help lists every top-level command and the pdf group', () => {
    const h = renderRootHelp()
    for (const v of ['convert', 'compress', 'resize', 'upscale', 'removebg', 'generate', 'formats', 'doctor', 'setup'])
      expect(h).toContain(`  ${v}`)
    expect(h).toContain('  pdf <tool>')
    expect(h).toContain('  skill <install|status>')
  })

  it('pdf group help lists its tools', () => {
    const h = renderGroupHelp('pdf')
    for (const t of ['merge', 'split', 'burst', 'extract-text', 'to-images', 'extract-images', 'compress'])
      expect(h).toContain(`  ${t}`)
  })

  it('wrap keeps words whole and indents continuation lines', () => {
    expect(wrap('aa bb cc', 10, 4)).toEqual(['aa', '    bb', '    cc'])
  })
})
```

`test/no-em-dash.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'

// Owner rule: no em-dashes anywhere in this work. Scans everything this change
// adds; a file that does not exist yet is simply skipped.
const ROOT = resolve(__dirname, '..')
const TARGETS = [
  'src/cli',
  'src/main/env.ts',
  'src/main/boot.ts',
  'src/main/atomicWrite.ts',
  'src/main/locks.ts',
  'src/main/recycle.ts',
  'src/main/uvInstall.ts',
  'src/main/skill.ts',
  'src/main/rembg',
  'src/main/tools/plan.ts',
  'src/main/tools/readiness.ts',
  'src/renderer/src/components/views/ClaudeSkill.tsx',
  'resources/cli',
  'resources/skill',
  'build/installer/path.nsh',
  'docs/cli.md',
  'docs/superpowers/plans/2026-10-04-cli-and-skill.md'
]

function files(p: string): string[] {
  if (!existsSync(p)) return []
  if (statSync(p).isFile()) return [p]
  return readdirSync(p).flatMap((n) => files(join(p, n)))
}

describe('no em-dashes', () => {
  it('none of the new files contain U+2014', () => {
    const offenders = TARGETS.flatMap((t) => files(join(ROOT, t))).filter((f) =>
      readFileSync(f, 'utf-8').includes('\u2014')
    )
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/cli-catalog.test.ts test/cli-parse.test.ts test/cli-help.test.ts test/no-em-dash.test.ts`
Expected: FAIL, unresolved `../src/cli/catalog` etc. (`no-em-dash` passes already; keep it).

- [ ] **Step 3: Implement the catalog**

`src/cli/catalog.ts`:

```ts
import { familyFormats } from '@shared/convert'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  IMAGE_FORMATS as COMPRESS_FORMATS,
  PDF_LEVELS,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  UPSCALE_FACTORS,
  VIDEO_CODECS
} from '@shared/compress'
import { RESIZE_FITS } from '@shared/resize'
import { BG_DEFAULTS, BG_FILLS } from '@shared/removebg'
import { GEN_DEFAULTS, GEN_MAX_COUNT, GEN_STYLES } from '@shared/generate'
import { TABS, TOOL_CARDS } from '@shared/tabs'

// The single table every part of the CLI reads: the parser (which flags exist),
// the option builder (values, ranges, defaults, app keys) and the help pages.
// Values come from the same @shared catalogs the app's option panels use, so
// the CLI cannot drift from the app (spec 2.3, 2.9).

export type FlagType = 'bool' | 'enum' | 'int' | 'number' | 'text' | 'path' | 'format' | 'enumOrInt'

export interface FlagSpec {
  name: string
  aliases?: string[]
  short?: string
  type: FlagType
  values?: readonly string[]
  /** enum values that are numbers (factor, bitrate) become numbers. */
  numeric?: boolean
  min?: number
  max?: number
  step?: number
  /** A unit the app shows that the CLI also accepts: '4x', '192k', '50%'. */
  suffix?: string
  /** The app's JobOptions key. Absent for CLI-only flags. */
  key?: string
  /** Shown word -> stored value, where the app stores a different word. */
  map?: Readonly<Record<string, string>>
  def?: string | number | boolean
  required?: boolean
  /** Help group title, the app's own (FORMAT, IMAGE, VIDEO, ...). */
  group?: string
  valueName?: string
  help: string
}

export type CommandId =
  | 'convert'
  | 'compress'
  | 'resize'
  | 'upscale'
  | 'removebg'
  | 'generate'
  | 'pdf merge'
  | 'pdf split'
  | 'pdf burst'
  | 'pdf extract-text'
  | 'pdf to-images'
  | 'pdf extract-images'
  | 'pdf compress'
  | 'formats'
  | 'doctor'
  | 'setup'
  | 'skill install'
  | 'skill status'

export interface CommandSpec {
  id: CommandId
  path: string[]
  args: string
  summary: string
  inputs: 'files' | 'prompt' | 'words' | 'none'
  flags: FlagSpec[]
  examples: string[]
}

const exts = (list: { ext: string }[]): string[] => list.map((f) => f.ext.slice(1))

/** Every --to value any source can reach. */
export const CONVERT_TARGETS: readonly string[] = [
  ...new Set([
    ...exts(familyFormats('image', '.png')),
    ...exts(familyFormats('video', '.mp4')),
    ...exts(familyFormats('audio', '.mp3')),
    ...exts(familyFormats('pdf', '.pdf')),
    ...exts(familyFormats('document', '.xlsx')),
    ...exts(familyFormats('document', '.pptx')),
    ...exts(familyFormats('archive', '.zip'))
  ])
]
export const VIDEO_CODEC_VALUES: readonly string[] = VIDEO_CODECS.map((c) => c.value)
export const AUDIO_CODEC_VALUES: readonly string[] = AUDIO_CODECS.map((c) => c.value)

const OUT: FlagSpec = {
  name: 'out',
  short: 'o',
  type: 'path',
  valueName: '<folder>',
  help: 'Output folder, created if missing (default: next to each file)'
}
const RECURSIVE: FlagSpec = {
  name: 'recursive',
  type: 'bool',
  help: 'With a folder input, also take files in its subfolders'
}
const DRY: FlagSpec = { name: 'dry-run', type: 'bool', help: 'Show what would happen, write nothing' }
const JSON_FLAG: FlagSpec = { name: 'json', type: 'bool', help: 'Machine-readable events on stdout' }
const FILE_COMMON = [OUT, RECURSIVE, DRY, JSON_FLAG]

const tabDesc = (id: string): string => TABS.find((t) => t.id === id)?.desc ?? ''
const cardDesc = (op: string): string => TOOL_CARDS.find((c) => c.opKey === op)?.desc ?? ''

const LEVEL: FlagSpec = {
  name: 'level',
  type: 'enum',
  values: PDF_LEVELS.map((l) => l.value),
  def: 'balanced',
  key: 'pdfLevel',
  group: 'PDF',
  help: 'PDF compression level'
}
const GREYSCALE: FlagSpec = {
  name: 'greyscale',
  aliases: ['grayscale'],
  type: 'bool',
  def: false,
  key: 'pdfGray',
  group: 'PDF',
  help: 'Convert to greyscale (not with --level lossless)'
}
const DPI: FlagSpec = {
  name: 'resolution',
  aliases: ['dpi'],
  type: 'int',
  min: 36,
  max: 600,
  def: 150,
  key: 'dpi',
  group: 'PAGES',
  valueName: '<dpi>',
  help: 'Page render resolution, 36-600'
}

export const COMMANDS: CommandSpec[] = [
  {
    id: 'convert',
    path: ['convert'],
    args: '<files...> --to <format> [options]',
    summary: `${tabDesc('convert')}. Images, video, audio, documents, PDF and archives.`,
    inputs: 'files',
    flags: [
      {
        name: 'to',
        type: 'format',
        values: CONVERT_TARGETS,
        required: true,
        key: 'format',
        group: 'FORMAT',
        valueName: '<format>',
        help: 'Target format, e.g. webp, jpg, mp4, pdf, cbz (jpeg, tif and a leading dot are fine)'
      },
      {
        name: 'quality',
        type: 'enumOrInt',
        values: ['smaller', 'balanced', 'best'],
        min: 1,
        max: 100,
        def: 'balanced',
        key: 'quality',
        group: 'FORMAT',
        valueName: '<preset|1-100>',
        help: 'Image quality for jpg, webp, avif and jxl targets: smaller, balanced, best or 1-100'
      },
      {
        name: 'compression',
        type: 'enum',
        values: ['store', 'normal'],
        def: 'store',
        key: 'store',
        group: 'FORMAT',
        help: 'Archive to archive: store (fast, no recompression) or normal'
      },
      DPI,
      {
        name: 'page-format',
        type: 'enum',
        values: ['jpg', 'png'],
        def: 'jpg',
        key: 'pageFormat',
        group: 'PAGES',
        help: 'PDF to comic: page image format'
      },
      {
        name: 'page-quality',
        type: 'int',
        min: 1,
        max: 100,
        def: 100,
        key: 'pageQuality',
        group: 'PAGES',
        help: 'PDF to comic: jpg page quality'
      },
      ...FILE_COMMON
    ],
    examples: [
      'filesmith convert *.heic --to jpg',
      'filesmith convert book.pdf --to cbz --resolution 200 --page-format png',
      'filesmith convert comics\\ --to cbz --compression normal --out D:\\Out'
    ]
  },
  {
    id: 'compress',
    path: ['compress'],
    args: '<files...> [options]',
    summary: `${tabDesc('compress')}. Images, video, audio and PDF.`,
    inputs: 'files',
    flags: [
      {
        name: 'format',
        type: 'enum',
        values: COMPRESS_FORMATS.map((f) => f.value),
        def: 'keep',
        key: 'imageFormat',
        group: 'IMAGE',
        help: 'Image format: keep, webp or avif'
      },
      {
        name: 'quality',
        type: 'int',
        min: 10,
        max: 100,
        def: 80,
        key: 'quality',
        group: 'IMAGE',
        help: 'Image and video quality, higher keeps more detail'
      },
      {
        name: 'codec',
        type: 'enum',
        values: [...VIDEO_CODEC_VALUES, ...AUDIO_CODEC_VALUES],
        group: 'VIDEO',
        valueName: '<codec>',
        help: 'Video codec (h264, h265, av1) or audio codec (keep, mp3, aac, opus), checked per file (default h264 / keep)'
      },
      {
        name: 'video-codec',
        type: 'enum',
        values: VIDEO_CODEC_VALUES,
        def: 'h264',
        key: 'videoCodec',
        group: 'VIDEO',
        help: 'Video codec, unambiguous form of --codec'
      },
      {
        name: 'scale',
        type: 'int',
        min: SCALE_MIN,
        max: SCALE_MAX,
        step: SCALE_STEP,
        suffix: '%',
        def: 100,
        key: 'scale',
        group: 'VIDEO',
        valueName: '<percent>',
        help: `Video size in percent of the source, ${SCALE_MIN}-${SCALE_MAX} in steps of ${SCALE_STEP}`
      },
      {
        name: 'audio-codec',
        type: 'enum',
        values: AUDIO_CODEC_VALUES,
        def: 'keep',
        key: 'audioCodec',
        group: 'AUDIO',
        help: 'Audio codec, unambiguous form of --codec'
      },
      {
        name: 'bitrate',
        type: 'enum',
        values: AUDIO_BITRATES.map(String),
        numeric: true,
        suffix: 'k',
        def: 192,
        key: 'audioBitrate',
        group: 'AUDIO',
        valueName: '<kbps>',
        help: `Audio bitrate in kbps: ${AUDIO_BITRATES.join(', ')} (192k is fine)`
      },
      LEVEL,
      GREYSCALE,
      ...FILE_COMMON
    ],
    examples: [
      'filesmith compress *.jpg --quality 70',
      'filesmith compress lecture.mov --codec h265 --scale 50',
      'filesmith compress report.pdf --level smallest --greyscale'
    ]
  },
  {
    id: 'resize',
    path: ['resize'],
    args: '<images...> [options]',
    summary: `${tabDesc('resize')}. Images only.`,
    inputs: 'files',
    flags: [
      {
        name: 'percent',
        type: 'number',
        min: 0.01,
        max: 10000,
        suffix: '%',
        def: 50,
        key: 'percent',
        group: 'SIZE',
        valueName: '<n>',
        help: 'Scale by percent (50 or 50%)'
      },
      { name: 'width', type: 'int', min: 1, max: 100000, key: 'width', group: 'SIZE', valueName: '<px>', help: 'Width in pixels; leave out to scale by the height' },
      { name: 'height', type: 'int', min: 1, max: 100000, key: 'height', group: 'SIZE', valueName: '<px>', help: 'Height in pixels; leave out to scale by the width' },
      {
        name: 'fit',
        type: 'enum',
        values: RESIZE_FITS.map((f) => f.value),
        def: 'contain',
        key: 'fit',
        group: 'SIZE',
        help: 'contain keeps the aspect (the app\'s "Keep aspect"); stretch uses both sizes'
      },
      {
        name: 'mode',
        type: 'enum',
        values: ['percent', 'dimensions'],
        key: 'mode',
        group: 'SIZE',
        help: 'Inferred from --percent or --width/--height; rarely needed'
      },
      ...FILE_COMMON
    ],
    examples: ['filesmith resize *.png --percent 25', 'filesmith resize hero.jpg --width 1920']
  },
  {
    id: 'upscale',
    path: ['upscale'],
    args: '<images...> [options]',
    summary: `${tabDesc('upscale')}. Output is always PNG; one image at a time.`,
    inputs: 'files',
    flags: [
      {
        name: 'factor',
        type: 'enum',
        values: UPSCALE_FACTORS.map(String),
        numeric: true,
        suffix: 'x',
        def: 4,
        key: 'upscaleFactor',
        group: 'MODEL',
        valueName: '<2|3|4>',
        help: 'Scale factor (4x is fine)'
      },
      {
        name: 'model',
        type: 'text',
        def: 'photo',
        key: 'upscaleModel',
        group: 'MODEL',
        valueName: '<model>',
        help: 'photo, anime, a Real-ESRGAN model name, pid, or comfy:<model file>; list them with: filesmith formats upscale'
      },
      {
        name: 'gpu',
        type: 'enum',
        values: ['full', 'balanced'],
        map: { full: 'full', balanced: 'background' },
        def: 'full',
        key: 'gpuMode',
        group: 'PERFORMANCE',
        help: 'GPU mode: full, or balanced to leave room for other apps'
      },
      ...FILE_COMMON
    ],
    examples: ['filesmith upscale old.jpg --factor 2', 'filesmith upscale frame.png --model pid --dry-run']
  },
  {
    id: 'removebg',
    path: ['removebg'],
    args: '<images...> [options]',
    summary: `${tabDesc('removebg')}. Output is always PNG. Needs: filesmith setup removebg.`,
    inputs: 'files',
    flags: [
      {
        name: 'fill',
        type: 'enum',
        values: BG_FILLS.map((f) => f.value),
        def: BG_DEFAULTS.bgFill,
        key: 'bgFill',
        group: 'BACKGROUND',
        valueName: '<fill>',
        help: 'Background: transparent, white, black, green, custom or image'
      },
      {
        name: 'color',
        type: 'text',
        def: BG_DEFAULTS.bgCustomColor,
        key: 'bgCustomColor',
        group: 'BACKGROUND',
        valueName: '<#hex>',
        help: 'Custom colour as #rrggbb; implies --fill custom'
      },
      {
        name: 'image',
        type: 'path',
        key: 'bgImagePath',
        group: 'BACKGROUND',
        valueName: '<image>',
        help: 'Background image, cover fit; implies --fill image'
      },
      ...FILE_COMMON
    ],
    examples: ['filesmith removebg product.jpg --fill white', 'filesmith removebg portrait.png --image beach.jpg']
  },
  {
    id: 'generate',
    path: ['generate'],
    args: '"<prompt>" [options]',
    summary: `${tabDesc('generate')} with your ComfyUI models. Writes to the current folder unless --out is given.`,
    inputs: 'prompt',
    flags: [
      { name: 'model', type: 'text', key: 'model', group: 'MODEL', valueName: '<name>', help: 'A model from: filesmith formats generate (default: the first runnable one)' },
      { name: 'negative', type: 'text', def: GEN_DEFAULTS.negative, key: 'negative', group: 'PROMPT', valueName: '<text>', help: 'Negative prompt' },
      {
        name: 'style',
        type: 'enum',
        values: GEN_STYLES.map((s) => s.id),
        def: GEN_DEFAULTS.style,
        key: 'style',
        group: 'PROMPT',
        valueName: '<style>',
        help: `Style: ${GEN_STYLES.map((s) => s.id).join(', ')}`
      },
      { name: 'count', type: 'int', min: 1, max: GEN_MAX_COUNT, def: GEN_DEFAULTS.count, key: 'count', group: 'OUTPUT', help: 'How many images' },
      { name: 'size', type: 'text', def: '1024x1024', group: 'OUTPUT', valueName: '<WxH>', help: 'Image size, e.g. 1216x832 (clamped to what the model supports)' },
      { name: 'width', type: 'int', min: 64, max: 8192, key: 'width', group: 'OUTPUT', valueName: '<px>', help: 'Custom width, overrides --size' },
      { name: 'height', type: 'int', min: 64, max: 8192, key: 'height', group: 'OUTPUT', valueName: '<px>', help: 'Custom height, overrides --size' },
      { name: 'steps', type: 'int', min: 1, max: 50, key: 'steps', group: 'ADVANCED', def: 'model default', help: 'Sampling steps' },
      { name: 'cfg', type: 'number', min: 1, max: 15, step: 0.5, key: 'cfg', group: 'ADVANCED', def: 'model default', help: 'Guidance (CFG), SDXL models' },
      { name: 'guidance', type: 'number', min: 1, max: 10, step: 0.5, key: 'guidance', group: 'ADVANCED', def: 'model default', help: 'Guidance, Flux models' },
      { name: 'seed', type: 'int', min: 0, max: 2 ** 53 - 1, key: 'seed', group: 'ADVANCED', def: 'random', help: 'Seed; a fixed seed gives repeatable images' },
      { name: 'try-anyway', type: 'bool', key: 'tryAnyway', group: 'ADVANCED', help: 'Run a model Filesmith does not recognise, where allowed' },
      OUT,
      DRY,
      JSON_FLAG
    ],
    examples: [
      'filesmith generate "a lighthouse at dusk" --count 4 --size 1216x832',
      'filesmith generate "a red kettle" --model flux1-dev --seed 42 --json'
    ]
  },
  {
    id: 'pdf merge',
    path: ['pdf', 'merge'],
    args: '<a.pdf> <b.pdf>... [options]',
    summary: `${cardDesc('merge')}, in argument order. Writes "<first> (merged).pdf".`,
    inputs: 'files',
    flags: [...FILE_COMMON],
    examples: ['filesmith pdf merge cover.pdf body.pdf appendix.pdf']
  },
  {
    id: 'pdf split',
    path: ['pdf', 'split'],
    args: '<files.pdf...> --pages <range> [options]',
    summary: `${cardDesc('split-range')}. Writes "<name> (pages).pdf".`,
    inputs: 'files',
    flags: [
      { name: 'pages', type: 'text', required: true, key: 'range', group: 'PAGES', valueName: '<range>', help: 'Pages to keep, e.g. 1-3,5,8-10' },
      ...FILE_COMMON
    ],
    examples: ['filesmith pdf split thesis.pdf --pages 1-3,10']
  },
  {
    id: 'pdf burst',
    path: ['pdf', 'burst'],
    args: '<files.pdf...> [options]',
    summary: `${cardDesc('split-pages')}, into a "<name> (split)" folder.`,
    inputs: 'files',
    flags: [...FILE_COMMON],
    examples: ['filesmith pdf burst scan.pdf']
  },
  {
    id: 'pdf extract-text',
    path: ['pdf', 'extract-text'],
    args: '<files.pdf...> [options]',
    summary: `${cardDesc('extract-text')}.`,
    inputs: 'files',
    flags: [...FILE_COMMON],
    examples: ['filesmith pdf extract-text *.pdf --json']
  },
  {
    id: 'pdf to-images',
    path: ['pdf', 'to-images'],
    args: '<files.pdf...> [options]',
    summary: `${cardDesc('pages-to-images')} (PNG), into a "<name> (pages)" folder.`,
    inputs: 'files',
    flags: [DPI, ...FILE_COMMON],
    examples: ['filesmith pdf to-images slides.pdf --resolution 200 --out D:\\Frames']
  },
  {
    id: 'pdf extract-images',
    path: ['pdf', 'extract-images'],
    args: '<files.pdf...> [options]',
    summary: `${cardDesc('extract-images')}, into a "<name> (images)" folder.`,
    inputs: 'files',
    flags: [...FILE_COMMON],
    examples: ['filesmith pdf extract-images brochure.pdf']
  },
  {
    id: 'pdf compress',
    path: ['pdf', 'compress'],
    args: '<files.pdf...> [options]',
    summary: 'Shrink PDFs. The same as filesmith compress for PDF files.',
    inputs: 'files',
    flags: [LEVEL, GREYSCALE, ...FILE_COMMON],
    examples: ['filesmith pdf compress report.pdf --level smallest']
  },
  {
    id: 'formats',
    path: ['formats'],
    args: '[verb]',
    summary: 'List every target format, option value and model, with what is ready. Read-only.',
    inputs: 'words',
    flags: [JSON_FLAG],
    examples: ['filesmith formats', 'filesmith formats upscale --json']
  },
  {
    id: 'doctor',
    path: ['doctor'],
    args: '[options]',
    summary: 'Check the bundled tools, GPU, AI tools and setup. Read-only.',
    inputs: 'none',
    flags: [
      { name: 'deep', type: 'bool', help: 'Also run a tiny Real-ESRGAN upscale to prove the GPU path' },
      { name: 'verify', type: 'bool', help: 'Also hash downloaded model files against integrity.json' },
      JSON_FLAG
    ],
    examples: ['filesmith doctor', 'filesmith doctor --json']
  },
  {
    id: 'setup',
    path: ['setup'],
    args: '<tool> [options]',
    summary: 'Download and set up an AI tool: removebg, pid, spandrel, comfy, generate, realesrgan, or remove <tool>. The only command that downloads.',
    inputs: 'words',
    flags: [
      { name: 'model', type: 'text', valueName: '<name>', help: 'setup generate: the model whose missing files to fetch' },
      { name: 'folder', type: 'path', valueName: '<path>', help: 'setup comfy: your ComfyUI folder' },
      { name: 'url', type: 'text', valueName: '<url>', help: 'setup comfy: a running ComfyUI, e.g. http://127.0.0.1:8188' },
      { name: 'comfy', type: 'path', valueName: '<folder>', help: 'setup spandrel: record and scan this ComfyUI folder' },
      { name: 'permanent', type: 'bool', help: 'setup remove: delete folders too large for the Recycle Bin' },
      DRY,
      JSON_FLAG
    ],
    examples: ['filesmith setup removebg', 'filesmith setup pid --dry-run', 'filesmith setup comfy --folder "D:\\ComfyUI"']
  },
  {
    id: 'skill install',
    path: ['skill', 'install'],
    args: '[options]',
    summary: 'Install the Filesmith skill for Claude Code into your .claude\\skills folder.',
    inputs: 'none',
    flags: [DRY, JSON_FLAG],
    examples: ['filesmith skill install']
  },
  {
    id: 'skill status',
    path: ['skill', 'status'],
    args: '[options]',
    summary: 'Show whether the Claude Code skill is installed and its version.',
    inputs: 'none',
    flags: [JSON_FLAG],
    examples: ['filesmith skill status --json']
  }
]

export const SUBCOMMANDS: Record<'pdf' | 'skill', string[]> = {
  pdf: COMMANDS.filter((c) => c.path[0] === 'pdf').map((c) => c.path[1]),
  skill: COMMANDS.filter((c) => c.path[0] === 'skill').map((c) => c.path[1])
}

export function findCommand(path: string[]): CommandSpec | undefined {
  const key = path.join(' ')
  return COMMANDS.find((c) => c.path.join(' ') === key)
}

export function flagOf(cmd: CommandSpec, name: string): FlagSpec {
  const f = cmd.flags.find((x) => x.name === name)
  if (!f) throw new Error(`${cmd.id} has no flag --${name}`)
  return f
}
```

- [ ] **Step 4: Implement the parser**

`src/cli/parse.ts`:

```ts
import { parseArgs } from 'node:util'
import { COMMANDS, SUBCOMMANDS, findCommand, type CommandSpec } from './catalog'
import { UsageError } from './exit'

export interface ParsedArgs {
  kind: 'run' | 'help' | 'version'
  command: CommandSpec | null
  group?: 'pdf' | 'skill'
  positionals: string[]
  values: Record<string, string | boolean>
  json: boolean
  dryRun: boolean
}

const GROUPS = new Set(['pdf', 'skill'])
const VERB_ALIASES: Record<string, string> = {
  'remove-bg': 'removebg',
  'remove-background': 'removebg'
}
const GLOBAL_BOOLS = new Set(['--json', '--dry-run', '--version', '--help', '-h'])

/** --json before `--`, case-insensitively: needed before parsing, so a usage
 * error can still be reported as a JSON event. */
export function detectJson(argv: string[]): boolean {
  for (const a of argv) {
    if (a === '--') return false
    if (a.toLowerCase() === '--json') return true
  }
  return false
}

function normalizeFlag(t: string): string {
  if (t.startsWith('--')) {
    const eq = t.indexOf('=')
    return eq === -1 ? t.toLowerCase() : t.slice(0, eq).toLowerCase() + t.slice(eq)
  }
  if (/^-[A-Za-z]$/.test(t)) return t.toLowerCase()
  return t
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
  return d[a.length][b.length]
}

function unknownFlag(flag: string, cmd: CommandSpec): UsageError {
  const name = flag.replace(/^-+/, '')
  const where = `filesmith ${cmd.path.join(' ')}`
  const owners = COMMANDS.filter((c) =>
    c.flags.some((f) => f.name === name || f.aliases?.includes(name))
  ).map((c) => c.path.join(' '))
  if (owners.length)
    return new UsageError(
      `Unknown option --${name} for ${where}. --${name} is an option of: ${owners.join(', ')}.`,
      cmd.path
    )
  const near = cmd.flags
    .map((f) => f.name)
    .filter((n) => distance(n, name) <= 2)
    .sort((a, b) => distance(a, name) - distance(b, name))[0]
  return new UsageError(
    `Unknown option --${name} for ${where}.${near ? ` Did you mean --${near}?` : ''}`,
    cmd.path
  )
}

function translate(e: unknown, cmd: CommandSpec): UsageError {
  const err = e as { code?: string; message?: string }
  const flag = /'(-{1,2}[^' ]+)/.exec(err.message ?? '')?.[1] ?? ''
  if (err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return unknownFlag(flag, cmd)
  if (err.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    if (/argument missing/.test(err.message ?? '')) return new UsageError(`${flag} needs a value.`, cmd.path)
    return new UsageError(`${flag} does not take a value.`, cmd.path)
  }
  return new UsageError(err.message ?? String(e), cmd.path)
}

/** Spec 2.1, 2.8, 2.9: verb (or `pdf <tool>` / `skill <sub>`), then inputs and
 * flags in any order, `--` ends flags. Throws UsageError. */
export function parseArgv(argv: string[]): ParsedArgs {
  const dd = argv.indexOf('--')
  const head = (dd === -1 ? argv : argv.slice(0, dd)).map(normalizeFlag)
  const tail = dd === -1 ? [] : argv.slice(dd + 1)
  const base = { positionals: [] as string[], values: {}, json: false, dryRun: false }

  let i = 0
  while (i < head.length && GLOBAL_BOOLS.has(head[i])) i++
  const leading = head.slice(0, i)
  const word = head[i] && !head[i].startsWith('-') ? head[i].toLowerCase() : undefined
  const verb = word ? (VERB_ALIASES[word] ?? word) : undefined

  if (!verb) {
    if (leading.includes('--version')) return { ...base, kind: 'version', command: null }
    const stray = head.slice(i).find((t) => !GLOBAL_BOOLS.has(t))
    if (stray) throw new UsageError(`Missing command before ${stray}.`)
    return { ...base, kind: 'help', command: null }
  }

  if (verb === 'help') {
    const target = head.slice(i + 1).filter((t) => !t.startsWith('-')).map((t) => t.toLowerCase())
    if (!target.length) return { ...base, kind: 'help', command: null }
    if (target.length === 1 && GROUPS.has(target[0]))
      return { ...base, kind: 'help', command: null, group: target[0] as 'pdf' | 'skill' }
    const cmd = findCommand([VERB_ALIASES[target[0]] ?? target[0], ...target.slice(1)])
    if (!cmd) throw new UsageError(`Unknown command: ${target.join(' ')}. Run: filesmith --help`)
    return { ...base, kind: 'help', command: cmd }
  }

  let path = [verb]
  let rest = [...leading, ...head.slice(i + 1)]
  if (GROUPS.has(verb)) {
    const group = verb as 'pdf' | 'skill'
    const sub = rest.find((t) => !t.startsWith('-'))
    const firstSubIdx = sub ? rest.indexOf(sub) : -1
    const flagsBefore = firstSubIdx === -1 ? rest : rest.slice(0, firstSubIdx)
    if (!sub || flagsBefore.some((t) => !GLOBAL_BOOLS.has(t))) {
      if (rest.includes('--help') || rest.includes('-h'))
        return { ...base, kind: 'help', command: null, group }
      throw new UsageError(
        `filesmith ${group} needs a tool: ${SUBCOMMANDS[group].join(', ')}.`,
        [group]
      )
    }
    path = [group, sub.toLowerCase()]
    rest = [...flagsBefore, ...rest.slice(firstSubIdx + 1)]
  }

  const cmd = findCommand(path)
  if (!cmd) throw new UsageError(`Unknown command: ${path.join(' ')}. Run: filesmith --help`)

  type Opt = { type: 'boolean' | 'string'; short?: string }
  const options: Record<string, Opt> = {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean' },
    json: { type: 'boolean' },
    'dry-run': { type: 'boolean' }
  }
  for (const f of cmd.flags)
    for (const n of [f.name, ...(f.aliases ?? [])])
      options[n] = {
        type: f.type === 'bool' ? 'boolean' : 'string',
        ...(f.short && n === f.name ? { short: f.short } : {})
      }

  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: rest,
      options,
      allowPositionals: true,
      strict: true,
      allowNegative: true
    })
  } catch (e) {
    throw translate(e, cmd)
  }

  const values: Record<string, string | boolean> = {}
  for (const f of cmd.flags)
    for (const n of [f.name, ...(f.aliases ?? [])]) {
      const v = parsed.values[n]
      if (typeof v === 'string' || typeof v === 'boolean') values[f.name] = v
    }
  const json = parsed.values.json === true
  const dryRun = parsed.values['dry-run'] === true
  if (parsed.values.version === true) return { ...base, kind: 'version', command: null, json }
  if (parsed.values.help === true) return { ...base, kind: 'help', command: cmd }

  const positionals = [...parsed.positionals, ...tail]
  if (cmd.inputs === 'none' && positionals.length)
    throw new UsageError(`filesmith ${cmd.path.join(' ')} takes no arguments.`, cmd.path)
  return { kind: 'run', command: cmd, positionals, values, json, dryRun }
}
```

- [ ] **Step 5: Implement the help renderer**

`src/cli/help.ts`:

```ts
import { COMMANDS, SUBCOMMANDS, findCommand, type CommandSpec, type FlagSpec } from './catalog'

const WIDTH = 80
const COL = 28

/** Word-wrap to `width`, continuation lines indented by `indent`. */
export function wrap(text: string, width: number, indent: number): string[] {
  const max = width - indent
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > max) {
      lines.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  return lines.map((l, i) => (i === 0 ? l : ' '.repeat(indent) + l))
}

function valueName(f: FlagSpec): string {
  if (f.valueName) return f.valueName
  if (f.type === 'enum' && f.values) {
    const v = `<${f.values.join('|')}>`
    return v.length <= 22 ? v : '<value>'
  }
  if ((f.type === 'int' || f.type === 'number') && f.min !== undefined && f.max !== undefined)
    return `<${f.min}-${f.max}>`
  if (f.type === 'path') return '<path>'
  return '<value>'
}

function label(f: FlagSpec): string {
  const short = f.short ? `-${f.short}, ` : '    '
  return `${short}--${f.name}${f.type === 'bool' ? '' : ` ${valueName(f)}`}`
}

function description(f: FlagSpec): string {
  let s = f.help
  if (f.type === 'enum' && f.values && valueName(f) === '<value>') s += `: ${f.values.join(', ')}`
  if (f.aliases?.length) s += ` (also --${f.aliases.join(', --')})`
  if (f.required) s += ' (required)'
  else if (f.def !== undefined && f.def !== false && f.def !== '') s += ` (default ${f.def})`
  return s
}

function flagLines(f: FlagSpec): string[] {
  const left = `  ${label(f)}`
  const desc = wrap(description(f), WIDTH, COL)
  if (left.length < COL - 1) return [left.padEnd(COL) + desc[0], ...desc.slice(1)]
  return [left, ' '.repeat(COL) + desc[0], ...desc.slice(1)]
}

export function usageLine(cmd: CommandSpec): string {
  return `Usage: filesmith ${cmd.path.join(' ')} ${cmd.args}`.trimEnd()
}

const HELP_FLAG: FlagSpec = { name: 'help', short: 'h', type: 'bool', help: 'Show this help' }

export function renderHelp(cmd: CommandSpec): string {
  const out = [usageLine(cmd), '', ...wrap(cmd.summary, WIDTH, 0), '']
  const groups = new Map<string, FlagSpec[]>()
  for (const f of cmd.flags) {
    const g = f.group ?? 'Options'
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  for (const [g, flags] of groups) {
    if (g === 'Options') continue
    out.push(`${g}:`, ...flags.flatMap(flagLines), '')
  }
  out.push('Options:', ...(groups.get('Options') ?? []).flatMap(flagLines), ...flagLines(HELP_FLAG), '')
  if (cmd.examples.length) out.push('Examples:', ...cmd.examples.map((e) => `  ${e}`), '')
  return out.join('\n')
}

const firstSentence = (s: string): string => s.split('. ')[0].replace(/\.$/, '')

function row(name: string, text: string): string[] {
  const lines = wrap(text, WIDTH, 26)
  return [`  ${name.padEnd(23)} ${lines[0] ?? ''}`, ...lines.slice(1)]
}

export function renderGroupHelp(group: 'pdf' | 'skill'): string {
  const out = [`Usage: filesmith ${group} <tool> [options]`, '', 'Tools:']
  for (const sub of SUBCOMMANDS[group]) {
    const cmd = findCommand([group, sub])
    if (cmd) out.push(...row(sub, firstSentence(cmd.summary)))
  }
  out.push('', `Run 'filesmith ${group} <tool> --help' for a tool's options.`, '')
  return out.join('\n')
}

export function renderRootHelp(): string {
  const out = [
    'Usage: filesmith <command> [options]',
    '',
    ...wrap(
      'Convert, compress, resize, upscale, remove backgrounds, generate images and run PDF tools from the command line. Never overwrites a file.',
      WIDTH,
      0
    ),
    '',
    'Commands:'
  ]
  for (const c of COMMANDS.filter((x) => x.path.length === 1))
    out.push(...row(c.path[0], firstSentence(c.summary)))
  out.push(...row('pdf <tool>', `PDF tools: ${SUBCOMMANDS.pdf.join(', ')}`))
  out.push(...row('skill <install|status>', 'The Claude Code skill'))
  out.push(...row('help [command]', 'Help for a command'))
  out.push(
    '',
    'Global options:',
    ...flagLines({ name: 'json', type: 'bool', help: 'Machine-readable events on stdout' }),
    ...flagLines({ name: 'dry-run', type: 'bool', help: 'Show what would happen, write nothing' }),
    ...flagLines(HELP_FLAG),
    ...flagLines({ name: 'version', type: 'bool', help: 'Print the version' }),
    '',
    "Run 'filesmith <command> --help' for a command's options.",
    ''
  )
  return out.join('\n')
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/cli-catalog.test.ts test/cli-parse.test.ts test/cli-help.test.ts test/no-em-dash.test.ts`
Expected: PASS. If a help line exceeds 80 columns, shorten that flag's `help` or `valueName` in the catalog; do not widen `WIDTH`.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npx prettier --write src/cli test && npm test
git add src/cli test/cli-catalog.test.ts test/cli-parse.test.ts test/cli-help.test.ts test/no-em-dash.test.ts
git commit -m "feat(cli): command catalog from the app's option catalogs, parser and help" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Flag values to app options

**Files:**
- Create: `src/cli/options.ts`, `test/cli-options.test.ts`

**Interfaces:**
- Consumes: `CommandSpec`, `FlagSpec`, `flagOf`, `findCommand`, `VIDEO_CODEC_VALUES` (Task 7); `UsageError` (Task 6); `normalizePageRange` (`src/main/tools/pdf.ts`); `BG_DEFAULTS`, `hexToRgb` (`@shared/removebg`).
- Produces:
  - `type RawFlags = Record<string, string | boolean>`; `interface Warning { code: string; message: string }`; `type PathState = 'file' | 'dir' | 'missing'`; `interface BuildContext { cwd: string; pathState(p: string): PathState }`.
  - `interface BuiltOptions { options: JobOptions; warnings: Warning[]; outDir?: string; explicit: Set<string>; codecFor?: 'video' | 'audio' }`.
  - `coerce(f: FlagSpec, raw: string | boolean, cmdPath?: string[]): string | number | boolean` (throws `UsageError`).
  - `buildOptions(cmd: CommandSpec, raw: RawFlags, ctx: BuildContext): BuiltOptions` for every file command (`convert` through `pdf compress`).
  - `interface GenerateFlags { prompt: string; model?: string; negative: string; style: string; count: number; width: number; height: number; sizeExplicit: boolean; steps?: number; cfg?: number; guidance?: number; seed: number; tryAnyway: boolean; outDir?: string }`; `buildGenerateFlags(cmd: CommandSpec, raw: RawFlags, positionals: string[], ctx: BuildContext): GenerateFlags`.

- [ ] **Step 1: Write the failing test**

`test/cli-options.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { findCommand } from '../src/cli/catalog'
import { buildGenerateFlags, buildOptions, type BuildContext, type RawFlags } from '../src/cli/options'
import { DEFAULT_OPTIONS } from '../src/renderer/src/state'

const ctx: BuildContext = {
  cwd: 'C:\\work',
  pathState: (p) => (p.toLowerCase().endsWith('beach.jpg') ? 'file' : 'missing')
}
const build = (path: string, raw: RawFlags) => buildOptions(findCommand(path.split(' '))!, raw, ctx)
const fails = (path: string, raw: RawFlags, re: RegExp) => expect(() => build(path, raw)).toThrow(re)

describe('defaults are the app defaults', () => {
  it('compress', () => expect(build('compress', {}).options).toEqual(DEFAULT_OPTIONS.compress))
  it('removebg', () => expect(build('removebg', {}).options).toEqual(DEFAULT_OPTIONS.removebg))
  it('resize', () => expect(build('resize', {}).options).toMatchObject(DEFAULT_OPTIONS.resize))
  it('upscale', () => expect(build('upscale', {}).options).toMatchObject(DEFAULT_OPTIONS.upscale))
})

describe('convert', () => {
  it('requires --to and normalises aliases', () => {
    fails('convert', {}, /needs --to <format>/)
    expect(build('convert', { to: 'JPEG' }).options.format).toBe('.jpg')
    expect(build('convert', { to: '.TIF' }).options.format).toBe('.tiff')
    fails('convert', { to: 'xyz' }, /Invalid value 'xyz' for --to/)
  })
  it('quality is a preset or 1-100', () => {
    expect(build('convert', { to: 'webp', quality: 'Best' }).options.quality).toBe('best')
    expect(build('convert', { to: 'webp', quality: '70' }).options.quality).toBe(70)
    fails('convert', { to: 'webp', quality: '0' }, /Valid: smaller, balanced, best, or 1-100/)
  })
  it('compression maps to store', () => {
    expect(build('convert', { to: 'cbz' }).options.store).toBe(true)
    expect(build('convert', { to: 'cbz', compression: 'normal' }).options.store).toBe(false)
  })
  it('--out resolves against the working folder', () => {
    expect(build('convert', { to: 'png', out: 'out' }).outDir).toBe(join('C:\\work', 'out'))
  })
})

describe('compress', () => {
  it('--codec goes to the video or audio key by value', () => {
    const v = build('compress', { codec: 'H265' })
    expect(v.options.videoCodec).toBe('h265')
    expect(v.codecFor).toBe('video')
    const a = build('compress', { codec: 'opus' })
    expect(a.options.audioCodec).toBe('opus')
    expect(a.codecFor).toBe('audio')
    fails('compress', { codec: 'h265', 'video-codec': 'av1' }, /--codec or --video-codec, not both/)
  })
  it('accepts the unit the app shows', () => {
    expect(build('compress', { bitrate: '128k' }).options.audioBitrate).toBe(128)
    expect(build('compress', { scale: '50%' }).options.scale).toBe(50)
    fails('compress', { bitrate: '100' }, /Valid: 320, 256, 192, 128, 96, 64/)
    fails('compress', { scale: '52' }, /in steps of 5/)
    fails('compress', { quality: '5' }, /Valid: 10-100/)
  })
  it('greyscale with lossless is a warning, not an error', () => {
    const b = build('compress', { level: 'lossless', greyscale: true })
    expect(b.warnings.map((w) => w.code)).toEqual(['GREYSCALE_IGNORED'])
  })
  it('pdf compress takes only the PDF options', () => {
    expect(build('pdf compress', { level: 'smallest' }).options).toEqual({
      pdfLevel: 'smallest',
      pdfGray: false
    })
  })
})

describe('resize', () => {
  it('infers the mode', () => {
    expect(build('resize', { percent: '25%' }).options).toMatchObject({ mode: 'percent', percent: 25 })
    expect(build('resize', { width: '1920' }).options).toMatchObject({
      mode: 'dimensions',
      width: 1920,
      height: ''
    })
  })
  it('rejects percent with a dimension and warns on contain with both', () => {
    fails('resize', { percent: '50', width: '10' }, /--percent or --width\/--height, not both/)
    fails('resize', { mode: 'dimensions' }, /needs --width or --height/)
    const b = build('resize', { width: '100', height: '100' })
    expect(b.warnings.map((w) => w.code)).toEqual(['DIMENSION_MAY_BE_IGNORED'])
    expect(build('resize', { width: '100', height: '100', fit: 'stretch' }).warnings).toEqual([])
  })
})

describe('upscale', () => {
  it('maps models, factors and the shown gpu word', () => {
    expect(build('upscale', { factor: '2x' }).options.upscaleFactor).toBe(2)
    expect(build('upscale', { model: 'realesrgan-x4plus-anime_6B' }).options.upscaleModel).toBe(
      'esrgan:realesrgan-x4plus-anime_6B'
    )
    expect(build('upscale', { model: 'Anime' }).options.upscaleModel).toBe('anime')
    expect(build('upscale', { model: 'comfy:4x-Ultra.pth' }).options.upscaleModel).toBe(
      'comfy:4x-Ultra.pth'
    )
    expect(build('upscale', { gpu: 'balanced' }).options.gpuMode).toBe('background')
  })
  it('pid is 4x only', () => {
    expect(build('upscale', { model: 'pid' }).options.upscaleFactor).toBe(4)
    fails('upscale', { model: 'pid', factor: '2' }, /pid upscales 4x only/)
    fails('upscale', { model: 'comfy' }, /Name a ComfyUI model/)
  })
})

describe('removebg', () => {
  it('a colour implies custom and is normalised', () => {
    expect(build('removebg', { color: '00B140' }).options).toMatchObject({
      bgFill: 'custom',
      bgCustomColor: '#00b140'
    })
    fails('removebg', { color: 'red' }, /Use #rrggbb/)
    fails('removebg', { color: '#000000', fill: 'white' }, /--color needs --fill custom/)
  })
  it('an image implies image fill and must exist', () => {
    expect(build('removebg', { image: 'beach.jpg' }).options).toMatchObject({
      bgFill: 'image',
      bgImagePath: join('C:\\work', 'beach.jpg')
    })
    fails('removebg', { image: 'gone.jpg' }, /--image must be an existing image file/)
    fails('removebg', { fill: 'image' }, /--fill image needs --image/)
  })
})

describe('pdf tools', () => {
  it('split needs a valid page range', () => {
    fails('pdf split', {}, /needs --pages/)
    expect(build('pdf split', { pages: ' 1 - 3 , 5' }).options).toEqual({ op: 'split-range', range: '1-3,5' })
    fails('pdf split', { pages: 'abc' }, /Invalid value 'abc' for --pages/)
  })
  it('ops', () => {
    expect(build('pdf merge', {}).options).toEqual({ op: 'merge' })
    expect(build('pdf burst', {}).options).toEqual({ op: 'split-pages' })
    expect(build('pdf extract-text', {}).options).toEqual({ op: 'extract-text' })
    expect(build('pdf extract-images', {}).options).toEqual({ op: 'extract-images' })
    expect(build('pdf to-images', { dpi: '200' }).options).toEqual({ op: 'pages-to-images', dpi: 200 })
  })
})

describe('generate', () => {
  const gen = findCommand(['generate'])!
  it('prompt, size, overrides and defaults', () => {
    const g = buildGenerateFlags(gen, { size: '1216x832', height: '640' }, ['a', 'red kettle'], ctx)
    expect(g).toMatchObject({
      prompt: 'a red kettle',
      width: 1216,
      height: 640,
      sizeExplicit: true,
      seed: -1,
      count: 1,
      style: 'none',
      tryAnyway: false
    })
    expect(buildGenerateFlags(gen, {}, ['x'], ctx)).toMatchObject({ width: 1024, height: 1024, sizeExplicit: false })
  })
  it('usage errors', () => {
    expect(() => buildGenerateFlags(gen, {}, [], ctx)).toThrow(/needs a prompt/)
    expect(() => buildGenerateFlags(gen, { size: 'big' }, ['x'], ctx)).toThrow(/Use WxH/)
    expect(() => buildGenerateFlags(gen, { count: '9' }, ['x'], ctx)).toThrow(/Valid: 1-8/)
    expect(() => buildGenerateFlags(gen, { cfg: '7.3' }, ['x'], ctx)).toThrow(/in steps of 0.5/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/cli-options.test.ts`
Expected: FAIL, unresolved `../src/cli/options`.

- [ ] **Step 3: Implement**

`src/cli/options.ts`:

```ts
import { extname, resolve } from 'path'
import type { JobOptions } from '@shared/types'
import { normalizeExt } from '@shared/convert'
import { BG_DEFAULTS, hexToRgb } from '@shared/removebg'
import { fileKind } from '@shared/fileKind'
import { normalizePageRange } from '../main/tools/pdf'
import { VIDEO_CODEC_VALUES, flagOf, type CommandSpec, type FlagSpec } from './catalog'
import { UsageError } from './exit'

export type RawFlags = Record<string, string | boolean>
export interface Warning {
  code: string
  message: string
}
export type PathState = 'file' | 'dir' | 'missing'
export interface BuildContext {
  cwd: string
  pathState(p: string): PathState
}
export interface BuiltOptions {
  options: JobOptions
  warnings: Warning[]
  outDir?: string
  /** Flag names the user actually typed (some warnings only apply then). */
  explicit: Set<string>
  /** Which kind a bare --codec addressed (spec 3.2). */
  codecFor?: 'video' | 'audio'
}
type Value = string | number | boolean

function validList(f: FlagSpec): string {
  if (f.values) return f.values.join(', ') + (f.type === 'enumOrInt' ? `, or ${f.min}-${f.max}` : '')
  if (f.min !== undefined && f.max !== undefined)
    return `${f.min}-${f.max}${f.step ? ` in steps of ${f.step}` : ''}`
  return ''
}

/** One flag value -> the typed value the app stores (spec 2.3). */
export function coerce(f: FlagSpec, raw: string | boolean, cmdPath: string[] = []): Value {
  const flag = `--${f.name}`
  const bad = (why = ''): never => {
    const list = validList(f)
    throw new UsageError(
      `Invalid value '${String(raw)}' for ${flag}.${why ? ` ${why}` : ''}${list ? ` Valid: ${list}.` : ''}`,
      cmdPath
    )
  }
  if (f.type === 'bool') return typeof raw === 'boolean' ? raw : bad()
  if (typeof raw !== 'string') throw new UsageError(`${flag} needs a value.`, cmdPath)
  let v = raw.trim()
  if (f.suffix && v.toLowerCase().endsWith(f.suffix)) v = v.slice(0, -f.suffix.length).trim()
  const num = (int: boolean): number => {
    const n = Number(v)
    if (v === '' || !Number.isFinite(n)) return bad()
    if (int && !Number.isInteger(n)) return bad('Use a whole number.')
    if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) return bad()
    if (f.step) {
      const k = (n - (f.min ?? 0)) / f.step
      if (Math.abs(k - Math.round(k)) > 1e-9) return bad()
    }
    return n
  }
  const pick = (): string | undefined => f.values?.find((x) => x.toLowerCase() === v.toLowerCase())
  switch (f.type) {
    case 'format': {
      const ext = normalizeExt(v)
      return f.values?.includes(ext.slice(1)) ? ext : bad()
    }
    case 'enum': {
      const hit = pick()
      if (hit === undefined) return bad()
      const mapped = f.map?.[hit] ?? hit
      return f.numeric ? Number(mapped) : mapped
    }
    case 'enumOrInt':
      return pick() ?? num(true)
    case 'int':
      return num(true)
    case 'number':
      return num(false)
    case 'text':
    case 'path':
      return v ? v : bad()
  }
}

function reader(cmd: CommandSpec, raw: RawFlags) {
  const get = (name: string): Value | undefined =>
    raw[name] === undefined ? undefined : coerce(flagOf(cmd, name), raw[name], cmd.path)
  const def = (name: string): Value => {
    const f = flagOf(cmd, name)
    const d = typeof f.def === 'string' && f.map?.[f.def] ? f.map[f.def] : f.def
    return (f.numeric && d !== undefined ? Number(d) : d) as Value
  }
  return { get, val: (name: string): Value => get(name) ?? def(name) }
}

/** Flag values -> the app's JobOptions for one file command (spec 3.1-3.7). */
export function buildOptions(cmd: CommandSpec, raw: RawFlags, ctx: BuildContext): BuiltOptions {
  const { get, val } = reader(cmd, raw)
  const explicit = new Set(Object.keys(raw))
  const warnings: Warning[] = []
  const usage = (m: string): never => {
    throw new UsageError(m, cmd.path)
  }
  const out = cmd.flags.some((f) => f.name === 'out') ? get('out') : undefined
  const outDir = typeof out === 'string' ? resolve(ctx.cwd, out) : undefined
  let options: JobOptions
  let codecFor: BuiltOptions['codecFor']

  switch (cmd.id) {
    case 'convert': {
      const to = get('to')
      if (to === undefined) usage('filesmith convert needs --to <format>, e.g. --to webp.')
      options = {
        format: to as string,
        quality: val('quality') as string | number,
        store: val('compression') === 'store',
        dpi: val('resolution') as number,
        pageFormat: val('page-format') as string,
        pageQuality: val('page-quality') as number
      }
      break
    }
    case 'compress': {
      const codec = get('codec') as string | undefined
      let videoCodec = val('video-codec') as string
      let audioCodec = val('audio-codec') as string
      if (codec !== undefined) {
        if (VIDEO_CODEC_VALUES.includes(codec)) {
          if (explicit.has('video-codec')) usage('Use --codec or --video-codec, not both.')
          videoCodec = codec
          codecFor = 'video'
        } else {
          if (explicit.has('audio-codec')) usage('Use --codec or --audio-codec, not both.')
          audioCodec = codec
          codecFor = 'audio'
        }
      }
      const pdfLevel = val('level') as string
      const pdfGray = val('greyscale') as boolean
      if (pdfGray && pdfLevel === 'lossless')
        warnings.push({ code: 'GREYSCALE_IGNORED', message: '--greyscale has no effect with --level lossless.' })
      options = {
        quality: val('quality') as number,
        imageFormat: val('format') as string,
        videoCodec,
        scale: val('scale') as number,
        audioCodec,
        audioBitrate: val('bitrate') as number,
        pdfLevel,
        pdfGray
      }
      break
    }
    case 'pdf compress': {
      const pdfLevel = val('level') as string
      const pdfGray = val('greyscale') as boolean
      if (pdfGray && pdfLevel === 'lossless')
        warnings.push({ code: 'GREYSCALE_IGNORED', message: '--greyscale has no effect with --level lossless.' })
      options = { pdfLevel, pdfGray }
      break
    }
    case 'resize': {
      const pct = get('percent')
      const w = get('width') as number | undefined
      const h = get('height') as number | undefined
      const mode = get('mode')
      const hasDim = w !== undefined || h !== undefined
      if ((pct !== undefined || mode === 'percent') && hasDim)
        usage('Use --percent or --width/--height, not both.')
      const dims = hasDim || mode === 'dimensions'
      if (dims && !hasDim) usage('--mode dimensions needs --width or --height.')
      const fit = val('fit') as string
      if (w !== undefined && h !== undefined && fit === 'contain')
        warnings.push({
          code: 'DIMENSION_MAY_BE_IGNORED',
          message:
            'With --fit contain and both --width and --height the image keeps its aspect, so one of them may have no effect. Use --fit stretch to force both.'
        })
      options = dims
        ? { mode: 'dimensions', percent: 50, width: w ?? '', height: h ?? '', fit }
        : { mode: 'percent', percent: val('percent') as number, width: '', height: '', fit }
      break
    }
    case 'upscale': {
      const given = String(val('model'))
      const lower = given.toLowerCase()
      let model: string
      if (lower === 'photo' || lower === 'anime' || lower === 'pid') model = lower
      else if (lower === 'comfy') return usage('Name a ComfyUI model: --model comfy:<model file>.')
      else if (lower.startsWith('comfy:')) model = `comfy:${given.slice(6)}`
      else if (lower.startsWith('esrgan:')) model = `esrgan:${given.slice(7)}`
      else model = `esrgan:${given}`
      let factor = get('factor') as number | undefined
      if (model === 'pid') {
        if (factor !== undefined && factor !== 4)
          usage('--model pid upscales 4x only; leave out --factor or use --factor 4.')
        factor = 4
      }
      options = {
        upscaleFactor: factor ?? (val('factor') as number),
        upscaleModel: model,
        gpuMode: val('gpu') as string
      }
      break
    }
    case 'removebg': {
      const color = get('color') as string | undefined
      const image = get('image') as string | undefined
      let fill = get('fill') as string | undefined
      if (color !== undefined) {
        if (!hexToRgb(color)) usage(`Invalid value '${color}' for --color. Use #rrggbb, e.g. #00b140.`)
        if (fill === undefined) fill = 'custom'
        else if (fill !== 'custom') usage('--color needs --fill custom (or leave out --fill).')
      }
      let bgImagePath = ''
      if (image !== undefined) {
        const abs = resolve(ctx.cwd, image)
        if (ctx.pathState(abs) !== 'file' || fileKind(extname(abs)) !== 'image')
          usage(`--image must be an existing image file: ${abs}`)
        bgImagePath = abs
        if (fill === undefined) fill = 'image'
        else if (fill !== 'image') usage('--image needs --fill image (or leave out --fill).')
      }
      fill = fill ?? (val('fill') as string)
      if (fill === 'image' && !bgImagePath) usage('--fill image needs --image <path>.')
      const hex = color
        ? (color.startsWith('#') ? color : `#${color}`).toLowerCase()
        : BG_DEFAULTS.bgCustomColor
      options = { ...BG_DEFAULTS, bgFill: fill, bgCustomColor: hex, bgImagePath }
      break
    }
    case 'pdf merge':
      options = { op: 'merge' }
      break
    case 'pdf split': {
      const pages = get('pages') as string | undefined
      if (pages === undefined) usage('filesmith pdf split needs --pages, e.g. --pages 1-3,5.')
      const range = normalizePageRange(pages as string)
      if (!range)
        usage(`Invalid value '${pages}' for --pages. Use page numbers and ranges, e.g. 1-3,5,8-10.`)
      options = { op: 'split-range', range: range as string }
      break
    }
    case 'pdf burst':
      options = { op: 'split-pages' }
      break
    case 'pdf extract-text':
      options = { op: 'extract-text' }
      break
    case 'pdf to-images':
      options = { op: 'pages-to-images', dpi: val('resolution') as number }
      break
    case 'pdf extract-images':
      options = { op: 'extract-images' }
      break
    default:
      throw new Error(`buildOptions does not handle ${cmd.id}`)
  }
  return { options, warnings, outDir, explicit, codecFor }
}

export interface GenerateFlags {
  prompt: string
  model?: string
  negative: string
  style: string
  count: number
  width: number
  height: number
  /** True when --size, --width or --height was typed (clamping then warns). */
  sizeExplicit: boolean
  steps?: number
  cfg?: number
  guidance?: number
  seed: number
  tryAnyway: boolean
  outDir?: string
}

/** Flag values for `filesmith generate` (spec 3.6). Model-dependent defaults
 * (steps, cfg, guidance, size caps) are applied by the command once the model
 * is known. */
export function buildGenerateFlags(
  cmd: CommandSpec,
  raw: RawFlags,
  positionals: string[],
  ctx: BuildContext
): GenerateFlags {
  const { get, val } = reader(cmd, raw)
  const prompt = positionals.join(' ').trim()
  if (!prompt)
    throw new UsageError('filesmith generate needs a prompt, e.g. filesmith generate "a red kettle".', cmd.path)
  const size = String(val('size'))
  const m = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(size)
  if (!m) throw new UsageError(`Invalid value '${size}' for --size. Use WxH, e.g. 1216x832.`, cmd.path)
  const out = get('out')
  return {
    prompt,
    model: get('model') as string | undefined,
    negative: val('negative') as string,
    style: val('style') as string,
    count: val('count') as number,
    width: (get('width') as number | undefined) ?? Number(m[1]),
    height: (get('height') as number | undefined) ?? Number(m[2]),
    sizeExplicit: ['size', 'width', 'height'].some((k) => raw[k] !== undefined),
    steps: get('steps') as number | undefined,
    cfg: get('cfg') as number | undefined,
    guidance: get('guidance') as number | undefined,
    seed: (get('seed') as number | undefined) ?? -1,
    tryAnyway: get('try-anyway') === true,
    outDir: typeof out === 'string' ? resolve(ctx.cwd, out) : undefined
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/cli-options.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npx prettier --write src/cli test/cli-options.test.ts && npm test
git add src/cli/options.ts test/cli-options.test.ts
git commit -m "feat(cli): map flag values to the app's job options with per-verb validation" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Inputs: globs, folders, stdin, de-duplication

**Files:**
- Create: `src/cli/inputs.ts`, `test/cli-inputs.test.ts`

**Interfaces:**
- Consumes: `PathState` (Task 8), `FileInfo`.
- Produces: `interface InputIssue { arg: string; code: 'NOT_FOUND' | 'NO_MATCH'; message: string }`; `interface SkippedInput { path: string; code: 'UNSUPPORTED_KIND'; message: string }`; `interface ExpandOptions { cwd: string; recursive: boolean; accepts(f: FileInfo): boolean; fileInfo(p: string): FileInfo; readStdin(): Promise<string> }`; `interface ExpandResult { files: string[]; issues: InputIssue[]; skipped: SkippedInput[] }`; `expandInputs(args: string[], o: ExpandOptions): Promise<ExpandResult>`; `expandGlob(pattern: string, cwd: string): string[]`; `pathState(p: string): PathState`; `naturalCompare(a: string, b: string): number`.

- [ ] **Step 1: Write the failing test**

`test/cli-inputs.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expandInputs, type ExpandOptions } from '../src/cli/inputs'
import { fileInfoFromPath } from '../src/main/fileInfo'

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fs-inputs-'))
  for (const f of ['a.png', 'b10.png', 'b2.png', 'Photo.JPG', 'img[1].png', 'notes.txt', '.hidden.png', 'Thumbs.db'])
    writeFileSync(join(root, f), 'x')
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'sub', 'c.png'), 'x')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const opts = (over: Partial<ExpandOptions> = {}): ExpandOptions => ({
  cwd: root,
  recursive: false,
  accepts: (f) => f.kind === 'image',
  fileInfo: fileInfoFromPath,
  readStdin: async () => '',
  ...over
})
const at = (...p: string[]): string => join(root, ...p)

describe('expandInputs', () => {
  it('a literal file, even one whose name looks like a glob', async () => {
    const r = await expandInputs(['a.png', 'img[1].png'], opts())
    expect(r.files).toEqual([at('a.png'), at('img[1].png')])
  })

  it('a folder takes its own accepted files in natural order; others are skipped, hidden ignored', async () => {
    const r = await expandInputs(['.'], opts())
    expect(r.files).toEqual([at('a.png'), at('b2.png'), at('b10.png'), at('img[1].png'), at('Photo.JPG')])
    expect(r.skipped.map((s) => s.path)).toEqual([at('notes.txt')])
    expect(r.issues).toEqual([])
  })

  it('--recursive descends', async () => {
    const r = await expandInputs([root], opts({ recursive: true }))
    expect(r.files).toContain(at('sub', 'c.png'))
  })

  it('globs: case-insensitive, backslashes, absolute, ** recursive', async () => {
    expect((await expandInputs(['*.jpg'], opts())).files).toEqual([at('Photo.JPG')])
    expect((await expandInputs([`${root}\\sub\\*.png`], opts())).files).toEqual([at('sub', 'c.png')])
    const all = (await expandInputs(['**/*.png'], opts())).files
    expect(all).toContain(at('sub', 'c.png'))
    expect(all).not.toContain(at('.hidden.png'))
  })

  it('no match and not found are per-argument issues', async () => {
    const r = await expandInputs(['*.webp', 'missing.png'], opts())
    expect(r.files).toEqual([])
    expect(r.issues.map((i) => i.code)).toEqual(['NO_MATCH', 'NOT_FOUND'])
  })

  it('de-duplicates case-insensitively and keeps first-seen order', async () => {
    const r = await expandInputs(['b2.png', 'A.PNG', '*.png'], opts())
    expect(r.files).toEqual([at('b2.png'), at('A.PNG'), at('b10.png'), at('img[1].png')])
  })

  it('- reads paths from stdin, one per line', async () => {
    const r = await expandInputs(['-'], opts({ readStdin: async () => 'a.png\r\n\r\nsub\\c.png\n' }))
    expect(r.files).toEqual([at('a.png'), at('sub', 'c.png')])
    const empty = await expandInputs(['-'], opts())
    expect(empty).toEqual({ files: [], issues: [], skipped: [] })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/cli-inputs.test.ts`
Expected: FAIL, unresolved `../src/cli/inputs`.

- [ ] **Step 3: Implement**

`src/cli/inputs.ts`:

```ts
import { globSync, readdirSync, statSync } from 'fs'
import { basename, join, resolve } from 'path'
import type { FileInfo } from '@shared/types'
import type { PathState } from './options'

export interface InputIssue {
  arg: string
  code: 'NOT_FOUND' | 'NO_MATCH'
  message: string
}
export interface SkippedInput {
  path: string
  code: 'UNSUPPORTED_KIND'
  message: string
}
export interface ExpandOptions {
  cwd: string
  recursive: boolean
  /** Folder members the verb cannot take are skipped, not failed (spec 2.2). */
  accepts(f: FileInfo): boolean
  fileInfo(p: string): FileInfo
  readStdin(): Promise<string>
}
export interface ExpandResult {
  files: string[]
  issues: InputIssue[]
  skipped: SkippedInput[]
}

const GLOB_CHARS = /[*?[]/
const SYSTEM_FILES = new Set(['thumbs.db', 'desktop.ini'])

export const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

const hidden = (name: string): boolean => name.startsWith('.') || SYSTEM_FILES.has(name.toLowerCase())

export function pathState(p: string): PathState {
  try {
    const st = statSync(p)
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'missing'
  } catch {
    return 'missing'
  }
}

function folderFiles(dir: string, recursive: boolean): string[] {
  const out: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !hidden(e.name))
    .sort((a, b) => naturalCompare(a.name, b.name))
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isFile()) out.push(p)
    else if (e.isDirectory() && recursive) out.push(...folderFiles(p, true))
  }
  return out
}

/** cmd and PowerShell pass wildcards through, so the CLI expands them itself
 * (spec 2.2). The static prefix becomes the glob's cwd, which makes absolute
 * patterns and drive letters work. */
export function expandGlob(pattern: string, cwd: string): string[] {
  const norm = pattern.replace(/\\/g, '/')
  const parts = norm.split('/')
  const i = parts.findIndex((s) => GLOB_CHARS.test(s))
  let base = parts.slice(0, i).join('/')
  if (/^[A-Za-z]:$/.test(base)) base += '/'
  if (base === '' && norm.startsWith('/')) base = '/'
  const root = resolve(cwd, base || '.')
  return globSync(parts.slice(i).join('/'), { cwd: root })
    .map((rel) => resolve(root, rel))
    .filter((p) => pathState(p) === 'file' && !hidden(basename(p)))
    .sort(naturalCompare)
}

export async function expandInputs(args: string[], o: ExpandOptions): Promise<ExpandResult> {
  const files: string[] = []
  const issues: InputIssue[] = []
  const skipped: SkippedInput[] = []
  const seen = new Set<string>()
  const add = (p: string): void => {
    const k = p.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    files.push(p)
  }

  const list: string[] = []
  for (const a of args) {
    if (a !== '-') list.push(a)
    else
      list.push(
        ...(await o.readStdin())
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      )
  }

  for (const arg of list) {
    const abs = resolve(o.cwd, arg)
    const state = pathState(abs)
    if (state === 'file') {
      add(abs)
    } else if (state === 'dir') {
      for (const p of folderFiles(abs, o.recursive)) {
        if (o.accepts(o.fileInfo(p))) add(p)
        else skipped.push({ path: p, code: 'UNSUPPORTED_KIND', message: 'not a file this command takes' })
      }
    } else if (GLOB_CHARS.test(arg)) {
      const hits = expandGlob(arg, o.cwd)
      if (hits.length) hits.forEach(add)
      else issues.push({ arg, code: 'NO_MATCH', message: `No file matches ${arg}` })
    } else {
      issues.push({ arg, code: 'NOT_FOUND', message: `File not found: ${abs}` })
    }
  }
  return { files, issues, skipped }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/cli-inputs.test.ts`
Expected: PASS. If `*.jpg` does not match `Photo.JPG`, Electron's/Node's `globSync` is case-sensitive on this build: lower-case both sides by globbing `'**/*'`-style is NOT the fix; instead pass the pattern through `pattern.replace(/[a-z]/gi, (c) => \`[${c.toLowerCase()}${c.toUpperCase()}]\`)` for the non-static segments, and keep the test.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/cli/inputs.ts test/cli-inputs.test.ts
git commit -m "feat(cli): input expansion with globs, folders, stdin and natural order" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The planner: routing, skips, per-file errors, predicted outputs

**Files:**
- Create: `src/cli/plan.ts`, `test/cli-plan.test.ts`

**Interfaces:**
- Consumes: `planOutput`, `PlannedOutput` (Task 3); `Readiness` (Task 5); `CliError`, `ErrorCode` (Task 6); `CommandId` (Task 7); `BuiltOptions`, `Warning` (Task 8).
- Produces:
  - `interface PlannedJob { id: string; input: string; inputs?: string[]; inSize: number; tool: ToolId; op: string; options: JobOptions; output?: PlannedOutput; state: 'ready' | 'skip' | 'error'; code?: ErrorCode; message?: string; hint?: string }`.
  - `interface PlanEnv { outDir?: string; hasRar: boolean; readiness: Readiness }`; `interface PlanResult { jobs: PlannedJob[]; warnings: Warning[]; runError?: CliError }`.
  - `acceptsKind(id: CommandId, f: FileInfo): boolean`; `planJobs(id: CommandId, files: FileInfo[], built: BuiltOptions, env: PlanEnv): PlanResult` (throws `CliError` for run-level requirement failures: readiness, `RAR_MISSING`).

- [ ] **Step 1: Write the failing test**

`test/cli-plan.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planJobs, type PlanEnv } from '../src/cli/plan'
import { CliError } from '../src/cli/exit'
import { fileKind } from '@shared/fileKind'
import type { FileInfo, JobOptions } from '@shared/types'
import type { BuiltOptions } from '../src/cli/options'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-cliplan-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = (name: string): FileInfo => {
  writeFileSync(join(dir, name), 'x')
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return { path: join(dir, name), name, ext, kind: fileKind(ext), size: 100 }
}
const built = (options: JobOptions, over: Partial<BuiltOptions> = {}): BuiltOptions => ({
  options,
  warnings: [],
  explicit: new Set(),
  ...over
})
const env = (over: Partial<PlanEnv> = {}): PlanEnv => ({ hasRar: true, readiness: { ok: true }, ...over })
const CONVERT = { format: '.webp', quality: 'balanced', store: true, dpi: 150, pageFormat: 'jpg', pageQuality: 100 }

describe('planJobs: convert', () => {
  it('routes each file and predicts its output', () => {
    const r = planJobs('convert', [file('a.png'), file('b.cbz'), file('c.pdf')], built({ ...CONVERT, format: '.cbz' }), env())
    expect(r.jobs.map((j) => [j.id, j.state, j.op])).toEqual([
      ['1', 'error', 'convert'],
      ['2', 'skip', 'convert'],
      ['3', 'ready', 'archive/from-pdf']
    ])
    expect(r.jobs[0]).toMatchObject({ code: 'UNSUPPORTED_KIND', message: "Can't convert .png to .cbz." })
    expect(r.jobs[1]).toMatchObject({ code: 'SAME_FORMAT', message: 'already cbz' })
    expect(r.jobs[2].options).toMatchObject({ op: 'from-pdf', format: '.cbz', dpi: 150 })
    expect(r.jobs[2].output).toEqual({ path: join(dir, 'c.cbz'), kind: 'file' })
  })

  it('two sources on one name: predicted exactly as the real run names them', () => {
    const r = planJobs('convert', [file('photo.png'), file('photo.jpg')], built(CONVERT), env())
    expect(r.jobs.map((j) => j.output?.path)).toEqual([
      join(dir, 'photo.webp'),
      join(dir, 'photo (converted).webp')
    ])
    expect(readdirSync(dir).sort()).toEqual(['photo.jpg', 'photo.png'])
  })

  it('a RAR target without WinRAR stops the run before anything is planned', () => {
    expect(() => planJobs('convert', [file('a.cbz')], built({ ...CONVERT, format: '.cbr' }), env({ hasRar: false }))).toThrow(CliError)
  })

  it('nothing runnable: run error listing what the inputs share', () => {
    const r = planJobs('convert', [file('a.mp3'), file('b.wav')], built(CONVERT), env())
    expect(r.runError?.code).toBe('USAGE')
    expect(r.runError?.message).toMatch(/No input can be converted to webp\. Formats these inputs share: .*m4a/)
  })

  it('all skipped is not an error', () => {
    const r = planJobs('convert', [file('a.webp')], built(CONVERT), env())
    expect(r.runError).toBeUndefined()
    expect(r.jobs[0].state).toBe('skip')
  })

  it('--quality typed for a target it cannot affect is a warning', () => {
    const r = planJobs('convert', [file('a.jpg')], built({ ...CONVERT, format: '.png' }, { explicit: new Set(['quality']) }), env())
    expect(r.warnings.map((w) => w.code)).toEqual(['QUALITY_IGNORED'])
  })

  it('outDir goes into every job and its predicted path', () => {
    const out = join(dir, 'out')
    const r = planJobs('convert', [file('a.png')], built(CONVERT), env({ outDir: out }))
    expect(r.jobs[0].options.outDir).toBe(out)
    expect(r.jobs[0].output?.path).toBe(join(out, 'a.webp'))
  })
})

describe('planJobs: other verbs', () => {
  it('compress rejects what the compressors cannot handle', () => {
    const r = planJobs('compress', [file('a.bmp'), file('b.txt'), file('c.jpg')], built({ imageFormat: 'keep' }), env())
    expect(r.jobs.map((j) => j.state)).toEqual(['error', 'error', 'ready'])
  })

  it('a bare --codec aimed at video warns when audio files are in the batch', () => {
    const r = planJobs('compress', [file('a.mp4'), file('b.mp3')], built({ videoCodec: 'h265', audioCodec: 'keep' }, { codecFor: 'video' }), env())
    expect(r.warnings.map((w) => w.code)).toEqual(['CODEC_IGNORED'])
  })

  it('readiness failures stop the run with the setup hint', () => {
    try {
      planJobs('upscale', [file('a.png')], built({ upscaleModel: 'pid' }), env({ readiness: { ok: false, code: 'SETUP_REQUIRED', message: 'PiD is not installed.', hint: 'filesmith setup pid' } }))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CliError)
      expect((e as CliError).hint).toBe('filesmith setup pid')
    }
  })

  it('pdf compress runs the compress tool', () => {
    const r = planJobs('pdf compress', [file('a.pdf'), file('b.png')], built({ pdfLevel: 'smallest', pdfGray: false }), env())
    expect(r.jobs.map((j) => [j.state, j.tool])).toEqual([
      ['ready', 'compress'],
      ['error', 'compress']
    ])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/cli-plan.test.ts`
Expected: FAIL, unresolved `../src/cli/plan`.

- [ ] **Step 3: Implement**

`src/cli/plan.ts`:

```ts
import type { FileInfo, JobOptions, ToolId } from '@shared/types'
import { canCompress, familyFormats, isSameFormat, routeConvert } from '@shared/convert'
import { needsRar } from '@shared/archive'
import { tabById } from '@shared/tabs'
import { planOutput, type PlannedOutput } from '../main/tools/plan'
import type { Readiness } from '../main/tools/readiness'
import { CliError, type ErrorCode } from './exit'
import type { CommandId } from './catalog'
import type { BuiltOptions, Warning } from './options'

export interface PlannedJob {
  /** 1-based, in input order: stable between a dry run and the real run. */
  id: string
  input: string
  /** pdf merge: every input in page order. */
  inputs?: string[]
  inSize: number
  tool: ToolId
  /** Engine route for the events: convert, archive/repack, pdf/merge, ... */
  op: string
  options: JobOptions
  output?: PlannedOutput
  state: 'ready' | 'skip' | 'error'
  code?: ErrorCode
  message?: string
  hint?: string
}

export interface PlanEnv {
  outDir?: string
  hasRar: boolean
  readiness: Readiness
}

export interface PlanResult {
  jobs: PlannedJob[]
  warnings: Warning[]
  /** Nothing can run: exit 2 after the per-file events (spec 2.7). */
  runError?: CliError
}

const QUALITY_TARGETS = ['.jpg', '.webp', '.avif', '.jxl']
const VERB: Partial<Record<CommandId, string>> = {
  convert: 'convert',
  compress: 'compress',
  resize: 'resize',
  upscale: 'upscale',
  removebg: 'remove the background of'
}

export function acceptsKind(id: CommandId, f: FileInfo): boolean {
  switch (id) {
    case 'convert':
      return tabById('convert').kinds.includes(f.kind)
    case 'compress':
      return canCompress(f.kind, f.ext)
    case 'resize':
    case 'upscale':
    case 'removebg':
      return f.kind === 'image'
    default:
      return f.kind === 'pdf'
  }
}

function toolOf(id: CommandId): ToolId {
  if (id === 'pdf compress') return 'compress'
  if (id.startsWith('pdf ')) return 'pdf'
  return id as ToolId
}

function planOne(
  id: CommandId,
  f: FileInfo,
  index: number,
  built: BuiltOptions,
  env: PlanEnv,
  claimed: Set<string>
): PlannedJob {
  const base = { id: String(index + 1), input: f.path, inSize: f.size }
  const tool = toolOf(id)
  const error = (code: ErrorCode, message: string): PlannedJob => ({
    ...base,
    tool,
    op: tool,
    options: {},
    state: 'error',
    code,
    message
  })
  const ready = (t: ToolId, op: string, options: JobOptions): PlannedJob => {
    const full: JobOptions = env.outDir ? { ...options, outDir: env.outDir } : options
    try {
      return { ...base, tool: t, op, options: full, output: planOutput(t, f, full, env.outDir, claimed), state: 'ready' }
    } catch (e) {
      return { ...base, tool: t, op, options: full, state: 'error', code: 'INTERNAL', message: (e as Error).message }
    }
  }

  if (!acceptsKind(id, f))
    return error('UNSUPPORTED_KIND', `Can't ${VERB[id] ?? id} ${f.ext || 'these'} files.`)

  if (id === 'convert') {
    const o = built.options
    const target = String(o.format)
    if (!familyFormats(f.kind, f.ext).some((x) => x.ext === target))
      return error('UNSUPPORTED_KIND', `Can't convert ${f.ext} to ${target}.`)
    if (isSameFormat(f.ext, target))
      return { ...base, tool: 'convert', op: 'convert', options: {}, state: 'skip', code: 'SAME_FORMAT', message: `already ${target.slice(1)}` }
    const route = routeConvert(f.kind, f.ext, target)
    if (route.tool === 'archive')
      return ready('archive', `archive/${route.op}`, {
        op: route.op ?? 'repack',
        format: target,
        store: o.store,
        dpi: o.dpi,
        pageFormat: o.pageFormat,
        pageQuality: o.pageQuality
      })
    return ready('convert', 'convert', { format: target, quality: o.quality })
  }
  return ready(tool, tool === 'pdf' ? `pdf/${String(built.options.op)}` : tool, { ...built.options })
}

function nothingToRun(id: CommandId, files: FileInfo[], options: JobOptions): string {
  if (id !== 'convert') return `Nothing to run: no input is a file filesmith ${id} can take.`
  const target = String(options.format).slice(1)
  const lists = files
    .filter((f) => f.kind !== 'other')
    .map((f) => familyFormats(f.kind, f.ext).map((x) => x.ext.slice(1)))
  const shared = lists.length ? lists.reduce((a, b) => a.filter((x) => b.includes(x))) : []
  return shared.length
    ? `No input can be converted to ${target}. Formats these inputs share: ${shared.join(', ')}.`
    : `No input can be converted to ${target}, and these inputs share no target format.`
}

/** Spec 2.7 and 4.4: decide everything before any file is touched. */
export function planJobs(id: CommandId, files: FileInfo[], built: BuiltOptions, env: PlanEnv): PlanResult {
  if (!env.readiness.ok) throw new CliError(env.readiness.code, env.readiness.message, env.readiness.hint)
  const o = built.options
  if (id === 'convert' && needsRar(String(o.format)) && !env.hasRar)
    throw new CliError('RAR_MISSING', 'WinRAR not found. CBR and RAR output need WinRAR installed.', 'filesmith doctor')

  const claimed = new Set<string>()
  const jobs = files.map((f, i) => planOne(id, f, i, built, env, claimed))

  const warnings: Warning[] = []
  if (built.codecFor === 'video' && files.some((f) => f.kind === 'audio'))
    warnings.push({ code: 'CODEC_IGNORED', message: `--codec ${String(o.videoCodec)} applies to video; audio files use --audio-codec ${String(o.audioCodec)}.` })
  if (built.codecFor === 'audio' && files.some((f) => f.kind === 'video'))
    warnings.push({ code: 'CODEC_IGNORED', message: `--codec ${String(o.audioCodec)} applies to audio; video files use --video-codec ${String(o.videoCodec)}.` })
  if (id === 'convert' && built.explicit.has('quality') && !QUALITY_TARGETS.includes(String(o.format)))
    warnings.push({ code: 'QUALITY_IGNORED', message: `--quality only affects jpg, webp, avif and jxl targets, not ${String(o.format).slice(1)}.` })

  const runnable = jobs.some((j) => j.state === 'ready')
  const failing = jobs.some((j) => j.state === 'error')
  return {
    jobs,
    warnings,
    runError: jobs.length && !runnable && failing ? new CliError('USAGE', nothingToRun(id, files, o)) : undefined
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/cli-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npx prettier --write src/cli test && npm test
git add src/cli/plan.ts test/cli-plan.test.ts
git commit -m "feat(cli): planner decides routing, skips and failures before any file is touched" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Runner, main, process entry and the file verbs end to end

**Files:**
- Create: `src/cli/io.ts`, `src/cli/runner.ts`, `src/cli/commands/files.ts`, `src/cli/main.ts`, `src/cli/deps.ts`, `test/cli-runner.test.ts`, `test/cli-main.test.ts`, `test/cli-graph.test.ts`, `e2e/cli.spec.ts`
- Modify: `src/cli/bootstrap.ts` (replace the Task 1 probe)

**Interfaces:**
- Consumes: everything from Tasks 2 to 10; `JobQueue` with `allowDownload` (Task 5); `fileInfoFromPath`; `resolveRar`; `usableComfyModels`; `pidSidecar`, `spandrelSidecar`, `stopComfyServer`.
- Produces:
  - `io.ts`: `interface CliIO { argv: string[]; stdout: Out; stderr: Out; stdoutTTY: boolean; stderrTTY: boolean; env: Record<string, string | undefined>; cwd: string; readStdin(): Promise<string>; signal: AbortSignal }`.
  - `runner.ts`: `interface QueueLike { add(req: JobRequest): void; cancelAll(): void }`, `type QueueFactory = (emit: (e: JobEvent) => void) => QueueLike`, `interface RunnerDeps { queue: QueueFactory; clock: () => number; statOutput(path: string): { outSize?: number; files?: number } }`, `interface RunTotals { ok; failed; skipped; canceled; inBytes; outBytes }` (numbers), `classifyError(message: string): { code: ErrorCode; hint?: string }`, `statOutput(path: string)`, `emitNotReady(j: PlannedJob, r: Reporter): 'skipped' | 'failed'`, `runPlanned(jobs, reporter, deps, signal): Promise<RunTotals>`.
  - `commands/files.ts`: `interface FileCommandDeps { queue: QueueFactory; hasRar(): boolean; readiness(id: CommandId, options: JobOptions): Promise<Readiness>; resolveUpscaleModel(value: string): string; fileInfo(path: string): FileInfo; statOutput(path: string): { outSize?: number; files?: number }; pathState(path: string): PathState; mkdirp(path: string): void }`, `runFileCommand(args: ParsedArgs, io: CliIO, reporter: Reporter, deps: FileCommandDeps, clock: () => number): Promise<number>`.
  - `main.ts`: `interface CliDeps { clock: () => number; files: FileCommandDeps }` (Tasks 13 to 17 add `generate`, `setup`, `formats`, `doctor`, `skill`), `main(io: CliIO, deps: CliDeps): Promise<number>`.
  - `deps.ts`: `defaultFileDeps(): FileCommandDeps`, `resolveUpscaleModel(value: string): string`, `defaultDeps(): CliDeps`.

- [ ] **Step 1: Write the failing unit tests**

`test/cli-runner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyError, runPlanned, type QueueLike } from '../src/cli/runner'
import type { EventBody, Reporter } from '../src/cli/events'
import type { PlannedJob } from '../src/cli/plan'
import type { JobEvent, JobRequest } from '@shared/types'

function recorder(): Reporter & { events: EventBody[] } {
  const events: EventBody[] = []
  return { events, emit: (e) => events.push(e), text: () => {}, close: () => {} }
}

/** Models JobQueue faithfully where it matters: concurrency 1, and cancelAll
 * drops QUEUED jobs without any event (only the running one reports). */
function fakeQueue(script: (req: JobRequest, emit: (e: JobEvent) => void) => void) {
  let emit: (e: JobEvent) => void = () => {}
  const pending: JobRequest[] = []
  let running: JobRequest | null = null
  const next = (): void => {
    if (running || !pending.length) return
    running = pending.shift() as JobRequest
    emit({ id: running.id, status: 'running' })
    script(running, (e) => {
      emit(e)
      if (e.status !== 'running') {
        running = null
        next()
      }
    })
  }
  const factory = (e: (ev: JobEvent) => void): QueueLike => {
    emit = e
    return {
      add: (req) => {
        pending.push(req)
        emit({ id: req.id, status: 'queued' })
        next()
      },
      cancelAll: () => {
        pending.length = 0
        if (running) {
          const id = running.id
          running = null
          emit({ id, status: 'canceled' })
        }
      }
    }
  }
  return factory
}

const job = (id: string, over: Partial<PlannedJob> = {}): PlannedJob => ({
  id,
  input: `C:\\in\\${id}.png`,
  inSize: 100,
  tool: 'convert',
  op: 'convert',
  options: {},
  state: 'ready',
  ...over
})
const deps = (queue: ReturnType<typeof fakeQueue>) => ({ queue, clock: () => 0, statOutput: () => ({ outSize: 40 }) })

describe('runPlanned', () => {
  it('maps JobEvents to start/progress/done/error and totals the bytes', async () => {
    const r = recorder()
    const q = fakeQueue((req, emit) => {
      emit({ id: req.id, status: 'running', percent: 50 })
      if (req.id === '2') emit({ id: req.id, status: 'failed', error: 'magick: improper image header' })
      else emit({ id: req.id, status: 'done', outputPath: 'C:\\in\\1.webp' })
    })
    const t = await runPlanned([job('1'), job('2'), job('3', { state: 'skip', code: 'SAME_FORMAT', message: 'already webp' })], r, deps(q), new AbortController().signal)
    expect(t).toMatchObject({ ok: 1, failed: 1, skipped: 1, canceled: 0, inBytes: 100, outBytes: 40 })
    expect(r.events.map((e) => e.event)).toEqual(['skipped', 'start', 'progress', 'done', 'start', 'progress', 'error'])
  })

  it('Ctrl+C: the running job and every never-started job end as canceled', async () => {
    const r = recorder()
    const ctrl = new AbortController()
    const q = fakeQueue((req) => {
      if (req.id === '1') queueMicrotask(() => ctrl.abort())
    })
    const t = await runPlanned([job('1'), job('2'), job('3')], r, deps(q), ctrl.signal)
    expect(t).toMatchObject({ ok: 0, canceled: 3 })
    expect(r.events.filter((e) => e.event === 'canceled').map((e) => (e as { id: string }).id).sort()).toEqual(['1', '2', '3'])
  })

  it('an already-aborted signal cancels everything without starting', async () => {
    const r = recorder()
    const ctrl = new AbortController()
    ctrl.abort()
    const t = await runPlanned([job('1')], r, deps(fakeQueue(() => {})), ctrl.signal)
    expect(t.canceled).toBe(1)
  })
})

describe('classifyError', () => {
  it.each([
    ['PiD is not installed. Run: filesmith setup pid.', 'SETUP_REQUIRED', 'filesmith setup pid'],
    ['Output folder not found: D:\\x', 'OUT_DIR_MISSING', undefined],
    ['This archive is password-protected.', 'PASSWORD', undefined],
    ['The image engine (ImageMagick) is missing from this installation. Reinstall Filesmith.', 'TOOL_MISSING', 'filesmith doctor'],
    ['magick: improper image header', 'TOOL_FAILED', undefined]
  ])('%s', (msg, code, hint) => expect(classifyError(msg)).toEqual(hint ? { code, hint } : { code }))
})
```

`test/cli-main.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { main, type CliDeps } from '../src/cli/main'
import type { CliIO } from '../src/cli/io'
import { fileInfoFromPath } from '../src/main/fileInfo'
import { pathState } from '../src/cli/inputs'
import { VERSION } from '../src/cli/version'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-main-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function harness(argv: string[], over: Partial<CliDeps['files']> = {}) {
  let out = ''
  let err = ''
  const io: CliIO = {
    argv,
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    stdoutTTY: false,
    stderrTTY: false,
    env: {},
    cwd: dir,
    readStdin: async () => '',
    signal: new AbortController().signal
  }
  const deps: CliDeps = {
    clock: () => 0,
    files: {
      queue: (emit) => ({
        add: (req) => {
          emit({ id: req.id, status: 'running' })
          emit({ id: req.id, status: 'done', outputPath: join(dir, 'out.webp') })
        },
        cancelAll: () => {}
      }),
      hasRar: () => false,
      readiness: async () => ({ ok: true }),
      resolveUpscaleModel: (v) => v,
      fileInfo: fileInfoFromPath,
      statOutput: () => ({ outSize: 1 }),
      pathState,
      mkdirp: () => {},
      ...over
    }
  }
  return {
    run: () => main(io, deps),
    out: () => out,
    err: () => err,
    events: () => out.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
  }
}

describe('main', () => {
  it('--version prints the version', async () => {
    const h = harness(['--version'])
    expect(await h.run()).toBe(0)
    expect(h.out()).toBe(`${VERSION}\n`)
  })

  it('a usage error in JSON mode is an error event plus a summary on stdout, exit 2', async () => {
    const h = harness(['convert', 'a.png', '--json'])
    expect(await h.run()).toBe(2)
    expect(h.events().map((e) => [e.event, e.code ?? e.exitCode])).toEqual([
      ['error', 'USAGE'],
      ['summary', 2]
    ])
    expect(h.err()).toBe('')
  })

  it('a usage error in human mode goes to stderr with the usage line', async () => {
    const h = harness(['convert', 'a.png'])
    expect(await h.run()).toBe(2)
    expect(h.err()).toContain('filesmith: filesmith convert needs --to <format>')
    expect(h.err()).toContain('Usage: filesmith convert <files...> --to <format> [options]')
    expect(h.out()).toBe('')
  })

  it('runs a convert: run, start, done, summary', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    const h = harness(['convert', 'a.png', '--to', 'webp', '--json'])
    expect(await h.run()).toBe(0)
    expect(h.events().map((e) => e.event)).toEqual(['run', 'start', 'done', 'summary'])
    expect(h.events()[0]).toMatchObject({ v: 1, command: 'convert', dryRun: false, inputs: 1 })
  })

  it('a dry run plans and writes nothing', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    const h = harness(['convert', 'a.png', '--to', 'webp', '--dry-run', '--json'], {
      queue: () => {
        throw new Error('the queue must not be created in a dry run')
      }
    })
    expect(await h.run()).toBe(0)
    expect(h.events().map((e) => e.event)).toEqual(['run', 'plan', 'summary'])
    expect(h.events()[1]).toMatchObject({ id: '1', ready: true, output: join(dir, 'a.webp'), outputKind: 'file' })
  })

  it('--out pointing at a file: exit 2 OUT_DIR_MISSING, nothing runs', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    writeFileSync(join(dir, 'taken'), 'x')
    const h = harness(['convert', 'a.png', '--to', 'webp', '--out', 'taken', '--json'])
    expect(await h.run()).toBe(2)
    expect(h.events().find((e) => e.event === 'error')).toMatchObject({ code: 'OUT_DIR_MISSING' })
    expect(h.events().some((e) => e.event === 'start')).toBe(false)
  })

  it('a missing --out folder is created only for a real run (O6)', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    const made: string[] = []
    const dry = harness(['convert', 'a.png', '--to', 'webp', '--out', 'new', '--dry-run'], { mkdirp: (p) => made.push(p) })
    expect(await dry.run()).toBe(0)
    expect(made).toEqual([])
    expect(dry.err()).toContain('warn: Would create the output folder')
    const real = harness(['convert', 'a.png', '--to', 'webp', '--out', 'new'], { mkdirp: (p) => made.push(p) })
    expect(await real.run()).toBe(0)
    expect(made).toEqual([join(dir, 'new')])
  })

  it('a requirement that fails for every input is exit 2 with the hint', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    const h = harness(['removebg', 'a.png', '--json'], {
      readiness: async () => ({ ok: false, code: 'SETUP_REQUIRED', message: 'Background removal is not set up yet.', hint: 'filesmith setup removebg' })
    })
    expect(await h.run()).toBe(2)
    expect(h.events().find((e) => e.event === 'error')).toMatchObject({ code: 'SETUP_REQUIRED', hint: 'filesmith setup removebg' })
  })

  it('only missing inputs: per-argument errors, then exit 2', async () => {
    const h = harness(['resize', 'nope.png', '--json'])
    expect(await h.run()).toBe(2)
    expect(h.events().map((e) => [e.event, e.code])).toEqual([
      ['run', undefined],
      ['error', 'NOT_FOUND'],
      ['error', 'NOT_FOUND'],
      ['summary', undefined]
    ])
  })
})
```

`test/cli-graph.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { importGraph } from './helpers/importGraph'

describe('CLI import graph', () => {
  it('nothing reachable from the CLI entry imports electron', () => {
    const { externals, files } = importGraph(resolve(__dirname, '..', 'src', 'cli', 'bootstrap.ts'))
    expect([...externals]).not.toContain('electron')
    for (const banned of ['index.ts', 'ipc.ts', 'session.ts', 'thumbnail.ts'])
      expect(files.some((f) => f.endsWith(`src\\main\\${banned}`) || f.endsWith(`src/main/${banned}`)), banned).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/cli-runner.test.ts test/cli-main.test.ts test/cli-graph.test.ts`
Expected: FAIL, unresolved `../src/cli/runner`, `../src/cli/main`.

- [ ] **Step 3: Implement the runner**

`src/cli/io.ts`:

```ts
import type { Out } from './events'

/** Everything main() touches of the process, injectable for tests (spec 4.3). */
export interface CliIO {
  argv: string[]
  stdout: Out
  stderr: Out
  stdoutTTY: boolean
  stderrTTY: boolean
  env: Record<string, string | undefined>
  cwd: string
  readStdin(): Promise<string>
  /** Aborted by Ctrl+C (SIGINT, SIGBREAK) or a closed stdout. */
  signal: AbortSignal
}
```

`src/cli/runner.ts`:

```ts
import { readdirSync, statSync } from 'fs'
import type { JobEvent, JobRequest } from '@shared/types'
import type { Reporter } from './events'
import type { ErrorCode } from './exit'
import type { PlannedJob } from './plan'

export interface QueueLike {
  add(req: JobRequest): void
  cancelAll(): void
}
export type QueueFactory = (emit: (e: JobEvent) => void) => QueueLike

export interface RunnerDeps {
  queue: QueueFactory
  clock: () => number
  statOutput(path: string): { outSize?: number; files?: number }
}

export interface RunTotals {
  ok: number
  failed: number
  skipped: number
  canceled: number
  inBytes: number
  outBytes: number
}

/** Engine error text -> a stable code and, when one exists, the exact command
 * that fixes it (spec 2.6). The engine's CLI wording ends in "Run: <cmd>." */
export function classifyError(message: string): { code: ErrorCode; hint?: string } {
  const hint = /Run: (filesmith [^\n]*?)\.?\s*$/m.exec(message)?.[1]
  if (hint) return { code: 'SETUP_REQUIRED', hint }
  if (/Output folder not found/i.test(message)) return { code: 'OUT_DIR_MISSING' }
  if (/password-protected/i.test(message)) return { code: 'PASSWORD' }
  if (/WinRAR not found/i.test(message)) return { code: 'RAR_MISSING', hint: 'filesmith doctor' }
  if (/missing from this installation|isn't installed|could not be started \(not found\)/i.test(message))
    return { code: 'TOOL_MISSING', hint: 'filesmith doctor' }
  return { code: 'TOOL_FAILED' }
}

export function statOutput(path: string): { outSize?: number; files?: number } {
  try {
    const st = statSync(path)
    return st.isDirectory() ? { files: readdirSync(path).length } : { outSize: st.size }
  } catch {
    return {}
  }
}

export function emitNotReady(j: PlannedJob, reporter: Reporter): 'skipped' | 'failed' {
  if (j.state === 'skip') {
    reporter.emit({ event: 'skipped', id: j.id, input: j.input, code: j.code ?? 'SAME_FORMAT', message: j.message ?? '' })
    return 'skipped'
  }
  reporter.emit({ event: 'error', id: j.id, input: j.input, code: j.code ?? 'INTERNAL', message: j.message ?? 'failed', hint: j.hint })
  return 'failed'
}

/** Run the ready jobs on a JobQueue in this process (spec 4.4); never touches
 * the app's queue. Resolves when every job reached a terminal event. */
export function runPlanned(
  jobs: PlannedJob[],
  reporter: Reporter,
  deps: RunnerDeps,
  signal: AbortSignal
): Promise<RunTotals> {
  const totals: RunTotals = { ok: 0, failed: 0, skipped: 0, canceled: 0, inBytes: 0, outBytes: 0 }
  for (const j of jobs) if (j.state !== 'ready') totals[emitNotReady(j, reporter)]++
  const ready = jobs.filter((j) => j.state === 'ready')
  if (!ready.length) return Promise.resolve(totals)

  return new Promise((resolve) => {
    const byId = new Map(ready.map((j) => [j.id, j]))
    const started = new Map<string, number>()
    const finished = new Set<string>()
    const finish = (id: string): void => {
      finished.add(id)
      if (finished.size === ready.length) {
        signal.removeEventListener('abort', onAbort)
        resolve(totals)
      }
    }
    const canceled = (j: PlannedJob): void => {
      reporter.emit({ event: 'canceled', id: j.id, input: j.input })
      totals.canceled++
      finish(j.id)
    }
    const queue = deps.queue((e) => {
      const job = byId.get(e.id)
      if (!job || finished.has(e.id)) return
      switch (e.status) {
        case 'running':
          if (!started.has(e.id)) {
            started.set(e.id, deps.clock())
            reporter.emit({ event: 'start', id: job.id, input: job.input, inSize: job.inSize, op: job.op })
          }
          if (e.percent !== undefined || e.message)
            reporter.emit({ event: 'progress', id: job.id, pct: e.percent ?? null, etaSec: e.etaSec, message: e.message })
          return
        case 'done': {
          const st = e.outputPath ? deps.statOutput(e.outputPath) : {}
          totals.ok++
          totals.inBytes += job.inSize
          if (st.outSize !== undefined) totals.outBytes += st.outSize
          reporter.emit({
            event: 'done',
            id: job.id,
            input: job.input,
            output: e.outputPath ?? '',
            outputKind: st.files !== undefined ? 'dir' : 'file',
            inSize: job.inSize,
            outSize: st.outSize,
            files: st.files,
            ms: deps.clock() - (started.get(e.id) ?? deps.clock())
          })
          finish(e.id)
          return
        }
        case 'failed': {
          const message = e.error ?? 'failed'
          const c = classifyError(message)
          reporter.emit({ event: 'error', id: job.id, input: job.input, code: c.code, message, hint: c.hint })
          totals.failed++
          finish(e.id)
          return
        }
        case 'canceled':
          canceled(job)
          return
      }
    })
    const onAbort = (): void => {
      queue.cancelAll()
      // JobQueue.cancelAll drops QUEUED jobs without an event; they never
      // started, so they are reported here or the run would never end.
      for (const j of ready) if (!started.has(j.id) && !finished.has(j.id)) canceled(j)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    for (const j of ready) queue.add({ id: j.id, tool: j.tool, input: j.input, options: j.options })
    if (signal.aborted) onAbort()
  })
}
```

- [ ] **Step 4: Implement the file command, main, deps and the process entry**

`src/cli/commands/files.ts`:

```ts
import type { FileInfo, JobOptions } from '@shared/types'
import type { Readiness } from '../../main/tools/readiness'
import type { CommandId, CommandSpec } from '../catalog'
import type { Reporter } from '../events'
import { CliError, EXIT, UsageError, reduceExit } from '../exit'
import { expandInputs } from '../inputs'
import type { CliIO } from '../io'
import { buildOptions, type PathState, type Warning } from '../options'
import type { ParsedArgs } from '../parse'
import { acceptsKind, planJobs, type PlanEnv, type PlanResult } from '../plan'
import { emitNotReady, runPlanned, type QueueFactory, type RunTotals } from '../runner'
import { VERSION } from '../version'

export interface FileCommandDeps {
  queue: QueueFactory
  hasRar(): boolean
  readiness(id: CommandId, options: JobOptions): Promise<Readiness>
  /** comfy:<name or path> -> comfy:<absolute path of a scanned model>. */
  resolveUpscaleModel(value: string): string
  fileInfo(path: string): FileInfo
  statOutput(path: string): { outSize?: number; files?: number }
  pathState(path: string): PathState
  mkdirp(path: string): void
}

function planAny(id: CommandId, files: FileInfo[], built: ReturnType<typeof buildOptions>, env: PlanEnv): PlanResult {
  return planJobs(id, files, built, env)
}

/** convert, compress, resize, upscale, removebg and the pdf tools. */
export async function runFileCommand(
  args: ParsedArgs,
  io: CliIO,
  reporter: Reporter,
  deps: FileCommandDeps,
  clock: () => number
): Promise<number> {
  const t0 = clock()
  const cmd = args.command as CommandSpec
  const id = cmd.id
  const built = buildOptions(cmd, args.values, { cwd: io.cwd, pathState: deps.pathState })
  if (id === 'upscale')
    built.options.upscaleModel = deps.resolveUpscaleModel(String(built.options.upscaleModel))
  if (!args.positionals.length)
    throw new UsageError(`filesmith ${cmd.path.join(' ')} needs at least one file.`, cmd.path)

  const outDir = built.outDir
  const outState = outDir ? deps.pathState(outDir) : 'dir'
  if (outState === 'file') throw new CliError('OUT_DIR_MISSING', `--out is a file, not a folder: ${outDir}`)
  if (outState === 'missing' && args.dryRun)
    built.warnings.push({ code: 'OUT_DIR_CREATE', message: `Would create the output folder ${outDir}` })

  const expanded = await expandInputs(args.positionals, {
    cwd: io.cwd,
    recursive: args.values.recursive === true,
    accepts: (f) => acceptsKind(id, f),
    fileInfo: deps.fileInfo,
    readStdin: io.readStdin
  })
  const files = expanded.files.map((p) => deps.fileInfo(p))
  reporter.emit({ event: 'run', command: cmd.path.join(' '), version: VERSION, dryRun: args.dryRun, inputs: files.length, options: built.options })

  const readiness: Readiness = files.length ? await deps.readiness(id, built.options) : { ok: true }
  const plan = planAny(id, files, built, { outDir, hasRar: deps.hasRar(), readiness })
  const warnings: Warning[] = [...built.warnings, ...plan.warnings]
  for (const w of warnings) reporter.emit({ event: 'warning', ...w })

  const totals: RunTotals = { ok: 0, failed: 0, skipped: 0, canceled: 0, inBytes: 0, outBytes: 0 }
  for (const s of expanded.skipped) {
    reporter.emit({ event: 'skipped', input: s.path, code: s.code, message: s.message })
    totals.skipped++
  }
  for (const i of expanded.issues) {
    reporter.emit({ event: 'error', input: i.arg, code: i.code, message: i.message })
    totals.failed++
  }
  const summary = (exitCode: number): number => {
    reporter.emit({ event: 'summary', ...totals, ms: clock() - t0, exitCode })
    return exitCode
  }

  if (plan.runError || plan.jobs.length === 0) {
    for (const j of plan.jobs) totals[emitNotReady(j, reporter)]++
    const err =
      plan.runError ??
      (expanded.issues.length
        ? new CliError(expanded.issues[0].code, 'Nothing to run: no input was found.')
        : new CliError('USAGE', `Nothing to run: no input is a file filesmith ${cmd.path.join(' ')} can take.`))
    reporter.emit({ event: 'error', code: err.code, message: err.message, hint: err.hint })
    return summary(EXIT.USAGE)
  }

  if (args.dryRun) {
    for (const j of plan.jobs) {
      if (j.state === 'skip') {
        totals[emitNotReady(j, reporter)]++
        continue
      }
      reporter.emit({
        event: 'plan',
        id: j.id,
        input: j.inputs ?? j.input,
        inSize: j.inSize,
        op: j.op,
        output: j.output?.path,
        outputKind: j.output?.kind,
        ready: j.state === 'ready',
        code: j.code,
        message: j.message,
        hint: j.hint
      })
      if (j.state === 'ready') totals.ok++
      else totals.failed++
    }
    return summary(totals.failed ? EXIT.FAILED : EXIT.OK)
  }

  if (outDir && outState === 'missing') {
    try {
      deps.mkdirp(outDir)
    } catch (e) {
      throw new CliError('OUT_DIR_MISSING', `Could not create the output folder ${outDir}: ${(e as Error).message}`)
    }
  }
  const run = await runPlanned(plan.jobs, reporter, { queue: deps.queue, clock, statOutput: deps.statOutput }, io.signal)
  for (const k of Object.keys(totals) as (keyof RunTotals)[]) totals[k] += run[k]
  return summary(reduceExit(totals))
}
```

`src/cli/main.ts`:

```ts
import type { CommandSpec } from './catalog'
import { findCommand } from './catalog'
import { runFileCommand, type FileCommandDeps } from './commands/files'
import { JsonReporter, type Reporter } from './events'
import { CliError, EXIT, UsageError } from './exit'
import { renderGroupHelp, renderHelp, renderRootHelp, usageLine } from './help'
import { HumanReporter } from './human'
import type { CliIO } from './io'
import { detectJson, parseArgv, type ParsedArgs } from './parse'
import { VERSION } from './version'

export interface CliDeps {
  clock: () => number
  files: FileCommandDeps
}

async function dispatch(args: ParsedArgs, io: CliIO, reporter: Reporter, deps: CliDeps): Promise<number> {
  const cmd = args.command as CommandSpec
  switch (cmd.id) {
    default:
      return runFileCommand(args, io, reporter, deps.files, deps.clock)
  }
}

function failure(e: unknown, io: CliIO, reporter: Reporter, json: boolean): number {
  if (e instanceof CliError) {
    reporter.emit({ event: 'error', code: e.code, message: e.message, hint: e.hint })
    if (e instanceof UsageError && !json) {
      const cmd = findCommand(e.commandPath)
      const where = e.commandPath.length ? `${e.commandPath.join(' ')} ` : ''
      io.stderr.write(`${cmd ? usageLine(cmd) : 'Usage: filesmith <command> [options]'}\nRun 'filesmith ${where}--help' for details.\n`)
    }
    if (json)
      reporter.emit({ event: 'summary', ok: 0, failed: 0, skipped: 0, canceled: 0, inBytes: 0, outBytes: 0, ms: 0, exitCode: EXIT.USAGE })
    return EXIT.USAGE
  }
  reporter.emit({ event: 'error', code: 'INTERNAL', message: e instanceof Error ? e.message : String(e) })
  io.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
  return EXIT.FAILED
}

/** The whole CLI as a function of its I/O (spec 4.3). */
export async function main(io: CliIO, deps: CliDeps): Promise<number> {
  const json = detectJson(io.argv)
  const reporter: Reporter = json
    ? new JsonReporter(io.stdout)
    : new HumanReporter(io.stdout, io.stderr, { color: io.stdoutTTY && !io.env.NO_COLOR, stderrTTY: io.stderrTTY })
  try {
    const args = parseArgv(io.argv)
    if (args.kind === 'version') {
      reporter.emit({ event: 'version', version: VERSION })
      return EXIT.OK
    }
    if (args.kind === 'help') {
      io.stdout.write(args.command ? renderHelp(args.command) : args.group ? renderGroupHelp(args.group) : renderRootHelp())
      return EXIT.OK
    }
    return await dispatch(args, io, reporter, deps)
  } catch (e) {
    return failure(e, io, reporter, json)
  } finally {
    reporter.close()
  }
}
```

`src/cli/deps.ts`:

```ts
import { mkdirSync } from 'fs'
import { basename, extname, resolve } from 'path'
import { JobQueue } from '../main/jobQueue'
import { fileInfoFromPath } from '../main/fileInfo'
import { resolveRar } from '../main/toolResolver'
import { usableComfyModels } from '../main/comfy/store'
import { defaultReadinessDeps, removebgReadiness, upscaleReadiness } from '../main/tools/readiness'
import type { FileCommandDeps } from './commands/files'
import { UsageError } from './exit'
import { pathState } from './inputs'
import type { CliDeps } from './main'
import { statOutput } from './runner'

/** comfy:<model file name, stem or path> -> comfy:<absolute path> (spec 3.4). */
export function resolveUpscaleModel(value: string): string {
  if (!value.startsWith('comfy:')) return value
  const want = value.slice('comfy:'.length)
  const models = usableComfyModels()
  const lower = want.toLowerCase()
  const hit =
    models.find((m) => m.path.toLowerCase() === resolve(want).toLowerCase()) ??
    models.find((m) => basename(m.path).toLowerCase() === lower || basename(m.path, extname(m.path)).toLowerCase() === lower)
  if (!hit)
    throw new UsageError(
      `No scanned ComfyUI upscaler matches "${want}". See: filesmith formats upscale`,
      ['upscale'],
      models.length ? 'filesmith formats upscale' : 'filesmith setup spandrel --comfy "<ComfyUI folder>"'
    )
  return `comfy:${hit.path}`
}

export function defaultFileDeps(): FileCommandDeps {
  return {
    // allowDownload false: a job that would fetch a model or runtime fails with
    // "Run: filesmith setup <tool>" instead (spec M5).
    queue: (emit) => new JobQueue(emit, undefined, { allowDownload: false }),
    hasRar: () => resolveRar() != null,
    readiness: async (id, options) =>
      id === 'upscale'
        ? upscaleReadiness(options, defaultReadinessDeps)
        : id === 'removebg'
          ? removebgReadiness(options, defaultReadinessDeps)
          : { ok: true },
    resolveUpscaleModel,
    fileInfo: fileInfoFromPath,
    statOutput,
    pathState,
    mkdirp: (p) => {
      mkdirSync(p, { recursive: true })
    }
  }
}

export function defaultDeps(): CliDeps {
  return { clock: Date.now, files: defaultFileDeps() }
}
```

`src/cli/bootstrap.ts` (replaces the Task 1 probe):

```ts
import { homedir } from 'os'
import { setEngineEnv } from '../main/env'
import { bootEngine } from '../main/boot'
import { pidSidecar } from '../main/pid/sidecar'
import { spandrelSidecar } from '../main/comfy/sidecar'
import { stopComfyServer } from '../main/generate'
import { cliEngineEnv } from './env'
import type { Out } from './events'
import { defaultDeps } from './deps'
import { main } from './main'

// The process entry (spec 4.1): the only file that touches `process`. Runs as
// plain Node under ELECTRON_RUN_AS_NODE, so src/main/index.ts (and with it the
// single-instance lock) never loads.
setEngineEnv(
  cliEngineEnv(
    {
      execPath: process.execPath,
      resourcesPath: process.resourcesPath,
      env: process.env,
      homedir: homedir(),
      moduleDir: __dirname
    },
    (url, init) => fetch(url, init)
  )
)
bootEngine()
// The shims set ELECTRON_RUN_AS_NODE for this process only. Children (ffmpeg,
// uv, python, ComfyUI, soffice) inherit process.env through run(), and an
// Electron-based program started from here must not silently run as Node.
delete process.env.ELECTRON_RUN_AS_NODE

const ctrl = new AbortController()
let interrupts = 0
const interrupt = (): void => {
  interrupts += 1
  if (interrupts > 1) process.exit(130) // a second Ctrl+C leaves at once
  ctrl.abort()
}
process.on('SIGINT', interrupt)
process.on('SIGBREAK', interrupt)

// `filesmith ... --json | head -1`: the reader went away. Treat it as Ctrl+C:
// cancel the jobs, stop writing, exit 130, no stack trace.
let stdoutClosed = false
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EPIPE') throw e
  stdoutClosed = true
  ctrl.abort()
})
const stdout: Out = { write: (s) => void (stdoutClosed || process.stdout.write(s)) }
const stderr: Out = { write: (s) => void process.stderr.write(s) }

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (d) => (text += d))
    process.stdin.on('end', () => resolve(text))
    process.stdin.on('error', reject)
  })
}

function stopEverything(): void {
  for (const stop of [() => pidSidecar.stop(), () => spandrelSidecar.stop(), () => stopComfyServer()])
    try {
      stop()
    } catch {
      /* best effort */
    }
}

main(
  {
    argv: process.argv.slice(2),
    stdout,
    stderr,
    stdoutTTY: process.stdout.isTTY === true,
    stderrTTY: process.stderr.isTTY === true,
    env: process.env,
    cwd: process.cwd(),
    readStdin,
    signal: ctrl.signal
  },
  defaultDeps()
)
  .then((code) => {
    process.exitCode = stdoutClosed ? 130 : code
  })
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    stopEverything()
    // Leave even if a stray handle (a child's pipe) would keep Node alive.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1500).unref()
  })
```

- [ ] **Step 5: Run the unit tests**

Run: `npx vitest run test/cli-runner.test.ts test/cli-main.test.ts test/cli-graph.test.ts`
Expected: PASS. If `cli-graph` lists `electron`, print `files` and follow the chain to the module that still imports it; fix it the Task 2 way (read from `env.ts`).

- [ ] **Step 6: Write the process-level tests**

`e2e/cli.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { execFileSync, spawn, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { MAGICK, ROOT, magickEnv } from './helpers'

// The CLI as a real process (spec 8.2): `node out/main/cli.js` against the
// repo's bundled tools, with an isolated userData. Run `npm run build` first.
const CLI = join(ROOT, 'out', 'main', 'cli.js')
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string }).version

test.skip(!existsSync(CLI), 'run `npm run build` first')
test.skip(!existsSync(MAGICK), 'bundled tools missing (npm run binaries)')

let work: string
test.beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'fs-cli-'))
})
test.afterEach(() => rmSync(work, { recursive: true, force: true }))

type Ev = Record<string, unknown> & { event: string }
function cli(args: string[], opts: { input?: string } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: work,
    input: opts.input ?? '',
    encoding: 'utf-8',
    env: { ...process.env, FILESMITH_USER_DATA: join(work, '.ud'), NO_COLOR: '1' },
    timeout: 120_000
  })
  const events = r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Ev)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, events }
}
const image = (name: string, size = '64x48'): string => {
  const p = join(work, name)
  mkdirSync(dirname(p), { recursive: true })
  execFileSync(MAGICK, ['-size', size, 'xc:red', p], { env: magickEnv })
  return p
}
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
const of = (events: Ev[], name: string): Ev[] => events.filter((e) => e.event === name)

test('png to webp with --json: pure NDJSON, output next to the source', () => {
  image('a.png')
  const r = cli(['convert', 'a.png', '--to', 'webp', '--json'])
  expect(r.code).toBe(0)
  expect(r.stderr).toBe('')
  expect(r.events.every((e) => e.v === 1 && typeof e.ts === 'string')).toBe(true)
  expect(r.events[0]).toMatchObject({ event: 'run', command: 'convert', version: VERSION })
  const done = of(r.events, 'done')[0]
  expect(done).toMatchObject({ input: join(work, 'a.png'), output: join(work, 'a.webp'), outputKind: 'file' })
  expect(done.outSize as number).toBeGreaterThan(0)
  expect(r.events.at(-1)).toMatchObject({ event: 'summary', ok: 1, exitCode: 0 })
})

test('never overwrites: a second run picks the tagged name, the first output is untouched', () => {
  image('a.png')
  cli(['convert', 'a.png', '--to', 'webp'])
  const first = sha(join(work, 'a.webp'))
  const r = cli(['convert', 'a.png', '--to', 'webp', '--json'])
  expect(of(r.events, 'done')[0].output).toBe(join(work, 'a (converted).webp'))
  expect(sha(join(work, 'a.webp'))).toBe(first)
})

test('a dry run writes nothing and predicts the real names, including a shared stem', () => {
  image('photo.png')
  image('photo.jpg')
  const before = readdirSync(work).sort()
  const dry = cli(['convert', 'photo.png', 'photo.jpg', '--to', 'webp', '--dry-run', '--json'])
  expect(readdirSync(work).sort()).toEqual(before)
  const planned = of(dry.events, 'plan').map((e) => e.output as string)
  expect(planned).toEqual([join(work, 'photo.webp'), join(work, 'photo (converted).webp')])
  const real = cli(['convert', 'photo.png', 'photo.jpg', '--to', 'webp', '--json'])
  // Same SET of names; which input gets the untagged one depends on which
  // parallel job reserves first (spec 2.4), so the id mapping is not compared.
  expect(of(real.events, 'done').map((e) => e.output as string).sort()).toEqual([...planned].sort())
})

test('a bad flag is exit 2 and writes nothing', () => {
  image('a.png')
  const r = cli(['convert', 'a.png', '--to', 'webp', '--bogus'])
  expect(r.code).toBe(2)
  expect(r.stderr).toContain('Unknown option --bogus')
  expect(existsSync(join(work, 'a.webp'))).toBe(false)
})

test('one corrupt input among good ones: exit 1, one error, the rest done', () => {
  image('good.png')
  writeFileSync(join(work, 'bad.png'), 'not an image')
  const r = cli(['convert', 'good.png', 'bad.png', '--to', 'webp', '--json'])
  expect(r.code).toBe(1)
  expect(of(r.events, 'error').map((e) => e.input)).toEqual([join(work, 'bad.png')])
  expect(of(r.events, 'done')).toHaveLength(1)
})

test('compress and resize produce real files', () => {
  image('a.jpg', '200x100')
  image('b.png', '64x48')
  expect(cli(['compress', 'a.jpg', '--quality', '50']).code).toBe(0)
  const r = cli(['resize', 'b.png', '--percent', '50', '--json'])
  const out = of(r.events, 'done')[0].output as string
  expect(execFileSync(MAGICK, ['identify', '-format', '%wx%h', out], { env: magickEnv }).toString()).toBe('32x24')
})

test('--out: a missing folder is created; a file is exit 2 OUT_DIR_MISSING', () => {
  image('a.png')
  expect(cli(['convert', 'a.png', '--to', 'webp', '-o', 'out\\deep']).code).toBe(0)
  expect(existsSync(join(work, 'out', 'deep', 'a.webp'))).toBe(true)
  writeFileSync(join(work, 'afile'), 'x')
  const r = cli(['convert', 'a.png', '--to', 'webp', '--out', 'afile', '--json'])
  expect(r.code).toBe(2)
  expect(of(r.events, 'error')[0]).toMatchObject({ code: 'OUT_DIR_MISSING' })
})

test('folder, --recursive and stdin inputs', () => {
  image('pics\\a.png')
  image('pics\\sub\\b.png')
  writeFileSync(join(work, 'pics', 'notes.txt'), 'x')
  const flat = cli(['resize', 'pics', '--percent', '50', '--dry-run', '--json'])
  expect(of(flat.events, 'plan')).toHaveLength(1)
  expect(of(flat.events, 'skipped')[0]).toMatchObject({ code: 'UNSUPPORTED_KIND' })
  expect(of(cli(['resize', 'pics', '--recursive', '--percent', '50', '--dry-run', '--json']).events, 'plan')).toHaveLength(2)
  const piped = cli(['resize', '-', '--percent', '50', '--dry-run', '--json'], { input: 'pics\\a.png\npics\\sub\\b.png\n' })
  expect(of(piped.events, 'plan')).toHaveLength(2)
})

test('removebg without setup: exit 2 SETUP_REQUIRED with the exact command, nothing downloaded', () => {
  image('a.png')
  const r = cli(['removebg', 'a.png', '--json'])
  expect(r.code).toBe(2)
  expect(of(r.events, 'error')[0]).toMatchObject({ code: 'SETUP_REQUIRED', hint: 'filesmith setup removebg' })
  expect(existsSync(join(work, '.ud', 'models', 'rembg'))).toBe(false)
})

test('runs under Electron in Node mode (the installed runtime)', () => {
  const r = spawnSync(ELECTRON, [CLI, '--version'], {
    encoding: 'utf-8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  expect(r.stdout.trim()).toBe(VERSION)
})

test('the built CLI and every chunk it loads never require electron', () => {
  const seen = new Set<string>()
  const walk = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    const src = readFileSync(file, 'utf-8')
    expect(src, file).not.toMatch(/require\(["']electron["']\)/)
    for (const m of src.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) walk(join(dirname(file), m[1]))
  }
  walk(CLI)
  expect(seen.size).toBeGreaterThan(1)
})

test('a closed stdout cancels the run and exits 130 without a stack trace', async () => {
  for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) image(`${n}.png`, '1600x1200')
  const child = spawn(process.execPath, [CLI, 'upscale', '.', '--factor', '2', '--json'], {
    cwd: work,
    env: { ...process.env, FILESMITH_USER_DATA: join(work, '.ud') }
  })
  let err = ''
  child.stderr.on('data', (d) => (err += d))
  await new Promise<void>((res) => child.stdout.once('data', () => res()))
  child.stdout.destroy()
  const code = await new Promise<number | null>((res) => child.on('exit', res))
  expect(code).toBe(130)
  expect(err).not.toMatch(/at .*\.js:\d+/)
})

test('works while the app is open, and its jobs never reach the app', async () => {
  const ud = join(work, '.ud')
  const app = await _electron.launch({ args: [ROOT], env: { ...process.env, FILESMITH_USER_DATA: ud } })
  try {
    const page = await app.firstWindow()
    image('cliprobe.png')
    const r = cli(['convert', 'cliprobe.png', '--to', 'webp', '--json'])
    expect(r.code).toBe(0)
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('cliprobe')
    expect(app.windows()).toHaveLength(1)
  } finally {
    await app.close()
  }
})
```

- [ ] **Step 7: Build and run the process-level tests**

Run: `npm run build && npx playwright test e2e/cli.spec.ts`
Expected: PASS (13 tests). The `closed stdout` test relies on Real-ESRGAN running on this machine's GPU; if it reports `TOOL_FAILED` (no Vulkan) the first event still arrives and the cancel path is what is tested.

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm run lint && npx prettier --write src/cli test e2e && npm test
git add src/cli test/cli-runner.test.ts test/cli-main.test.ts test/cli-graph.test.ts e2e/cli.spec.ts
git commit -m "feat(cli): run file verbs end to end with events, exit codes and clean cancel" -m "convert, compress, resize, upscale and removebg run on a JobQueue in the CLI process with allowDownload false. Ctrl+C and a closed stdout cancel running and queued jobs and exit 130." -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: PDF tools (`filesmith pdf <tool>`)

**Files:**
- Create: `src/cli/planPdf.ts`, `test/cli-plan-pdf.test.ts`
- Modify: `src/cli/commands/files.ts` (`planAny` dispatch), `e2e/cli.spec.ts` (PDF cases)

**Interfaces:**
- Consumes: `planJobs`, `PlanEnv`, `PlanResult`, `PlannedJob` (Task 10); `planOutput` (Task 3); `UsageError` (Task 6).
- Produces: `planPdfJobs(id: CommandId, files: FileInfo[], built: BuiltOptions, env: PlanEnv): PlanResult`. `pdf merge` is ONE job (`id` `"1"`, `input` the first file, `inputs` all of them in argument order, `options.mergeInputs` the same list); every other pdf tool is one job per file (through `planJobs`).

- [ ] **Step 1: Write the failing test**

`test/cli-plan-pdf.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planPdfJobs } from '../src/cli/planPdf'
import { UsageError } from '../src/cli/exit'
import { fileKind } from '@shared/fileKind'
import type { FileInfo, JobOptions } from '@shared/types'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-pdfplan-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = (name: string, size = 10): FileInfo => {
  writeFileSync(join(dir, name), 'x')
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return { path: join(dir, name), name, ext, kind: fileKind(ext), size }
}
const built = (options: JobOptions) => ({ options, warnings: [], explicit: new Set<string>() })
const env = { hasRar: true, readiness: { ok: true as const } }

describe('planPdfJobs', () => {
  it('merge is one job in argument order next to the first input', () => {
    const files = [file('cover.pdf', 5), file('body.pdf', 7)]
    const r = planPdfJobs('pdf merge', files, built({ op: 'merge' }), env)
    expect(r.jobs).toHaveLength(1)
    expect(r.jobs[0]).toMatchObject({
      id: '1',
      input: join(dir, 'cover.pdf'),
      inputs: [join(dir, 'cover.pdf'), join(dir, 'body.pdf')],
      inSize: 12,
      tool: 'pdf',
      op: 'pdf/merge',
      state: 'ready',
      output: { path: join(dir, 'cover (merged).pdf'), kind: 'file' }
    })
    expect(r.jobs[0].options.mergeInputs).toEqual([join(dir, 'cover.pdf'), join(dir, 'body.pdf')])
  })

  it('merge needs two or more PDFs and nothing else', () => {
    expect(() => planPdfJobs('pdf merge', [file('a.pdf')], built({ op: 'merge' }), env)).toThrow(/at least two PDFs/)
    expect(() => planPdfJobs('pdf merge', [file('a.pdf'), file('b.docx')], built({ op: 'merge' }), env)).toThrow(UsageError)
  })

  it('other tools plan one job per PDF, folders for folder outputs', () => {
    const r = planPdfJobs('pdf burst', [file('a.pdf'), file('b.png')], built({ op: 'split-pages' }), env)
    expect(r.jobs.map((j) => [j.state, j.op])).toEqual([
      ['ready', 'pdf/split-pages'],
      ['error', 'pdf']
    ])
    expect(r.jobs[0].output).toEqual({ path: join(dir, 'a (split)'), kind: 'dir' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/cli-plan-pdf.test.ts`
Expected: FAIL, unresolved `../src/cli/planPdf`.

- [ ] **Step 3: Implement**

`src/cli/planPdf.ts`:

```ts
import { basename } from 'path'
import type { FileInfo, JobOptions } from '@shared/types'
import { planOutput } from '../main/tools/plan'
import type { CommandId } from './catalog'
import { UsageError } from './exit'
import type { BuiltOptions } from './options'
import { planJobs, type PlanEnv, type PlanResult, type PlannedJob } from './plan'

/** `filesmith pdf <tool>` (spec 3.7). Merge is one job over every input in
 * argument order; the rest are one job per file. */
export function planPdfJobs(id: CommandId, files: FileInfo[], built: BuiltOptions, env: PlanEnv): PlanResult {
  if (id !== 'pdf merge') return planJobs(id, files, built, env)
  const others = files.filter((f) => f.kind !== 'pdf')
  if (others.length)
    throw new UsageError(`pdf merge takes only PDFs: ${others.map((f) => basename(f.path)).join(', ')}.`, ['pdf', 'merge'])
  if (files.length < 2) throw new UsageError('pdf merge needs at least two PDFs.', ['pdf', 'merge'])
  const paths = files.map((f) => f.path)
  const options: JobOptions = { op: 'merge', mergeInputs: paths, ...(env.outDir ? { outDir: env.outDir } : {}) }
  const job: PlannedJob = {
    id: '1',
    input: paths[0],
    inputs: paths,
    inSize: files.reduce((a, f) => a + f.size, 0),
    tool: 'pdf',
    op: 'pdf/merge',
    options,
    output: planOutput('pdf', files[0], options, env.outDir, new Set()),
    state: 'ready'
  }
  return { jobs: [job], warnings: [] }
}
```

In `src/cli/commands/files.ts`, import `planPdfJobs` from `../planPdf` and change `planAny` to:

```ts
function planAny(id: CommandId, files: FileInfo[], built: ReturnType<typeof buildOptions>, env: PlanEnv): PlanResult {
  return id.startsWith('pdf ') && id !== 'pdf compress'
    ? planPdfJobs(id, files, built, env)
    : planJobs(id, files, built, env)
}
```

- [ ] **Step 4: Add the PDF process-level tests**

Append to `e2e/cli.spec.ts` (and add `MUTOOL` to the `./helpers` import):

```ts
const pdfOf = (name: string, ...pages: string[]): string => {
  const imgs = pages.map((size, i) => image(`${name}-p${i}.png`, size))
  const p = join(work, name)
  execFileSync(MAGICK, [...imgs, p], { env: magickEnv })
  return p
}
const pageWidths = (pdf: string): number[] =>
  [...execFileSync(MUTOOL, ['pages', pdf]).toString().matchAll(/MediaBox[^\d]*[\d.]+\s+[\d.]+\s+([\d.]+)/g)].map((m) =>
    Math.round(Number(m[1]))
  )

test('pdf merge keeps argument order; split keeps the listed pages; burst makes a folder', () => {
  pdfOf('a.pdf', '100x100')
  pdfOf('b.pdf', '200x100', '300x100', '400x100')
  const merged = cli(['pdf', 'merge', 'b.pdf', 'a.pdf', '--json'])
  expect(merged.code).toBe(0)
  const out = of(merged.events, 'done')[0].output as string
  expect(out).toBe(join(work, 'b (merged).pdf'))
  expect(pageWidths(out)).toEqual([200, 300, 400, 100])

  const split = cli(['pdf', 'split', 'b.pdf', '--pages', '2-3', '--json'])
  expect(pageWidths(of(split.events, 'done')[0].output as string)).toEqual([300, 400])

  const burst = cli(['pdf', 'burst', 'b.pdf', '--json'])
  expect(of(burst.events, 'done')[0]).toMatchObject({ output: join(work, 'b (split)'), outputKind: 'dir', files: 3 })
})

test('pdf tools reject non-PDF inputs; pdf compress is compress', () => {
  image('x.png')
  const bad = cli(['pdf', 'extract-text', 'x.png', '--json'])
  expect(bad.code).toBe(2)
  expect(of(bad.events, 'error')[0]).toMatchObject({ code: 'UNSUPPORTED_KIND' })
  pdfOf('c.pdf', '100x100')
  const c = cli(['pdf', 'compress', 'c.pdf', '--level', 'lossless', '--json'])
  expect(c.code).toBe(0)
  expect(of(c.events, 'done')[0].output).toBe(join(work, 'c (compressed).pdf'))
})
```

If `mutool pages` prints the MediaBox in a different shape on this mutool build, print its output once and adjust the regex to read the third number of each page's MediaBox; keep the assertion on widths.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/cli-plan-pdf.test.ts && npm run build && npx playwright test e2e/cli.spec.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run lint && npx prettier --write src/cli test e2e && npm test
git add src/cli test/cli-plan-pdf.test.ts e2e/cli.spec.ts
git commit -m "feat(cli): pdf merge, split, burst, extract-text, to-images, extract-images, compress" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: `filesmith generate` (M3)

**Files:**
- Create: `src/cli/commands/generate.ts`, `test/cli-generate.test.ts`
- Modify: `src/shared/generate.ts` (`GenerateOptions.outDir`), `src/main/generate/index.ts:30-39,119-120` (export `slug`, `generatedOutputDir`), `src/cli/main.ts` (dispatch + `CliDeps.generate`), `src/cli/deps.ts` (`defaultGenerateDeps`)

**Interfaces:**
- Consumes: `buildGenerateFlags`, `GenerateFlags` (Task 8); `planFileInDir` (Task 3); `classifyError` (Task 11); `generateImages`, `scanGenerationModels`, `registryArchInfo`, `registryDimCaps`, `comfyGenerationAvailable`, `stopComfyServer` (existing, `src/main/generate/index.ts`); `clampDim` (`@shared/generate`); `archInfoFor` (`@shared/genArch`).
- Produces:
  - `GenerateOptions.outDir?: string` (the app omits it and keeps Downloads).
  - `generate/index.ts`: `slug(prompt: string): string`, `generatedOutputDir(opts: GenerateOptions): string`.
  - `commands/generate.ts`: `interface GenerateDeps { scan(): { models: GenModel[] }; archInfo(): Record<string, ArchInfo>; dimCaps(): Record<string, DimCaps>; available(): Promise<boolean>; generate(opts: GenerateOptions, onImage: (i: number, path: string) => void, onProgress: (i: number, pct: number) => void, onStatus: (m: string) => void, signal: AbortSignal): Promise<void>; stop(): void; pathState(p: string): PathState; mkdirp(p: string): void; outSize(p: string): number | undefined }`, `isRestoreName(label: string): boolean`, `pickModel(models: GenModel[], wanted?: string): GenModel | undefined`, `runGenerate(args: ParsedArgs, io: CliIO, reporter: Reporter, deps: GenerateDeps, clock: () => number): Promise<number>`.
  - `CliDeps.generate: GenerateDeps`; `defaultGenerateDeps(): GenerateDeps`.

- [ ] **Step 1: Write the failing test**

`test/cli-generate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { isRestoreName as rendererIsRestore } from '../src/renderer/src/components/options/generate/restore'
import { isRestoreName, pickModel, runGenerate, type GenerateDeps } from '../src/cli/commands/generate'
import { parseArgv } from '../src/cli/parse'
import type { EventBody, Reporter } from '../src/cli/events'
import type { CliIO } from '../src/cli/io'
import type { GenModel } from '@shared/genArch'
import { engineEnv } from '../src/main/env'
import { generatedOutputDir } from '../src/main/generate'

const model = (over: Partial<GenModel>): GenModel => ({
  name: 'checkpoints/sdxl.safetensors',
  label: 'sdxl',
  arch: 'sdxl',
  source: 'checkpoint',
  group: 'Checkpoints',
  runnable: true,
  ...over
})

function setup(argv: string[], over: Partial<GenerateDeps> = {}, ctrl = new AbortController()) {
  const events: EventBody[] = []
  const reporter: Reporter = { emit: (e) => events.push(e), text: () => {}, close: () => {} }
  const io = { cwd: 'C:\\proj', signal: ctrl.signal } as CliIO
  const calls: unknown[] = []
  const deps: GenerateDeps = {
    scan: () => ({ models: [model({ label: 'SUPIR-v0Q', name: 'checkpoints/SUPIR-v0Q.safetensors' }), model({})] }),
    archInfo: () => ({}),
    dimCaps: () => ({ sdxl: { minDim: 512, maxDim: 1536, dimStep: 64 } }),
    available: async () => true,
    generate: async (opts, onImage, onProgress) => {
      calls.push(opts)
      for (let i = 0; i < opts.count; i++) {
        onProgress(i, 50)
        onImage(i, join(opts.outDir as string, `img-${i}.png`))
      }
    },
    stop: () => calls.push('stop'),
    pathState: () => 'dir',
    mkdirp: () => {},
    outSize: () => 1000,
    ...over
  }
  return { run: () => runGenerate(parseArgv(argv), io, reporter, deps, () => 0), events, calls }
}

describe('generate', () => {
  it('auto-picks the first runnable non-restoration model, like the app', () => {
    expect(pickModel([model({ label: 'refiner' }), model({ label: 'juggernaut' })])?.label).toBe('juggernaut')
    for (const l of ['SUPIR-v0Q', 'sdxl_refiner', 'inpaint-x', 'my-upscaler', 'controlnet', 'juggernaut'])
      expect(isRestoreName(l), l).toBe(rendererIsRestore(l))
  })

  it('runs with arch defaults, clamps the size with a warning, writes to the current folder', async () => {
    const s = setup(['generate', 'a red kettle', '--count', '2', '--size', '2048x2048', '--json'])
    expect(await s.run()).toBe(0)
    const opts = s.calls[0] as Record<string, unknown>
    expect(opts).toMatchObject({ model: 'checkpoints/sdxl.safetensors', width: 1536, height: 1536, steps: 28, cfg: 7, outDir: 'C:\\proj', count: 2 })
    expect(s.events.map((e) => e.event)).toEqual(['run', 'warning', 'start', 'progress', 'done', 'start', 'progress', 'done', 'summary'])
    expect(s.calls.at(-1)).toBe('stop')
  })

  it('a dry run predicts one output per image and does not generate', async () => {
    const s = setup(['generate', 'A Red Kettle!', '--count', '2', '--dry-run'], {
      generate: async () => {
        throw new Error('must not run')
      }
    })
    expect(await s.run()).toBe(0)
    const plans = s.events.filter((e) => e.event === 'plan') as { output: string }[]
    expect(plans.map((p) => p.output)).toEqual([join('C:\\proj', 'a-red-kettle.png'), join('C:\\proj', 'a-red-kettle (generated).png')])
  })

  it('missing companions point at setup generate for that model', async () => {
    const s = setup(['generate', 'x', '--model', 'flux'], {
      scan: () => ({ models: [model({ label: 'flux', name: 'diffusion_models/flux.safetensors', runnable: false, missing: [{ label: 'T5', filename: 't5.safetensors', url: 'u', approxSize: '9 GB', subdir: 'text_encoders' }] })] })
    })
    await expect(s.run()).rejects.toMatchObject({ code: 'SETUP_REQUIRED', hint: 'filesmith setup generate --model "diffusion_models/flux.safetensors"' })
  })

  it('no ComfyUI and no models are setup errors', async () => {
    await expect(setup(['generate', 'x'], { scan: () => ({ models: [] }) }).run()).rejects.toMatchObject({ code: 'SETUP_REQUIRED' })
    await expect(setup(['generate', 'x'], { available: async () => false }).run()).rejects.toMatchObject({ code: 'SETUP_REQUIRED' })
  })

  it('Ctrl+C cancels the images not yet made', async () => {
    const ctrl = new AbortController()
    const s = setup(['generate', 'x', '--count', '3'], {
      generate: async (opts, onImage) => {
        onImage(0, join(opts.outDir as string, 'one.png'))
        ctrl.abort()
        throw new Error('Generation cancelled')
      }
    }, ctrl)
    expect(await s.run()).toBe(130)
    expect(s.events.filter((e) => e.event === 'canceled')).toHaveLength(2)
  })

  it('the app keeps Downloads when no outDir is given (M3)', () => {
    expect(generatedOutputDir({ outDir: 'D:\\x' } as never)).toBe('D:\\x')
    expect(generatedOutputDir({} as never)).toBe(engineEnv().downloadsDir)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/cli-generate.test.ts`
Expected: FAIL, unresolved `../src/cli/commands/generate`.

- [ ] **Step 3: Implement the engine change (M3)**

`src/shared/generate.ts`, add to `GenerateOptions`:

```ts
  /** Output folder. The app leaves it unset (Downloads); the CLI passes --out
   * or the current folder. */
  outDir?: string
```

`src/main/generate/index.ts`: make `slug` exported (`export function slug`), add below it

```ts
/** Where generated images go: the caller's folder, else Downloads (the app). */
export function generatedOutputDir(opts: GenerateOptions): string {
  return opts.outDir ?? engineEnv().downloadsDir
}
```

and replace the two output lines in the loop with

```ts
      const out = reserveFileInDir(generatedOutputDir(opts), slug(opts.prompt), '.png', 'generated')
```

(import `reserveFileInDir` instead of `reserveOutPath` from `../output`; drop the now-unused `join` import if nothing else uses it).

- [ ] **Step 4: Implement the command**

`src/cli/commands/generate.ts`:

```ts
import { basename } from 'path'
import type { GenerateOptions, DimCaps } from '@shared/generate'
import { clampDim } from '@shared/generate'
import { archInfoFor, type ArchInfo, type GenModel } from '@shared/genArch'
import { planFileInDir } from '../../main/output'
import { slug } from '../../main/generate'
import type { CommandSpec } from '../catalog'
import type { Reporter } from '../events'
import { CliError, EXIT, UsageError, reduceExit } from '../exit'
import type { CliIO } from '../io'
import { buildGenerateFlags, type PathState } from '../options'
import type { ParsedArgs } from '../parse'
import { classifyError } from '../runner'
import { VERSION } from '../version'

export interface GenerateDeps {
  scan(): { models: GenModel[] }
  archInfo(): Record<string, ArchInfo>
  dimCaps(): Record<string, DimCaps>
  available(): Promise<boolean>
  generate(
    opts: GenerateOptions,
    onImage: (i: number, path: string) => void,
    onProgress: (i: number, pct: number) => void,
    onStatus: (m: string) => void,
    signal: AbortSignal
  ): Promise<void>
  /** Stops only a ComfyUI this process launched. */
  stop(): void
  pathState(p: string): PathState
  mkdirp(p: string): void
  outSize(p: string): number | undefined
}

/** Same rule as the app's Generate panel (renderer generate/restore.ts): a
 * restoration/refiner checkpoint is never the default. Pinned by a test. */
export function isRestoreName(label: string): boolean {
  return /supir|refiner|inpaint|upscal|controlnet/i.test(label)
}

export function pickModel(models: GenModel[], wanted?: string): GenModel | undefined {
  if (wanted) {
    const w = wanted.toLowerCase()
    return models.find(
      (m) => m.name.toLowerCase() === w || m.label.toLowerCase() === w || basename(m.name).toLowerCase() === w
    )
  }
  return models.find((m) => m.runnable && !m.notImage && !isRestoreName(m.label))
}

const SETUP_COMFY = 'filesmith setup comfy --folder "<ComfyUI folder>"'

/** `filesmith generate "<prompt>"` (spec 3.6): one job per image. */
export async function runGenerate(
  args: ParsedArgs,
  io: CliIO,
  reporter: Reporter,
  deps: GenerateDeps,
  clock: () => number
): Promise<number> {
  const t0 = clock()
  const cmd = args.command as CommandSpec
  const flags = buildGenerateFlags(cmd, args.values, args.positionals, { cwd: io.cwd, pathState: deps.pathState })
  const outDir = flags.outDir ?? io.cwd
  const outState = deps.pathState(outDir)
  if (outState === 'file') throw new CliError('OUT_DIR_MISSING', `--out is a file, not a folder: ${outDir}`)

  const { models } = deps.scan()
  if (!models.length)
    throw new CliError('SETUP_REQUIRED', 'No image generation model was found in your ComfyUI folders.', SETUP_COMFY)
  const model = pickModel(models, flags.model)
  if (!model) {
    if (flags.model)
      throw new UsageError(`No generation model named "${flags.model}". See: filesmith formats generate`, cmd.path)
    throw new CliError('SETUP_REQUIRED', 'None of your generation models is ready to run.', 'filesmith formats generate')
  }
  if (!model.runnable) {
    if (model.missing?.length)
      throw new CliError(
        'SETUP_REQUIRED',
        `${model.label} needs files first: ${model.missing.map((m) => m.label).join(', ')}.`,
        `filesmith setup generate --model "${model.name}"`
      )
    if (!(flags.tryAnyway && model.tryAnyway))
      throw new CliError('USAGE', model.reason ?? `${model.label} is not ready to use.`, model.tryAnyway ? 'add --try-anyway' : undefined)
  }
  if (!(await deps.available())) throw new CliError('SETUP_REQUIRED', 'ComfyUI was not found and is not running.', SETUP_COMFY)

  const info = deps.archInfo()[model.arch] ?? archInfoFor(model.arch)
  const caps = deps.dimCaps()[model.arch]
  const width = clampDim(flags.width, caps)
  const height = clampDim(flags.height, caps)
  const opts: GenerateOptions = {
    model: model.name,
    prompt: flags.prompt,
    negative: flags.negative,
    style: flags.style,
    width,
    height,
    count: flags.count,
    steps: flags.steps ?? info.steps,
    cfg: flags.cfg ?? info.cfg,
    guidance: flags.guidance ?? info.guidance,
    seed: flags.seed,
    tryAnyway: flags.tryAnyway,
    outDir
  }
  const op = `generate/${model.arch}`
  reporter.emit({ event: 'run', command: 'generate', version: VERSION, dryRun: args.dryRun, inputs: flags.count, options: { ...opts } })
  if (flags.sizeExplicit && (width !== flags.width || height !== flags.height))
    reporter.emit({ event: 'warning', code: 'SIZE_CLAMPED', message: `${model.label} supports ${width}x${height} here, not ${flags.width}x${flags.height}.` })
  if (flags.guidance !== undefined && !info.hasGuidance)
    reporter.emit({ event: 'warning', code: 'GUIDANCE_IGNORED', message: `--guidance has no effect on ${model.label}; use --cfg.` })
  if (outState === 'missing' && args.dryRun)
    reporter.emit({ event: 'warning', code: 'OUT_DIR_CREATE', message: `Would create the output folder ${outDir}` })

  const ids = Array.from({ length: flags.count }, (_, i) => String(i + 1))
  const totals = { ok: 0, failed: 0, skipped: 0, canceled: 0, inBytes: 0, outBytes: 0 }
  const summary = (exitCode: number): number => {
    reporter.emit({ event: 'summary', ...totals, ms: clock() - t0, exitCode })
    return exitCode
  }

  if (args.dryRun) {
    const claimed = new Set<string>()
    for (const id of ids)
      reporter.emit({
        event: 'plan',
        id,
        input: flags.prompt,
        inSize: 0,
        op,
        output: planFileInDir(outDir, slug(flags.prompt), '.png', 'generated', claimed),
        outputKind: 'file',
        ready: true
      })
    totals.ok = ids.length
    return summary(EXIT.OK)
  }

  if (outState === 'missing') deps.mkdirp(outDir)
  const startedAt = new Map<number, number>()
  let current = 0
  const start = (i: number): void => {
    if (startedAt.has(i)) return
    startedAt.set(i, clock())
    reporter.emit({ event: 'start', id: ids[i], input: flags.prompt, inSize: 0, op })
  }
  try {
    await deps.generate(
      opts,
      (i, path) => {
        start(i)
        const size = deps.outSize(path)
        totals.ok++
        totals.outBytes += size ?? 0
        reporter.emit({
          event: 'done',
          id: ids[i],
          input: flags.prompt,
          output: path,
          outputKind: 'file',
          inSize: 0,
          outSize: size,
          ms: clock() - (startedAt.get(i) ?? clock()),
          seed: opts.seed >= 0 ? opts.seed + i : undefined
        })
        current = i + 1
      },
      (i, pct) => {
        start(i)
        current = i
        reporter.emit({ event: 'progress', id: ids[i], pct })
      },
      (message) => {
        if (current >= ids.length) return
        start(current)
        reporter.emit({ event: 'progress', id: ids[current], pct: null, message })
      },
      io.signal
    )
  } catch (e) {
    const left = ids.slice(totals.ok)
    if (io.signal.aborted) {
      for (const id of left) {
        reporter.emit({ event: 'canceled', id, input: flags.prompt })
        totals.canceled++
      }
    } else {
      const message = e instanceof Error ? e.message : String(e)
      const c = classifyError(message)
      left.forEach((id, k) => {
        reporter.emit({
          event: 'error',
          id,
          input: flags.prompt,
          code: c.code,
          message: k === 0 ? message : 'Not generated: an earlier image failed.',
          hint: k === 0 ? c.hint : undefined
        })
        totals.failed++
      })
    }
  } finally {
    deps.stop()
  }
  return summary(reduceExit(totals))
}
```

`src/cli/main.ts`: import `runGenerate`, `GenerateDeps`; `CliDeps` gains `generate: GenerateDeps`; `dispatch` gains `case 'generate': return runGenerate(args, io, reporter, deps.generate, deps.clock)`.

`src/cli/deps.ts`: add

```ts
import { mkdirSync } from 'fs'
import {
  comfyGenerationAvailable,
  generateImages,
  registryArchInfo,
  registryDimCaps,
  scanGenerationModels,
  stopComfyServer
} from '../main/generate'
import type { GenerateDeps } from './commands/generate'

export function defaultGenerateDeps(): GenerateDeps {
  return {
    scan: () => scanGenerationModels(),
    archInfo: () => registryArchInfo(),
    dimCaps: () => registryDimCaps(),
    available: () => comfyGenerationAvailable(),
    generate: (opts, onImage, onProgress, onStatus, signal) =>
      generateImages(opts, onImage, onProgress, onStatus, signal),
    stop: () => stopComfyServer(),
    pathState,
    mkdirp: (p) => {
      mkdirSync(p, { recursive: true })
    },
    outSize: (p) => statOutput(p).outSize
  }
}
```

(merge the `mkdirSync` import with the existing one) and `defaultDeps()` returns `{ clock: Date.now, files: defaultFileDeps(), generate: defaultGenerateDeps() }`. In `test/cli-main.test.ts`, give the `deps` object a `generate` member built from the same fake shape as `test/cli-generate.test.ts` (any functions; those tests never dispatch to generate).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/cli-generate.test.ts test/cli-main.test.ts test/gen-registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Try it against this machine's ComfyUI**

Run: `npm run build && node out/main/cli.js generate "a lighthouse at dusk" --dry-run` then without `--dry-run`.
Expected: the dry run names `a-lighthouse-at-dusk.png` in the current folder; the real run writes it (or, on a machine without ComfyUI, exits 2 with `hint: filesmith setup comfy --folder "<ComfyUI folder>"`).

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npx prettier --write src test && npm test
git add src/shared/generate.ts src/main/generate/index.ts src/cli test/cli-generate.test.ts test/cli-main.test.ts
git commit -m "feat(cli): filesmith generate with an output folder (current folder by default)" -m "GenerateOptions gains outDir; the app leaves it unset and keeps Downloads." -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `filesmith setup <tool>`, the only command that downloads

**Files:**
- Create: `src/main/recycle.ts`, `src/cli/commands/setup.ts`, `test/recycle.test.ts`, `test/cli-setup.test.ts`
- Modify: `src/cli/main.ts` (dispatch + `CliDeps.setup`), `src/cli/deps.ts` (`defaultSetupDeps`)

**Interfaces:**
- Consumes: `installPid`, `installComfyEngine`, `InstallOpts`, `InstallProgress` (Task 4); `downloadCompanions` (Task 4); `setupRembg`, rembg paths (Task 5); `readLock`, `isStale` (Task 4); `run` with `env` (Task 5); `classifyError` (Task 11); `mergeComfyStore`, `scanComfy`, `clearComfyPythonCache`, `scanGenerationModels`, `listNcnnModels`, `userNcnnDir`, `detectNvidia`, `cudaTierSupport` (existing).
- Produces:
  - `recycle.ts`: `RECYCLE_LIMIT = { bytes: 5 GiB, files: 5000 }`, `folderStats(path: string): { bytes: number; files: number }`, `tooBigForRecycleBin(s: { bytes: number; files: number }): boolean`, `moveToRecycleBin(path: string): Promise<void>`, `freeBytesAt(path: string): number | null`.
  - `commands/setup.ts`: `interface SetupDeps` (below), `interface Timers { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }`, `class StepReporter { onProgress: InstallProgress; onBytes(got: number, total: number): void; stop(): void }`, `runSetup(args: ParsedArgs, cwd: string, reporter: Reporter, deps: SetupDeps, signal: AbortSignal, clock: () => number, timers?: Timers): Promise<number>`.
  - `CliDeps.setup: SetupDeps`; `defaultSetupDeps(): SetupDeps`.

`SetupDeps`:

```ts
export interface SetupDeps {
  cuda(): Promise<{ ok: boolean; reason?: string }>
  pidInstalled(): boolean
  installPid(onProgress: InstallProgress, opts: InstallOpts): Promise<void>
  /** Our venv with spandrel, or a ComfyUI Python that already has it. */
  comfyReady(): boolean
  installComfyEngine(onProgress: InstallProgress, opts: InstallOpts): Promise<void>
  setComfy(patch: { folder?: string; serverUrl?: string }): void
  scanComfy(folder: string): Promise<ComfyModel[]>
  generationModels(): GenModel[]
  rembgReady(model: string): boolean
  setupRembg(model: string, onProgress: InstallProgress, opts: InstallOpts): Promise<void>
  downloadCompanions(model: string, onProgress: (p: CompanionProgress) => void, opts: InstallOpts): Promise<void>
  ncnnModels(): { name: string; label: string; user: boolean }[]
  userNcnnDir(): string
  pathState(p: string): PathState
  /** Describes what is (or would be) removed; Recycle Bin unless too large. */
  removeTool(target: 'pid' | 'removebg', o: { permanent: boolean; dryRun: boolean }): Promise<string>
  freeBytes(): number | null
  userData(): string
}
```

- [ ] **Step 1: Write the failing tests**

`test/recycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { folderStats, freeBytesAt, moveToRecycleBin, tooBigForRecycleBin } from '../src/main/recycle'

describe('recycle', () => {
  it('folderStats counts bytes and files recursively', () => {
    const d = mkdtempSync(join(tmpdir(), 'fs-rec-'))
    try {
      mkdirSync(join(d, 'sub'))
      writeFileSync(join(d, 'a'), '12345')
      writeFileSync(join(d, 'sub', 'b'), '123')
      expect(folderStats(d)).toEqual({ bytes: 8, files: 2 })
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('the Recycle Bin limit is 5 GB or 5,000 files', () => {
    expect(tooBigForRecycleBin({ bytes: 6 * 1024 ** 3, files: 10 })).toBe(true)
    expect(tooBigForRecycleBin({ bytes: 10, files: 5001 })).toBe(true)
    expect(tooBigForRecycleBin({ bytes: 10, files: 10 })).toBe(false)
  })

  it('freeBytesAt walks up to an existing folder', () => {
    expect(freeBytesAt(join(tmpdir(), 'does', 'not', 'exist'))).toBeGreaterThan(0)
  })

  // Puts a file in this machine's Recycle Bin, so it only runs on request.
  it.skipIf(!process.env.FILESMITH_TEST_RECYCLE)('moves a file to the Recycle Bin', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'fs-rec-')), 'recycle me.txt')
    writeFileSync(f, 'x')
    await moveToRecycleBin(f)
    expect(existsSync(f)).toBe(false)
  })
})
```

`test/cli-setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { StepReporter, runSetup, type SetupDeps, type Timers } from '../src/cli/commands/setup'
import { parseArgv } from '../src/cli/parse'
import type { EventBody, Reporter } from '../src/cli/events'

function rec(): Reporter & { events: EventBody[] } {
  const events: EventBody[] = []
  return { events, emit: (e) => events.push(e), text: () => {}, close: () => {} }
}

function fakeDeps(over: Partial<SetupDeps> = {}): SetupDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    cuda: async () => ({ ok: true }),
    pidInstalled: () => false,
    installPid: async (p) => {
      calls.push('installPid')
      p('Downloading model (2.6 GB)', 50)
    },
    comfyReady: () => false,
    installComfyEngine: async () => void calls.push('installComfyEngine'),
    setComfy: (patch) => void calls.push(`setComfy ${JSON.stringify(patch)}`),
    scanComfy: async () => [],
    generationModels: () => [
      { name: 'diffusion_models/flux.safetensors', label: 'flux', arch: 'flux1', source: 'diffusion', group: 'Flux', runnable: false, missing: [{ label: 'T5', filename: 't5.safetensors', url: 'https://x/t5', approxSize: '9 GB', subdir: 'text_encoders' }] }
    ],
    rembgReady: () => false,
    setupRembg: async (model, p) => {
      calls.push(`setupRembg ${model}`)
      p('Ready', 100)
    },
    downloadCompanions: async (m) => void calls.push(`downloadCompanions ${m}`),
    ncnnModels: () => [{ name: 'realesrgan-x4plus', label: 'Photo', user: false }],
    userNcnnDir: () => 'U:\\models\\realesrgan',
    pathState: () => 'dir',
    removeTool: async (t, o) => {
      calls.push(`remove ${t} ${JSON.stringify(o)}`)
      return 'U:\\pid (6 GB)'
    },
    freeBytes: () => 100e9,
    userData: () => 'U:\\',
    ...over
  }
}

const go = (argv: string[], deps: SetupDeps, ctrl = new AbortController()) => {
  const r = rec()
  return { r, run: () => runSetup(parseArgv(argv), 'C:\\work', r, deps, ctrl.signal, () => 0) }
}

describe('runSetup', () => {
  it('with no tool lists readiness with fix commands', async () => {
    const s = go(['setup'], fakeDeps({ pidInstalled: () => true }))
    expect(await s.run()).toBe(0)
    const checks = s.r.events.filter((e) => e.event === 'check') as { id: string; status: string; fix?: string }[]
    expect(checks.find((c) => c.id === 'pid')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'removebg')).toMatchObject({ status: 'warn', fix: 'filesmith setup removebg' })
  })

  it('unknown tools are usage errors', async () => {
    await expect(go(['setup', 'nope'], fakeDeps()).run()).rejects.toThrow(/Unknown setup tool: nope/)
  })

  it('removebg: dry run lists the plan and downloads nothing', async () => {
    const d = fakeDeps()
    const s = go(['setup', 'removebg', '--dry-run'], d)
    expect(await s.run()).toBe(0)
    expect(d.calls).toEqual([])
    expect(s.r.events.filter((e) => e.event === 'step').length).toBeGreaterThan(2)
  })

  it('removebg: installs the default model and reports done', async () => {
    const d = fakeDeps()
    const s = go(['setup', 'remove-bg'], d)
    expect(await s.run()).toBe(0)
    expect(d.calls).toEqual(['setupRembg birefnet-general'])
    expect(s.r.events.find((e) => e.event === 'done')).toMatchObject({ tool: 'removebg', alreadyDone: false })
  })

  it('already set up is exit 0 with alreadyDone', async () => {
    const s = go(['setup', 'removebg'], fakeDeps({ rembgReady: () => true }))
    expect(await s.run()).toBe(0)
    expect(s.r.events.find((e) => e.event === 'done')).toMatchObject({ alreadyDone: true })
  })

  it('pid: an unsupported GPU is a run-level error', async () => {
    await expect(go(['setup', 'pid'], fakeDeps({ cuda: async () => ({ ok: false, reason: 'Pascal is too old.' }) })).run()).rejects.toMatchObject({ code: 'GPU_UNSUPPORTED', message: 'Pascal is too old.' })
  })

  it('a failing install is exit 1 with an error event; a canceled one is 130', async () => {
    const failing = go(['setup', 'pid'], fakeDeps({ installPid: async () => { throw new Error('uv pip install failed') } }))
    expect(await failing.run()).toBe(1)
    expect(failing.r.events.find((e) => e.event === 'error')).toMatchObject({ message: 'uv pip install failed' })
    const ctrl = new AbortController()
    const canceled = go(['setup', 'pid'], fakeDeps({ installPid: async () => { ctrl.abort(); throw new Error('Download cancelled') } }), ctrl)
    expect(await canceled.run()).toBe(130)
  })

  it('comfy needs --folder or --url and records them', async () => {
    await expect(go(['setup', 'comfy'], fakeDeps()).run()).rejects.toThrow(/needs --folder/)
    const d = fakeDeps()
    expect(await go(['setup', 'comfy', '--folder', 'D:\\ComfyUI'], d).run()).toBe(0)
    expect(d.calls).toEqual(['setComfy {"folder":"D:\\\\ComfyUI"}'])
  })

  it('generate: dry run lists the missing files; the real run downloads them', async () => {
    const d = fakeDeps()
    const dry = go(['setup', 'generate', '--model', 'flux', '--dry-run'], d)
    expect(await dry.run()).toBe(0)
    expect(dry.r.events.find((e) => e.event === 'step')).toMatchObject({ step: 'T5' })
    expect(await go(['setup', 'generate', '--model', 'flux'], d).run()).toBe(0)
    expect(d.calls).toEqual(['downloadCompanions diffusion_models/flux.safetensors'])
  })

  it('remove pid warns about the shared environment and passes --permanent', async () => {
    const d = fakeDeps()
    const s = go(['setup', 'remove', 'pid', '--permanent'], d)
    expect(await s.run()).toBe(0)
    expect(s.r.events.find((e) => e.event === 'warning')).toMatchObject({ code: 'SHARED_ENV' })
    expect(d.calls).toEqual(['remove pid {"permanent":true,"dryRun":false}'])
  })
})

describe('StepReporter', () => {
  it('heartbeats every 5 s while a step has no percentage, and computes an ETA from bytes', () => {
    const r = rec()
    // A holder object, so TypeScript does not narrow the callback slot to null.
    const tick: { fn: (() => void) | null } = { fn: null }
    let now = 0
    const timers: Timers = {
      set: (fn) => {
        tick.fn = fn
        return 1
      },
      clear: () => {
        tick.fn = null
      }
    }
    const s = new StepReporter(r, () => now, timers)
    s.onProgress('Installing PyTorch', null)
    now = 5000
    tick.fn?.()
    expect(r.events.at(-1)).toEqual({ event: 'heartbeat', step: 'Installing PyTorch', elapsedSec: 5 })
    s.onProgress('Downloading model', 0)
    expect(tick.fn).toBeNull()
    s.onBytes(0, 1000)
    now = 7000
    s.onBytes(500, 1000)
    expect(r.events.at(-1)).toMatchObject({ event: 'step', pct: 50, bytes: 500, totalBytes: 1000, etaSec: 2 })
    s.stop()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/recycle.test.ts test/cli-setup.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement the Recycle Bin helper**

`src/main/recycle.ts`:

```ts
import { existsSync, readdirSync, statSync, statfsSync } from 'fs'
import { dirname, join } from 'path'
import { run } from './run'

/** Beyond this Windows deletes "to the Recycle Bin" permanently, so we refuse
 * instead (the owner's rule for deletes; spec 5.3, deviation D-e). */
export const RECYCLE_LIMIT = { bytes: 5 * 1024 ** 3, files: 5000 }

export function folderStats(path: string): { bytes: number; files: number } {
  const st = statSync(path)
  if (!st.isDirectory()) return { bytes: st.size, files: 1 }
  let bytes = 0
  let files = 0
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        files++
        try {
          bytes += statSync(p).size
        } catch {
          /* vanished */
        }
      }
    }
  }
  walk(path)
  return { bytes, files }
}

export function tooBigForRecycleBin(s: { bytes: number; files: number }): boolean {
  return s.bytes > RECYCLE_LIMIT.bytes || s.files > RECYCLE_LIMIT.files
}

/** Free bytes on the volume holding `path` (or its nearest existing parent). */
export function freeBytesAt(path: string): number | null {
  let p = path
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p)
  try {
    const st = statfsSync(p)
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return null
  }
}

/** Send a file or folder to the Recycle Bin through the shell's own API. The
 * path travels in an environment variable, never in the script text. */
export async function moveToRecycleBin(path: string): Promise<void> {
  const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  // `if { } else { }` must stay on one statement: PowerShell rejects an `else`
  // after a `;`.
  const script = [
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    '$p = $env:FILESMITH_RECYCLE',
    "if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }"
  ].join('; ')
  const r = await run(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, FILESMITH_RECYCLE: path }
  })
  if (r.code !== 0 || existsSync(path))
    throw new Error(`Could not move ${path} to the Recycle Bin. ${r.stderr.trim().split('\n').pop() ?? ''}`.trim())
}
```

- [ ] **Step 4: Implement the command**

`src/cli/commands/setup.ts`:

```ts
import { resolve } from 'path'
import { BG_DEFAULTS } from '@shared/removebg'
import { formatBytes } from '@shared/compress'
import type { ComfyModel } from '@shared/comfy'
import type { GenModel } from '@shared/genArch'
import type { CompanionProgress } from '../../main/generate/companions'
import type { InstallOpts, InstallProgress } from '../../main/uvInstall'
import type { Reporter } from '../events'
import { CliError, EXIT, UsageError } from '../exit'
import type { PathState } from '../options'
import type { ParsedArgs } from '../parse'
import { classifyError } from '../runner'
import { VERSION } from '../version'

export interface SetupDeps {
  cuda(): Promise<{ ok: boolean; reason?: string }>
  pidInstalled(): boolean
  installPid(onProgress: InstallProgress, opts: InstallOpts): Promise<void>
  comfyReady(): boolean
  installComfyEngine(onProgress: InstallProgress, opts: InstallOpts): Promise<void>
  setComfy(patch: { folder?: string; serverUrl?: string }): void
  scanComfy(folder: string): Promise<ComfyModel[]>
  generationModels(): GenModel[]
  rembgReady(model: string): boolean
  setupRembg(model: string, onProgress: InstallProgress, opts: InstallOpts): Promise<void>
  downloadCompanions(model: string, onProgress: (p: CompanionProgress) => void, opts: InstallOpts): Promise<void>
  ncnnModels(): { name: string; label: string; user: boolean }[]
  userNcnnDir(): string
  pathState(p: string): PathState
  removeTool(target: 'pid' | 'removebg', o: { permanent: boolean; dryRun: boolean }): Promise<string>
  freeBytes(): number | null
  userData(): string
}

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(h: unknown): void
}
const REAL_TIMERS: Timers = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (h) => clearInterval(h as ReturnType<typeof setInterval>)
}

const ALIASES: Record<string, string> = {
  'remove-bg': 'removebg',
  'upscale-advanced': 'pid',
  'upscale-comfy': 'spandrel'
}
const TOOLS = 'removebg, pid, spandrel, comfy, generate, realesrgan, remove <tool>'
const PID_BYTES = 6_100_000_000

/** Installer progress -> `step` events with bytes and ETA, plus a heartbeat
 * every 5 s while a step has no percentage (spec 5.3), so an agent never
 * mistakes a 3 GB pip install for a hang. */
export class StepReporter {
  private step = ''
  private pct: number | null = null
  private since = 0
  private first: { t: number; got: number } | null = null
  private timer: unknown = null

  constructor(
    private readonly reporter: Reporter,
    private readonly clock: () => number,
    private readonly timers: Timers = REAL_TIMERS
  ) {}

  onProgress: InstallProgress = (step, pct) => {
    if (step !== this.step) {
      this.step = step
      this.since = this.clock()
      this.first = null
    }
    this.pct = pct
    this.reporter.emit({ event: 'step', step, pct })
    if (pct === null && this.timer === null)
      this.timer = this.timers.set(
        () =>
          this.reporter.emit({
            event: 'heartbeat',
            step: this.step,
            elapsedSec: Math.round((this.clock() - this.since) / 1000)
          }),
        5000
      )
    else if (pct !== null) this.stop()
  }

  onBytes = (got: number, total: number): void => {
    const t = this.clock()
    if (!this.first) this.first = { t, got }
    const secs = (t - this.first.t) / 1000
    const speed = secs > 0 ? (got - this.first.got) / secs : 0
    this.reporter.emit({
      event: 'step',
      step: this.step,
      pct: total ? Math.min(99, Math.round((got / total) * 100)) : this.pct,
      bytes: got,
      totalBytes: total || undefined,
      etaSec: speed > 0 && total > got ? Math.round((total - got) / speed) : undefined
    })
  }

  stop(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
  }
}

export async function runSetup(
  args: ParsedArgs,
  cwd: string,
  reporter: Reporter,
  deps: SetupDeps,
  signal: AbortSignal,
  clock: () => number,
  timers: Timers = REAL_TIMERS
): Promise<number> {
  const t0 = clock()
  const v = args.values
  const words = args.positionals.map((w) => w.toLowerCase())
  const tool = words[0] ? (ALIASES[words[0]] ?? words[0]) : undefined
  const finish = (exitCode: number): number => {
    reporter.emit({
      event: 'summary',
      ok: exitCode === 0 ? 1 : 0,
      failed: exitCode === 1 ? 1 : 0,
      skipped: 0,
      canceled: exitCode === 130 ? 1 : 0,
      inBytes: 0,
      outBytes: 0,
      ms: clock() - t0,
      exitCode
    })
    return exitCode
  }

  if (!tool) {
    const gpu = await deps.cuda()
    const gen = deps.generationModels()
    const rows: [string, boolean, string, string][] = [
      ['removebg', deps.rembgReady(BG_DEFAULTS.bgModel), 'background removal', 'filesmith setup removebg'],
      ['pid', deps.pidInstalled(), gpu.ok ? 'PiD upscaler (NVIDIA)' : (gpu.reason ?? 'needs an NVIDIA GPU'), 'filesmith setup pid'],
      ['spandrel', deps.comfyReady(), 'ComfyUI upscale models (NVIDIA)', 'filesmith setup spandrel'],
      ['realesrgan', deps.ncnnModels().length > 0, 'bundled upscaler', 'filesmith doctor'],
      [
        'generate',
        gen.some((m) => m.runnable),
        `${gen.filter((m) => m.runnable).length} of ${gen.length} generation models ready`,
        gen.length ? 'filesmith formats generate' : 'filesmith setup comfy --folder "<ComfyUI folder>"'
      ]
    ]
    for (const [id, ok, detail, fix] of rows)
      reporter.emit({ event: 'check', id, group: 'setup', status: ok ? 'ok' : 'warn', detail: ok ? `ready, ${detail}` : `not set up, ${detail}`, fix: ok ? undefined : fix })
    return EXIT.OK
  }
  if (![...TOOLS.split(', ').map((t) => t.split(' ')[0])].includes(tool))
    throw new UsageError(`Unknown setup tool: ${tool}. Tools: ${TOOLS}.`, ['setup'])

  reporter.emit({
    event: 'run',
    command: `setup ${[tool, ...words.slice(1)].join(' ')}`,
    version: VERSION,
    dryRun: args.dryRun,
    inputs: 0,
    options: { ...v }
  })
  const steps = new StepReporter(reporter, clock, timers)
  const opts: InstallOpts = { signal, onBytes: steps.onBytes }
  const free = deps.freeBytes()
  const freeText = free == null ? 'free space unknown' : `${formatBytes(free)} free`
  const plan = (lines: [string, string][]): number => {
    for (const [step, detail] of lines) reporter.emit({ event: 'step', step, pct: null, detail })
    return finish(EXIT.OK)
  }
  const already = (name: string, path?: string): number => {
    reporter.emit({ event: 'done', tool: name, path, alreadyDone: true })
    return finish(EXIT.OK)
  }
  const attempt = async (name: string, path: string | undefined, fn: () => Promise<void>): Promise<number> => {
    try {
      await fn()
      steps.stop()
      reporter.emit({ event: 'done', tool: name, path, alreadyDone: false })
      return finish(EXIT.OK)
    } catch (e) {
      steps.stop()
      if (signal.aborted) {
        reporter.emit({ event: 'error', code: 'CANCELED', message: 'Setup canceled. Run the same command again to resume.' })
        return finish(EXIT.CANCELED)
      }
      const message = e instanceof Error ? e.message : String(e)
      reporter.emit({ event: 'error', code: classifyError(message).code, message })
      return finish(EXIT.FAILED)
    }
  }
  const gpuGate = async (): Promise<void> => {
    const g = await deps.cuda()
    if (!g.ok) throw new CliError('GPU_UNSUPPORTED', g.reason ?? 'This GPU cannot run the CUDA engine.')
  }
  const ENGINE_PLAN: [string, string][] = [
    ['GPU', 'NVIDIA with CUDA compute capability 7.5+ and driver 525+: ok'],
    ['Python env', 'Python 3.12 with PyTorch (CUDA 12.8) via uv, about 3 GB'],
    ['Disk', freeText]
  ]

  switch (tool) {
    case 'realesrgan': {
      for (const m of deps.ncnnModels())
        reporter.emit({ event: 'step', step: m.name, pct: null, detail: `${m.label}${m.user ? ', added by you' : ''}` })
      reporter.emit({ event: 'step', step: 'Your own models', pct: null, detail: `drop a .param/.bin pair into ${deps.userNcnnDir()}` })
      return already('realesrgan', deps.userNcnnDir())
    }
    case 'removebg': {
      const model = BG_DEFAULTS.bgModel
      if (deps.rembgReady(model)) return already('removebg')
      if (args.dryRun)
        return plan([
          ['uv', 'use an installed uv 0.11.28+, else download uv 0.11.30 from github.com/astral-sh/uv'],
          ['rembg', 'uv tool install rembg[cli,cpu]>=2.0.75,<3 (Python 3.11, CPU only, no GPU needed)'],
          ['Model', `${model}, about 1 GB, into ${resolve(deps.userData(), 'models', 'rembg')}`],
          ['Disk', freeText]
        ])
      return attempt('removebg', undefined, () => deps.setupRembg(model, steps.onProgress, opts))
    }
    case 'pid': {
      await gpuGate()
      if (deps.pidInstalled()) return already('pid')
      if (args.dryRun)
        return plan([
          ...ENGINE_PLAN.slice(0, 2),
          ['Source', 'github.com/nv-tlabs/PiD at a pinned commit'],
          ['Weights', 'huggingface.co/nvidia/PiD, about 3 GB (reused from your ComfyUI when found)'],
          ['Disk', `needs about ${formatBytes(PID_BYTES)}, ${freeText}`]
        ])
      return attempt('pid', undefined, () => deps.installPid(steps.onProgress, opts))
    }
    case 'spandrel': {
      await gpuGate()
      const folder = typeof v.comfy === 'string' ? resolve(cwd, v.comfy) : undefined
      if (folder && deps.pathState(folder) !== 'dir') throw new UsageError(`--comfy must be a folder: ${folder}`, ['setup'])
      const ready = deps.comfyReady()
      if (ready && !folder) return already('spandrel')
      if (args.dryRun)
        return plan([
          ...(ready ? [] : [...ENGINE_PLAN, ['spandrel', 'the model loader, a few MB'] as [string, string]]),
          ...(folder ? [['ComfyUI folder', `record ${folder} and scan its upscale models`] as [string, string]] : [])
        ])
      return attempt('spandrel', folder, async () => {
        if (!ready) await deps.installComfyEngine(steps.onProgress, opts)
        if (!folder) return
        steps.onProgress('Scanning ComfyUI upscale models', null)
        deps.setComfy({ folder })
        for (const m of await deps.scanComfy(folder))
          reporter.emit({ event: 'step', step: m.name, pct: null, detail: `${m.badge}${m.reason ? `: ${m.reason}` : ''}` })
      })
    }
    case 'comfy': {
      const folder = typeof v.folder === 'string' ? resolve(cwd, v.folder) : undefined
      const url = typeof v.url === 'string' ? v.url.replace(/\/+$/, '') : undefined
      if (!folder && !url)
        throw new UsageError('filesmith setup comfy needs --folder <ComfyUI folder> or --url <http://host:port>.', ['setup'])
      if (folder && deps.pathState(folder) !== 'dir') throw new UsageError(`--folder must be a folder: ${folder}`, ['setup'])
      if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new UsageError('--url must look like http://127.0.0.1:8188', ['setup'])
      if (args.dryRun)
        return plan([
          ...(folder ? [['ComfyUI folder', `record ${folder}`] as [string, string]] : []),
          ...(url ? [['ComfyUI server', `record ${url}`] as [string, string]] : []),
          ['Downloads', 'none; ComfyUI itself comes from comfy.org']
        ])
      deps.setComfy({ ...(folder ? { folder } : {}), ...(url ? { serverUrl: url } : {}) })
      const gen = deps.generationModels()
      reporter.emit({ event: 'step', step: 'Generation models', pct: null, detail: `${gen.filter((m) => m.runnable).length} of ${gen.length} ready to run` })
      reporter.emit({ event: 'done', tool: 'comfy', path: folder ?? url, alreadyDone: false })
      return finish(EXIT.OK)
    }
    case 'generate': {
      const name = typeof v.model === 'string' ? v.model : undefined
      if (!name) throw new UsageError('filesmith setup generate needs --model <name>. See: filesmith formats generate', ['setup'])
      const model = deps.generationModels().find((m) => [m.name, m.label].some((x) => x.toLowerCase() === name.toLowerCase()))
      if (!model) throw new UsageError(`No generation model named "${name}". See: filesmith formats generate`, ['setup'])
      const missing = model.missing ?? []
      if (!missing.length) return already('generate', model.name)
      if (args.dryRun)
        return plan([
          ...missing.map((f): [string, string] => [f.label, `${f.filename}, ${f.approxSize}, from ${f.url}${f.sha256 ? ', sha256 checked' : ''}`]),
          ['Disk', `${freeText} on the Filesmith data drive (files go into your ComfyUI models folder)`]
        ])
      return attempt('generate', model.name, () =>
        deps.downloadCompanions(model.name, (p) => steps.onProgress(`Downloading ${p.label} (${p.index}/${p.total})`, p.pct), opts)
      )
    }
    case 'remove': {
      const sub = words[1] ? (ALIASES[words[1]] ?? words[1]) : undefined
      if (sub !== 'pid' && sub !== 'spandrel' && sub !== 'removebg')
        throw new UsageError('filesmith setup remove needs pid, spandrel or removebg.', ['setup'])
      const target = sub === 'removebg' ? 'removebg' : 'pid'
      if (target === 'pid')
        reporter.emit({ event: 'warning', code: 'SHARED_ENV', message: 'PiD and the ComfyUI upscaler engine share one Python environment; removing it removes both.' })
      const o = { permanent: v.permanent === true, dryRun: args.dryRun }
      if (args.dryRun) return plan([[`Remove ${sub}`, await deps.removeTool(target, o)]])
      return attempt(`remove ${sub}`, undefined, async () => {
        steps.onProgress(`Removed ${await deps.removeTool(target, o)}`, 100)
      })
    }
  }
  throw new UsageError(`Unknown setup tool: ${tool}. Tools: ${TOOLS}.`, ['setup'])
}
```

`src/cli/main.ts`: `CliDeps` gains `setup: SetupDeps`; `dispatch` gains `case 'setup': return runSetup(args, io.cwd, reporter, deps.setup, io.signal, deps.clock)`.

`src/cli/deps.ts`: add

```ts
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { formatBytes } from '@shared/compress'
import { cudaTierSupport, detectNvidia } from '../main/pid/gpu'
import { comfyEngineReady, pidInstalled, pidRoot } from '../main/pid/paths'
import { installComfyEngine, installPid } from '../main/pid/install'
import { comfyPythonReady, clearComfyPythonCache } from '../main/comfy/pythonEnv'
import { mergeComfyStore } from '../main/comfy/store'
import { scanComfy } from '../main/comfy/discover'
import { downloadCompanions } from '../main/generate/companions'
import { listNcnnModels, userNcnnDir } from '../main/tools/ncnnModels'
import { installedRembgExe, rembgModelDir, rembgModelPresent, rembgToolDir } from '../main/rembg/paths'
import { setupRembg } from '../main/rembg/setup'
import { isStale, readLock } from '../main/locks'
import { folderStats, freeBytesAt, moveToRecycleBin, tooBigForRecycleBin } from '../main/recycle'
import { engineEnv } from '../main/env'
import type { SetupDeps } from './commands/setup'

async function removeTool(target: 'pid' | 'removebg', o: { permanent: boolean; dryRun: boolean }): Promise<string> {
  const lock = readLock(target === 'pid' ? 'pid-env' : 'rembg')
  if (lock && !isStale(lock))
    throw new Error(`Another Filesmith (${lock.host}, pid ${lock.pid}) is installing right now. Wait for it to finish.`)
  const paths = (target === 'pid' ? [pidRoot()] : [join(rembgToolDir(), 'rembg'), rembgModelDir()]).filter((p) => existsSync(p))
  if (!paths.length) return 'nothing, it is not installed'
  const items = paths.map((p) => ({ p, ...folderStats(p) }))
  const desc = items.map((i) => `${i.p} (${formatBytes(i.bytes)})`).join(', ')
  const big = items.filter(tooBigForRecycleBin)
  if (o.dryRun) return big.length && !o.permanent ? `${desc}; too large for the Recycle Bin, needs --permanent` : desc
  if (big.length && !o.permanent)
    throw new Error(`${big[0].p} is ${formatBytes(big[0].bytes)}, too large for the Recycle Bin. Run again with --permanent to delete it for good.`)
  for (const i of items) {
    if (tooBigForRecycleBin(i)) rmSync(i.p, { recursive: true, force: true })
    else await moveToRecycleBin(i.p)
  }
  return desc
}

export function defaultSetupDeps(): SetupDeps {
  return {
    cuda: async () => cudaTierSupport(await detectNvidia()),
    pidInstalled: () => pidInstalled('flux'),
    installPid: (p, o) => installPid('flux', p, o),
    comfyReady: () => comfyEngineReady() || comfyPythonReady(),
    installComfyEngine: (p, o) => installComfyEngine(p, o),
    setComfy: (patch) => {
      mergeComfyStore(patch)
      clearComfyPythonCache()
    },
    scanComfy: async (folder) => {
      const models = await scanComfy(folder)
      mergeComfyStore({ folder, models })
      return models
    },
    generationModels: () => scanGenerationModels().models,
    rembgReady: (m) => installedRembgExe() != null && rembgModelPresent(m),
    setupRembg,
    downloadCompanions,
    ncnnModels: () => listNcnnModels().map((m) => ({ name: m.name, label: m.label, user: m.user })),
    userNcnnDir,
    pathState,
    removeTool,
    freeBytes: () => freeBytesAt(engineEnv().userData),
    userData: () => engineEnv().userData
  }
}
```

and add `setup: defaultSetupDeps()` to `defaultDeps()`. Give `test/cli-main.test.ts`'s deps a `setup` member (`fakeDeps()` from `test/cli-setup.test.ts` can be copied in; it is never dispatched there).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/recycle.test.ts test/cli-setup.test.ts test/cli-main.test.ts`
Expected: PASS (the Recycle Bin case is skipped). Then once by hand: `FILESMITH_TEST_RECYCLE=1 npx vitest run test/recycle.test.ts` (Expected: PASS; one empty `recycle me.txt` lands in the Recycle Bin).

- [ ] **Step 6: Set up background removal for real once**

Run: `npm run build && node out/main/cli.js setup removebg --dry-run && node out/main/cli.js setup removebg --json`
Expected: the dry run prints the four plan lines; the real run streams `step` events (with `bytes`, `totalBytes`, `etaSec` during the model download), then `done` and `summary` with exit 0. A second run prints `ok removebg already set up`. Then `node out/main/cli.js removebg <some.png> --json` succeeds.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npx prettier --write src test && npm test
git add src/main/recycle.ts src/cli test/recycle.test.ts test/cli-setup.test.ts test/cli-main.test.ts
git commit -m "feat(cli): filesmith setup for removebg, pid, spandrel, comfy, generate, realesrgan and remove" -m "Progress with bytes, ETA and a 5 s heartbeat; GPU gate and disk check; cross-process locks; removal goes to the Recycle Bin, or needs --permanent above 5 GB." -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: `filesmith formats` and `filesmith doctor`

**Files:**
- Create: `src/cli/commands/formats.ts`, `src/cli/commands/doctor.ts`, `test/cli-formats.test.ts`, `test/cli-doctor.test.ts`
- Modify: `src/cli/human.ts` (command-aware summary), `test/cli-human.test.ts`, `src/main/generate/comfy.ts` (export `firstLiveComfy`), `src/cli/main.ts` (dispatch, `CliDeps.formats`, `CliDeps.doctor`), `src/cli/deps.ts` (`defaultFormatsDeps`, `defaultDoctorDeps`)

**Interfaces:**
- Consumes: `wrap` (Task 7); `SUBCOMMANDS` (Task 7); `pidWeightFiles` (Task 4); `hashFile` (Task 5); `readLock`, `isStale` (Task 4); `freeBytesAt` (Task 14); existing resolvers.
- Produces:
  - `generate/comfy.ts`: `firstLiveComfy(): Promise<string | null>`.
  - `commands/formats.ts`: `interface FormatsDeps { hasRar(): boolean; ncnnModels(): { name: string; label: string; user: boolean }[]; comfyModels(): ComfyModel[]; comfyReady(): boolean; pidInstalled(): boolean; cudaOk(): Promise<boolean>; rembgReady(): boolean; generationModels(): GenModel[] }`, `buildFormats(deps): Promise<Record<string, Record<string, unknown>>>`, `renderFormats(data): string`, `runFormats(args, reporter, deps): Promise<number>`.
  - `commands/doctor.ts`: `interface Check { id: string; group: string; status: 'ok' | 'warn' | 'fail' | 'skip'; detail: string; fix?: string }`, `interface DoctorDeps` (below), `collectChecks(deps: DoctorDeps, o: { deep: boolean; verify: boolean }): Promise<Check[]>`, `runDoctor(args, reporter, deps, clock): Promise<number>`.
  - `CliDeps.formats: FormatsDeps`, `CliDeps.doctor: DoctorDeps`.

`DoctorDeps` (Task 17 adds `skill()`):

```ts
export interface DoctorDeps {
  tool(name: string): { path: string; bundled: boolean }
  probe(cmd: string, args: string[]): Promise<{ started: boolean; firstLine: string }>
  ghostscript(): string
  soffice(): string
  rar(): string | null
  realesrgan(): string
  ncnnCount(): number
  exists(p: string): boolean
  gpu(): Promise<{ name: string; vramMb: number | null; computeCap: number | null; driver: string | null } | null>
  cuda(gpu: Awaited<ReturnType<DoctorDeps['gpu']>>): { ok: boolean; reason?: string }
  pidInstalled(): boolean
  comfyEngineReady(): boolean
  comfyPythonReady(): boolean
  comfyFolder(): string | null
  comfyModelCount(): number
  uv(): Promise<string | null>
  rembgExe(): string | null
  rembgModel(model: string): boolean
  comfyAlive(): Promise<string | null>
  comfyLaunchable(): boolean
  generationModels(): GenModel[]
  registryWarnings(): string[]
  channelEnabled(): boolean
  userData(): string
  writable(dir: string): boolean
  freeBytes(dir: string): number | null
  packaged(): boolean
  shimDir(): string
  pathEnv(): string
  appRunning(): Promise<boolean>
  liveLocks(): { what: string; host: string; pid: number }[]
  proxyConfigured(): Promise<boolean>
  env: Record<string, string | undefined>
  version: string
  bundledVersion(): string | null
  deepSmoke(): Promise<{ ok: boolean; detail: string }>
  verify(): Promise<{ id: string; ok: boolean; detail: string }[]>
}
```

- [ ] **Step 1: Write the failing tests**

`test/cli-formats.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildFormats, renderFormats, runFormats, type FormatsDeps } from '../src/cli/commands/formats'
import { parseArgv } from '../src/cli/parse'
import type { EventBody, Reporter } from '../src/cli/events'

const deps = (over: Partial<FormatsDeps> = {}): FormatsDeps => ({
  hasRar: () => false,
  ncnnModels: () => [
    { name: 'realesrgan-x4plus', label: 'Photo', user: false },
    { name: 'realesrgan-x4plus-anime_6B', label: 'Anime (6B)', user: false }
  ],
  comfyModels: () => [{ path: 'D:\\models\\4x-Ultra.pth', name: '4x-Ultra', scale: 4, badge: 'verified' }],
  comfyReady: () => true,
  pidInstalled: () => false,
  cudaOk: async () => false,
  rembgReady: () => true,
  generationModels: () => [
    { name: 'checkpoints/sdxl.safetensors', label: 'sdxl', arch: 'sdxl', source: 'checkpoint', group: 'Checkpoints', runnable: true }
  ],
  ...over
})

describe('formats', () => {
  it('lists targets per source group, the option values and the models with readiness', async () => {
    const f = await buildFormats(deps())
    const groups = f.convert.groups as { group: string; to: string[] }[]
    expect(groups.find((g) => g.group === 'image')?.to).toContain('webp')
    expect(f.convert.rar).toBe(false)
    expect(f.compress.levels).toEqual(['lossless', 'high', 'balanced', 'smallest'])
    const models = f.upscale.models as { value: string; engine: string; ready: boolean }[]
    expect(models.map((m) => m.value)).toEqual(['photo', 'realesrgan-x4plus-anime_6B', 'pid', 'comfy:4x-Ultra.pth'])
    expect(models.find((m) => m.value === 'pid')?.ready).toBe(false)
    expect(models.find((m) => m.engine === 'comfy')?.ready).toBe(false) // no CUDA tier
  })

  it('formats <verb> narrows; an unknown verb is a usage error', async () => {
    const events: EventBody[] = []
    let text = ''
    const r: Reporter = { emit: (e) => events.push(e), text: (s) => (text += s), close: () => {} }
    expect(await runFormats(parseArgv(['formats', 'upscale']), r, deps())).toBe(0)
    expect(Object.keys((events[0] as { data: object }).data)).toEqual(['upscale'])
    expect(text).toContain('UPSCALE')
    await expect(runFormats(parseArgv(['formats', 'nope']), r, deps())).rejects.toThrow(/Unknown verb for formats: nope/)
  })

  it('the human rendering fits 80 columns', async () => {
    for (const line of renderFormats(await buildFormats(deps())).split('\n')) expect(line.length, line).toBeLessThanOrEqual(80)
  })
})
```

`test/cli-doctor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { collectChecks, runDoctor, type DoctorDeps } from '../src/cli/commands/doctor'
import { parseArgv } from '../src/cli/parse'
import type { EventBody, Reporter } from '../src/cli/events'

const good = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  tool: (n) => ({ path: `R:\\bin\\${n}.exe`, bundled: true }),
  probe: async (cmd) => ({ started: true, firstLine: `${cmd} 1.0` }),
  ghostscript: () => 'R:\\gs\\gswin64c.exe',
  soffice: () => 'R:\\lo\\soffice.com',
  rar: () => null,
  realesrgan: () => 'R:\\re\\realesrgan-ncnn-vulkan.exe',
  ncnnCount: () => 5,
  exists: () => true,
  gpu: async () => ({ name: 'RTX 5090', vramMb: 32607, computeCap: 12, driver: '581.15' }),
  cuda: () => ({ ok: true }),
  pidInstalled: () => false,
  comfyEngineReady: () => false,
  comfyPythonReady: () => false,
  comfyFolder: () => null,
  comfyModelCount: () => 0,
  uv: async () => null,
  rembgExe: () => null,
  rembgModel: () => false,
  comfyAlive: async () => null,
  comfyLaunchable: () => false,
  generationModels: () => [],
  registryWarnings: () => [],
  channelEnabled: () => false,
  userData: () => 'U:\\Filesmith',
  writable: () => true,
  freeBytes: () => 500e9,
  packaged: () => false,
  shimDir: () => 'P:\\Filesmith\\resources\\cli',
  pathEnv: () => '',
  appRunning: async () => false,
  liveLocks: () => [],
  proxyConfigured: async () => false,
  env: {},
  version: '0.6.0',
  bundledVersion: () => null,
  deepSmoke: async () => ({ ok: true, detail: '4x4 upscaled' }),
  verify: async () => [],
  ...over
})

describe('doctor', () => {
  it('missing AI tools are warnings with exact fix commands, not failures', async () => {
    const checks = await collectChecks(good(), { deep: false, verify: false })
    expect(checks.some((c) => c.status === 'fail')).toBe(false)
    expect(checks.find((c) => c.id === 'pid')).toMatchObject({ status: 'warn', fix: 'filesmith setup pid' })
    expect(checks.find((c) => c.id === 'rembg')).toMatchObject({ status: 'warn', fix: 'filesmith setup removebg' })
    expect(checks.find((c) => c.id === 'winrar')?.status).toBe('warn')
    expect(checks.find((c) => c.id === 'path')?.status).toBe('skip')
  })

  it('a missing bundled tool fails and the exit code is 1', async () => {
    const deps = good({ probe: async (cmd) => ({ started: !cmd.includes('mutool'), firstLine: '' }) })
    const events: EventBody[] = []
    const r: Reporter = { emit: (e) => events.push(e), text: () => {}, close: () => {} }
    expect(await runDoctor(parseArgv(['doctor', '--json']), r, deps, () => 0)).toBe(1)
    expect(events.find((e) => e.event === 'check' && e.id === 'mutool')).toMatchObject({ status: 'fail', fix: 'Reinstall Filesmith' })
    expect(events.at(-1)).toMatchObject({ event: 'summary', exitCode: 1 })
  })

  it('packaged: PATH and the bundled version are checked', async () => {
    const off = await collectChecks(good({ packaged: () => true, bundledVersion: () => '0.6.0' }), { deep: false, verify: false })
    expect(off.find((c) => c.id === 'path')).toMatchObject({ status: 'warn' })
    expect(off.find((c) => c.id === 'version')?.status).toBe('ok')
    const on = await collectChecks(
      good({ packaged: () => true, pathEnv: () => 'C:\\Windows;P:\\Filesmith\\resources\\cli\\', bundledVersion: () => '0.5.2' }),
      { deep: false, verify: false }
    )
    expect(on.find((c) => c.id === 'path')?.status).toBe('ok')
    expect(on.find((c) => c.id === 'version')?.status).toBe('fail')
  })

  it('a system proxy without HTTPS_PROXY is a warning; held locks are reported', async () => {
    const checks = await collectChecks(
      good({ proxyConfigured: async () => true, liveLocks: () => [{ what: 'the AI upscaler engine', host: 'app', pid: 42 }] }),
      { deep: false, verify: false }
    )
    expect(checks.find((c) => c.id === 'proxy')?.status).toBe('warn')
    expect(checks.find((c) => c.id === 'installs')).toMatchObject({ status: 'warn' })
  })

  it('--deep and --verify add their checks', async () => {
    const checks = await collectChecks(good({ verify: async () => [{ id: 'pid weights', ok: false, detail: 'hash differs' }] }), { deep: true, verify: true })
    expect(checks.find((c) => c.id === 'realesrgan-smoke')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'verify pid weights')?.status).toBe('fail')
  })
})
```

Append to `test/cli-human.test.ts`:

```ts
describe('HumanReporter summaries per command', () => {
  it('doctor says whether anything failed; setup prints no file summary', () => {
    const o = sink()
    const r = new HumanReporter(o.out, sink().out, { color: false, stderrTTY: false })
    r.emit({ event: 'run', command: 'doctor', version: '0.6.0', dryRun: false, inputs: 0, options: {} })
    r.emit({ event: 'summary', ok: 9, failed: 0, skipped: 1, canceled: 0, inBytes: 0, outBytes: 0, ms: 1, exitCode: 0 })
    r.emit({ event: 'run', command: 'setup pid', version: '0.6.0', dryRun: false, inputs: 0, options: {} })
    r.emit({ event: 'summary', ok: 1, failed: 0, skipped: 0, canceled: 0, inBytes: 0, outBytes: 0, ms: 1, exitCode: 0 })
    expect(o.text()).toBe('No problems found.\n')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/cli-formats.test.ts test/cli-doctor.test.ts test/cli-human.test.ts`
Expected: FAIL, unresolved imports; the new human case fails on the summary line.

- [ ] **Step 3: Implement**

`src/cli/human.ts`: add `private command = ''`; in `case 'run'` add `this.command = e.command`; replace `case 'summary'` with

```ts
      case 'summary':
        if (this.command === 'doctor')
          this.out(e.failed ? `${e.failed} ${e.failed === 1 ? 'check' : 'checks'} failed.\n` : 'No problems found.\n')
        else if (!this.command.startsWith('setup') && !this.command.startsWith('skill'))
          this.out(summaryLine(e, this.dryRun))
        return
```

`src/main/generate/comfy.ts`, add:

```ts
/** The first ComfyUI that answers right now, without launching one (doctor). */
export async function firstLiveComfy(): Promise<string | null> {
  for (const url of candidateComfyUrls()) if (await alive(url)) return url
  return null
}
```

`src/cli/commands/formats.ts`:

```ts
import { basename } from 'path'
import { COMPRESSIBLE_IMAGE_EXTS, familyFormats } from '@shared/convert'
import { AUDIO_BITRATES, AUDIO_CODECS, IMAGE_FORMATS as COMPRESS_FORMATS, PDF_LEVELS, UPSCALE_FACTORS, VIDEO_CODECS } from '@shared/compress'
import { RESIZE_FITS } from '@shared/resize'
import { BG_FILLS } from '@shared/removebg'
import { GEN_SIZES, GEN_STYLES } from '@shared/generate'
import { ARCHIVE_EXTS, AUDIO_EXTS, IMAGE_EXTS, TEXT_EXTS, VIDEO_EXTS } from '@shared/fileKind'
import type { ComfyModel } from '@shared/comfy'
import type { GenModel } from '@shared/genArch'
import { SUBCOMMANDS } from '../catalog'
import type { Reporter } from '../events'
import { UsageError } from '../exit'
import { wrap } from '../help'
import type { ParsedArgs } from '../parse'

export interface FormatsDeps {
  hasRar(): boolean
  ncnnModels(): { name: string; label: string; user: boolean }[]
  comfyModels(): ComfyModel[]
  comfyReady(): boolean
  pidInstalled(): boolean
  cudaOk(): Promise<boolean>
  rembgReady(): boolean
  generationModels(): GenModel[]
}

const bare = (exts: string[]): string[] => exts.map((e) => e.replace(/^\./, ''))
const targets = (kind: Parameters<typeof familyFormats>[0], ext: string): string[] =>
  bare(familyFormats(kind, ext).map((f) => f.ext))
const SHIPPED_ALIAS: Record<string, string> = { 'realesrgan-x4plus': 'photo', 'realesrgan-x4plus-anime': 'anime' }

/** Everything a `--to`, `--model` or option value can be, with readiness
 * (spec 3.8). Data first: the human view renders the same object. */
export async function buildFormats(deps: FormatsDeps): Promise<Record<string, Record<string, unknown>>> {
  const cuda = await deps.cudaOk()
  return {
    convert: {
      groups: [
        { group: 'image', from: bare(IMAGE_EXTS), to: targets('image', '.png') },
        { group: 'video', from: bare(VIDEO_EXTS), to: targets('video', '.mp4') },
        { group: 'audio', from: bare(AUDIO_EXTS), to: targets('audio', '.mp3') },
        { group: 'doc', from: ['pdf', 'docx', 'doc', 'odt', 'rtf', ...bare(TEXT_EXTS)], to: targets('document', '.docx'), note: 'a .pdf also converts to cbz, cbr, cb7, cbt' },
        { group: 'sheet', from: ['xlsx', 'xls', 'ods', 'csv', 'tsv'], to: targets('document', '.xlsx') },
        { group: 'slide', from: ['pptx', 'ppt', 'odp'], to: targets('document', '.pptx') },
        { group: 'archive', from: bare(ARCHIVE_EXTS), to: targets('archive', '.zip') }
      ],
      rar: deps.hasRar()
    },
    compress: {
      images: bare(COMPRESSIBLE_IMAGE_EXTS),
      format: COMPRESS_FORMATS.map((f) => f.value),
      videoCodecs: VIDEO_CODECS.map((c) => c.value),
      audioCodecs: AUDIO_CODECS.map((c) => c.value),
      bitrates: [...AUDIO_BITRATES],
      levels: PDF_LEVELS.map((l) => l.value)
    },
    resize: { fits: RESIZE_FITS.map((f) => f.value) },
    upscale: {
      factors: [...UPSCALE_FACTORS],
      gpu: ['full', 'balanced'],
      models: [
        ...deps.ncnnModels().map((m) => ({ value: SHIPPED_ALIAS[m.name] ?? m.name, label: m.label, engine: 'realesrgan', ready: true, ...(m.user ? { user: true } : {}) })),
        { value: 'pid', label: 'PiD, 4x only', engine: 'pid', ready: cuda && deps.pidInstalled() },
        ...deps.comfyModels().map((m) => ({ value: `comfy:${basename(m.path)}`, label: m.name, engine: 'comfy', ready: cuda && deps.comfyReady(), badge: m.badge }))
      ]
    },
    removebg: { fills: BG_FILLS.map((f) => f.value), ready: deps.rembgReady() },
    generate: {
      styles: GEN_STYLES.map((s) => s.id),
      sizes: GEN_SIZES.map((s) => `${s.width}x${s.height}`),
      models: deps.generationModels().map((m) => ({
        name: m.name,
        label: m.label,
        arch: m.arch,
        runnable: m.runnable,
        ...(m.missing?.length ? { missing: m.missing.map((f) => f.label) } : {}),
        ...(!m.runnable && m.reason ? { reason: m.reason } : {})
      }))
    },
    pdf: { tools: SUBCOMMANDS.pdf }
  }
}

function describeItem(o: Record<string, unknown>): string {
  const id = String(o.value ?? o.name ?? o.group ?? '')
  const rest = Object.entries(o)
    .filter(([k]) => !['value', 'name', 'group'].includes(k))
    .map(([k, v]) => (typeof v === 'boolean' ? (v ? k : `not ${k}`) : Array.isArray(v) ? `${k}: ${v.join(', ')}` : `${k}: ${String(v)}`))
  return `${id}: ${rest.join('; ')}`
}

export function renderFormats(data: Record<string, Record<string, unknown>>): string {
  const out: string[] = []
  for (const [section, body] of Object.entries(data)) {
    out.push(section.toUpperCase())
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v) && v.some((x) => typeof x === 'object')) {
        out.push(`  ${k}:`)
        for (const item of v) out.push(...wrap(describeItem(item as Record<string, unknown>), 80, 8).map((l, i) => (i ? l : `    ${l}`)))
      } else if (Array.isArray(v)) out.push(...wrap(`${k}: ${v.join(', ')}`, 80, 4).map((l, i) => (i ? l : `  ${l}`)))
      else out.push(`  ${k}: ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}`)
    }
    out.push('')
  }
  return out.join('\n')
}

export async function runFormats(args: ParsedArgs, reporter: Reporter, deps: FormatsDeps): Promise<number> {
  const all = await buildFormats(deps)
  const word = args.positionals[0]?.toLowerCase()
  const key = word === 'remove-bg' ? 'removebg' : word
  if (key && !(key in all))
    throw new UsageError(`Unknown verb for formats: ${word}. One of: ${Object.keys(all).join(', ')}.`, ['formats'])
  const data = key ? { [key]: all[key] } : all
  reporter.emit({ event: 'formats', data })
  reporter.text(renderFormats(data))
  return 0
}
```

`src/cli/commands/doctor.ts`:

```ts
import type { GenModel } from '@shared/genArch'
import { BG_DEFAULTS } from '@shared/removebg'
import { formatBytes } from '@shared/compress'
import type { Reporter } from '../events'
import type { ParsedArgs } from '../parse'
import { VERSION } from '../version'

export interface Check {
  id: string
  group: string
  status: 'ok' | 'warn' | 'fail' | 'skip'
  detail: string
  fix?: string
}

export interface DoctorDeps {
  tool(name: string): { path: string; bundled: boolean }
  probe(cmd: string, args: string[]): Promise<{ started: boolean; firstLine: string }>
  ghostscript(): string
  soffice(): string
  rar(): string | null
  realesrgan(): string
  ncnnCount(): number
  exists(p: string): boolean
  gpu(): Promise<{ name: string; vramMb: number | null; computeCap: number | null; driver: string | null } | null>
  cuda(gpu: Awaited<ReturnType<DoctorDeps['gpu']>>): { ok: boolean; reason?: string }
  pidInstalled(): boolean
  comfyEngineReady(): boolean
  comfyPythonReady(): boolean
  comfyFolder(): string | null
  comfyModelCount(): number
  uv(): Promise<string | null>
  rembgExe(): string | null
  rembgModel(model: string): boolean
  comfyAlive(): Promise<string | null>
  comfyLaunchable(): boolean
  generationModels(): GenModel[]
  registryWarnings(): string[]
  channelEnabled(): boolean
  userData(): string
  writable(dir: string): boolean
  freeBytes(dir: string): number | null
  packaged(): boolean
  shimDir(): string
  pathEnv(): string
  appRunning(): Promise<boolean>
  liveLocks(): { what: string; host: string; pid: number }[]
  proxyConfigured(): Promise<boolean>
  env: Record<string, string | undefined>
  version: string
  bundledVersion(): string | null
  deepSmoke(): Promise<{ ok: boolean; detail: string }>
  verify(): Promise<{ id: string; ok: boolean; detail: string }[]>
}

const SETUP_COMFY = 'filesmith setup comfy --folder "<ComfyUI folder>"'
const CORE: [string, string[], string][] = [
  ['ffmpeg', ['-version'], 'video and audio'],
  ['ffprobe', ['-version'], 'video sizes and durations'],
  ['magick', ['-version'], 'every image job'],
  ['mutool', ['-v'], 'the PDF tools'],
  ['caesiumclt', ['--version'], 'image compress'],
  ['7z', [], 'archives']
]
const norm = (p: string): string => p.trim().replace(/[\\/]+$/, '').toLowerCase()

/** Read-only checklist (spec 5.4). AI tools are optional: missing is `warn`. */
export async function collectChecks(deps: DoctorDeps, o: { deep: boolean; verify: boolean }): Promise<Check[]> {
  const checks: Check[] = []
  const add = (c: Check): void => void checks.push(c)

  for (const [name, args, what] of CORE) {
    const t = deps.tool(name)
    const p = await deps.probe(t.path, args)
    add({
      id: name,
      group: 'core',
      status: !p.started ? 'fail' : t.bundled ? 'ok' : 'warn',
      detail: !p.started ? `missing, needed for ${what}` : `${p.firstLine || 'runs'}${t.bundled ? '' : ' (from PATH, not the bundled copy)'}`,
      fix: p.started ? undefined : 'Reinstall Filesmith'
    })
  }
  const gs = await deps.probe(deps.ghostscript(), ['--version'])
  add({ id: 'ghostscript', group: 'core', status: gs.started ? 'ok' : 'warn', detail: gs.started ? `version ${gs.firstLine}` : 'missing; PDF compress levels other than lossless need it', fix: gs.started ? undefined : 'Reinstall Filesmith' })
  const so = deps.soffice()
  add({ id: 'libreoffice', group: 'core', status: deps.exists(so) ? 'ok' : 'warn', detail: deps.exists(so) ? so : 'not found; document conversion needs it', fix: deps.exists(so) ? undefined : 'Reinstall Filesmith' })
  const re = deps.realesrgan()
  const models = deps.ncnnCount()
  add({ id: 'realesrgan', group: 'core', status: deps.exists(re) && models ? 'ok' : 'fail', detail: deps.exists(re) ? `${models} models` : 'missing', fix: deps.exists(re) && models ? undefined : 'Reinstall Filesmith' })
  const rar = deps.rar()
  add({ id: 'winrar', group: 'core', status: rar ? 'ok' : 'warn', detail: rar ?? 'not installed; only CBR and RAR output need it', fix: rar ? undefined : 'Install WinRAR from rarlab.com' })

  const gpu = await deps.gpu()
  const cuda = deps.cuda(gpu)
  add({ id: 'nvidia', group: 'gpu', status: gpu ? 'ok' : 'skip', detail: gpu ? `${gpu.name}, ${gpu.vramMb ?? '?'} MB, compute ${gpu.computeCap ?? '?'}, driver ${gpu.driver ?? '?'}` : 'no NVIDIA GPU (Real-ESRGAN still runs on any Vulkan GPU)' })
  add({ id: 'cuda-tier', group: 'gpu', status: cuda.ok ? 'ok' : 'warn', detail: cuda.ok ? 'PiD and ComfyUI upscalers can run' : (cuda.reason ?? 'not supported') })
  if (o.deep) {
    const s = await deps.deepSmoke()
    add({ id: 'realesrgan-smoke', group: 'gpu', status: s.ok ? 'ok' : 'fail', detail: s.detail, fix: s.ok ? undefined : 'Update your graphics driver (Real-ESRGAN needs Vulkan)' })
  }

  const pid = deps.pidInstalled()
  add({ id: 'pid', group: 'upscale', status: pid ? 'ok' : cuda.ok ? 'warn' : 'skip', detail: pid ? 'installed' : 'not installed', fix: !pid && cuda.ok ? 'filesmith setup pid' : undefined })
  const comfyPy = deps.comfyPythonReady()
  const spandrel = deps.comfyEngineReady() || comfyPy
  add({ id: 'spandrel', group: 'upscale', status: spandrel ? 'ok' : cuda.ok ? 'warn' : 'skip', detail: spandrel ? `ready (${comfyPy ? 'your ComfyUI Python' : 'Filesmith environment'})` : 'not set up', fix: !spandrel && cuda.ok ? 'filesmith setup spandrel' : undefined })
  const folder = deps.comfyFolder()
  add({ id: 'comfy-folder', group: 'upscale', status: folder ? 'ok' : 'warn', detail: folder ? `${folder}, ${deps.comfyModelCount()} usable upscalers` : 'no ComfyUI folder recorded', fix: folder ? undefined : SETUP_COMFY })

  const uv = await deps.uv()
  add({ id: 'uv', group: 'removebg', status: uv ? 'ok' : 'warn', detail: uv ?? 'not found; setup downloads one', fix: uv ? undefined : 'filesmith setup removebg' })
  const rembg = deps.rembgExe()
  const model = deps.rembgModel(BG_DEFAULTS.bgModel)
  add({ id: 'rembg', group: 'removebg', status: rembg && model ? 'ok' : 'warn', detail: rembg && model ? `${rembg}, ${BG_DEFAULTS.bgModel} model present` : rembg ? `${BG_DEFAULTS.bgModel} model missing` : 'not installed', fix: rembg && model ? undefined : 'filesmith setup removebg' })

  const live = await deps.comfyAlive()
  const launchable = deps.comfyLaunchable()
  add({ id: 'comfyui', group: 'generate', status: live || launchable ? 'ok' : 'warn', detail: live ? `running at ${live}` : launchable ? 'found; starts when needed' : 'not found', fix: live || launchable ? undefined : SETUP_COMFY })
  const gen = deps.generationModels()
  const runnable = gen.filter((m) => m.runnable).length
  add({ id: 'gen-models', group: 'generate', status: runnable ? 'ok' : 'warn', detail: `${runnable} of ${gen.length} models ready`, fix: runnable ? undefined : gen.length ? 'filesmith formats generate' : SETUP_COMFY })
  deps.registryWarnings().forEach((w, i) => add({ id: `registry-${i + 1}`, group: 'generate', status: 'warn', detail: w }))
  add({ id: 'channel', group: 'generate', status: 'skip', detail: deps.channelEnabled() ? 'enabled' : 'disabled' })

  const ud = deps.userData()
  const writable = deps.writable(ud)
  add({ id: 'user-data', group: 'environment', status: writable ? 'ok' : 'fail', detail: ud, fix: writable ? undefined : `Check the permissions of ${ud}` })
  const free = deps.freeBytes(ud)
  add({ id: 'disk', group: 'environment', status: free == null || free > 10e9 ? 'ok' : 'warn', detail: free == null ? 'unknown' : `${formatBytes(free)} free` })
  if (deps.packaged()) {
    const onPath = deps.pathEnv().split(';').some((p) => norm(p) === norm(deps.shimDir()))
    add({ id: 'path', group: 'environment', status: onPath ? 'ok' : 'warn', detail: onPath ? `${deps.shimDir()} is on PATH` : 'filesmith is not on PATH in this terminal', fix: onPath ? undefined : 'Open a new terminal (PATH changes reach new terminals only), or reinstall Filesmith' })
    const bundled = deps.bundledVersion()
    add({ id: 'version', group: 'environment', status: bundled === deps.version ? 'ok' : 'fail', detail: `cli ${deps.version}, app ${bundled ?? 'unknown'}`, fix: bundled === deps.version ? undefined : 'Reinstall Filesmith' })
  } else {
    add({ id: 'path', group: 'environment', status: 'skip', detail: 'running from a source checkout' })
  }
  add({ id: 'app', group: 'environment', status: 'ok', detail: (await deps.appRunning()) ? 'the app is running (AI jobs in both load the GPU twice)' : 'the app is not running' })
  const locks = deps.liveLocks()
  add({ id: 'installs', group: 'environment', status: locks.length ? 'warn' : 'ok', detail: locks.length ? locks.map((l) => `${l.what} by the ${l.host} (pid ${l.pid})`).join('; ') : 'no installs running' })
  const proxyGap = (await deps.proxyConfigured()) && !deps.env.HTTPS_PROXY && !deps.env.HTTP_PROXY
  add({ id: 'proxy', group: 'environment', status: proxyGap ? 'warn' : 'ok', detail: proxyGap ? 'Windows uses a proxy but HTTPS_PROXY is not set; setup downloads may fail' : 'ok', fix: proxyGap ? 'set HTTPS_PROXY=http://<proxy>:<port>' : undefined })

  if (o.verify)
    for (const r of await deps.verify())
      add({ id: `verify ${r.id}`, group: 'verify', status: r.ok ? 'ok' : 'fail', detail: r.detail, fix: r.ok ? undefined : 'filesmith setup remove <tool>, then set it up again' })
  return checks
}

export async function runDoctor(args: ParsedArgs, reporter: Reporter, deps: DoctorDeps, clock: () => number): Promise<number> {
  const t0 = clock()
  reporter.emit({ event: 'run', command: 'doctor', version: VERSION, dryRun: false, inputs: 0, options: { ...args.values } })
  const checks = await collectChecks(deps, { deep: args.values.deep === true, verify: args.values.verify === true })
  let group = ''
  for (const c of checks) {
    if (c.group !== group) {
      group = c.group
      reporter.text(`${group.toUpperCase()}\n`)
    }
    reporter.emit({ event: 'check', ...c })
  }
  const count = (s: Check['status']): number => checks.filter((c) => c.status === s).length
  const exitCode = count('fail') ? 1 : 0
  reporter.emit({ event: 'summary', ok: count('ok') + count('warn'), failed: count('fail'), skipped: count('skip'), canceled: 0, inBytes: 0, outBytes: 0, ms: clock() - t0, exitCode })
  return exitCode
}
```

`src/cli/main.ts`: `CliDeps` gains `formats: FormatsDeps` and `doctor: DoctorDeps`; `dispatch` gains

```ts
    case 'formats':
      return runFormats(args, reporter, deps.formats)
    case 'doctor':
      return runDoctor(args, reporter, deps.doctor, deps.clock)
```

`src/cli/deps.ts`: add (merge imports with the existing ones):

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import { BG_DEFAULTS } from '@shared/removebg'
import { run } from '../main/run'
import { realesrganDir, resolveGhostscript, resolveRealesrgan, resolveSoffice, resolveTool } from '../main/toolResolver'
import { findUvAsync } from '../main/uv'
import { firstLiveComfy, findComfyLaunch } from '../main/generate/comfy'
import { loadRegistry } from '../main/registry/load'
import { channelEnabled } from '../main/registry/channel'
import { readComfyStore } from '../main/comfy/store'
import { pidWeightFiles } from '../main/pid/install'
import { expectedHash } from '../main/net/integrity'
import { hashFile } from '../main/rembg/setup'
import { resourcePath } from '../main/env'
import { VERSION } from './version'
import type { FormatsDeps } from './commands/formats'
import type { DoctorDeps } from './commands/doctor'

export function defaultFormatsDeps(): FormatsDeps {
  return {
    hasRar: () => resolveRar() != null,
    ncnnModels: () => listNcnnModels().map((m) => ({ name: m.name, label: m.label, user: m.user })),
    comfyModels: () => usableComfyModels(),
    comfyReady: () => comfyEngineReady() || comfyPythonReady(),
    pidInstalled: () => pidInstalled('flux'),
    cudaOk: async () => cudaTierSupport(await detectNvidia()).ok,
    rembgReady: () => installedRembgExe() != null && rembgModelPresent(BG_DEFAULTS.bgModel),
    generationModels: () => scanGenerationModels().models
  }
}

const packaged = (): boolean => basename(process.execPath).toLowerCase() === 'filesmith.exe'

async function probe(cmd: string, args: string[]): Promise<{ started: boolean; firstLine: string }> {
  try {
    const r = await run(cmd, args)
    return { started: true, firstLine: (r.stdout || r.stderr).trim().split(/\r?\n/)[0]?.slice(0, 60) ?? '' }
  } catch {
    return { started: false, firstLine: '' }
  }
}

export function defaultDoctorDeps(): DoctorDeps {
  return {
    tool: (name) => {
      const path = resolveTool(name)
      return { path, bundled: path !== name }
    },
    probe,
    ghostscript: resolveGhostscript,
    soffice: resolveSoffice,
    rar: resolveRar,
    realesrgan: resolveRealesrgan,
    ncnnCount: () => listNcnnModels().length,
    exists: existsSync,
    gpu: detectNvidia,
    cuda: (gpu) => cudaTierSupport(gpu),
    pidInstalled: () => pidInstalled('flux'),
    comfyEngineReady,
    comfyPythonReady,
    comfyFolder: () => readComfyStore()?.folder || null,
    comfyModelCount: () => usableComfyModels().length,
    uv: findUvAsync,
    rembgExe: installedRembgExe,
    rembgModel: rembgModelPresent,
    comfyAlive: firstLiveComfy,
    comfyLaunchable: () => findComfyLaunch() != null,
    generationModels: () => scanGenerationModels().models,
    registryWarnings: () => loadRegistry().warnings,
    channelEnabled,
    userData: () => engineEnv().userData,
    writable: (dir) => {
      try {
        mkdirSync(dir, { recursive: true })
        const probeFile = join(dir, `.doctor-${process.pid}`)
        writeFileSync(probeFile, '')
        rmSync(probeFile, { force: true })
        return true
      } catch {
        return false
      }
    },
    freeBytes: freeBytesAt,
    packaged,
    shimDir: () => resourcePath('cli'),
    pathEnv: () => process.env.PATH ?? '',
    appRunning: async () => {
      try {
        const r = await run('tasklist', ['/FI', 'IMAGENAME eq Filesmith.exe', '/FO', 'CSV', '/NH'])
        return r.stdout
          .split(/\r?\n/)
          .map((l) => /^"Filesmith\.exe","(\d+)"/i.exec(l)?.[1])
          .some((pid) => pid && Number(pid) !== process.pid)
      } catch {
        return false
      }
    },
    liveLocks: () =>
      ['pid-env', 'rembg', 'companions']
        .map((n) => readLock(n))
        .filter((l): l is NonNullable<typeof l> => l != null && !isStale(l)),
    proxyConfigured: async () => {
      try {
        const r = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'])
        return /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(r.stdout)
      } catch {
        return false
      }
    },
    env: process.env,
    version: VERSION,
    bundledVersion: () => {
      try {
        return (JSON.parse(readFileSync(resourcePath('app.asar', 'package.json'), 'utf-8')) as { version: string }).version
      } catch {
        return null
      }
    },
    deepSmoke: async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'filesmith-doctor-'))
      try {
        const src = join(tmp, 'in.png')
        const out = join(tmp, 'out.png')
        await run(resolveTool('magick'), ['-size', '4x4', 'xc:white', src])
        const r = await run(resolveRealesrgan(), ['-i', src, '-o', out, '-s', '4', '-n', 'realesrgan-x4plus', '-m', join(realesrganDir(), 'models')])
        return existsSync(out) ? { ok: true, detail: 'a 4x4 image upscaled on the GPU' } : { ok: false, detail: (r.stderr.trim().split('\n').pop() ?? '').slice(0, 70) }
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    },
    verify: async () => {
      const items = [
        ...pidWeightFiles('flux').map((f) => ({ id: `pid ${basename(f.path)}`, path: f.path, key: f.url })),
        { id: `rembg ${BG_DEFAULTS.bgModel}`, path: rembgModelFile(BG_DEFAULTS.bgModel), key: `rembg-model:${BG_DEFAULTS.bgModel}` }
      ].filter((i) => existsSync(i.path))
      const out: { id: string; ok: boolean; detail: string }[] = []
      for (const i of items) {
        const want = expectedHash(i.key)
        if (!want) {
          out.push({ id: i.id, ok: true, detail: 'no hash on record to compare with' })
          continue
        }
        const got = await hashFile(i.path)
        out.push({ id: i.id, ok: got === want, detail: got === want ? 'sha256 matches' : `sha256 differs from the record (${got.slice(0, 12)}...)` })
      }
      return out
    }
  }
}
```

(add `rembgModelFile` to the rembg paths import), and `defaultDeps()` gains `formats: defaultFormatsDeps(), doctor: defaultDoctorDeps()`. Give `test/cli-main.test.ts` deps `formats` and `doctor` members (the fakes from the two new tests).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/cli-formats.test.ts test/cli-doctor.test.ts test/cli-human.test.ts test/cli-main.test.ts`
Expected: PASS.

- [ ] **Step 5: Try both on this machine**

Run: `npm run build && node out/main/cli.js doctor && node out/main/cli.js doctor --json --deep && node out/main/cli.js formats upscale`
Expected: doctor lists the core tools ok, the RTX 5090 under GPU, exits 0; `--deep` adds `realesrgan-smoke ok`; formats lists photo, anime, the other bundled models, pid and any scanned ComfyUI upscalers.

- [ ] **Step 6: Add the e2e checks and commit**

Append to `e2e/cli.spec.ts`:

```ts
test('formats --json and doctor --json produce valid events', () => {
  const f = cli(['formats', '--json'])
  expect(f.code).toBe(0)
  expect(Object.keys(of(f.events, 'formats')[0].data as object)).toContain('convert')
  const d = cli(['doctor', '--json'])
  expect([0, 1]).toContain(d.code)
  expect(of(d.events, 'check').find((c) => c.id === 'magick')).toMatchObject({ status: 'ok' })
  expect(d.events.at(-1)).toMatchObject({ event: 'summary' })
})
```

```bash
npm run typecheck && npm run lint && npx prettier --write src test e2e && npm test && npx playwright test e2e/cli.spec.ts
git add src test e2e
git commit -m "feat(cli): formats and doctor" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: PATH shims and the per-user installer (M9)

**Files:**
- Create: `resources/cli/filesmith.cmd`, `resources/cli/filesmith`, `resources/cli/path.ps1`, `build/installer/path.nsh`, `.gitattributes`, `test/path-ps1.test.ts`, `e2e/cli-packed.spec.ts`
- Modify: `build/installer.nsh` (include, `customUnInstall`), `build/installer/pages.nsh:28-30` (`customInstall`), `electron-builder.yml` (extraResources `cli`, fuse note)

**Interfaces:**
- Consumes: the built `out/main/cli.js` (Task 11).
- Produces: `<install>\resources\cli\filesmith.cmd` and `filesmith` (sh) that run `<install>\Filesmith.exe --use-system-ca <install>\resources\app.asar\out\main\cli.js <args>` with `ELECTRON_RUN_AS_NODE=1` and `NODE_USE_ENV_PROXY=1`; `path.ps1 add|remove <dir> [-Key <HKCU subkey>]`; NSIS macros `filesmithPathAdd`, `filesmithPathRemove`; the HKCU PATH entry `<install>\resources\cli`.

- [ ] **Step 1: Write the failing PATH-editor test**

`test/path-ps1.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { resolve } from 'path'

// Runs the real script against a throwaway HKCU key, never HKCU\Environment.
const SCRIPT = resolve(__dirname, '..', 'resources', 'cli', 'path.ps1')
const KEY = `Software\\FilesmithTest\\Env-${process.pid}`
const REG = `HKCU\\${KEY}`
const ps = (action: string, dir: string): void => {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, action, dir, '-Key', KEY])
}
const read = (): string => {
  const out = execFileSync('reg', ['query', REG, '/v', 'Path']).toString()
  return /Path\s+REG_EXPAND_SZ\s+(.*)/.exec(out)?.[1]?.trim() ?? `not expand_sz: ${out}`
}

afterAll(() => {
  spawnSync('reg', ['delete', 'HKCU\\Software\\FilesmithTest', '/f'])
})

describe.skipIf(process.platform !== 'win32')('path.ps1', () => {
  it('adds once, keeps %VARS% unexpanded and REG_EXPAND_SZ, removes cleanly', () => {
    execFileSync('reg', ['add', REG, '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', '%USERPROFILE%\\bin;C:\\Other', '/f'])
    ps('add', 'C:\\Apps\\Filesmith\\resources\\cli')
    ps('add', 'c:\\apps\\filesmith\\resources\\cli\\')
    expect(read()).toBe('%USERPROFILE%\\bin;C:\\Other;C:\\Apps\\Filesmith\\resources\\cli')
    ps('remove', 'C:\\APPS\\Filesmith\\resources\\cli')
    expect(read()).toBe('%USERPROFILE%\\bin;C:\\Other')
    ps('remove', 'C:\\Apps\\Filesmith\\resources\\cli')
    expect(read()).toBe('%USERPROFILE%\\bin;C:\\Other')
  })

  it('creates the value when the user has no PATH of their own yet', () => {
    spawnSync('reg', ['delete', REG, '/v', 'Path', '/f'])
    ps('add', 'D:\\F\\resources\\cli')
    expect(read()).toBe('D:\\F\\resources\\cli')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/path-ps1.test.ts`
Expected: FAIL, PowerShell cannot find `resources\cli\path.ps1`.

- [ ] **Step 3: Write the shims and the PATH editor**

`.gitattributes`:

```
# The sh shim must keep LF or Git Bash fails with "$'\r': command not found".
resources/cli/filesmith text eol=lf
resources/cli/*.cmd text eol=crlf
resources/cli/*.ps1 text eol=crlf
# Skill files (Task 17): their frontmatter is matched with LF in tests.
resources/skill/** text eol=lf
```

`resources/cli/filesmith.cmd`:

```bat
@echo off
rem Filesmith command line (spec 7.1). Runs the app's own Electron as plain
rem Node, so the app's single-instance lock is never involved and the app can
rem stay open. A .cmd makes cmd and PowerShell wait and pass the exit code back.
setlocal
set ELECTRON_RUN_AS_NODE=1
rem Downloads in `filesmith setup` follow HTTPS_PROXY and trust the Windows
rem certificate store, like the app's own downloader.
set NODE_USE_ENV_PROXY=1
"%~dp0..\..\Filesmith.exe" --use-system-ca "%~dp0..\app.asar\out\main\cli.js" %*
exit /b %ERRORLEVEL%
```

`resources/cli/filesmith` (LF line endings; the `.gitattributes` above keeps them):

```sh
#!/bin/sh
# Filesmith command line for Git Bash, MSYS and Claude Code's Bash tool, which
# do not run .cmd files by bare name (spec 7.1). Same command as filesmith.cmd.
dir=$(dirname "$0")
here=$(cd "$dir" && (pwd -W 2>/dev/null || pwd))
export ELECTRON_RUN_AS_NODE=1
export NODE_USE_ENV_PROXY=1
exec "$here/../../Filesmith.exe" --use-system-ca "$here/../app.asar/out/main/cli.js" "$@"
```

`resources/cli/path.ps1`:

```powershell
# Adds or removes one folder on the per-user PATH without touching anything
# else (spec 7.2): the value stays REG_EXPAND_SZ with its %VARS% unexpanded, the
# compare ignores case and a trailing backslash, and repeating a call is a no-op.
# Pure NSIS string handling is not used because it truncates PATHs over 1024
# characters; [Environment]::SetEnvironmentVariable is not used because it
# flattens REG_EXPAND_SZ to REG_SZ.
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Dir,
  [string]$Key = 'Environment'
)
$ErrorActionPreference = 'Stop'
$reg = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Key)
try {
  $opts = [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
  $current = [string]$reg.GetValue('Path', '', $opts)
  $norm = { param([string]$p) $p.Trim().TrimEnd('\').ToLowerInvariant() }
  $target = & $norm $Dir
  $parts = @($current -split ';' | Where-Object { $_.Trim() -ne '' })
  $present = @($parts | Where-Object { (& $norm $_) -eq $target }).Count -gt 0
  $changed = $false
  if ($Action -eq 'add' -and -not $present) {
    $parts += $Dir.TrimEnd('\')
    $changed = $true
  }
  if ($Action -eq 'remove' -and $present) {
    $parts = @($parts | Where-Object { (& $norm $_) -ne $target })
    $changed = $true
  }
  if ($changed) {
    $reg.SetValue('Path', ($parts -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
  }
} finally {
  $reg.Close()
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/path-ps1.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the installer and the packaging**

`build/installer/path.nsh`:

```nsis
;
; Filesmith on the per-user PATH (spec 7.2). The edit itself is path.ps1, which
; keeps REG_EXPAND_SZ and never truncates a long PATH. Only resources\cli goes
; on PATH: putting resources\bin there would shadow the user's own ffmpeg,
; magick and 7z.
;
!include "WinMessages.nsh"

!define FILESMITH_PS '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli\path.ps1"'

!macro filesmithPathAdd
  nsExec::ExecToLog '${FILESMITH_PS} add "$INSTDIR\resources\cli"'
  Pop $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro filesmithPathRemove
  nsExec::ExecToLog '${FILESMITH_PS} remove "$INSTDIR\resources\cli"'
  Pop $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
```

`build/installer.nsh`: add, ABOVE the `!ifndef BUILD_UNINSTALLER` guard (the uninstaller needs the macros too):

```nsis
; PATH entry for the command line (spec 7.2). Outside the guard: the uninstaller
; compiles from this file and removes the entry.
!include "installer\path.nsh"

; Uninstall drops the PATH entry, except during an update: electron-builder
; runs the old uninstaller with --updated, and the new version re-adds the same
; folder at once, so the entry should not blink out in between.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro filesmithPathRemove
  ${endIf}
!macroend
```

`build/installer/pages.nsh`, the existing `customInstall` becomes:

```nsis
; When the section ends, autoclose walks on to the finish page by itself: the
; Next button it would otherwise wait for has been hidden since .onGUIInit.
; Before that, put the command line on the per-user PATH (path.nsh).
!macro customInstall
  !insertmacro filesmithPathAdd
  SetAutoClose true
!macroend
```

Before editing, run `grep -rn "customUnInstall" build/` and confirm nothing else defines it (a macro can be defined only once).

`electron-builder.yml`: add to `extraResources` (after `spandrel`):

```yaml
  # The command line's shims and PATH editor (spec 7.1). Only this folder goes on
  # PATH. The shims run Filesmith.exe with ELECTRON_RUN_AS_NODE, so the
  # runAsNode Electron fuse must stay enabled: never add electronFuses.runAsNode
  # false (the release smoke test fails if it is).
  - from: resources/cli
    to: cli
    filter: ['**/*']
```

- [ ] **Step 6: Write the packed-layout tests**

`e2e/cli-packed.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAGICK, ROOT, magickEnv } from './helpers'

// The shims as installed: dist/win-unpacked is the install layout. Build it with
// `npm run build && npx electron-builder --win dir` first.
const RES = join(ROOT, 'dist', 'win-unpacked', 'resources')
const CMD = join(RES, 'cli', 'filesmith.cmd')
const SH = join(RES, 'cli', 'filesmith').replace(/\\/g, '/')
const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string }).version

test.skip(!existsSync(CMD), 'build the unpacked app first: npx electron-builder --win dir')

let work: string
test.beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'fs-packed-'))
})
test.afterEach(() => rmSync(work, { recursive: true, force: true }))

const viaCmd = (args: string) =>
  spawnSync('cmd.exe', ['/d', '/s', '/c', `"${CMD}" ${args}`], {
    encoding: 'utf-8',
    windowsVerbatimArguments: true,
    env: { ...process.env, FILESMITH_USER_DATA: join(work, '.ud') }
  })

test('filesmith.cmd: version, waits, and passes exit codes through', () => {
  expect(viaCmd('--version').stdout.trim()).toBe(VERSION)
  expect(viaCmd('convert x.png --bogus').status).toBe(2)
})

test('filesmith.cmd keeps spaces, & and non-ASCII letters in paths', () => {
  const file = join(work, 'a & b ä.png')
  execFileSync(MAGICK, ['-size', '8x8', 'xc:red', file], { env: magickEnv })
  const r = viaCmd(`convert "${file}" --to webp --dry-run --json`)
  expect(r.status).toBe(0)
  const plan = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === 'plan')
  expect(plan.input).toBe(file)
})

test('the sh shim works from Git Bash', () => {
  const r = spawnSync('sh', [SH, '--version'], { encoding: 'utf-8' })
  expect(r.stdout.trim()).toBe(VERSION)
})
```

- [ ] **Step 7: Build the unpacked app and run the packed tests**

Run: `npm run build && npx electron-builder --win dir --publish never && npx playwright test e2e/cli-packed.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Prove install, PATH and uninstall on this machine**

```bash
npm run package
```

Then in PowerShell (the version is still 0.5.2 at this point):

```powershell
Start-Process -Wait "dist\Filesmith-Setup-x64-0.5.2.exe" -ArgumentList '/S'
$user = (Get-Item 'HKCU:\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames')
$user -split ';' | Select-String 'resources\\cli'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
filesmith --version
filesmith doctor
Start-Process -Wait "$env:LOCALAPPDATA\Programs\Filesmith\Uninstall Filesmith.exe" -ArgumentList '/S'
((Get-Item 'HKCU:\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames') -split ';') -match 'resources\\cli'
Start-Process -Wait "dist\Filesmith-Setup-x64-0.5.2.exe" -ArgumentList '/S'
```

Expected: one `...\Filesmith\resources\cli` entry after install; `filesmith --version` prints `0.5.2`; doctor's `path` check is `ok`; after the uninstall the last query prints nothing; the reinstall leaves exactly one entry again. If the install folder differs from `%LOCALAPPDATA%\Programs\Filesmith`, read it from the PATH entry and use that.

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck && npm run lint && npx prettier --check . && npm test
git add .gitattributes resources/cli build/installer.nsh build/installer/path.nsh build/installer/pages.nsh electron-builder.yml test/path-ps1.test.ts e2e/cli-packed.spec.ts
git commit -m "feat(installer): filesmith on the per-user PATH with cmd and sh shims" -m "The shims run Filesmith.exe as Node (ELECTRON_RUN_AS_NODE) with --use-system-ca and NODE_USE_ENV_PROXY. path.ps1 edits HKCU PATH safely; uninstall removes the entry except during updates." -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: The Claude skill, `filesmith skill`, and the Settings button (M10)

**Files:**
- Create: `resources/skill/filesmith/SKILL.md`, `resources/skill/filesmith/reference.md`, `src/main/skill.ts`, `src/cli/commands/skill.ts`, `src/renderer/src/components/views/ClaudeSkill.tsx`, `test/skill.test.ts`, `e2e/skill.spec.ts`
- Modify: `src/shared/ipc.ts` (types), `src/main/ipc.ts` (two handlers), `src/preload/index.ts` (two methods), `src/renderer/src/components/views/SettingsView.tsx` (one group), `src/cli/commands/doctor.ts` (skill check), `src/cli/main.ts`, `src/cli/deps.ts`, `electron-builder.yml` (extraResources `skill`), `test/cli-doctor.test.ts`

**Interfaces:**
- Consumes: `resourcePath`, `engineEnv` (Task 2); `moveToRecycleBin` (Task 14); `COMMANDS` (Task 7, for the drift test).
- Produces:
  - `@shared/ipc`: `interface SkillStatus { installed: boolean; path: string; version: string | null; current: boolean }`, `interface SkillInstallResult { ok: boolean; path?: string; updated?: boolean; previousVersion?: string; error?: string }`.
  - `src/main/skill.ts`: `SKILL_FILES`, `skillTargetDir(home: string): string`, `skillSourceDir(): string`, `skillCommand(packaged: boolean, resourcesDir: string): string`, `renderSkillFile(text: string, version: string, command: string): string`, `skillStatus(home: string, version: string): SkillStatus`, `interface SkillInstallOutcome { path: string; updated: boolean; previousVersion?: string; changed: string[] }`, `installSkill(e: { home: string; version: string; command: string; sourceDir?: string; trash(path: string): Promise<void>; dryRun?: boolean }): Promise<SkillInstallOutcome>`.
  - preload: `installSkill(): Promise<SkillInstallResult>`, `skillStatus(): Promise<SkillStatus>`.
  - `commands/skill.ts`: `interface SkillDeps { install(o: { dryRun: boolean }): Promise<SkillInstallOutcome>; status(): SkillStatus; sourceDir(): string }`, `runSkill(args, reporter, deps, clock): Promise<number>`; `DoctorDeps.skill(): SkillStatus`.

- [ ] **Step 1: Write the skill files**

`resources/skill/filesmith/SKILL.md` (the `{{VERSION}}` and `{{FILESMITH}}` placeholders are filled in at install time):

````markdown
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
````

`resources/skill/filesmith/reference.md`:

````markdown
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
- `done` (files): `id`, `input`, `output`, `outputKind`, `inSize`, `outSize` or `files`, `ms`, `seed` (generate with a fixed seed)
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
````

- [ ] **Step 2: Write the failing tests**

`test/skill.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { installSkill, skillCommand, skillStatus, skillTargetDir } from '../src/main/skill'
import { COMMANDS } from '../src/cli/catalog'

const SRC = resolve(__dirname, '..', 'resources', 'skill', 'filesmith')
let home: string
const trashed: string[] = []
const env = (over = {}) => ({ home, version: '0.6.0', command: 'C:/F/resources/cli/filesmith', sourceDir: SRC, trash: async (p: string) => void trashed.push(p), ...over })
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'fs-home-'))
  trashed.length = 0
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('skill', () => {
  it('installs into ~/.claude/skills/filesmith with the version and command filled in', async () => {
    const r = await installSkill(env())
    expect(r).toMatchObject({ path: skillTargetDir(home), updated: false, changed: ['SKILL.md', 'reference.md'] })
    const text = readFileSync(join(skillTargetDir(home), 'SKILL.md'), 'utf-8')
    expect(text).toContain('filesmith-version: 0.6.0')
    expect(text).toContain('C:/F/resources/cli/filesmith')
    expect(text).not.toContain('{{')
    expect(skillStatus(home, '0.6.0')).toMatchObject({ installed: true, version: '0.6.0', current: true })
  })

  it('updating replaces only its own files, trashing the old copies, and keeps foreign files', async () => {
    await installSkill(env({ version: '0.5.9' }))
    writeFileSync(join(skillTargetDir(home), 'notes.md'), 'mine')
    const r = await installSkill(env())
    expect(r).toMatchObject({ updated: true, previousVersion: '0.5.9' })
    expect(trashed.map((p) => p.split(/[\\/]/).pop())).toContain('SKILL.md')
    expect(readFileSync(join(skillTargetDir(home), 'notes.md'), 'utf-8')).toBe('mine')
  })

  it('a dry run changes nothing; an up-to-date install changes nothing', async () => {
    const dry = await installSkill(env({ dryRun: true }))
    expect(dry.changed).toEqual(['SKILL.md', 'reference.md'])
    expect(existsSync(skillTargetDir(home))).toBe(false)
    await installSkill(env())
    expect((await installSkill(env())).changed).toEqual([])
  })

  it('status of a missing or older skill', () => {
    expect(skillStatus(home, '0.6.0')).toMatchObject({ installed: false, version: null, current: false })
    mkdirSync(skillTargetDir(home), { recursive: true })
    writeFileSync(join(skillTargetDir(home), 'SKILL.md'), '---\nfilesmith-version: 0.5.0\n---\n')
    expect(skillStatus(home, '0.6.0')).toMatchObject({ installed: true, version: '0.5.0', current: false })
  })

  it('the command is the sh shim when packaged, node + cli.js in dev', () => {
    expect(skillCommand(true, 'C:\\P\\Filesmith\\resources')).toBe('C:/P/Filesmith/resources/cli/filesmith')
    expect(skillCommand(false, 'D:\\repo\\resources')).toBe('node D:/repo/out/main/cli.js')
  })

  it('reference.md names every command and every flag (drift guard)', () => {
    const ref = readFileSync(join(SRC, 'reference.md'), 'utf-8')
    for (const c of COMMANDS) {
      expect(ref, c.id).toContain(c.path[c.path.length - 1])
      for (const f of c.flags) expect(ref, `${c.id} --${f.name}`).toContain(`--${f.name}`)
    }
  })

  it('the skill frontmatter starts with name and a "Use when" description', () => {
    const md = readFileSync(join(SRC, 'SKILL.md'), 'utf-8')
    expect(md).toMatch(/^---\nname: filesmith\ndescription: Use when /)
  })
})
```

Append to `test/cli-doctor.test.ts` (and add `skill: () => ({ installed: false, path: 'H:\\.claude\\skills\\filesmith', version: null, current: false })` to `good()`):

```ts
  it('reports the Claude skill and offers to install or update it', async () => {
    const missing = await collectChecks(good(), { deep: false, verify: false })
    expect(missing.find((c) => c.id === 'skill')).toMatchObject({ status: 'warn', fix: 'filesmith skill install' })
    const old = await collectChecks(good({ skill: () => ({ installed: true, path: 'x', version: '0.5.0', current: false }) }), { deep: false, verify: false })
    expect(old.find((c) => c.id === 'skill')?.detail).toContain('0.5.0')
  })
```

`e2e/skill.spec.ts`:

```ts
import { _electron } from 'playwright'
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIN, ROOT } from './helpers'

// The Settings button (M10) against a throwaway home folder: homedir() follows
// USERPROFILE on Windows, so the real ~/.claude is never touched.
test('Settings installs the Claude skill and shows its version', async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  const profile = mkdtempSync(join(tmpdir(), 'fs-profile-'))
  const userData = mkdtempSync(join(tmpdir(), 'fs-ud-'))
  const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string }).version
  const app = await _electron.launch({ args: [ROOT], env: { ...process.env, USERPROFILE: profile, FILESMITH_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('navigation', { name: 'Operations' }).getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByText('Not installed')).toBeVisible()
    await page.getByRole('button', { name: 'Install Claude skill' }).click()
    await expect(page.getByText(`Installed ${version}`)).toBeVisible()
    expect(existsSync(join(profile, '.claude', 'skills', 'filesmith', 'SKILL.md'))).toBe(true)
    if (process.env.FILESMITH_SHOTS) await page.screenshot({ path: join(ROOT, 'docs', 'mockups', 'cli-settings-skill.png') })
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run test/skill.test.ts test/cli-doctor.test.ts`
Expected: FAIL, unresolved `../src/main/skill`.

- [ ] **Step 4: Implement the shared install logic**

`src/shared/ipc.ts`, append:

```ts
/** skill:status: the Claude Code skill in ~/.claude/skills/filesmith. */
export interface SkillStatus {
  installed: boolean
  path: string
  version: string | null
  /** Installed and the same version as the app. */
  current: boolean
}

/** skill:install */
export interface SkillInstallResult {
  ok: boolean
  path?: string
  updated?: boolean
  previousVersion?: string
  error?: string
}
```

`src/main/skill.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SkillStatus } from '@shared/ipc'
import { resourcePath } from './env'

/** The files the installer owns; anything else in the folder is left alone. */
export const SKILL_FILES = ['SKILL.md', 'reference.md'] as const

export function skillTargetDir(home: string): string {
  return join(home, '.claude', 'skills', 'filesmith')
}

export function skillSourceDir(): string {
  return resourcePath('skill', 'filesmith')
}

/** What the skill tells an agent to run when `filesmith` is not on PATH yet:
 * the sh shim (Claude Code's Bash tool is Git Bash), forward slashes. */
export function skillCommand(packaged: boolean, resourcesDir: string): string {
  const fwd = (p: string): string => p.replace(/\\/g, '/')
  return packaged
    ? fwd(join(resourcesDir, 'cli', 'filesmith'))
    : `node ${fwd(join(resourcesDir, '..', 'out', 'main', 'cli.js'))}`
}

export function renderSkillFile(text: string, version: string, command: string): string {
  return text.replaceAll('{{VERSION}}', version).replaceAll('{{FILESMITH}}', command)
}

function installedVersion(dir: string): string | null {
  try {
    return /^\s*filesmith-version:\s*(\S+)/m.exec(readFileSync(join(dir, 'SKILL.md'), 'utf-8'))?.[1] ?? null
  } catch {
    return null
  }
}

export function skillStatus(home: string, version: string): SkillStatus {
  const path = skillTargetDir(home)
  const v = installedVersion(path)
  return { installed: v != null, path, version: v, current: v === version }
}

export interface SkillInstallOutcome {
  path: string
  updated: boolean
  previousVersion?: string
  /** Files that were (or, in a dry run, would be) written. */
  changed: string[]
}

/** Copy the bundled skill into ~/.claude/skills/filesmith (spec 6.3). Shared by
 * `filesmith skill install` and the Settings button; `trash` is the host's
 * Recycle Bin call, used for a file that is being replaced. */
export async function installSkill(e: {
  home: string
  version: string
  command: string
  sourceDir?: string
  trash(path: string): Promise<void>
  dryRun?: boolean
}): Promise<SkillInstallOutcome> {
  const src = e.sourceDir ?? skillSourceDir()
  const dest = skillTargetDir(e.home)
  const previous = installedVersion(dest)
  const files = SKILL_FILES.map((name) => ({
    name,
    text: renderSkillFile(readFileSync(join(src, name), 'utf-8'), e.version, e.command)
  }))
  const changed = files
    .filter((f) => {
      try {
        return readFileSync(join(dest, f.name), 'utf-8') !== f.text
      } catch {
        return true
      }
    })
    .map((f) => f.name)
  if (!e.dryRun) {
    mkdirSync(dest, { recursive: true })
    for (const f of files) {
      if (!changed.includes(f.name)) continue
      const target = join(dest, f.name)
      if (existsSync(target)) await e.trash(target)
      writeFileSync(target, f.text)
    }
  }
  return { path: dest, updated: previous != null, ...(previous ? { previousVersion: previous } : {}), changed }
}
```

- [ ] **Step 5: The CLI command and the doctor check**

`src/cli/commands/skill.ts`:

```ts
import type { SkillStatus } from '@shared/ipc'
import type { SkillInstallOutcome } from '../../main/skill'
import type { CommandSpec } from '../catalog'
import type { Reporter } from '../events'
import type { ParsedArgs } from '../parse'
import { VERSION } from '../version'

export interface SkillDeps {
  install(o: { dryRun: boolean }): Promise<SkillInstallOutcome>
  status(): SkillStatus
  sourceDir(): string
}

export async function runSkill(args: ParsedArgs, reporter: Reporter, deps: SkillDeps, clock: () => number): Promise<number> {
  const t0 = clock()
  const cmd = args.command as CommandSpec
  if (cmd.id === 'skill status') {
    const s = deps.status()
    reporter.emit({
      event: 'check',
      id: 'skill',
      group: 'skill',
      status: s.installed && s.current ? 'ok' : 'warn',
      detail: s.installed ? `${s.version} at ${s.path}${s.current ? '' : `, the app is ${VERSION}`}` : 'not installed',
      fix: s.installed && s.current ? undefined : 'filesmith skill install'
    })
    return 0
  }
  reporter.emit({ event: 'run', command: 'skill install', version: VERSION, dryRun: args.dryRun, inputs: 0, options: {} })
  const r = await deps.install({ dryRun: args.dryRun })
  if (args.dryRun) {
    reporter.emit({ event: 'step', step: 'From', pct: null, detail: deps.sourceDir() })
    reporter.emit({ event: 'step', step: 'To', pct: null, detail: r.path })
    reporter.emit({ event: 'step', step: 'Would write', pct: null, detail: r.changed.length ? r.changed.join(', ') : 'nothing, already current' })
  } else {
    reporter.emit({ event: 'done', path: r.path, updated: r.updated, previousVersion: r.previousVersion })
  }
  reporter.emit({ event: 'summary', ok: 1, failed: 0, skipped: 0, canceled: 0, inBytes: 0, outBytes: 0, ms: clock() - t0, exitCode: 0 })
  return 0
}
```

`src/cli/commands/doctor.ts`: add `skill(): SkillStatus` to `DoctorDeps` (import the type from `@shared/ipc`) and, after the `proxy` check:

```ts
  const skill = deps.skill()
  add({
    id: 'skill',
    group: 'environment',
    status: skill.installed && skill.current ? 'ok' : 'warn',
    detail: skill.installed ? `Claude skill ${skill.version}${skill.current ? '' : `, older than ${deps.version}`}` : 'Claude skill not installed',
    fix: skill.installed && skill.current ? undefined : 'filesmith skill install'
  })
```

`src/cli/main.ts`: `CliDeps` gains `skill: SkillDeps`; `dispatch` gains `case 'skill install': case 'skill status': return runSkill(args, reporter, deps.skill, deps.clock)`.

`src/cli/deps.ts`:

```ts
import { homedir } from 'os'
import { installSkill, skillCommand, skillSourceDir, skillStatus } from '../main/skill'
import type { SkillDeps } from './commands/skill'

export function defaultSkillDeps(): SkillDeps {
  const command = skillCommand(packaged(), engineEnv().resourcesDir)
  return {
    install: ({ dryRun }) => installSkill({ home: homedir(), version: VERSION, command, trash: moveToRecycleBin, dryRun }),
    status: () => skillStatus(homedir(), VERSION),
    sourceDir: skillSourceDir
  }
}
```

`defaultDoctorDeps()` gains `skill: () => skillStatus(homedir(), VERSION)`; `defaultDeps()` gains `skill: defaultSkillDeps()`. Give `test/cli-main.test.ts` deps a `skill` member.

- [ ] **Step 6: The app side (IPC, preload, Settings)**

`src/main/ipc.ts`: add `app` to the electron import, `homedir` from `os`, and

```ts
import { installSkill, skillCommand, skillStatus } from './skill'
import { engineEnv } from './env'
import type { SkillInstallResult, SkillStatus } from '@shared/ipc'
```

then, next to the other status handlers:

```ts
  // --- Claude Code skill (spec 6.3, M10). Same function as `filesmith skill install`.
  ipcMain.handle('skill:status', (): SkillStatus => skillStatus(homedir(), app.getVersion()))
  ipcMain.handle('skill:install', async (): Promise<SkillInstallResult> => {
    try {
      const r = await installSkill({
        home: homedir(),
        version: app.getVersion(),
        command: skillCommand(app.isPackaged, engineEnv().resourcesDir),
        trash: (p) => shell.trashItem(p)
      })
      return { ok: true, path: r.path, updated: r.updated, previousVersion: r.previousVersion }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
```

`src/preload/index.ts`: add `SkillInstallResult, SkillStatus` to the `@shared/ipc` type import and, in `api`:

```ts
  /** Claude Code skill (Settings > CLAUDE). */
  skillStatus: (): Promise<SkillStatus> => ipcRenderer.invoke('skill:status'),
  installSkill: (): Promise<SkillInstallResult> => ipcRenderer.invoke('skill:install'),
```

`src/renderer/src/components/views/ClaudeSkill.tsx`:

```tsx
import { useEffect, useState, type JSX } from 'react'
import type { SkillStatus } from '@shared/ipc'
import { SmallButton } from '../ui/Button'
import { Setting } from '../ui/Setting'

/** Settings > CLAUDE: install or update the Filesmith skill for Claude Code. */
export function ClaudeSkill(): JSX.Element {
  const [status, setStatus] = useState<SkillStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void window.filesmith.skillStatus().then((s) => alive && setStatus(s))
    return () => {
      alive = false
    }
  }, [])
  async function install(): Promise<void> {
    setBusy(true)
    setError(null)
    const r = await window.filesmith.installSkill()
    if (!r.ok) setError(r.error ?? 'The skill could not be installed.')
    setStatus(await window.filesmith.skillStatus())
    setBusy(false)
  }
  const desc = error ?? (status == null ? 'Checking' : status.installed ? `Installed ${status.version}` : 'Not installed')
  return (
    <Setting title="Claude Code skill" desc={desc} warn={error != null}>
      <SmallButton onClick={() => void install()} disabled={busy}>
        {status?.installed && !status.current ? 'Update Claude skill' : 'Install Claude skill'}
      </SmallButton>
    </Setting>
  )
}
```

`src/renderer/src/components/views/SettingsView.tsx`: import `ClaudeSkill` and add after the TOOLS group:

```tsx
        <SettingGroup title="CLAUDE">
          <ClaudeSkill />
        </SettingGroup>
```

`electron-builder.yml`: add to `extraResources`:

```yaml
  # The Claude Code skill, copied out by `filesmith skill install` and the
  # Settings button (spec 6). Never installed silently.
  - from: resources/skill
    to: skill
    filter: ['**/*']
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/skill.test.ts test/cli-doctor.test.ts test/cli-main.test.ts && npm run build && npx playwright test e2e/skill.spec.ts e2e/ui.spec.ts`
Expected: PASS.

- [ ] **Step 8: The screenshot for the owner (O9)**

Run: `FILESMITH_SHOTS=1 npx playwright test e2e/skill.spec.ts`
Expected: `docs/mockups/cli-settings-skill.png` showing the CLAUDE group with the installed state. It goes in the PR description for the owner's look approval.

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck && npm run lint && npx prettier --write src test e2e && npm test
git add resources/skill src test/skill.test.ts test/cli-doctor.test.ts test/cli-main.test.ts e2e/skill.spec.ts electron-builder.yml docs/mockups/cli-settings-skill.png
git commit -m "feat(skill): Claude Code skill, filesmith skill install/status and a Settings button" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Release workflow and bundle verification (M12)

**Files:**
- Modify: `.github/workflows/release.yml` (paths filter, packed-CLI smoke step), `scripts/verify-bundle.mjs` (shims, skill, LF check)

**Interfaces:**
- Consumes: the packed layout from Tasks 16 and 17.
- Produces: a release (and every PR dry run that touches the CLI) fails if the packed `filesmith.cmd` does not print the package version, if doctor reports a failed core check, or if a one-file convert fails.

- [ ] **Step 1: Make verify-bundle require the new files**

In `scripts/verify-bundle.mjs`, append to `REQUIRED`:

```js
  ['cli/filesmith.cmd', 'filesmith on PATH (cmd, PowerShell)'],
  ['cli/filesmith', 'filesmith on PATH (Git Bash, Claude Code)'],
  ['cli/path.ps1', 'the installer PATH edit'],
  ['skill/filesmith/SKILL.md', 'the Claude Code skill'],
  ['skill/filesmith/reference.md', 'the Claude Code skill reference']
```

add `readFileSync` to the `node:fs` import, and after the ffmpeg size loop:

```js
// Git Bash cannot run the sh shim with CRLF endings ("$'\r': command not found").
const sh = join(root, 'cli', 'filesmith')
if (existsSync(sh) && readFileSync(sh, 'utf8').includes('\r'))
  failures.push('cli/filesmith has CRLF line endings (Git Bash cannot run it)')
```

Run: `node scripts/verify-bundle.mjs resources`
Expected: the existing tool checks plus no `missing cli/...` or `missing skill/...` lines; exit 0 on this machine (binaries are fetched).

- [ ] **Step 2: Smoke-test the packed CLI in the release workflow**

In `.github/workflows/release.yml`, extend `pull_request.paths` with:

```yaml
      - 'src/cli/**'
      - 'resources/cli/**'
      - 'resources/skill/**'
      - 'build/installer.nsh'
      - 'build/installer/**'
```

and add this step right after "Verify bundled tools (packed app)":

```yaml
      # The command line in the packed app (spec 7.3): the shim must run the
      # app's own exe in Node mode, print the package.json version, pass
      # doctor's core checks and convert one file. This also fails loudly if the
      # runAsNode Electron fuse is ever turned off.
      - name: Smoke-test the packed CLI
        shell: pwsh
        run: |
          $ErrorActionPreference = 'Stop'
          $PSNativeCommandUseErrorActionPreference = $false
          $shim = 'dist\win-unpacked\resources\cli\filesmith.cmd'
          $v = (& $shim --version | Out-String).Trim()
          if ($v -ne '${{ steps.ver.outputs.version }}') { throw "filesmith --version printed '$v'" }
          $env:FILESMITH_USER_DATA = Join-Path $env:RUNNER_TEMP 'fs-ud'
          $events = & $shim doctor --json | ForEach-Object { $_ | ConvertFrom-Json }
          $bad = @($events | Where-Object { $_.event -eq 'check' -and $_.group -eq 'core' -and $_.status -eq 'fail' })
          if ($bad.Count) { throw "doctor core checks failed: $($bad.id -join ', ')" }
          $png = Join-Path $env:RUNNER_TEMP 'smoke.png'
          [IO.File]::WriteAllBytes($png, [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))
          & $shim convert $png --to webp --json | Out-Host
          if ($LASTEXITCODE -ne 0) { throw "filesmith convert exited $LASTEXITCODE" }
          if (-not (Test-Path (Join-Path $env:RUNNER_TEMP 'smoke.webp'))) { throw 'smoke.webp was not written' }
          "- packed CLI ``$v``: doctor core checks ok, convert ok" >> $env:GITHUB_STEP_SUMMARY
          $global:LASTEXITCODE = 0
```

- [ ] **Step 3: Run the same smoke locally against the unpacked build**

Run (PowerShell): `npm run build; npx electron-builder --win dir --publish never; node scripts/verify-bundle.mjs dist/win-unpacked/resources` and then the body of the step above with `${{ steps.ver.outputs.version }}` replaced by the `package.json` version.
Expected: no throw; `smoke.webp` exists.

- [ ] **Step 4: Verify and commit**

```bash
npx prettier --check . && npm test
git add .github/workflows/release.yml scripts/verify-bundle.mjs
git commit -m "ci(release): verify the packed CLI shims, skill files and a one-file convert" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Docs, version 0.6.0, the full gate, install, hands-on, PR

**Files:**
- Create: `docs/cli.md`
- Modify: `package.json` (0.6.0), `CLAUDE.md` (Build/test/run, layout)

**Interfaces:**
- Consumes: everything.
- Produces: PR `feat(cli): filesmith command line and Claude skill (#<N>)` with the owner's merge question.

- [ ] **Step 1: Renormalize line endings once**

Run: `git add --renormalize resources && git status --short`
Expected: nothing new staged (the `.gitattributes` from Task 16 already covered the shims and skill files when they were added). If files show up, commit them with Step 8.

- [ ] **Step 2: Write `docs/cli.md`**

It holds, in this order (no em-dashes):
1. **What it is**: one paragraph (same engine and tools as the app, offline except AI setup, never overwrites, works while the app is open, jobs never appear in the app).
2. **Install and PATH**: installed with the app into `<install>\resources\cli`, on the per-user PATH for new terminals; cmd/PowerShell use `filesmith.cmd`, Git Bash uses the `filesmith` sh shim; the `%` quirk in cmd and the cosmetic "Terminate batch job (Y/N)?" after Ctrl+C (O3); Windows PowerShell 5.1 decodes captured output with the OEM code page, so for non-ASCII paths in `--json` run `[Console]::OutputEncoding = [Text.Encoding]::UTF8` first (or use Git Bash); installing, updating or uninstalling Filesmith closes every `Filesmith.exe`, a running CLI job included (spec 9).
3. **Grammar**: the rules of spec section 2 in short form (shape, inputs and globs, options mirror the app, never overwrite and dry runs, output formats, exit codes), with three examples per verb taken from the help pages.
4. **JSON events**: the schema v1 table (copy from `resources/skill/filesmith/reference.md`, Events section) and the additive-only rule.
5. **AI tools**: what `setup <tool>` downloads, where it goes (`%APPDATA%\Filesmith\{pid,uv,uv-tools,models\rembg}`), the GPU gates, `setup remove` and the Recycle Bin limit.
6. **For agents**: the skill, `filesmith skill install`, the Settings button.
7. **Implementation notes (verified 2026-10-04 on this machine, source: running `node_modules/electron/dist/electron.exe` with `ELECTRON_RUN_AS_NODE=1`)**: Electron 43 runs Node 24.18; `fs.globSync` exists; `--use-system-ca` is accepted; `NODE_USE_ENV_PROXY=1` routes `fetch` through `HTTPS_PROXY`; `process.resourcesPath` is the install's `resources` folder in Node mode; `require('electron')` is a path string in Node mode, so the engine reads paths from `src/main/env.ts`. Plus: the runAsNode fuse must stay on.
8. **Development**: `npm run build && npm run cli -- <args>`, the unit and e2e test files, how to build the unpacked app for `e2e/cli-packed.spec.ts`.

- [ ] **Step 3: CLAUDE.md**

In `## Build, test, run`, after the `npm run test:e2e` bullet, add:

```markdown
- `npm run cli -- <args>` runs the command line from `out/main/cli.js` (build first). Reference:
  `docs/cli.md`. The engine never imports `electron`; it reads paths from `src/main/env.ts`.
```

In the project layout block add `src/cli/` (`the filesmith command line: parse, plan, run, report`), `resources/cli/` (`PATH shims + path.ps1`) and `resources/skill/` (`Claude Code skill`). Keep CLAUDE.md under 200 lines.

The README stays logo and badges only (the owner stripped it in commit `e2c7b39`); `docs/cli.md` is the user documentation (spec 12 asked for a README section; this is deviation D-i, raised in the PR).

- [ ] **Step 4: Version 0.6.0**

`package.json`: `"version": "0.6.0"`. Run `npm install --package-lock-only` so `package-lock.json` matches.

- [ ] **Step 5: The full PR gate**

Run:

```bash
npm test && npm run typecheck && npm run lint && npx prettier --check . && npm run build && npm run test:e2e
```

Expected: everything passes. `e2e/cli-packed.spec.ts` skips unless `dist/win-unpacked` exists; build it with `npx electron-builder --win dir --publish never` and run `npx playwright test e2e/cli-packed.spec.ts` once more against 0.6.0.

- [ ] **Step 6: Package, install and open (owner rule: always install and open)**

```bash
npm run package
```

Then in PowerShell: `Start-Process -Wait "dist\Filesmith-Setup-x64-0.6.0.exe"` (interactive install), open Filesmith from the Start menu, check Settings > CLAUDE shows "Not installed" or the earlier version.

- [ ] **Step 7: Hands-on from fresh terminals, with the app open (spec 8.4)**

Open a NEW cmd, a NEW PowerShell and a NEW Git Bash window and run in each:

```
filesmith --version
filesmith doctor
filesmith convert "<a test image>" --to webp --json
```

Expected: `0.6.0`; doctor exits 0 with `path ok`; one `done` event with an output next to the image; the app keeps running and its queue and Completed view do not show the job.

Then in one terminal: `filesmith compress "<a long video>" --codec h265`, press Ctrl+C after a few seconds. Expected: `stop` line, exit code 130 (`echo %ERRORLEVEL%` in cmd after answering the batch prompt, `$LASTEXITCODE` in PowerShell), no `ffmpeg.exe` left in Task Manager, no partial output file.

Then: `filesmith skill install`, check `%USERPROFILE%\.claude\skills\filesmith\SKILL.md` exists with `filesmith-version: 0.6.0`, and Settings > CLAUDE now reads `Installed 0.6.0`.

Then uninstall from Settings > Apps and reinstall; in a new terminal check `filesmith --version` works and the user PATH holds exactly one `...\resources\cli` entry:
`((Get-Item 'HKCU:\Environment').GetValue('Path','', 'DoNotExpandEnvironmentNames') -split ';') -match 'resources\\cli'`.

- [ ] **Step 8: Commit and push**

```bash
git add docs/cli.md CLAUDE.md package.json package-lock.json
git commit -m "docs(cli): docs/cli.md and CLAUDE.md entry; bump to 0.6.0" -m "Refs #<N>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/<N>-cli
```

- [ ] **Step 9: Open the PR**

```bash
gh pr create --title "feat(cli): filesmith command line and Claude skill (#<N>)" --body "$(cat <<'EOF'
Closes #<N>.

## What
- `filesmith` command bundled with the app and on the per-user PATH: convert, compress, resize, upscale, removebg, generate, `pdf <tool>`, plus formats, doctor, setup, skill. Verb-first, option names and values mirror the app, `--dry-run` everywhere, `--json` NDJSON events (schema v1), exit codes 0/1/2/130, never overwrites.
- Runs the installed Filesmith.exe in Node mode (ELECTRON_RUN_AS_NODE) behind `filesmith.cmd` and an sh shim, so it works while the app is open and its jobs never reach the app.
- AI tools never download from a job: `filesmith setup <tool>` is the only command that downloads (progress with bytes, ETA and heartbeats; cross-process locks).
- Claude Code skill in `resources/skill/filesmith`, installed by `filesmith skill install` or Settings > CLAUDE.

## Engine changes outside src/cli
EngineEnv provider (no electron imports in the engine), shared boot, dry-run output planners, readiness checks and `allowDownload`, explicit rembg install with a pinned model folder (fixes the always-false removebg ready flag), cross-process install locks, atomic state writes, `comfy-live.json`, `GenerateOptions.outDir`, per-user PATH in the installer.

## For the owner
- Settings > CLAUDE screenshot (O9): docs/mockups/cli-settings-skill.png
- Deviations from the spec, all listed in the plan: entry file name, planners in one module, no new renderer UI for removebg setup, hidden-file rule, `setup remove --permanent` above 5 GB, two additive event fields, LibreOffice checked at run time, bare `filesmith` prints help, README left as logo and badges (docs/cli.md instead).
- Unsigned, like every release so far.

## Verification
- `npm test`, typecheck, lint, prettier, build, `npm run test:e2e` (incl. e2e/cli.spec.ts, e2e/cli-packed.spec.ts, e2e/skill.spec.ts): all green.
- Installed 0.6.0 on this machine; `filesmith` from fresh cmd, PowerShell and Git Bash with the app open; Ctrl+C on a video compress; skill install from CLI and Settings; uninstall and reinstall keep exactly one PATH entry.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10: Report and ask**

Give the owner the PR link, the screenshot path, the hands-on results and a recommendation, then ask "merge?" once. Do not merge, enable auto-merge or push to main without their explicit yes for this PR. After a yes: squash-merge, delete the branch locally and remotely, install the released 0.6.0 build and confirm `filesmith --version`, and `git worktree remove` any worktree used.

---

## Self-review notes (for the executor)

- **Spec coverage:** M1 Task 2; M2 Task 2; M3 Task 13; M4 Task 3; M5 Task 5; M6 Task 5; M7 Task 4; M8 Task 4; M9 Task 16; M10 Task 17; M11 Tasks 1 and 19; M12 Task 18. Grammar (spec 2) Tasks 6 to 11; commands (spec 3) Tasks 11 to 15; architecture (spec 4) Tasks 1, 2, 11; AI tools (spec 5) Tasks 5, 14, 15; skill (spec 6) Task 17; packaging (spec 7) Tasks 16, 18; tests (spec 8) in every task.
- **Names used across tasks:** `EngineEnv`/`engineEnv`/`resourcePath`/`userDataPath` (Task 2); `planFileInDir`/`planOutDir`/`planOutput` (Task 3); `withFileLock`/`readLock`/`isStale` (Task 4); `InstallOpts`/`InstallProgress`/`ensureUv` (Task 4); `Readiness`/`upscaleReadiness`/`removebgReadiness`/`notReadyMessage` (Task 5); `CliError`/`UsageError`/`EXIT`/`reduceExit` (Task 6); `EventBody`/`Reporter`/`JsonReporter`/`HumanReporter` (Task 6); `CommandSpec`/`FlagSpec`/`findCommand`/`flagOf` (Task 7); `ParsedArgs`/`parseArgv`/`detectJson` (Task 7); `BuiltOptions`/`buildOptions`/`buildGenerateFlags`/`PathState` (Task 8); `expandInputs`/`pathState` (Task 9); `PlannedJob`/`planJobs`/`acceptsKind` (Task 10); `CliIO`/`runPlanned`/`classifyError`/`statOutput`/`CliDeps`/`main` (Task 11).

