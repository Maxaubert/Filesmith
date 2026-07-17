// @ts-check
/**
 * Populate resources/bin with the bundled CLI tools so Filesmith is
 * self-contained (no PATH tools required at runtime). Binaries are large and
 * NOT committed — this script recreates them, and `npm run package` runs it
 * before electron-builder packs resources/bin into the app.
 *
 * Strategy per tool:
 *  - ImageMagick (magick.exe + its DLL/XML/ICC runtime): copied from the local
 *    winget/Program Files install. It's the dynamic build, so magick.exe needs
 *    its sibling DLLs — a flat copy into resources/bin keeps them together.
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

/** ImageMagick: copy magick.exe plus its runtime siblings (dynamic build). */
function bundleImageMagick() {
  const magick = which('magick')
  if (!magick) {
    log('  ! ImageMagick not found — skip (winget install ImageMagick.ImageMagick)')
    return
  }
  const dir = dirname(magick)
  let files = 0
  let bytes = 0
  for (const f of readdirSync(dir)) {
    const ext = f.toLowerCase().slice(f.lastIndexOf('.') + 1)
    const keep = f.toLowerCase() === 'magick.exe' || ['dll', 'xml', 'icc'].includes(ext)
    const src = join(dir, f)
    if (keep && statSync(src).isFile()) {
      copyFileSync(src, join(BIN, f))
      files++
      bytes += statSync(src).size
    }
  }
  log(`  ✓ ImageMagick: ${files} files (${(bytes / MB).toFixed(1)} MB)`)
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
    // Windows 10+ ships bsdtar as `tar`, which extracts .zip.
    execFileSync('tar', ['-xf', zip, '-C', tmp])
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
    const local = which('ffmpeg')
    const localProbe = which('ffprobe')
    if (local) {
      copyFileSync(local, join(BIN, 'ffmpeg.exe'))
      if (localProbe) copyFileSync(localProbe, join(BIN, 'ffprobe.exe'))
      log(`  ✓ ffmpeg: copied local build (${mb(join(BIN, 'ffmpeg.exe'))} MB — larger than essentials)`)
    } else {
      log('    ffmpeg not bundled; video/audio convert will fall back to PATH')
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
    log('  ✓ Ghostscript: downloaded + extracted')
  } catch (e) {
    log(`  ! Ghostscript failed (${e.message}) — PDF non-lossless compress needs it`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// `--lo-only` bundles just LibreOffice (the big download), leaving the fast
// resources/bin tools untouched. `--gs-only` bundles just Ghostscript.
if (process.argv.includes('--lo-only')) {
  bundleLibreOffice()
} else if (process.argv.includes('--gs-only')) {
  await bundleGhostscript()
} else {
  log('Populating resources/bin …')
  bundleImageMagick()
  bundleCaesium()
  await bundleFfmpeg()
  bundleMutool()
  await bundleGhostscript()
  bundleLibreOffice()

  const bundled = readdirSync(BIN).filter((f) => f !== '.gitkeep')
  const total = bundled.reduce((s, f) => s + statSync(join(BIN, f)).size, 0)
  log(`\nresources/bin: ${bundled.length} files, ${(total / MB).toFixed(1)} MB total`)
  if (!existsSync(join(BIN, 'magick.exe')))
    log('  ⚠ magick.exe missing — image convert/resize will need PATH')
}
