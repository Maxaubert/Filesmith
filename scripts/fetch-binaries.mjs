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
 *  - mutool (PDF) is deferred until the PDF tools land (phase 3).
 *
 * Install the copy-sourced tools first if missing:
 *   winget install ImageMagick.ImageMagick SaeraSoft.CaesiumCLT
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, basename } from 'node:path'
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
    log(`  ✓ ffmpeg: ffmpeg.exe (${mb(join(BIN, 'ffmpeg.exe'))} MB)`)
  } catch (e) {
    log(`  ! ffmpeg download failed (${e.message})`)
    const local = which('ffmpeg')
    if (local) {
      copyFileSync(local, join(BIN, 'ffmpeg.exe'))
      log(`  ✓ ffmpeg: copied local build (${mb(join(BIN, 'ffmpeg.exe'))} MB — larger than essentials)`)
    } else {
      log('    ffmpeg not bundled; video/audio convert will fall back to PATH')
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

log('Populating resources/bin …')
bundleImageMagick()
bundleCaesium()
await bundleFfmpeg()
log('  (mutool/PDF deferred until phase 3)')

const bundled = readdirSync(BIN).filter((f) => f !== '.gitkeep')
const total = bundled.reduce((s, f) => s + statSync(join(BIN, f)).size, 0)
log(`\nresources/bin: ${bundled.length} files, ${(total / MB).toFixed(1)} MB total`)
if (!existsSync(join(BIN, 'magick.exe'))) log('  ⚠ magick.exe missing — image convert/resize will need PATH')
