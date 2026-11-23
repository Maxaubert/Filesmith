import { statfsSync } from 'fs'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join } from 'path'
import { run } from '../run'
import { cudaTierSupport, detectNvidia } from './gpu'
import { downloadFile } from '../net/download'
import { expectedHash, recordHash } from '../net/integrity'
import { findComfyPidWeights } from '../comfy/discover'
import {
  PID_BACKBONES,
  pidEnvMarker,
  pidRepoDir,
  pidRoot,
  pidVenvPython,
  spandrelMarker
} from './paths'
import { registryEntry } from '../registry/load'
import { ensureUv, winTar, type InstallOpts, type InstallProgress } from '../uvInstall'
import { withFileLock } from '../locks'

export type { InstallOpts, InstallProgress } from '../uvInstall'

/** The running install's cancel signal and byte reporter. Module scope is safe:
 * runExclusive admits one install per process. */
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

/**
 * What a re-vendor must carry over from the old repo dir: the weights (~3 GB,
 * which installComfyEngine never downloads again) and the venv (~3 GB torch).
 * Both live INSIDE the repo dir (see paths.ts), so a plain rm of the old source
 * used to delete them.
 */
const KEPT_ENTRIES = ['checkpoints', '.venv'] as const

/** Where the kept entries wait during a re-vendor. Inside pidRoot(), so it is on
 * the same volume and every move is a cheap rename. */
function pidKeepDir(): string {
  return join(pidRoot(), 'keep')
}

function isNonEmptyDir(path: string): boolean {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0
  } catch {
    return false
  }
}

/** Move `src` into `dest` entry by entry, then drop `src`. On a name clash
 * `dest` wins: the copy already in place is the newer one, and the held file of
 * the same name is the older duplicate. Files only the held copy has are kept. */
function mergeInto(src: string, dest: string): void {
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    if (!existsSync(to)) renameSync(from, to)
    else if (statSync(from).isDirectory() && statSync(to).isDirectory()) mergeInto(from, to)
  }
  rmSync(src, { recursive: true, force: true })
}

/** Move the kept entries (when present) out of `repoDir` into `holdDir`. */
export function stashKept(repoDir: string, holdDir: string): void {
  mkdirSync(holdDir, { recursive: true })
  for (const name of KEPT_ENTRIES) {
    const from = join(repoDir, name)
    if (!existsSync(from)) continue
    // Never let the rm that follows take a kept entry: refuse instead.
    if (existsSync(join(holdDir, name)))
      throw new Error(`Cannot keep ${name}: ${join(holdDir, name)} is still in the way`)
    renameSync(from, join(holdDir, name))
  }
}

/**
 * Move held entries back into `repoDir` (created when missing) and drop
 * `holdDir` once it is empty. A no-op when there is no `holdDir`.
 *
 * `fresh` = `repoDir` was just replaced by newly extracted source: any
 * `checkpoints` or `.venv` there came from the source archive, so it is removed
 * and the user's copy wins. Otherwise (a hold left by a crashed run) the copy
 * already in the repo is preferred: a non-empty one is merged into rather than
 * replaced, so an older held copy never overwrites newer weights.
 */
export function restoreKept(repoDir: string, holdDir: string, fresh: boolean): void {
  if (!existsSync(holdDir)) return
  mkdirSync(repoDir, { recursive: true })
  for (const name of KEPT_ENTRIES) {
    const from = join(holdDir, name)
    if (!existsSync(from)) continue
    const to = join(repoDir, name)
    if (existsSync(to) && (fresh || !isNonEmptyDir(to)))
      rmSync(to, { recursive: true, force: true })
    if (!existsSync(to)) renameSync(from, to)
    else if (name === 'checkpoints') mergeInto(from, to)
    // A stale held .venv beside a non-empty one in the repo holds no weights;
    // the repo's venv is the newer one.
    else rmSync(from, { recursive: true, force: true })
  }
  if (readdirSync(holdDir).length === 0) rmSync(holdDir, { recursive: true, force: true })
}

/**
 * Replace `repoDir` with the extracted source at `newSrc`, keeping the weights
 * and venv. The restore runs in `finally`, so a failure anywhere after the stash
 * (the rm, the rename) still puts them back; a crash leaves them in `holdDir`,
 * where the next ensureRepo finds and restores them.
 */
export function replaceRepoKeeping(repoDir: string, newSrc: string, holdDir: string): void {
  restoreKept(repoDir, holdDir, false)
  let replaced = false
  try {
    stashKept(repoDir, holdDir)
    rmSync(repoDir, { recursive: true, force: true })
    renameSync(newSrc, repoDir)
    replaced = true
  } finally {
    restoreKept(repoDir, holdDir, replaced)
  }
}

