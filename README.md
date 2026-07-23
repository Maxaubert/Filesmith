# Filesmith

A desktop file toolkit for Windows. Drop files, pick a tool, get results — with batch
queues, thumbnails, live progress, and rich previews. Everything runs locally on your
machine.

**Tools**

- **Images** — convert (PNG / WebP / AVIF / JPG…), compress, resize, remove background, upscale, and **generate** (text‑to‑image).
- **Video / Audio** — convert (container / codec) and compress.
- **PDF** — extract text, PDF → images, compress.
- **Documents** — convert office documents to PDF.

Your queue and produced files are **remembered across restarts** — close the app and reopen
it, and your work is still there (files that were deleted in the meantime are dropped).

## Download & install

Grab the latest `Filesmith-Setup-x64-<version>.exe` from
[Releases](https://github.com/Maxaubert/Filesmith/releases) and run it.

The installer is **unsigned**, so Windows SmartScreen may warn on first run
("Windows protected your PC"). Click **More info → Run anyway** to proceed. Updates are
manual — download and run the newer installer when a new release is out. No admin rights
are required for the tools; installing to `Program Files` prompts for admin as usual.

## What needs the internet / AI (and what doesn't)

Filesmith works **fully offline** for the everyday tools — convert, compress, resize, and
all PDF/video/audio/document operations run from bundled binaries with no downloads and no
AI.

The **AI features are optional and opt‑in** — nothing AI runs unless you choose it:

| Feature | Needs |
|---|---|
| **Remove Background** | The free [`uv`](https://docs.astral.sh/uv/) tool; downloads a small AI model on first use (one time, then offline). The panel tells you before you commit files. |
| **Upscale** | Downloads an upscaling model on first use. NVIDIA (PiD) mode needs an NVIDIA GPU. |
| **Generate** | An existing [ComfyUI](https://github.com/comfyanonymous/ComfyUI) install (Filesmith drives it headlessly). If ComfyUI or a model is missing, the panel says exactly what to do; missing text‑encoders/VAEs can be downloaded from the panel. |

If you don't want AI, just use the core tools — the AI tools stay out of your way.

## Stack

Electron + TypeScript, React + Vite + Tailwind v4 renderer. Operations are performed by
external tools (ffmpeg, ImageMagick, mutool, Ghostscript, CaesiumCLT, LibreOffice,
Real‑ESRGAN, rembg, ComfyUI) that the app orchestrates. Core tools are bundled; AI tools are
resolved from your machine or fetched on first use.

## Develop

```bash
npm install
npm run dev        # launch with HMR
npm run typecheck  # tsc project checks
npm run lint       # eslint
npm test           # unit tests (vitest)
npm run binaries   # populate resources/ with the bundled tools (once, before packaging)
npm run package    # build the Windows installer into dist/
```

See `CLAUDE.md` for scope and architecture.
