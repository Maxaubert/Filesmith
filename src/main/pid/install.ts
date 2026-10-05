import { statfsSync } from 'fs'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join } from 'path'
import { run } from '../run'
import { cudaTierSupport, detectNvidia } from './gpu'
import { downloadFile } from '../net/download'
import { expectedHash, recordHash } from '../net/integrity'
import { findComfyPidWeights } from '../comfy/discover'
import { PID_BACKBONES, pidEnvMarker, pidRepoDir, pidRoot, spandrelMarker } from './paths'
import { registryEntry } from '../registry/load'
import { ensureUv, winTar, type InstallOpts, type InstallProgress } from '../uvInstall'
import { withFileLock } from '../locks'

export type { InstallOpts, InstallProgress } from '../uvInstall'

/** The running install's cancel signal and byte reporter. Module scope is safe:
 * withInstallLock admits one install per process. */
let active: InstallOpts = {}

function runI(cmd: string, args: string[], opts: { cwd?: string } = {}): ReturnType<typeof run> {
  return run(cmd, args, { ...opts, signal: active.signal })
}

// The one-click PiD install. Everything the Advanced tier needs is public and
// ungated, so this runs unattended: vendor the nv-tlabs/PiD source, build a
// torch(cu128)+diffusers env with uv, and pull the nvidia/PiD weights. These are
// the exact steps proven in the feasibility spike.
//
// It is a multi-GB download (~3GB env + ~3GB weights), so every step reports
// progress for a modal. Idempotent and interruption-safe: downloads are atomic
// (write to .part, rename on success), and each phase is gated on a marker that
// is written only AFTER the phase fully completes — so a killed install always
// resumes cleanly and never mistakes a half-done step for a finished one.

/** The VAE's share of a backbone's approxBytes, so the checkpoint floor is the
 * remainder. Both come from the catalog rather than being re-guessed here. */
const VAE_APPROX_BYTES = 335_000_000

// The vendored nv-tlabs/PiD source ref. This WAS the head of a moving branch,
// recorded in an empty marker: two users installing a month apart ran different
// code, neither could tell which, and neither could ever receive a fix, because
// the marker's mere existence counted as "up to date". The ref is now written
// into the marker and a mismatch forces a re-vendor.
// Pinned to a COMMIT, not the moving `main`: two installs a month apart must
// run the same vendored code, and the marker comparison below can only mean
// something when the ref itself is immutable.
const PID_REPO_REF = '2c8814c2b91cc41a2be7809962c891e0d0ccff5f'
const PID_REPO_ZIP = `https://github.com/nv-tlabs/PiD/archive/${PID_REPO_REF}.zip`
const HF_BASE = 'https://huggingface.co/nvidia/PiD/resolve/main'

// Written at the very end of ensureRepo (after the pin is relaxed), so an
// interruption mid-extract/mid-relax is never seen as a finished repo.
const REPO_MARKER = '.filesmith-repo-ready'

/**
 * Download a URL to `dest`. Delegates to net/download.ts rather than keeping a
 * private copy: the fork here was missing ALL THREE of that file's guards — no
 * 401/403 license message, no rejection of an HTML/JSON error page served as
 * 200, and no minimum-size floor — and it is what fetches the 2.6 GB checkpoint
 * and the 320 MB VAE. It also now inherits sha256 verification, net.fetch (system
 * proxy + Windows trust store) and real network error messages.
 */
async function download(
  url: string,
  dest: string,
  onPct?: (pct: number) => void,
  minBytes?: number
): Promise<void> {
  // Trust-on-first-use like every other download in the app: the uv zip, the
  // vendored source and the multi-GB weights used to be the ONLY fetches that
  // bypassed the integrity ledger entirely - accepted on a size floor, never
  // recorded, so a re-download could silently differ from what was installed.
  const result = await downloadFile(url, dest, {
    onPct,
    minBytes,
    sha256: expectedHash(url),
    signal: active.signal,
    onBytes: active.onBytes
  })
  recordHash(result.url, result.sha256, result.bytes)
}

/** Copy a file into place atomically (temp + rename), so an interrupted copy
 * never leaves a truncated file that the existsSync guards accept as complete. */
function copyAtomic(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  rmSync(part, { force: true })
  copyFileSync(src, part)
  rmSync(dest, { force: true })
  renameSync(part, dest)
}

/** Ensure the PiD source is vendored (downloaded zip, extracted, pyproject relaxed). */
function markerSays(path: string, want: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, 'utf-8').trim() === want
  } catch {
    return false
  }
}

