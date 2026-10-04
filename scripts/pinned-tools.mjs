// @ts-check
/**
 * Pinned, SHA-256-checked sources for every bundled tool, used by
 * `fetch-binaries.mjs --pinned` (the CI release build). A clean runner has
 * none of the local installs fetch-binaries normally copies from, so this
 * stages the SAME versions the local installer ships (checked 2026-10-04
 * against resources/ of the v0.5.0 build) from their official downloads.
 *
 * Hashes: GitHub release asset digests and the winget-pkgs manifests for the
 * same versions agree on every entry; mupdf and Real-ESRGAN were downloaded
 * and their extracted exes are byte-identical to the local bundle.
 *
 * Two tools cannot be staged by extraction alone and are INSTALLED instead,
 * so `--pinned` refuses to run outside CI unless `--pinned-allow-install`:
 *  - ImageMagick ships its dynamic (modules) build only as an Inno Setup exe;
 *    it is installed silently into the staging dir.
 *  - LibreOffice's MSI admin image (`msiexec /a`) does not run (corrupt
 *    bootstrap.ini, see bundleLibreOffice), so it gets a real per-dir install.
 *
 * To bump a tool: change version/url/sha256 here (the release page or the
 * winget-pkgs manifest lists the digest), then let the PR dry run verify it.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export const PINNED = {
  // Standalone 7z-only extractor: unpacks the 7-Zip installer (a 7z SFX),
  // whose full 7z.exe then extracts everything else.
  sevenZipR: {
    version: '26.02',
    url: 'https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe',
    sha256: '56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72'
  },
  sevenZip: {
    version: '26.02',
    url: 'https://github.com/ip7z/7zip/releases/download/26.02/7z2602-x64.exe',
    sha256: '6745fa76dc2ea031596d8678f6f6b99c3c1b435b4164a63485adbbc7b8d82ef0'
  },
  imagemagick: {
    version: '7.1.2-29 Q16-HDRI x64 dll',
    url: 'https://github.com/ImageMagick/ImageMagick/releases/download/7.1.2-29/ImageMagick-7.1.2-29-Q16-HDRI-x64-dll.exe',
    sha256: '94c025d0f572b1f7db03c380002485b49069c6d02796f462ffd7052874ba7467'
  },
  caesium: {
    version: '1.4.0',
    url: 'https://github.com/Lymphatus/caesium-clt/releases/download/v1.4.0/caesiumclt-v1.4.0-x86_64-pc-windows-msvc.zip',
    sha256: 'a56454a83207fc25830f4d12679d7385c0906060f2ce5f54345ac5a4cf94b00f'
  },
  // gyan.dev's essentials build, the same one the local download fetches,
  // from its versioned GitHub mirror (gyan.dev's own URL always means "latest").
  ffmpeg: {
    version: '9.0.2 essentials',
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.7z',
    sha256: '4705843ccaaf54257c16ad90f3e952ece33c17df964ecf7bfdbb0f49c7171077'
  },
  mutool: {
    version: '1.23.0',
    url: 'https://mupdf.com/downloads/archive/mupdf-1.23.0-windows.zip',
    sha256: '702386666f0d5a7d968102759843509c2549c1a206489add6cd284f657393ff8'
  },
  libreoffice: {
    version: '26.2.4.2',
    url: 'https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.4.2/win/x86_64/LibreOffice_26.2.4.2_Win_x86-64.msi',
    sha256: '202f26cda071c5aa4996a5a28412fddceb3891dceb0366982c62650456c0730f'
  },
  ghostscript: {
    version: '10.07.1',
    url: 'https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10071/gs10071w64.exe',
    sha256: '3a4c28d0aac47aa7cccd35a5932c55110376e9dbd966898dde388b7faba444a4'
  },
  realesrgan: {
    version: 'v0.2.5.0 (ncnn-vulkan 20220424)',
    url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip',
    sha256: 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d'
  }
}

/** @typedef {keyof typeof PINNED} PinnedId */

/**
 * @typedef {object} StagedTools
 * @property {string} magickDir     folder holding magick.exe, its DLLs and modules/
 * @property {string} caesiumExe
 * @property {string} sevenZipDir   folder holding 7z.exe, 7z.dll, License.txt
 * @property {string} ffmpegBinDir  folder holding ffmpeg.exe + ffprobe.exe
 * @property {string} mutoolExe
 * @property {string} libreOfficeDir  install root (program/soffice.exe inside)
 * @property {string} ghostscriptDir  root with bin/ lib/ Resource/ iccprofiles/
 * @property {string} realesrganDir   root with the exe, DLLs and models/
 */

const log = (...a) => console.log(...a)

