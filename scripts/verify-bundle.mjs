// @ts-check
/**
 * Verify a resources tree carries every bundled tool, and that each one runs.
 *
 *   node scripts/verify-bundle.mjs [resourcesRoot] [--manifest <file>]
 *
 * resourcesRoot defaults to ./resources (before packing); the release workflow
 * also points it at dist/win-unpacked/resources (after packing), because
 * electron-builder only WARNS on a missing extraResources source. `--manifest`
 * writes "<size> <relative path>" for every file, to diff a CI bundle against
 * a local one. Exits 1 on any missing file or failed smoke run.
 */
import {
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const args = process.argv.slice(2)
const mIdx = args.indexOf('--manifest')
const manifest = mIdx >= 0 ? args[mIdx + 1] : null
const root = resolve(args.find((a, i) => !a.startsWith('--') && i !== mIdx + 1) ?? 'resources')
const MB = 1024 * 1024

/** [relative path, what breaks without it] */
const REQUIRED = [
  ['bin/magick.exe', 'every image operation'],
  ['bin/CORE_RL_MagickCore_.dll', 'magick (dynamic build runtime)'],
  ['bin/modules/coders/IM_MOD_RL_png_.dll', 'magick PNG decode/encode'],
  ['bin/modules/coders/IM_MOD_RL_jpeg_.dll', 'magick JPEG decode/encode'],
  ['bin/modules/coders/IM_MOD_RL_webp_.dll', 'magick WebP decode/encode'],
  ['bin/ffmpeg.exe', 'video/audio convert and compress'],
  ['bin/ffprobe.exe', 'video resolution preview'],
  ['bin/caesiumclt.exe', 'image compress'],
  ['bin/mutool.exe', 'PDF tools'],
  ['bin/7z.exe', 'archive tools'],
  ['bin/7z.dll', 'archive tools'],
  ['bin/7-Zip-License.txt', '7-Zip licence (LGPL + unRAR terms must ship)'],
  ['libreoffice/program/soffice.exe', 'document conversion'],
  ['libreoffice/program/soffice.com', 'document conversion (console launcher)'],
  ['ghostscript/bin/gswin64c.exe', 'PDF compress (non-lossless levels)'],
  ['ghostscript/Resource', 'Ghostscript fonts/init'],
  ['realesrgan/realesrgan-ncnn-vulkan.exe', 'AI upscale'],
  ['realesrgan/models/realesrgan-x4plus.param', 'AI upscale model'],
  ['realesrgan/models/realesrgan-x4plus.bin', 'AI upscale model'],
  ['realesrgan/models/realesrgan-x4plus-anime.param', 'AI upscale anime model'],
  ['realesrgan/models/realesrgan-x4plus-anime.bin', 'AI upscale anime model'],
  ['pid/pid_server.py', 'PiD upscaler sidecar'],
  ['spandrel/spandrel_server.py', 'spandrel upscaler sidecar'],
  ['registry/engines.json', 'built-in model registry']
]

const failures = []
for (const [rel, what] of REQUIRED)
  if (!existsSync(join(root, rel))) failures.push(`missing ${rel} (breaks ${what})`)

// The essentials ffmpeg is ~100 MB; the "full" build (~227 MB) must not leak in.
for (const f of ['bin/ffmpeg.exe', 'bin/ffprobe.exe']) {
  const p = join(root, f)
  if (existsSync(p) && statSync(p).size > 120 * MB)
    failures.push(
      `${f} is ${(statSync(p).size / MB).toFixed(0)} MB: the "full" ffmpeg build leaked in`
    )
}

/** Run a bundled exe; record a failure if it cannot start or exits non-zero. */
function smoke(
  /** @type {string} */ label,
  /** @type {string} */ exe,
  /** @type {string[]} */ argv,
  env = {}
) {
  if (!existsSync(exe)) return
  try {
    const out = execFileSync(exe, argv, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      env: { ...process.env, ...env }
    })
    console.log(`  ✓ ${label}: ${out.split(/\r?\n/).find((l) => l.trim()) ?? 'ok'}`)
  } catch (e) {
    const err = /** @type {{ status?: number, stderr?: string, message: string }} */ (e)
    failures.push(
      `${label} failed to run (exit ${err.status ?? '?'}): ${(err.stderr || err.message).trim()}`
    )
  }
}

console.log(`Verifying bundled tools in ${root}`)
const bin = join(root, 'bin')
// The same env the app sets (toolResolver.magickEnv), so the coder modules are
// loaded from THIS tree. Encoding a PNG proves they load, not just magick.exe.
const magickEnv = {
  MAGICK_CODER_MODULE_PATH: join(bin, 'modules', 'coders'),
  MAGICK_CODER_FILTER_PATH: join(bin, 'modules', 'filters'),
  MAGICK_CONFIGURE_PATH: bin
}
const tmp = mkdtempSync(join(tmpdir(), 'filesmith-verify-'))
try {
  const png = join(tmp, 'probe.png')
  smoke('magick encode PNG', join(bin, 'magick.exe'), ['-size', '8x8', 'xc:red', png], magickEnv)
  smoke(
    'magick decode PNG',
    join(bin, 'magick.exe'),
    [png, '-format', '%wx%h %m', 'info:'],
    magickEnv
  )
  smoke('ffmpeg', join(bin, 'ffmpeg.exe'), ['-hide_banner', '-version'])
  smoke('ffprobe', join(bin, 'ffprobe.exe'), ['-hide_banner', '-version'])
  smoke('caesiumclt', join(bin, 'caesiumclt.exe'), ['--version'])
  smoke('mutool', join(bin, 'mutool.exe'), ['-v'])
  smoke('7z', join(bin, '7z.exe'), ['i'])
  smoke('ghostscript', join(root, 'ghostscript', 'bin', 'gswin64c.exe'), ['--version'])
  smoke('libreoffice', join(root, 'libreoffice', 'program', 'soffice.com'), ['--version'])
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (manifest) {
  const lines = []
  const walk = (/** @type {string} */ d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      const s = statSync(p)
      if (s.isDirectory()) walk(p)
      else lines.push(`${s.size} ${relative(root, p).replaceAll('\\', '/')}`)
    }
  }
  walk(root)
  lines.sort((a, b) => a.slice(a.indexOf(' ')).localeCompare(b.slice(b.indexOf(' '))))
  mkdirSync(dirname(resolve(manifest)), { recursive: true })
  writeFileSync(manifest, lines.join('\n') + '\n')
  const total = lines.reduce((s, l) => s + Number(l.split(' ')[0]), 0)
  console.log(`  manifest: ${lines.length} files, ${(total / MB).toFixed(1)} MB -> ${manifest}`)
}

if (failures.length) {
  console.log(`\n❌ ${failures.length} problem(s) in ${root}:`)
  for (const f of failures) console.log(`   • ${f}`)
  process.exit(1)
}
console.log('All bundled tools present and runnable.')
