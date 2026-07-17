# Compression upgrade plan

A running design doc for expanding the **Compress** tab, decided category by
category with the user. Status per section: DECIDED / discussing / TODO.

**STATUS: IMPLEMENTED** (images, video, audio, PDF). Engine + per-kind options UI
+ live video-resolution preview + Ghostscript/ffprobe bundling all landed and
verified end-to-end against the real binaries. Possible follow-up: allow WAV/FLAC
into audio Compress (wav→opus is a big win), currently excluded by canCompress.

Current baseline (what the Compress tab does today):
- Images: CaesiumCLT (jpg/png/webp/gif/tiff) + ImageMagick fallback, re-encode at
  a quality value, **same format in/out**.
- Video: ffmpeg CRF, x264 (VP9 for webm), fixed 128k AAC audio, one quality slider.
- Audio: ffmpeg re-encode to the same codec at a bitrate.
- PDF: `mutool clean -gggg -z` (deflate streams + garbage-collect; no image downsampling).

---

## 1. Images — DECIDED

Add a **Format** choice to the image Compress options. Three options:

1. **Keep format** (default) — re-encode in the source format at the quality
   slider. This is exactly today's behavior (CaesiumCLT / ImageMagick). Lossy.
2. **WebP (compatible)** — convert to WebP, **lossy** (quality-slider driven).
   Fast, opens basically everywhere, keeps transparency. The "just make it
   smaller and it'll work anywhere" option.
3. **AVIF (smallest)** — convert to AVIF, **lossy** (quality-slider driven).
   Best compression (~40-60% smaller than WebP), slower to encode, slightly
   narrower compatibility. The "squeeze it as hard as possible" option.

Key decisions:
- **Both new formats run in LOSSY mode**, driven by the existing quality slider.
  Rationale: a Compress button should reliably make files smaller; lossy is
  where the big wins are for photos (the common case). Lossless WebP/AVIF only
  helps graphics and can make photos *larger*, so it's not offered here.
- **No "→ JPEG" option in Compress.** Converting to JPEG is a footgun on
  transparency / sharp edges; that belongs in the Convert tool.
- Perfect-quality (lossless) format conversion, if ever wanted, also belongs in
  Convert, not Compress.

Implementation notes:
- ImageMagick (already bundled) can already encode WebP and AVIF at `-quality`
  (verified in the conversion matrix), so an **MVP needs no new binary** — route
  the WebP/AVIF options through magick with the mapped quality.
- Optional later upgrade: bundle `cwebp` (libwebp) and `avifenc` (libavif) for
  finer quality/effort control and better speed than magick's built-ins.
- The output extension follows the chosen format (`name (compressed).webp` etc.);
  "Keep format" keeps the source extension as today.
- Transparency is preserved in lossy WebP/AVIF (unlike JPEG).

Second-wave / not now (nice-to-have specialists):
- mozjpeg (better JPEG encoder, 10-30% smaller), oxipng / pngquant (PNG lossless
  / palette), gifsicle (GIF). Bigger, format-specific wins; revisit later.
- "Strip metadata" toggle (EXIF/ICC/XMP) — cheap, always helps a little.

---

## 2. Video — DECIDED

Three independent controls in the video Compress options:

### a. Codec (the biggest lever) — same "compatible / smaller / smallest" framing as images
1. **H.264 (compatible)** — universal, plays everywhere, least efficient. Today's
   default. ffmpeg `libx264`.
2. **H.265 / HEVC (smaller)** — ~30-50% smaller than H.264 at equal quality,
   slower encode, well supported. ffmpeg `libx265` (mp4 with `-tag:v hvc1` for
   Apple compatibility).
3. **AV1 (smallest)** — another ~20-35% smaller than H.265, slowest encode,
   narrower support. ffmpeg `libsvtav1` (fast AV1 encoder). Requires the bundled
   ffmpeg to include SVT-AV1 — verify, else fall back to hiding the option.
- WebM sources keep the VP9/Opus path as today.

### b. Quality — the existing slider
- Maps to CRF per codec (the CRF scale differs by codec: ~18-32 for x264/x265,
  higher numbers for AV1, so use a per-codec mapping, not one shared range).

### c. Resolution — presets + live output list
- Presets: **Original / 1440p / 1080p / 720p / 480p / 360p / 240p**.
- Each preset means "fit within that box, **preserve aspect ratio, never
  upscale**" — so it works for any shape (landscape, portrait, ultrawide) and any
  mix of inputs in a multiselect (everyone capped to the ceiling; anything
  already smaller is left alone). No stretching.
