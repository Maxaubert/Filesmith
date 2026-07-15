# Filesmith

A desktop file toolkit. Drop files, run operations: **convert, compress, resize, upscale,
remove background,** and **PDF tools** (extract text, PDF→images, compress) across images,
video, audio, and PDFs, with batch queues, thumbnails, and live progress.

> Early development. The UI is a placeholder while the design is worked out.

## Stack

Electron + TypeScript, React + Vite + Tailwind v4 renderer. Operations are performed by
external tools (ffmpeg, ImageMagick, mutool, CaesiumCLT, Real-ESRGAN, rembg) that the app
orchestrates. The core tools are bundled; the AI tools are fetched on first use.

## Develop

```bash
npm install
npm run dev        # launch with HMR
npm run typecheck  # tsc project checks
npm test           # unit tests
npm run package    # build the Windows installer (dist/)
```

## Status

Scaffold + engine under construction. See `CLAUDE.md` for scope, phasing, and the
design process.
