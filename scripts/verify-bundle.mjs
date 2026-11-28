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
  readFileSync,
  statSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const args = process.argv.slice(2)
const mIdx = args.indexOf('--manifest')
const manifest = mIdx >= 0 ? args[mIdx + 1] : null
const root = resolve(
  args.find((a, i) => !a.startsWith('--') && (mIdx < 0 || i !== mIdx + 1)) ?? 'resources'
)
const MB = 1024 * 1024

/** [relative path, what breaks without it] */
const REQUIRED = [
  ['bin/magick.exe', 'every image operation'],
  ['bin/CORE_RL_MagickCore_.dll', 'magick (dynamic build runtime)'],
  ['bin/modules/coders/IM_MOD_RL_png_.dll', 'magick PNG decode/encode'],
  ['bin/modules/coders/IM_MOD_RL_jpeg_.dll', 'magick JPEG decode/encode'],
  ['bin/modules/coders/IM_MOD_RL_webp_.dll', 'magick WebP decode/encode'],
  ['bin/ffmpeg.exe', 'video/audio convert and compress'],
  ['bin/caesiumclt.exe', 'image compress'],
  ['bin/mutool.exe', 'PDF tools'],
  ['bin/7z.exe', 'archive tools'],
  ['bin/7z.dll', 'archive tools'],
  ['bin/7-Zip-License.txt', '7-Zip licence (LGPL + unRAR terms must ship)'],
  ['licenses/THIRD-PARTY-NOTICES.md', 'third-party licence notices must ship'],
  ['libreoffice/program/soffice.exe', 'document conversion'],
  ['libreoffice/program/soffice.com', 'document conversion (console launcher)'],
  ['libreoffice/share/template/common/internal/html.oth', 'HTML sources lose their layout'],
  ['libreoffice/share/extensions/dict-en/hyph_en_US.dic', 'hyphenation moves line breaks'],
  ['libreoffice/LICENSE.html', 'LibreOffice licence texts must ship'],
  ['libreoffice/license.txt', 'LibreOffice licence texts must ship'],
  ['libreoffice/NOTICE', 'LibreOffice notices must ship'],
  ['libreoffice/help/media/icon-themes/COPYING-ICONS', 'the icon theme licence must ship'],
  ['ghostscript/bin/gswin64c.exe', 'PDF compress (non-lossless levels)'],
  ['ghostscript/Resource', 'Ghostscript fonts/init'],
  ['realesrgan/realesrgan-ncnn-vulkan.exe', 'AI upscale'],
  ['realesrgan/models/realesrgan-x4plus.param', 'AI upscale model'],
  ['realesrgan/models/realesrgan-x4plus.bin', 'AI upscale model'],
  ['realesrgan/models/realesrgan-x4plus-anime.param', 'AI upscale anime model'],
  ['realesrgan/models/realesrgan-x4plus-anime.bin', 'AI upscale anime model'],
  ['pid/pid_server.py', 'PiD upscaler sidecar'],
  ['spandrel/spandrel_server.py', 'spandrel upscaler sidecar'],
  ['registry/engines.json', 'built-in model registry'],
  ['cli/filesmith.cmd', 'filesmith on PATH (cmd, PowerShell)'],
  ['cli/filesmith', 'filesmith on PATH (Git Bash, Claude Code)'],
  ['cli/path.ps1', 'the installer PATH edit'],
  ['skill/filesmith/SKILL.md', 'the Claude Code skill'],
  ['skill/filesmith/reference.md', 'the Claude Code skill reference']
]

/** [relative path, why it must not ship] */
const FORBIDDEN = [
  ['bin/ffprobe.exe', 'not used, about 100 MB'],
  ['libreoffice/help/index.html', 'the LibreOffice trim did not run'],
  ['realesrgan/vcomp140d.dll', 'debug OpenMP runtime, not redistributable and unused']
]

const failures = []
for (const [rel, what] of REQUIRED)
  if (!existsSync(join(root, rel))) failures.push(`missing ${rel} (breaks ${what})`)
for (const [rel, why] of FORBIDDEN)
  if (existsSync(join(root, rel))) failures.push(`${rel} must not ship (${why})`)

