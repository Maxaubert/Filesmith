// @ts-check
/**
 * Populate resources/bin with the bundled CLI tools so Filesmith is
 * self-contained (no PATH tools required at runtime). Binaries are large and
 * NOT committed — this script recreates them, and `npm run package` runs it
 * before electron-builder packs resources/bin into the app.
 *
 * Strategy per tool:
 *  - ImageMagick (magick.exe + its DLL/XML/ICC runtime): copied from the local
 *    winget/Program Files install. It's the dynamic *modules* build, so
 *    magick.exe needs its sibling DLLs — a flat copy into resources/bin keeps
 *    them together — AND the coder DLLs under modules/coders (one per format:
 *    PNG, JPEG, WebP, …). Without the modules tree the shipped magick cannot
 *    decode anything ("no decode delegate"); a dev machine hides that because
 *    magick falls back to its compiled-in Program Files path. The spawn env
 *    points at the bundled tree (see toolResolver.magickEnv).
 *  - CaesiumCLT (caesiumclt.exe): a single self-contained exe, copied from the
 *    local install.
 *  - ffmpeg (ffmpeg.exe): downloaded from gyan.dev's "essentials" build. The
 *    local winget build is the "full" static one (~217 MB per exe) — far too
 *    large to ship — so we fetch the leaner essentials build instead.
 *  - mutool (PDF ops): a single static exe, copied from the local install.
 *  - LibreOffice (document conversion): the whole install tree copied into
 *    resources/libreoffice (~350 MB) — bundled so doc conversion works offline.
 *
 * Install the copy-sourced tools first if missing:
 *   winget install ImageMagick.ImageMagick SaeraSoft.CaesiumCLT ArtifexSoftware.mutool
 *   (LibreOffice: install from libreoffice.org)
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BIN = join(ROOT, 'resources', 'bin')
const MB = 1024 * 1024

mkdirSync(BIN, { recursive: true })
const log = (...a) => console.log(...a)
const mb = (p) => (statSync(p).size / MB).toFixed(1)

/** Locate an executable on PATH via `where`; null if absent. */
function which(name) {
  try {
    return execFileSync('where', [name], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean) ?? null
  } catch {
    return null
  }
}

/** ImageMagick: copy magick.exe plus its runtime siblings (dynamic build), AND
 * the modules/ tree (coders + filters). The winget build loads one DLL per
 * format from modules/coders at runtime; shipping magick.exe without them
 * produces an installer where every image operation fails with "no decode
 * delegate" on any machine that has no system ImageMagick to fall back to. */
function bundleImageMagick() {
  const magick = which('magick')
  if (!magick) {
    log('  ! ImageMagick not found — skip (winget install ImageMagick.ImageMagick)')
    return
  }
  const dir = dirname(magick)
  let files = 0
  for (const f of readdirSync(dir)) {
    const ext = f.toLowerCase().slice(f.lastIndexOf('.') + 1)
    const keep = f.toLowerCase() === 'magick.exe' || ['dll', 'xml', 'icc'].includes(ext)
    const src = join(dir, f)
    if (keep && statSync(src).isFile()) {
      copyFileSync(src, join(BIN, f))
      files++
    }
  }
  const modules = join(dir, 'modules')
  if (existsSync(modules)) {
    rmSync(join(BIN, 'modules'), { recursive: true, force: true })
    cpSync(modules, join(BIN, 'modules'), { recursive: true })
    const coders = join(BIN, 'modules', 'coders')
    const n = existsSync(coders) ? readdirSync(coders).filter((f) => f.endsWith('.dll')).length : 0
    log(`  ✓ ImageMagick: ${files} files + ${n} coder modules`)
  } else {
    // A static build compiles the coders in; only the modules build needs them.
    log(`  ✓ ImageMagick: ${files} files (static build, no modules dir)`)
  }
}

/** CaesiumCLT: a single self-contained exe. */
function bundleCaesium() {
  const c = which('caesiumclt')
  if (!c) {
    log('  ! CaesiumCLT not found — skip (winget install SaeraSoft.CaesiumCLT)')
    return
  }
  copyFileSync(c, join(BIN, 'caesiumclt.exe'))
  log(`  ✓ CaesiumCLT: caesiumclt.exe (${mb(join(BIN, 'caesiumclt.exe'))} MB)`)
}