async function ensureRepo(onProgress: InstallProgress): Promise<void> {
  active.signal?.throwIfAborted()
  if (markerSays(join(pidRepoDir(), REPO_MARKER), PID_REPO_REF)) return
  onProgress('Downloading PiD source', null)
  const tmpDir = mkdtempSync(join(pidRoot(), 'src-'))
  const tmpZip = join(tmpDir, 'pid-src.zip')
  await download(PID_REPO_ZIP, tmpZip, (p) => onProgress('Downloading PiD source', p))

  onProgress('Extracting PiD source', null)
  // Extract with bsdtar (long-path safe); the zip unpacks to PiD-main/, which we
  // then rename into repoDir with Node (same volume, no PowerShell needed). Args
  // are passed as an array, so paths with spaces/quotes are safe.
  const extractTo = join(tmpDir, 'extract')
  rmSync(extractTo, { recursive: true, force: true })
  mkdirSync(extractTo, { recursive: true })
  const ex = await runI(winTar(), ['-xf', tmpZip, '-C', extractTo])
  if (ex.code !== 0) throw new Error(`PiD source extract failed: ${ex.stderr.slice(-400)}`)

  const inner = join(extractTo, `PiD-${PID_REPO_REF}`)
  if (!existsSync(inner)) throw new Error('PiD source extract produced no PiD-* folder')
  rmSync(pidRepoDir(), { recursive: true, force: true })
  renameSync(inner, pidRepoDir())
  rmSync(extractTo, { recursive: true, force: true })
  rmSync(tmpZip, { force: true })

  // The repo pins an exact uv version and declares a Linux-only lockfile env;
  // relax the pin so a current uv can install for Windows via `uv pip`. Assert
  // the relax actually took: a silent regex no-op that left an exact pin would
  // make a stale uv fail confusingly later.
  const pyproj = join(pidRepoDir(), 'pyproject.toml')
  const relaxed = readFileSync(pyproj, 'utf-8').replace(
    /required-version = "==[\d.]+"/,
    'required-version = ">=0.11.28"'
  )
  writeFileSync(pyproj, relaxed)
  if (/required-version = "==/.test(relaxed))
    throw new Error('Failed to relax PiD uv version pin (unexpected pyproject format)')

  writeFileSync(join(pidRepoDir(), REPO_MARKER), PID_REPO_REF)
}

/** Build the torch(cu128)+diffusers venv inside the repo. */
async function ensureEnv(onProgress: InstallProgress): Promise<void> {
  active.signal?.throwIfAborted()
  // The marker is written ONLY after every package install succeeds. Gating on
  // it (rather than on python.exe, which `uv venv` creates up front, before the
  // ~3GB torch install) means an interrupted install is never mistaken for a
  // finished env — a re-run rebuilds it instead of skipping to a torch-less venv.
  const marker = pidEnvMarker()
  if (existsSync(marker)) return
  const uv = await ensureUv(onProgress, active)
  const python = join(pidRepoDir(), '.venv', 'Scripts', 'python.exe')

  onProgress('Creating Python environment', null)
  const venvRes = await runI(uv, ['venv', '--python', '3.12'], { cwd: pidRepoDir() })
  if (venvRes.code !== 0) throw new Error(`venv creation failed: ${venvRes.stderr.slice(-400)}`)

  // torch first, from the CUDA 12.8 index (Blackwell-compatible), then the rest.
  onProgress('Installing PyTorch (CUDA), ~3 GB', null)
  const torchRes = await runI(
    uv,
    [
      'pip',
      'install',
      '--python',
      python,
      'torch==2.10.0',
      'torchvision==0.25.0',
      '--index-url',
      'https://download.pytorch.org/whl/cu128'
    ],
    { cwd: pidRepoDir() }
  )
  if (torchRes.code !== 0) throw new Error(`PyTorch install failed: ${torchRes.stderr.slice(-400)}`)

  onProgress('Installing PiD dependencies', null)
  const depRes = await runI(uv, ['pip', 'install', '--python', python, '-e', '.'], {
    cwd: pidRepoDir()
  })
  if (depRes.code !== 0)
    throw new Error(`PiD dependency install failed: ${depRes.stderr.slice(-400)}`)

  writeFileSync(marker, '')
}

/** Pull the nvidia/PiD weights for a backbone (checkpoint + VAE). */
async function ensureWeights(backbone: string, onProgress: InstallProgress): Promise<void> {
  active.signal?.throwIfAborted()
  const bb = PID_BACKBONES[backbone]
  if (!bb) throw new Error(`Unknown PiD backbone: ${backbone}`)

  // Weights land INSIDE the repo (see paths.ts): PiD reads ./checkpoints/... from
  // the repo CWD. bb.vaeFile / bb.checkpointDir are 'checkpoints/…' paths that
  // double as the HF repo layout, so they join cleanly onto both URL and repoDir.
  // download() is atomic, so a present file is always a complete file.
  //
  // Reuse an existing ComfyUI PiD if the user has one on disk: copying the local
  // files skips the ~3 GB download entirely.
  const existing = findComfyPidWeights(basename(bb.checkpointDir))

  const vaeDest = join(pidRepoDir(), bb.vaeFile)
  if (!existsSync(vaeDest)) {
    if (existing) {
      onProgress('Reusing ComfyUI VAE', null)
      copyAtomic(existing.vae, vaeDest)
    } else {
      // A floor derived from the catalog's own advertised size, so a truncated
      // body or a captive-portal page can't be cached as a finished weight.
      // bb.approxBytes was populated and then read by nothing at all.
      await download(
        `${HF_BASE}/${bb.vaeFile}`,
        vaeDest,
        (p) => onProgress('Downloading VAE (320 MB)', p),
        Math.floor(VAE_APPROX_BYTES * 0.9)
      )
    }
  }
  const ckptDest = join(pidRepoDir(), bb.checkpointDir, 'model_ema_bf16.pth')
  if (!existsSync(ckptDest)) {
    if (existing) {
      onProgress('Reusing ComfyUI PiD model', null)
      copyAtomic(existing.checkpoint, ckptDest)
    } else {
      await download(
        `${HF_BASE}/${bb.checkpointDir}/model_ema_bf16.pth`,
        ckptDest,
        (p) => onProgress('Downloading model (2.6 GB)', p),
        Math.floor(Math.max(0, bb.approxBytes - VAE_APPROX_BYTES) * 0.9)
      )
    }
  }
}

/** The PiD weight files and the URL each was downloaded from (doctor --verify). */
export function pidWeightFiles(backbone: string): { path: string; url: string }[] {
  const bb = PID_BACKBONES[backbone]
  if (!bb) return []
  const ckpt = `${bb.checkpointDir}/model_ema_bf16.pth`
  return [
    { path: join(pidRepoDir(), ckpt), url: `${HF_BASE}/${ckpt}` },
    { path: join(pidRepoDir(), bb.vaeFile), url: `${HF_BASE}/${bb.vaeFile}` }
  ]
}

/**
 * One install at a time, process-wide.
 *
 * Neither pid:install nor comfy:install had any dedupe, and they write the SAME
 * temp paths and rmSync the same repo dir — so two concurrent runs destroyed
 * each other. The only guards were renderer-local React flags, and the card is
 * conditionally mounted, so navigating away and back mid-install reset the flag
 * and re-enabled the button. A second caller now JOINS the running install
 * rather than starting a rival one.
 */
let inFlight: Promise<void> | null = null

export function installInProgress(): boolean {
  return inFlight != null
}

function withInstallLock(fn: () => Promise<void>): Promise<void> {
  if (inFlight) return inFlight
  inFlight = fn().finally(() => {
    inFlight = null
  })
  return inFlight
}

/**
 * Refuse before a multi-GB download that cannot fit. `bb.approxBytes` was
 * populated and read by nothing; the env itself is ~3 GB on top. A full disk
 * otherwise surfaces as whatever the write stream happens to throw, several
 * gigabytes in.
 */
const ENV_APPROX_BYTES = 3_000_000_000

export function checkDiskSpace(needBytes: number, dir?: string): { ok: boolean; reason?: string } {
  if (!(needBytes > 0)) return { ok: true }
  try {
    // statfs is Node 18.15+; absent or failing, we simply don't block — refusing
    // to install because we couldn't measure is worse than not measuring.
    if (typeof statfsSync !== 'function') return { ok: true }
    const st = statfsSync(dir ?? pidRoot())
    const free = Number(st.bavail) * Number(st.bsize)
    if (!Number.isFinite(free) || free <= 0) return { ok: true }
    if (free >= needBytes) return { ok: true }
    const gb = (n: number): string => `${(n / 1e9).toFixed(1)} GB`
    return {
      ok: false,
      reason: `Not enough disk space: this needs about ${gb(needBytes)} free, and there is ${gb(free)} available where Filesmith stores its data.`
    }
  } catch {
    return { ok: true } // never block an install on a failed probe
  }
}

/**
 * Delete the AI install so a poisoned one can be recovered. There was no reset
 * action anywhere in src/, and pidInstalled() returns true on mere existsSync —
 * so a corrupt weight (e.g. a captive-portal page whose Content-Length matched
 * its body) was permanently unrecoverable from the UI.
 */
export function removePidInstall(): { ok: boolean; error?: string } {
  if (inFlight) return { ok: false, error: 'An install is running. Wait for it to finish first.' }
  try {
    rmSync(pidRoot(), { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Full one-click PiD install (idempotent, interruption-safe, one per machine). */
export async function installPid(
  backbone: string,
  onProgress: InstallProgress,
  opts: InstallOpts = {}
): Promise<void> {
  return withInstallLock(() =>
    withFileLock(
      'pid-env',
      'the AI upscaler engine',
      async () => {
        active = opts
        try {
          await installPidInner(backbone, onProgress)
        } finally {
          active = {}
        }
      },
      {
        signal: opts.signal,
        onWait: (h) =>
          onProgress(`Waiting for another Filesmith (${h?.host ?? 'process'}) to finish`, null)
      }
    )
  )
}

/** Refuse the multi-GB download when this GPU can't run the result. The
 * verdict (cudaTierSupport) was computed for the status endpoint and then
 * never enforced: a GTX 1080 was still offered the ~3 GB cu128 torch. */
async function assertCudaCapable(): Promise<void> {
  const support = cudaTierSupport(await detectNvidia())
  if (!support.ok) throw new Error(support.reason ?? 'This GPU cannot run the CUDA engine.')
}

async function installPidInner(backbone: string, onProgress: InstallProgress): Promise<void> {
  await assertCudaCapable()
  mkdirSync(pidRoot(), { recursive: true })
  const bbForSpace = PID_BACKBONES[backbone]
  const space = checkDiskSpace((bbForSpace?.approxBytes ?? 0) + ENV_APPROX_BYTES)
  if (!space.ok) throw new Error(space.reason)
  await ensureRepo(onProgress)
  await ensureEnv(onProgress)
  await ensureWeights(backbone, onProgress)
  onProgress('Ready', 100)
}

/** Add `spandrel` to the shared torch venv (self-heals an env built before this
 * feature existed). Fast when already present. */
async function ensureSpandrel(onProgress: InstallProgress): Promise<void> {
  active.signal?.throwIfAborted()
  // Compare the RECORDED spec, not mere existence. The marker used to be empty,
  // so whatever spandrel resolved on setup day was frozen forever — and a model
  // with a newer architecture then reported "could not be read" with no way in
  // the UI to update the loader.
  // Never honour a USER-layer engineSpec: with field-by-field merge an
  // imported pack can override this string, and it is spliced into
  // `uv pip install`. validateEntry constrains its shape; provenance
  // constrains who may set it.
  const entry = registryEntry('spandrel')
  const spec =
    (entry && entry.provenance.source !== 'user' && entry.engineSpec) || 'spandrel>=0.4.1'
  if (markerSays(spandrelMarker(), spec)) return
  const uv = await ensureUv(onProgress, active)
  const python = join(pidRepoDir(), '.venv', 'Scripts', 'python.exe')

  onProgress('Installing spandrel', null)
  // spandrel is the loader; Pillow/numpy the image IO. All are small and are
  // usually already present from the PiD deps, so this is quick when so.
  const res = await runI(
    uv,
    ['pip', 'install', '--python', python, '--upgrade', spec, 'pillow', 'numpy'],
    { cwd: pidRepoDir() }
  )
  if (res.code !== 0) throw new Error(`spandrel install failed: ${res.stderr.slice(-400)}`)
  writeFileSync(spandrelMarker(), spec)
}

/**
 * Install just what ComfyUI-imported upscalers need: the shared torch venv plus
 * spandrel. No PiD weights (~3 GB) — the env alone runs ESRGAN-family models.
 */
export async function installComfyEngine(
  onProgress: InstallProgress,
  opts: InstallOpts = {}
): Promise<void> {
  // Shares both locks with installPid: both run ensureRepo/ensureEnv, write the
  // same temp paths and rmSync the same repo dir.
  return withInstallLock(() =>
    withFileLock(
      'pid-env',
      'the AI upscaler engine',
      async () => {
        active = opts
        try {
          await assertCudaCapable()
          mkdirSync(pidRoot(), { recursive: true })
          const space = checkDiskSpace(ENV_APPROX_BYTES)
          if (!space.ok) throw new Error(space.reason)
          await ensureRepo(onProgress)
          await ensureEnv(onProgress)
          await ensureSpandrel(onProgress)
          onProgress('Ready', 100)
        } finally {
          active = {}
        }
      },
      {
        signal: opts.signal,
        onWait: (h) =>
          onProgress(`Waiting for another Filesmith (${h?.host ?? 'process'}) to finish`, null)
      }
    )
  )
}