// The essentials ffmpeg is ~100 MB; the "full" build (~227 MB) must not leak in.
const ffmpeg = join(root, 'bin', 'ffmpeg.exe')
if (existsSync(ffmpeg) && statSync(ffmpeg).size > 120 * MB) {
  const size = (statSync(ffmpeg).size / MB).toFixed(0)
  failures.push(`bin/ffmpeg.exe is ${size} MB: the "full" ffmpeg build leaked in`)
}

// Git Bash cannot run the sh shim with CRLF endings ("$'\r': command not found").
const sh = join(root, 'cli', 'filesmith')
if (existsSync(sh) && readFileSync(sh, 'utf8').includes('\r'))
  failures.push('cli/filesmith has CRLF line endings (Git Bash cannot run it)')

/** Seconds one smoke run may take before it counts as hung (issue #43). */
const SMOKE_LIMIT_S = 90

/** Kill a process and every process it started (soffice.com starts soffice.bin). */
function killTree(/** @type {number | undefined} */ pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

/**
 * Run a bundled exe; record a failure if it cannot start, exits non-zero, or
 * hangs. It settles on 'exit', not on the pipes closing: a grandchild that
 * inherits the output pipes (LibreOffice's soffice.bin) kept the old
 * execFileSync waiting forever, which is how the release check hung for 45
 * minutes (issue #43). Whatever is still running afterwards is killed as a tree.
 */
function smoke(
  /** @type {string} */ label,
  /** @type {string} */ exe,
  /** @type {string[]} */ argv,
  env = {}
) {
  if (!existsSync(exe)) return Promise.resolve()
  console.log(`  ... ${label}`)
  return new Promise((done) => {
    let out = ''
    let err = ''
    let finished = false
    const child = spawn(exe, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      windowsHide: true
    })
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    const end = (/** @type {string | null} */ problem) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      killTree(child.pid)
      if (problem) failures.push(`${label}: ${problem}`)
      else console.log(`  ✓ ${label}: ${out.split(/\r?\n/).find((l) => l.trim()) ?? 'ok'}`)
      done(undefined)
    }
    const timer = setTimeout(
      () => end(`hung for ${SMOKE_LIMIT_S} s and was killed (${exe})`),
      SMOKE_LIMIT_S * 1000
    )
    child.on('error', (e) => end(`failed to start: ${e.message}`))
    // A short grace period lets the pipes drain after exit, then stop waiting.
    child.on('exit', (code) =>
      setTimeout(
        () => end(code === 0 ? null : `failed to run (exit ${code}): ${(err || out).trim()}`),
        250
      )
    )
  })
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
  await smoke(
    'magick encode PNG',
    join(bin, 'magick.exe'),
    ['-size', '8x8', 'xc:red', png],
    magickEnv
  )
  await smoke(
    'magick decode PNG',
    join(bin, 'magick.exe'),
    [png, '-format', '%wx%h %m', 'info:'],
    magickEnv
  )
  await smoke('ffmpeg', join(bin, 'ffmpeg.exe'), ['-hide_banner', '-version'])
  await smoke('caesiumclt', join(bin, 'caesiumclt.exe'), ['--version'])
  await smoke('mutool', join(bin, 'mutool.exe'), ['-v'])
  await smoke('7z', join(bin, '7z.exe'), ['i'])
  await smoke('ghostscript', join(root, 'ghostscript', 'bin', 'gswin64c.exe'), ['--version'])
  // A throwaway profile, so a first run never sits in LibreOffice's profile setup.
  const profile = 'file:///' + join(tmp, 'lo-profile').replaceAll('\\', '/')
  await smoke('libreoffice', join(root, 'libreoffice', 'program', 'soffice.com'), [
    `-env:UserInstallation=${profile}`,
    '--headless',
    '--norestore',
    '--version'
  ])
  // --version loads very little. A real conversion shows the trimmed tree works.
  const html = join(tmp, 'doc.html')
  writeFileSync(html, '<html><body><h1>Filesmith</h1><p>check</p></body></html>')
  const so = join(root, 'libreoffice', 'program', 'soffice.com')
  await smoke('libreoffice HTML to PDF', so, [
    `-env:UserInstallation=${profile}`,
    '--headless',
    '--norestore',
    '--convert-to',
    'pdf',
    '--outdir',
    tmp,
    html
  ])
  // soffice exits 0 even when it converts nothing.
  if (existsSync(so) && !existsSync(join(tmp, 'doc.pdf')))
    failures.push('libreoffice HTML to PDF: no PDF was written')
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