/** 7-Zip: 7z.exe plus its 7z.dll. Handles every archive container the Archives
 * category reads and writes (zip, 7z, tar, and READING rar). Copied from a
 * local install like ImageMagick and Caesium; the standalone 7zr.exe is not an
 * option because it only speaks 7z. */
function bundleSevenZip() {
  const dirs = [
    process.env.ProgramW6432 && join(process.env.ProgramW6432, '7-Zip'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, '7-Zip'),
    join('C:', 'Program Files', '7-Zip'),
    join('C:', 'Program Files (x86)', '7-Zip')
  ].filter(Boolean)
  const dir = dirs.find((d) => existsSync(join(d, '7z.exe')))
  if (!dir) {
    log('  ! 7-Zip not found — skip (winget install 7zip.7zip)')
    return
  }
  // 7z.exe needs 7z.dll beside it. License.txt travels with them: 7-Zip is
  // LGPL with the unRAR restriction, so the licence has to ship too.
  for (const f of ['7z.exe', '7z.dll', 'License.txt']) {
    const src = join(dir, f)
    if (existsSync(src)) copyFileSync(src, join(BIN, f === 'License.txt' ? '7-Zip-License.txt' : f))
  }
  log(`  ✓ 7-Zip: 7z.exe (${mb(join(BIN, '7z.exe'))} MB)`)
}