async function ensureRepo(onProgress: InstallProgress): Promise<void> {
  active.signal?.throwIfAborted()
  // A hold left by a run that crashed mid re-vendor goes back first, before
  // anything can decide the weights are missing.
  restoreKept(pidRepoDir(), pidKeepDir(), false)
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
  // The kept venv was installed (`uv pip install -e .`) against the OLD source,
  // so its deps must be re-resolved. Drop its ready marker only now, after the
  // download and extract succeeded: a failed or cancelled download leaves the old
  // repo, venv and marker in place, so the engine keeps working. Dropping it
  // before the swap means a failed swap never leaves a venv that reads as
  // installed beside a repo with no source. ensureEnv then runs its install steps
  // again on the kept venv; torch is already there, so it is quick.
  rmSync(pidEnvMarker(), { force: true })
  replaceRepoKeeping(pidRepoDir(), inner, pidKeepDir())
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
  const python = pidVenvPython()

  // A venv kept across a re-vendor (see ensureRepo) is reused as is: `uv venv`
  // on an existing dir can replace it, which would throw away the ~3 GB torch
  // install. The pip steps below are no-ops for what is already satisfied.
  if (!existsSync(python)) {
    onProgress('Creating Python environment', null)
    const venvRes = await runI(uv, ['venv', '--python', '3.12'], { cwd: pidRepoDir() })
    if (venvRes.code !== 0) throw new Error(`venv creation failed: ${venvRes.stderr.slice(-400)}`)
  }

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
 * and re-enabled the button. A second caller of the SAME kind joins the running
 * install rather than starting a rival one. A caller of the OTHER kind used to
 * join too, and so got back a promise that never ran its own steps (comfy:install
 * reported ok with no spandrel, pid:install with no weights). It now waits for
 * the running install to settle, then runs its own steps, which are idempotent
 * through the markers.
 */
export type InstallKind = 'pid' | 'comfy'

export class InstallLock {
  /** The running or queued install of each kind. */
  private pending = new Map<InstallKind, Promise<void>>()
  /** Settles once every install started so far has settled. Never rejects. */
  private tail: Promise<void> = Promise.resolve()

  /** True while any install is running or queued. */
  get busy(): boolean {
    return this.pending.size > 0
  }

  run(
    kind: InstallKind,
    inner: () => Promise<void>,
    opts: { signal?: AbortSignal; onWait?: () => void } = {}
  ): Promise<void> {
    const existing = this.pending.get(kind)
    if (existing) return existing
    const prev = this.tail
    const mustWait = this.pending.size > 0
    const work = (async (): Promise<void> => {
      if (mustWait) {
        opts.onWait?.()
        await settledOrAborted(prev, opts.signal)
      }
      opts.signal?.throwIfAborted()
      await inner()
    })()
    const entry = work.finally(() => {
      if (this.pending.get(kind) === entry) this.pending.delete(kind)
    })
    this.pending.set(kind, entry)
    // Wait on prev as well: a caller aborted while queued settles early, and the
    // next one must still not start before the install it was waiting for ends.
    this.tail = Promise.allSettled([prev, entry]).then(() => undefined)
    return entry
  }
}

/** Resolve when `p` settles, or reject as soon as `signal` aborts. */
function settledOrAborted(p: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return p
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new Error('Aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    void p.then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
  })
}

const installLock = new InstallLock()

export function installInProgress(): boolean {
  return installLock.busy
}

/**
 * Run one install exclusively: the in-process lock above, the cross-process
 * 'pid-env' file lock (the CLI shares the same dirs), and the module-scope
 * `active` opts, reset when the install ends.
 */
function runExclusive(
  kind: InstallKind,
  opts: InstallOpts,
  onProgress: InstallProgress,
  inner: () => Promise<void>
): Promise<void> {
  return installLock.run(
    kind,
    () =>
      withFileLock(
        'pid-env',
        'the AI upscaler engine',
        async () => {
          active = opts
          try {
            await inner()
          } finally {
            active = {}
          }
        },
        {
          signal: opts.signal,
          onWait: (h) =>
            onProgress(`Waiting for another Filesmith (${h?.host ?? 'process'}) to finish`, null)
        }
      ),
    {
      signal: opts.signal,
      onWait: () => onProgress('Waiting for the other install to finish', null)
    }
  )
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
  if (installLock.busy)
    return { ok: false, error: 'An install is running. Wait for it to finish first.' }
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
  return runExclusive('pid', opts, onProgress, () => installPidInner(backbone, onProgress))
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
  const python = pidVenvPython()

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
  // same temp paths and replace the same repo dir.
  return runExclusive('comfy', opts, onProgress, async () => {
    await assertCudaCapable()
    mkdirSync(pidRoot(), { recursive: true })
    const space = checkDiskSpace(ENV_APPROX_BYTES)
    if (!space.ok) throw new Error(space.reason)
    await ensureRepo(onProgress)
    await ensureEnv(onProgress)
    await ensureSpandrel(onProgress)
    onProgress('Ready', 100)
  })
}