/** Download a pinned file and refuse it unless its SHA-256 matches. */
async function download(/** @type {PinnedId} */ id, /** @type {string} */ dest) {
  const { url, sha256, version } = PINNED[id]
  log(`  … ${id} ${version}: ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = createHash('sha256').update(buf).digest('hex')
  if (got !== sha256)
    throw new Error(
      `${id}: SHA-256 mismatch for ${url}\n    expected ${sha256}\n    got      ${got}`
    )
  writeFileSync(dest, buf)
  log(`  ✓ ${id}: ${(buf.length / 1024 / 1024).toFixed(1)} MB, sha256 ok`)
  return dest
}

/** The single top-level folder an archive extracted into (e.g. mupdf-1.23.0-windows). */
function onlySubdir(/** @type {string} */ dir) {
  const subs = readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory())
  if (subs.length !== 1) throw new Error(`expected one folder in ${dir}, found: ${subs.join(', ')}`)
  return join(dir, subs[0])
}

function mustExist(/** @type {string} */ p, /** @type {string} */ what) {
  if (!existsSync(p)) throw new Error(`${what}: ${p} missing after staging`)
  return p
}

/**
 * Download, verify and unpack every pinned tool into `stage`. Throws on the
 * first failure: a release build with a missing or unverified tool must stop.
 * @param {string} stage
 * @param {{ allowInstall: boolean }} opts
 * @returns {Promise<StagedTools>}
 */
export async function stagePinnedTools(stage, { allowInstall }) {
  if (!allowInstall)
    throw new Error(
      '--pinned installs ImageMagick and LibreOffice into a staging dir (registry entries\n' +
        '    included). It runs on CI (CI=true); pass --pinned-allow-install to run it elsewhere.'
    )
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  const dl = join(stage, 'downloads')
  mkdirSync(dl)
  log(`Staging pinned tools in ${stage} …`)

  // 7-Zip first: its 7z.exe is the extractor for everything after it.
  const sevenZipR = await download('sevenZipR', join(dl, '7zr.exe'))
  const sevenZipDir = join(stage, '7zip')
  execFileSync(
    sevenZipR,
    ['x', await download('sevenZip', join(dl, '7z.exe')), `-o${sevenZipDir}`, '-y'],
    {
      stdio: 'ignore'
    }
  )
  const sevenZip = mustExist(join(sevenZipDir, '7z.exe'), '7-Zip')
  mustExist(join(sevenZipDir, '7z.dll'), '7-Zip')
  const extract = (/** @type {string} */ archive, /** @type {string} */ out) => {
    execFileSync(sevenZip, ['x', archive, `-o${out}`, '-y'], { stdio: 'ignore' })
    return out
  }

  const caesiumDir = extract(
    await download('caesium', join(dl, 'caesium.zip')),
    join(stage, 'caesium')
  )
  const caesiumExe = mustExist(join(onlySubdir(caesiumDir), 'caesiumclt.exe'), 'CaesiumCLT')

  const ffmpegDir = extract(await download('ffmpeg', join(dl, 'ffmpeg.7z')), join(stage, 'ffmpeg'))
  const ffmpegBinDir = join(onlySubdir(ffmpegDir), 'bin')
  mustExist(join(ffmpegBinDir, 'ffmpeg.exe'), 'ffmpeg')
  mustExist(join(ffmpegBinDir, 'ffprobe.exe'), 'ffprobe')

  const mutoolDir = extract(await download('mutool', join(dl, 'mupdf.zip')), join(stage, 'mupdf'))
  const mutoolExe = mustExist(join(onlySubdir(mutoolDir), 'mutool.exe'), 'mutool')

  // The Ghostscript installer is NSIS; 7-Zip unpacks it to the install layout.
  const ghostscriptDir = extract(
    await download('ghostscript', join(dl, 'gs.exe')),
    join(stage, 'gs')
  )
  mustExist(join(ghostscriptDir, 'bin', 'gswin64c.exe'), 'Ghostscript')

  const realesrganDir = extract(
    await download('realesrgan', join(dl, 'realesrgan.zip')),
    join(stage, 'realesrgan')
  )
  mustExist(join(realesrganDir, 'realesrgan-ncnn-vulkan.exe'), 'Real-ESRGAN')

  // ImageMagick: silent Inno install into the stage. The staging dir is deleted
  // after bundling, so the registry paths the installer leaves behind point at
  // nothing and cannot mask a bundle with missing coder modules.
  const magickDir = join(stage, 'imagemagick')
  execFileSync(
    await download('imagemagick', join(dl, 'imagemagick.exe')),
    ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/NOICONS', `/DIR=${magickDir}`],
    { stdio: 'inherit' }
  )
  mustExist(join(magickDir, 'magick.exe'), 'ImageMagick')
  mustExist(join(magickDir, 'modules', 'coders'), 'ImageMagick coder modules')

  // LibreOffice: a real install (see header), confined to the stage.
  const libreOfficeDir = join(stage, 'libreoffice')
  const msi = await download('libreoffice', join(dl, 'libreoffice.msi'))
  const msiLog = join(stage, 'libreoffice-msi.log')
  log('  … installing LibreOffice (msiexec, a few minutes) …')
  try {
    execFileSync(
      'msiexec',
      [
        '/i',
        msi,
        '/qn',
        '/norestart',
        `INSTALLLOCATION=${libreOfficeDir}`,
        'REBOOTYESNO=No',
        '/l*',
        msiLog
      ],
      { stdio: 'inherit' }
    )
  } catch (e) {
    // 3010 = installed, reboot requested: irrelevant for a copy source.
    const status = /** @type {{ status?: number }} */ (e).status
    if (status !== 3010) {
      // The verbose log is UTF-16; its tail usually names the failing action.
      if (existsSync(msiLog))
        log(readFileSync(msiLog, 'utf16le').split(/\r?\n/).slice(-40).join('\n'))
      throw new Error(`LibreOffice msiexec failed (exit ${status}); log: ${msiLog}`, { cause: e })
    }
  }
  mustExist(join(libreOfficeDir, 'program', 'soffice.exe'), 'LibreOffice')

  return {
    magickDir,
    caesiumExe,
    sevenZipDir,
    ffmpegBinDir,
    mutoolExe,
    libreOfficeDir,
    ghostscriptDir,
    realesrganDir
  }
}