/** ffmpeg: download the smaller "essentials" static build and extract ffmpeg.exe. */
async function bundleFfmpeg() {
  const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  const tmp = join(tmpdir(), 'filesmith-ffmpeg')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const zip = join(tmp, 'ffmpeg.zip')
  try {
    log('  … downloading ffmpeg essentials (~45 MB)…')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
    // Windows 10+ ships bsdtar (which extracts .zip) in System32. Use it by
    // full path: a bare `tar` can resolve to Git Bash's GNU tar on PATH, which
    // parses `C:\…` as a remote host ("Cannot connect to C: resolve failed").
    const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    execFileSync(existsSync(systemTar) ? systemTar : 'tar', ['-xf', zip, '-C', tmp])
    const top = readdirSync(tmp).find(
      (f) => f.startsWith('ffmpeg-') && statSync(join(tmp, f)).isDirectory()
    )
    if (!top) throw new Error('extracted ffmpeg folder not found')
    copyFileSync(join(tmp, top, 'bin', 'ffmpeg.exe'), join(BIN, 'ffmpeg.exe'))
    // ffprobe (from the same build) reads video dimensions for the compress
    // resolution preview.
    copyFileSync(join(tmp, top, 'bin', 'ffprobe.exe'), join(BIN, 'ffprobe.exe'))
    log(`  ✓ ffmpeg: ffmpeg.exe + ffprobe.exe (${mb(join(BIN, 'ffmpeg.exe'))} MB)`)
  } catch (e) {
    log(`  ! ffmpeg download failed (${e.message})`)
    // The local winget build is the ~227 MB "full" static one. Falling back to
    // it silently once produced a 553 MB installer, so the fallback is opt-in.
    if (process.argv.includes('--allow-local-ffmpeg')) {
      const local = which('ffmpeg')
      const localProbe = which('ffprobe')
      if (local) {
        copyFileSync(local, join(BIN, 'ffmpeg.exe'))
        if (localProbe) copyFileSync(localProbe, join(BIN, 'ffprobe.exe'))
        log(
          `  ✓ ffmpeg: copied local build (${mb(join(BIN, 'ffmpeg.exe'))} MB — larger than essentials)`
        )
      } else {
        log('    ffmpeg not bundled; video/audio convert will fall back to PATH')
      }
    } else {
      log('    NOT falling back to the local "full" build (~227 MB per exe).')
      log('    Re-run with network access, or pass --allow-local-ffmpeg to accept the size.')
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** mutool (MuPDF): a single static exe for the PDF tools. */
function bundleMutool() {
  const m = which('mutool')
  if (!m) {
    log('  ! mutool not found — skip (winget install ArtifexSoftware.mutool)')
    return
  }
  copyFileSync(m, join(BIN, 'mutool.exe'))
  log(`  ✓ mutool: mutool.exe (${mb(join(BIN, 'mutool.exe'))} MB)`)
}

/**
 * Bundle the whole LibreOffice tree into resources/libreoffice so document
 * conversion works offline with zero user setup (~360 MB — the "bundle it"
 * tradeoff). Copies from a local install (the reliable source, same pattern as
 * the other bundled tools). A downloaded MSI can't be used directly: its admin
 * image (`msiexec /a`) leaves a corrupt bootstrap.ini and won't run — a real
 * install (or LibreOffice Portable) is required to copy from.
 */
function bundleLibreOffice() {
  const dest = join(ROOT, 'resources', 'libreoffice')
  if (existsSync(join(dest, 'program', 'soffice.exe'))) {
    log('  ✓ LibreOffice: already bundled')
    return
  }
  // A local install or a LibreOffice Portable "App/libreoffice" tree.
  const candidates = [
    'C:\\Program Files\\LibreOffice',
    'C:\\Program Files (x86)\\LibreOffice',
    process.env.LIBREOFFICE_DIR || ''
  ].filter(Boolean)
  const src = candidates.find((r) => existsSync(join(r, 'program', 'soffice.exe')))
  if (!src) {
    log('  ! LibreOffice not found — skip. To bundle it, install LibreOffice')
    log('    (winget install TheDocumentFoundation.LibreOffice) or set LIBREOFFICE_DIR')
    log('    to a LibreOffice tree, then re-run. Document conversion needs it.')
    return
  }
  log('  … copying LibreOffice tree (~360 MB, this takes a moment)…')
  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
  log(`  ✓ LibreOffice: bundled from ${src}`)
}

/**
 * Ghostscript: the portable subset (bin/lib/Resource/iccprofiles) used to
 * downsample images inside PDFs (the Compress tab's non-lossless levels). It's a
 * tree (exe + gsdll + lib + Resource), not a single exe, so it lives in
 * resources/ghostscript. Copy from a local install, else download the official
 * installer and extract it with 7-Zip (no admin/install needed).
 */
async function bundleGhostscript() {
  const dest = join(ROOT, 'resources', 'ghostscript')
  if (existsSync(join(dest, 'bin', 'gswin64c.exe'))) {
    log('  ✓ Ghostscript: already bundled')
    return
  }
  const SUBSET = ['bin', 'lib', 'Resource', 'iccprofiles']
  const copySubset = (root) => {
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    for (const d of SUBSET)
      if (existsSync(join(root, d))) cpSync(join(root, d), join(dest, d), { recursive: true })
  }
  // (a) local install: C:\Program Files\gs\gs<ver>\ or $GHOSTSCRIPT_DIR
  for (const base of ['C:\\Program Files\\gs', process.env.GHOSTSCRIPT_DIR || ''].filter(Boolean)) {
    try {
      if (existsSync(join(base, 'bin', 'gswin64c.exe'))) {
        copySubset(base)
        log(`  ✓ Ghostscript: copied from ${base}`)
        return
      }
      const ver = (existsSync(base) ? readdirSync(base) : []).find((d) =>
        existsSync(join(base, d, 'bin', 'gswin64c.exe'))
      )
      if (ver) {
        copySubset(join(base, ver))
        log(`  ✓ Ghostscript: copied from ${join(base, ver)}`)
        return
      }
    } catch {
      /* not there */
    }
  }
  // (b) download the official installer + extract with 7-Zip
  const sevenZip = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe'
  ].find(existsSync)
  if (!sevenZip) {
    log('  ! Ghostscript not found and 7-Zip missing — skip. Install Ghostscript')
    log('    (github.com/ArtifexSoftware/ghostpdl-downloads) or 7-Zip, then re-run.')
    log('    PDF Compress non-lossless levels need it.')
    return
  }
  const url =
    'https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10071/gs10071w64.exe'
  const tmp = join(tmpdir(), 'filesmith-gs')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const exe = join(tmp, 'gs.exe')
  try {
    log('  … downloading Ghostscript 10.07.1 (~65 MB)…')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(exe, Buffer.from(await res.arrayBuffer()))
    execFileSync(sevenZip, ['x', exe, `-o${join(tmp, 'x')}`, '-y'], { stdio: 'ignore' })
    copySubset(join(tmp, 'x'))
    if (!existsSync(join(dest, 'bin', 'gswin64c.exe')))
      throw new Error('gswin64c.exe missing after extract (unexpected installer layout)')
    log('  ✓ Ghostscript: downloaded + extracted')
  } catch (e) {
    log(`  ! Ghostscript failed (${e.message}) — PDF non-lossless compress needs it`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * Real-ESRGAN (ncnn/Vulkan): the AI upscaler behind the Image Upscale tab. Like
 * Ghostscript it's a tree (exe + vcomp dlls + models/), so it lives in
 * resources/realesrgan. Only the two models the app exposes are kept; the
 * release also ships animevideo/realesrnet variants we don't offer.
 */
const REALESRGAN_MODELS = ['realesrgan-x4plus', 'realesrgan-x4plus-anime']

async function bundleRealesrgan() {
  const dest = join(ROOT, 'resources', 'realesrgan')
  const EXE = 'realesrgan-ncnn-vulkan.exe'
  if (existsSync(join(dest, EXE))) {
    log('  ✓ Real-ESRGAN: already bundled')
    return
  }
  // Take the tree apart rather than copying it whole: the models we skip are
  // ~65 MB of installer weight for features the UI doesn't expose.
  const copySubset = (root) => {
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(join(dest, 'models'), { recursive: true })
    for (const f of readdirSync(root))
      if (f === EXE || f.endsWith('.dll')) cpSync(join(root, f), join(dest, f))
    const src = join(root, 'models')
    for (const m of REALESRGAN_MODELS)
      for (const ext of ['.bin', '.param'])
        if (existsSync(join(src, m + ext)))
          cpSync(join(src, m + ext), join(dest, 'models', m + ext))
  }
  // (a) a local copy (RCMM installs the same binary on demand) or $REALESRGAN_DIR
  const local = [
    join(process.env.LOCALAPPDATA || '', 'RCMM', 'tools', 'realesrgan'),
    process.env.REALESRGAN_DIR || ''
  ]
    .filter(Boolean)
    .find((d) => existsSync(join(d, EXE)))
  if (local) {
    copySubset(local)
    log(`  ✓ Real-ESRGAN: copied from ${local}`)
    return
  }
  // (b) the official release zip
  const url =
    'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip'
  const tmp = join(tmpdir(), 'filesmith-resrgan')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const zip = join(tmp, 'r.zip')
  try {
    log('  … downloading Real-ESRGAN (~120 MB)…')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${join(tmp, 'x')}' -Force`
      ],
      { stdio: 'ignore' }
    )
    copySubset(join(tmp, 'x'))
    if (!existsSync(join(dest, EXE)))
      throw new Error(`${EXE} missing after extract (unexpected release layout)`)
    log('  ✓ Real-ESRGAN: downloaded + extracted')
  } catch (e) {
    log(`  ! Real-ESRGAN failed (${e.message}) — the Image Upscale tab needs it`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * The tree-shaped tools, each with the file whose absence means it did not get
 * bundled. These ship via electron-builder's `extraResources`, and app-builder's
 * `copyFiles()` only **warns** on a missing source (`if (fromStat == null) {
 * log.warn(...); return }`) — so without this check `npm run package` exits 0 on
 * a machine that has none of them and produces an installer with dead PDF
 * compress, dead AI upscale and dead document conversion.
 */
const REQUIRED_TREES = [
  {
    id: 'libreoffice',
    probe: ['libreoffice', 'program', 'soffice.com'],
    what: 'document conversion',
    how: 'winget install TheDocumentFoundation.LibreOffice (or set LIBREOFFICE_DIR)'
  },
  {
    id: 'ghostscript',
    probe: ['ghostscript', 'bin', 'gswin64c.exe'],
    what: 'PDF compress (non-lossless levels)',
    how: 'install Ghostscript or 7-Zip so the download path can extract it'
  },
  {
    id: 'realesrgan',
    probe: ['realesrgan', 'realesrgan-ncnn-vulkan.exe'],
    what: 'AI image upscale',
    how: 'set REALESRGAN_DIR, or re-run with network access to fetch the release zip'
  },
  {
    id: 'realesrgan-models',
    probe: ['realesrgan', 'models'],
    what: 'AI image upscale (no model files)',
    how: 'same as realesrgan — the models/ folder must contain at least one .param',
    // A tree with an empty models/ dir upscales nothing, so probe contents too.
    nonEmptyParam: true
  }
]

/** `--skip=<id>[,<id>]`: deliberately build without a tree (a dev build). */
const skipArg = process.argv.find((a) => a.startsWith('--skip='))
const SKIPPED = new Set((skipArg?.slice('--skip='.length) ?? '').split(',').filter(Boolean))

/**
 * A skipped tree still has to *exist* as a directory, otherwise electron-builder
 * logs a warning for a missing `extraResources` source and the operator learns
 * nothing. Leave a marker so the omission is visible in the packaged app too.
 */
function markSkipped(id) {
  const dir = join(ROOT, 'resources', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKIPPED.txt'),
    `This build was packaged with --skip=${id}. Features depending on it are unavailable.\n`
  )
}

/** Fail the build loudly rather than shipping a silently broken installer. */
function assertBundled() {
  const missing = []

  const required = [
    'magick.exe',
    'ffmpeg.exe',
    'ffprobe.exe',
    'caesiumclt.exe',
    'mutool.exe',
    '7z.exe',
    '7z.dll'
  ]
  for (const f of required)
    if (!existsSync(join(BIN, f)))
      missing.push({
        id: f,
        what: 'core convert/compress/PDF/archive',
        how: 'winget install ImageMagick.ImageMagick Gyan.FFmpeg ArtifexSoftware.mutool SaeraSoft.CaesiumCLT 7zip.7zip'
      })

  // The essentials ffmpeg is ~90 MB; the local "full" static build is ~227 MB
  // per exe. Existence alone once let a stale full build ride into a 553 MB
  // installer, so size is part of the contract.
  const FFMPEG_CEILING = 120 * MB
  for (const f of ['ffmpeg.exe', 'ffprobe.exe']) {
    const p = join(BIN, f)
    if (existsSync(p) && statSync(p).size > FFMPEG_CEILING)
      missing.push({
        id: f,
        what: `installer size (${mb(p)} MB — the "full" build leaked in)`,
        how: 'delete resources/bin/ffmpeg.exe + ffprobe.exe and re-run to fetch essentials, or pass --allow-local-ffmpeg deliberately'
      })
  }

  // A small magick.exe is the modules build: it decodes nothing without its
  // coder DLLs. A static build (~30+ MB) compiles them in and needs no tree.
  const magick = join(BIN, 'magick.exe')
  if (existsSync(magick) && statSync(magick).size < 5 * MB) {
    const coders = join(BIN, 'modules', 'coders')
    const ok = existsSync(coders) && readdirSync(coders).some((f) => f.endsWith('.dll'))
    if (!ok)
      missing.push({
        id: 'magick modules',
        what: 'every image operation ("no decode delegate" on a clean install)',
        how: 'delete resources/bin/magick.exe and re-run so the modules/ tree is copied too'
      })
  }

  for (const t of REQUIRED_TREES) {
    const base = t.id.split('-')[0]
    if (SKIPPED.has(t.id) || SKIPPED.has(base)) continue
    const p = join(ROOT, 'resources', ...t.probe)
    let ok = existsSync(p)
    if (ok && t.nonEmptyParam) ok = readdirSync(p).some((f) => f.endsWith('.param'))
    if (!ok) missing.push({ ...t, path: p })
  }

  if (!missing.length) return
  log('\n❌ This build would ship broken. Missing:')
  for (const m of missing) log(`   • ${m.id} — breaks ${m.what}\n     ${m.how}`)
  log('\n   Fix them and re-run, or pass --skip=<id> to build without one deliberately.')
  process.exit(1)
}

for (const id of SKIPPED) {
  log(`  ! --skip=${id}: building WITHOUT it`)
  if (REQUIRED_TREES.some((t) => t.id === id || t.id.split('-')[0] === id)) markSkipped(id)
}

// `--lo-only` bundles just LibreOffice (the big download), leaving the fast
// resources/bin tools untouched. `--gs-only` / `--esrgan-only` likewise.
if (process.argv.includes('--lo-only')) {
  bundleLibreOffice()
} else if (process.argv.includes('--gs-only')) {
  await bundleGhostscript()
} else if (process.argv.includes('--esrgan-only')) {
  await bundleRealesrgan()
} else {
  log('Populating resources/bin …')
  bundleImageMagick()
  bundleCaesium()
  bundleSevenZip()
  await bundleFfmpeg()
  bundleMutool()
  if (!SKIPPED.has('ghostscript')) await bundleGhostscript()
  if (!SKIPPED.has('realesrgan')) await bundleRealesrgan()
  if (!SKIPPED.has('libreoffice')) bundleLibreOffice()

  const bundled = readdirSync(BIN).filter((f) => f !== '.gitkeep')
  const total = bundled.reduce((s, f) => s + statSync(join(BIN, f)).size, 0)
  log(`\nresources/bin: ${bundled.length} files, ${(total / MB).toFixed(1)} MB total`)

  assertBundled()
}
