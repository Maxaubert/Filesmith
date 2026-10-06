# Architecture

For developers. How Filesmith is put together, where things live, and how a change gets tested and
shipped. User-facing command line docs are in [cli.md](cli.md).

## Processes

| Process        | Entry                                                     | Role                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main           | `src/main/index.ts`                                       | Electron app, window, IPC handlers (`src/main/ipc.ts`), the job queue and every tool run. All privileged work happens here.                                                                                                     |
| Preload        | `src/preload/index.ts`                                    | `contextBridge` exposes the typed `window.filesmith` API. The renderer's only way into main.                                                                                                                                    |
| Renderer       | `src/renderer/src/main.tsx`                               | React UI. Never touches `fs` or `child_process`.                                                                                                                                                                                |
| CLI            | `src/cli/bootstrap.ts`, built to `out/main/cli.js`        | The same engine as plain Node. The shims in `resources\cli` (`filesmith.cmd`, sh `filesmith`) run `Filesmith.exe` with `ELECTRON_RUN_AS_NODE=1`, so nothing the CLI imports may import `electron`.                              |
| CLI watchdog   | `src/cli/watchdog.ts`, built to `out/main/cliWatchdog.js` | Cleans up outputs and child tools after a CLI that was killed outright.                                                                                                                                                         |
| Console runner | `src/main/console/`                                       | The bottom Console strip. Each command forks the bundled `cli.js` (`runCli.ts`); the line is re-validated in main (`validate.ts`) and only `filesmith` verbs run. Stop is staged: interrupt, interrupt again, then a tree kill. |
| Sidecars       | `src/main/pid/sidecar.ts`, `src/main/comfy/sidecar.ts`    | Long-lived Python processes (PiD, spandrel) kept warm across images, talking newline-delimited JSON.                                                                                                                            |

The engine gets its host (userData, resources folder, downloads folder, `fetch`) from `src/main/env.ts`
(`setEngineEnv`). The app fills it from Electron, the CLI from Node. `src/main/boot.ts` holds startup
shared by both.

## src layout

```
src/
  main/              engine and Electron main process
    tools/           one module per operation (convert, compress, resize, upscale, removebg,
                     pdf, archive), plus registry.ts (tool id -> module), plan.ts (dry-run
                     output names), estimate.ts, readiness.ts, soffice.ts, ncnnModels.ts
    console/         Console strip: command catalog, validation, forked CLI runs
    generate/        Generate: ComfyUI server, workflows, model scan, preflight
    comfy/           ComfyUI discovery, imported upscalers, spandrel sidecar
    pid/             PiD upscaler: GPU check, install, warm sidecar
    rembg/           rembg install and paths
    registry/        three-layer model registry (builtin, channel, user)
    net/             downloads and SHA-256 integrity records
    jobQueue.ts      batch queue with concurrency limits and cancel
    output.ts        collision-safe output naming
    atomicOutput.ts  part files and placeholders for every output
    toolResolver.ts  finds bundled or PATH binaries
    session.ts       session.json load/save
  preload/           typed window.filesmith bridge
  renderer/src/      React UI: components/{shell,queue,inspector,options,console,views,ui,icons}
  cli/               filesmith CLI: parse, plan, runner, events, commands/{doctor,files,formats,
                     generate,setup,skill}, watchdog
  shared/            types and catalogs used by main, renderer and CLI (types.ts, ipc.ts,
                     tabs.ts, convert/compress/resize/removebg/archive/generate, console*)
```

## How a job flows

1. The renderer queues files per verb (`src/shared/tabs.ts`) and calls `job:run` through the preload
   bridge with a `JobRequest`.
2. `JobQueue` (`src/main/jobQueue.ts`) runs jobs with a global concurrency limit and per-tool caps
   (upscale and removebg run one at a time). Each job gets an `AbortController` for cancel.
3. `getTool()` in `src/main/tools/registry.ts` picks the tool module, which builds the arguments and
   spawns the CLI tool through `src/main/run.ts`.
4. Progress goes back as `JobEvent`s (`status`, `percent`, `etaSec`, `outputPath`, `outputSize`,
   `error`) broadcast on the `job:event` IPC channel.