- ffmpeg idiom (downscale-only fit, even dimensions):
  `scale='min(TW,iw)':'min(TH,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
- **Live "Output" list in the sidebar** showing each selected file's real result,
  updating as the setting changes:
  ```
  clip1.mp4     1920×1080  →  1280×720
  vertical.mp4  1080×1920  →   405×720
  wide.mov      2560×1080  →  1280×540
  ```
  Needs each input's dimensions — bundle `ffprobe` (tiny, ships with ffmpeg) or
  do a quick probe. Kills all ambiguity about what "720p" does per file.
- Optional later: a percentage / custom-dimensions mode for power users.

### Audio track (inside video)
- MVP: keep the current fixed AAC 128k. Optionally expose audio bitrate / "remove
  audio" later, reusing the audio-category decisions below.

## 3. Audio — DECIDED

Two controls in the audio Compress options. (Audio Compress only applies to
lossy formats — mp3/m4a/aac/ogg/opus/wma; lossless flac/wav are excluded by
`canCompress`, as today.) All via bundled ffmpeg, no new tools.

### a. Codec / format picker — parenthetical labels for the tradeoff
1. **MP3 (compatible)** — universal, least efficient. `libmp3lame`.
2. **AAC (balanced)** — better quality per byte, widely supported (`.m4a`). ffmpeg `aac`.
3. **Opus (smallest)** — most efficient (~40-60% smaller at equal quality),
   especially at low bitrates; fine on modern devices. `libopus`.
- "Keep format" behavior can remain the default (re-encode in the source codec),
  with MP3/AAC/Opus as explicit targets.

### b. Bitrate picker (replaces the quality slider for audio)
- User picks the **bitrate directly**, shown in kbps (not an abstract quality
  slider). Preset values: **320 / 256 / 192 / 128 / 96 / 64 kbps** (default ~192).
- ffmpeg `-b:a <N>k`. Lower bitrate = smaller file; Opus stays clean lower than
  MP3/AAC.

### Explicitly NOT doing (this round)
- **No "already-compressed" warning.** (User decision.)
- Sample-rate reduction / stereo→mono downmix / Voice-Podcast-Music presets:
  deferred, revisit later if wanted.

## 4. PDF — DECIDED

Bundle **Ghostscript** (`gs`) — the only mature offline single-binary tool that
downsamples the *images inside* a PDF (mutool/qpdf only touch structure, which is
why today's compress does almost nothing on scanned / image-heavy PDFs). Worth
the ~60 MB. License: AGPL, compatible since Filesmith is open-source and already
ships GPL ffmpeg (no network service, so AGPL's extra clause doesn't bite).

### a. Compression level picker — default Balanced
- **Lossless** — today's `mutool clean -gggg -z`. No image changes, safe, small
  savings. Best for text-only PDFs / when you don't want to risk altering render.
- **High quality** (~300 dpi) — Ghostscript `-dPDFSETTINGS=/printer`. Downsamples
  images but keeps print-grade sharpness; minimal visible loss.
- **Balanced** (~150 dpi) — Ghostscript `-dPDFSETTINGS=/ebook`. **Default.** Looks
  great on screen, big savings. What most people want.
- **Smallest** (~72 dpi) — Ghostscript `-dPDFSETTINGS=/screen`. Aggressive,
  visibly softer, tiny files.
- Why keep Lossless(mutool) alongside the gs tiers: gs re-renders the whole PDF
  through its own engine (great for shrinking, occasionally rewrites things);
  mutool is the conservative "shrink without altering" pass.

### b. Grayscale toggle — optional, OFF by default
- Converts color → grayscale for docs that don't need color (scanned documents to
  email). ~30-50% extra. Ghostscript `-sColorConversionStrategy=Gray
  -sProcessColorModel=DeviceGray`. Off by default so it never surprises anyone.

Base gs invocation:
`gs -sDEVICE=pdfwrite -dPDFSETTINGS=/<tier> -dNOPAUSE -dBATCH -dQUIET -o out.pdf in.pdf`

## 5. General / archive compression — SKIPPED (out of scope)

Decided NOT to add zip/7z/zstd archiving. Compress stays **media-only**
(images / video / audio / PDF). Arbitrary-file and folder archiving is out of
scope; the output-is-an-archive model is a different mental model than
"compress → still-usable smaller file", and it isn't wanted here.

---

## UI polish (not compression-specific)

- **Sidebar empty state:** when nothing is selected (no files, or files present
  but none selected), the options panel must NOT assume a kind / show bogus
  choices like "convert to PNG". Show a "No files selected" placeholder instead
  and reveal the real options once a file is selected. (Fixed separately.)
