# Filesmith

A desktop **file toolkit**: drop files and run operations (convert, compress, resize, upscale,
remove background, generate, PDF tools, archive repack/extract, archive to/from PDF) across
images, video, audio, PDFs, documents and archives, with batch queues, thumbnails and live
progress. The same engine runs as the `filesmith` CLI and in the in-app console.

Docs: user docs in `docs/` (getting-started, operations, models, cli), developer overview in
`docs/architecture.md`, kept mockups in `docs/mockups/README.md`. Old upgrade plans and the
dependency audit: `C:\Users\Admin\Documents\Claude\research\filesmith\`.

## What it is

Electron + TypeScript desktop app. Renderer is React + TypeScript + Vite + Tailwind v4.
The heavy lifting is done by external CLI tools (ffmpeg, ImageMagick, mutool, CaesiumCLT,
7-Zip, Real-ESRGAN, LibreOffice, Ghostscript, rembg); the app orchestrates them. Writing
RAR/CBR is the one operation that needs a tool we cannot bundle (WinRAR's Rar.exe), so it is
detected at runtime and the target is greyed out when absent. Windows-first, unsigned
installer via GitHub Releases (mirrors the sibling RCMM project's distribution).

Origin: the operations are ported from RCMM's audited `rcmm-convert/compress/upscale/removebg`
PowerShell scripts (`../RCMM/manager/src/RCMM/`), lifted into a real GUI app.

## Design process (READ THIS)

Navigation is VERB-first: the rail is Convert / Compress / Resize / Upscale /
Remove BG / Generate / PDF Tools, each owning one queue that may hold several
convert groups at once. A selection never spans two convert groups, because one
options panel can only describe one target set. See `src/shared/tabs.ts`.

**Signed-off redesign (2026-10-04):** `docs/mockups/terminal-v5/10-s2-vscode-grouped.html`, dark-only,
strict monochrome. Rules and feedback trail: `docs/design/redesign-direction.md`.

**View sizes (2026-10-05):** `docs/mockups/view-zoom/04-explorer-style.html`; spec `docs/superpowers/specs/2026-10-05-view-sizes-design.md`.

**Console (2026-10-06):** `docs/mockups/console/01-bottom-panel.html`; spec `docs/superpowers/specs/2026-10-06-console-design.md`.

**The look is designed collaboratively with the owner. Make NO visual assumptions.**
Before building or restyling any UI, present mockups (self-contained browser HTML, like the
RCMM Show/Hide exploration), offer options, and iterate to explicit sign-off. This covers
layout, components, palette, typography, motion, empty/loading states, and the file-preview
experience. The renderer implements the signed-off terminal design (rules in
`docs/design/redesign-direction.md`): dark only, strict monochrome, every colour is a token in
`src/renderer/src/theme/tokens.css`, and `test/monochrome-source.test.ts` fails on any other colour
literal. New screens still go through mockups first. Engineering/plumbing (main process, tool modules, IPC, tests, packaging) moves fast
without design ceremony.

## Tools and dependencies

Bundled (offline): ffmpeg, ImageMagick, mutool, CaesiumCLT, 7-Zip in `resources/bin`, plus
`resources/libreoffice`, `resources/ghostscript` and `resources/realesrgan` (all gitignored,
staged by `scripts/fetch-binaries.mjs`). Installed on demand with uv into `%APPDATA%\Filesmith`:
rembg, PiD, spandrel. Never bundled: WinRAR.

## Project layout

Short map; details in `docs/architecture.md`.

```
src/
  main/        Electron main process and the engine
    index.ts, ipc.ts, jobQueue.ts, output.ts, toolResolver.ts, session.ts, env.ts, boot.ts
    tools/       one module per operation (convert, compress, resize, upscale, removebg, pdf,
                 archive) + registry, plan, estimate, readiness
    console/     in-app console: catalog, validation, forked CLI runs (staged cancel), cd
    generate/ comfy/ pid/ rembg/ registry/ net/
                 Generate, ComfyUI + spandrel, PiD, rembg, model registry, downloads
  preload/     contextBridge: the typed `window.filesmith` API
  renderer/src/
    components/  shell/ queue/ inspector/ options/ views/ console/ ui/ icons/
    theme/       tokens and CSS
  shared/      types, tabs.ts (VERB-first navigation), per-verb option models, console line
  cli/         the filesmith command line: parse, plan, run, report; commands/
resources/     cli/ (PATH shims + path.ps1), skill/ (Claude Code skill), registry/,
               pid/ and spandrel/ (Python sidecars)
e2e/           Playwright specs      test/  Vitest      scripts/  fetch, verify, pin tools
```

## Build, test, run

- `npm run dev` - launch the app (electron-vite dev, HMR).
- `npm run build` - build main/preload/renderer to `out/`.
- `npm run typecheck` - node + web tsc project checks.
- `npm test` - Vitest unit tests (arg-builders, format catalogs, output collision-safety).
- `npm run lint` / `npm run format` - eslint (flat config) / prettier.
- `npm run package` - electron-vite build + electron-builder NSIS installer to `dist/`.
- `npm run test:e2e` - Playwright end-to-end (launches the built app via `_electron`; run
  `npm run build` first). Covers the preload/IPC/engine chain unit tests can't reach.
  `FILESMITH_SHOTS=1` also refreshes the tracked `impl-*` shots in `docs/mockups`.
- `npm run cli -- <args>` runs the command line from `out/main/cli.js` (build first). Reference:
  `docs/cli.md`. The engine never imports `electron`; it reads paths from `src/main/env.ts`.
- Releases: push to main runs `.github/workflows/release.yml` (gates, then requires a NEW
  `package.json` version, builds with `fetch-binaries --pinned`, publishes `v<version>`). Bump the
  version in the PR. Tool versions + SHA-256 live in `scripts/pinned-tools.mjs`; PRs touching
  the release machinery get a dry-run installer artifact. Pushes that only touch `**.md`,
  `docs/**` or `LICENSE` do not release.

## Conventions

- TypeScript strict. Main-process code is Node; renderer is browser. Keep the boundary clean
  (all privileged work in main, exposed via the typed preload bridge; renderer never touches
  `fs`/`child_process`).
- Tool modules own their own format catalog + argument builder and are independently testable.
- Never overwrite a user's source or an existing output file. Always resolve a collision-free
  name (`name.ext`, then `name (converted).ext`, `name (converted 2).ext`; folders get ` (2)`).
  This is a hard rule ported from RCMM.
- No secrets in the repo; unsigned build is expected.

## Working with the owner

Feature/fix work is tracked as GitHub issues → branch → PR (per global rules). Every change,
README and docs included, goes through a PR. Anything touching the **look** goes through the
mockup-driven design process above, always.