5. Outputs are atomic (`src/main/atomicOutput.ts`): the final name is reserved first with an empty
   placeholder (exclusive create), the tool writes a `.filesmith-part` sibling, and the part is renamed
   onto the final name only on success. A failed or canceled job leaves no half-written file.
6. Names are collision-safe (`src/main/output.ts`, ported from RCMM): `name.ext`, then
   `name (tag).ext`, `name (tag 2).ext`, and `base (2)` for folders. A source or existing file is
   never overwritten. `tools/plan.ts` predicts the same names for dry runs.

The CLI runs the same tool modules through `src/cli/runner.ts`, not the app's queue, so CLI jobs never
show up in the app.

## Bundled tools

- Core tools ship in the installer: ffmpeg, ImageMagick, mutool, CaesiumCLT and 7-Zip in
  `resources\bin`, plus `resources\libreoffice`, `resources\ghostscript` and `resources\realesrgan`.
  They are not in git.
- `npm run binaries` (`scripts/fetch-binaries.mjs`) stages them, mostly from local installs.
  `--pinned` (used by CI) downloads the same versions from official sources, each checked against a
  SHA-256 in `scripts/pinned-tools.mjs`.
- `scripts/verify-bundle.mjs` checks every tool is present and runs.
- WinRAR's `Rar.exe` cannot be bundled. It is detected at runtime and RAR/CBR targets are greyed out
  without it.

## AI tools

- Real-ESRGAN (ncnn/Vulkan) is bundled. Extra models download into `%APPDATA%\Filesmith\models`.
- rembg, PiD and spandrel install on demand with `uv` into `%APPDATA%\Filesmith` (`uv`, `uv-tools`,
  `pid`, `models`). The app offers setup in the UI; the CLI never downloads during a job and says
  `Run: filesmith setup <tool>` instead.
- Generate drives a local ComfyUI (`filesmith setup comfy --folder` or `--url`).
- Model downloads come from the registry: `resources\registry\*.json` (builtin), a signed channel
  layer, and the user layer in `%APPDATA%\Filesmith\registry\user`, which updates never touch.

## Settings and data

- userData is `%APPDATA%\Filesmith`, shared by the app and the CLI. `FILESMITH_USER_DATA` overrides it
  (tests and CI).
- `session.json` holds queues, results and options (written atomically).
- UI preferences (sidebar order and hidden verbs, sidebar collapsed, view size, console panel) live in
  renderer `localStorage`.
- Other files there: `integrity.json`, `comfy-upscalers.json`, `comfy-live.json`, `locks\`.

## Tests

- Unit: `npm test` (Vitest, `test\*.test.ts`). `electron` is stubbed by `test/mocks/electron.ts`.
  Covers argument builders, catalogs, output naming, CLI parsing, IPC parity, and a no-em-dash check.
- E2E: `npm run build`, then `npm run test:e2e` (Playwright `_electron`, specs in `e2e\`). The app runs
  hidden (`FILESMITH_E2E_HIDDEN=1` from `e2e/helpers.ts`), one worker at a time.
- Screenshots: set `FILESMITH_SHOTS=1` to capture shots (for example `e2e/visual.spec.ts` writes to
  `docs\mockups\terminal-v5\shots`). They are evidence for design review, not assertions.
- E2E is the local pre-PR gate; CI does not run it.

## CI and releases

- `ci.yml` (PRs and pushes to main, `windows-latest`): typecheck, lint, `prettier --check`, unit tests.
- `release.yml` (push to main, except docs-only changes): the same gates, then a check that
  `v<version>` from `package.json` does not exist yet, pinned tool fetch, bundle verification before
  and after packing, a smoke test of the packed CLI, and `gh release create` with generated notes.
  Output: `Filesmith-Setup-x64-<version>.exe` plus a stable-named copy. Unsigned.
- PRs that touch release machinery (`package.json`, scripts, `src/cli`, installer files) get a dry run:
  the installer is built and uploaded as a workflow artifact, never published. Bump the version in the
  PR, or the dry run fails.

## Design process

The look is designed with the owner. Make no visual assumptions: any UI change starts with
self-contained HTML mockups and waits for sign-off. The signed-off target is
`docs\mockups\terminal-v5\10-s2-vscode-grouped.html` (dark only, strict monochrome). The rules and
feedback trail are in [design/redesign-direction.md](design/redesign-direction.md). Feature specs live in
`docs\superpowers\specs`.
