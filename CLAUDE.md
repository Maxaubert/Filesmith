# Filesmith

A desktop **file toolkit**: drop files and run operations — convert, compress, resize,
upscale, remove background, PDF tools (extract text, PDF→images, compress) and archive
tools (repack CBZ/CBR/CB7/CBT, extract, archive↔PDF) — across images, video, audio,
PDFs, documents and archives, with batch queues, thumbnails, and live progress.

## What it is

Electron + TypeScript desktop app. Renderer is React + TypeScript + Vite + Tailwind v4.
The heavy lifting is done by external CLI tools (ffmpeg, ImageMagick, mutool, CaesiumCLT,
7-Zip, Real-ESRGAN, rembg); the app orchestrates them. Writing RAR/CBR is the one
operation that needs a tool we cannot bundle (WinRAR's Rar.exe), so it is detected at
runtime and the target is greyed out when absent. Windows-first, unsigned installer via
GitHub Releases (mirrors the sibling RCMM project's distribution).

Origin: the operations are ported from RCMM's audited `rcmm-convert/compress/upscale/removebg`
PowerShell scripts (`../RCMM/manager/src/RCMM/`), lifted into a real GUI app.

## Design process — READ THIS

**The look is designed collaboratively with the owner. Make NO visual assumptions.**
Before building or restyling any UI, present mockups (self-contained browser HTML, like the
RCMM Show/Hide exploration), offer options, and iterate to explicit sign-off. This covers
layout, components, palette, typography, motion, empty/loading states, and the file-preview
experience. The current renderer is a deliberately plain placeholder until that design work
happens. Engineering/plumbing (main process, tool modules, IPC, tests, packaging) moves fast
without design ceremony.

## Scope (v1, built in phases)

1. **Images core** — convert, compress, resize.
2. **AI images** — upscale (Real-ESRGAN), remove background (rembg). Heavy tools are
   downloaded on first use into `%APPDATA%/Filesmith/tools`.
3. **Media + PDF** — video/audio convert & compress (ffmpeg), PDF extract-text / images /
   compress (mutool).

Dependencies: bundle the core tools (ffmpeg, ImageMagick, mutool, CaesiumCLT, 7-Zip) in
`resources/bin` so images/PDF work offline out of the box; fetch the AI tools on demand.

Each phase is its own checkpoint — confirm scope before starting the next.

## Project layout

```
src/
  main/        Node/Electron main process — the engine
    index.ts        app + window bootstrap
    tools/{convert,compress,resize,upscale,removebg,pdf,archive}.ts — one per operation
    (planned) toolResolver.ts  find bundled/PATH binaries; on-demand AI-tool download
    (planned) jobQueue.ts      batch queue: spawn, stream progress, cancel
    (planned) output.ts        collision-safe output naming (ported from RCMM Get-UniqueOutPath)
    (planned) ipc.ts           renderer <-> engine wiring
  preload/     contextBridge — the typed `window.filesmith` API
  renderer/    React UI (placeholder until designed)
  shared/      (planned) types.ts — Job, ToolId, FileKind, Options, progress events
resources/bin/ bundled CLI binaries (gitignored; fetched by scripts, packed by electron-builder)
```

## Build, test, run

- `npm run dev` — launch the app (electron-vite dev, HMR).
- `npm run build` — build main/preload/renderer to `out/`.
- `npm run typecheck` — node + web tsc project checks.
- `npm test` — Vitest unit tests (arg-builders, format catalogs, output collision-safety).
- `npm run lint` / `npm run format` — eslint (flat config) / prettier.
- `npm run package` — electron-vite build + electron-builder NSIS installer to `dist/`.
- `npm run test:e2e` — Playwright end-to-end (launches the built app via `_electron`; run
  `npm run build` first). Covers the preload/IPC/engine chain unit tests can't reach.

## Conventions

- TypeScript strict. Main-process code is Node; renderer is browser — keep the boundary clean
  (all privileged work in main, exposed via the typed preload bridge; renderer never touches
  `fs`/`child_process`).
- Tool modules own their own format catalog + argument builder and are independently testable.
- Never overwrite a user's source or an existing output file — always resolve a collision-free
  name (`name (converted).ext`, ` (2)`, unique dirs). This is a hard rule ported from RCMM.
- No secrets in the repo; unsigned build is expected.

## Working with the owner

Feature/fix work is tracked as GitHub issues → branch → PR (per global rules). README-only
changes commit directly. Anything touching the **look** goes through the mockup-driven design
process above — always.
