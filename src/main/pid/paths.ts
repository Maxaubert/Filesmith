import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'

// Where the PiD Advanced tier lives on disk. Unlike the bundled CLI tools, PiD
// is a large (~6GB) torch+weights install fetched on first use, so it lives
// under the user's data dir, never inside the app bundle.
//
//   <userData>/pid/
//     repo/              the nv-tlabs/PiD source (vendored)
//     repo/.venv/        the torch(cu128)+diffusers env
//     repo/checkpoints/  nvidia/PiD weights (per backbone) + the shared VAE
//     kernel-cache/      persisted CUDA/inductor compile cache (warm across runs)
//
// The weights live INSIDE the repo (not beside it): PiD resolves both its config
// source (pid/_src/...) and its weights (./checkpoints/...) relative to the
// process CWD, which is the repo dir, so a single CWD has to see both.

export function pidRoot(): string {
  return join(app.getPath('userData'), 'pid')
}
export function pidRepoDir(): string {
  return join(pidRoot(), 'repo')
}
export function pidVenvPython(): string {
  const exe = process.platform === 'win32' ? 'python.exe' : 'python'
  const sub = process.platform === 'win32' ? 'Scripts' : 'bin'
  return join(pidRepoDir(), '.venv', sub, exe)
}
/** Where PiD's weights live: <repoDir>/checkpoints, resolved as ./checkpoints
 * from the repo CWD. Also the root the backbone's relative paths join against. */
export function pidCheckpointsDir(): string {
  return join(pidRepoDir(), 'checkpoints')
}
export function pidKernelCache(): string {
  return join(pidRoot(), 'kernel-cache')
}

/** Marker file the installer writes only after the venv's packages are all in.
 * Its presence (not python.exe's, which uv creates before the ~3GB torch pull)
 * is the real "env is complete" signal. */
export function pidEnvMarker(): string {
  return join(pidRepoDir(), '.venv', '.filesmith-env-ready')
}

/** The server script shipped with the app (copied into the repo at install). */
export function pidServerScript(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pid', 'pid_server.py')
    : join(app.getAppPath(), 'resources', 'pid', 'pid_server.py')
}

/** The spandrel upscale sidecar shipped with the app. Runs in the SAME torch
 * venv as PiD (spandrel is added to it), so ComfyUI-imported models cost no
 * second multi-GB install. */
export function spandrelServerScript(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'spandrel', 'spandrel_server.py')
    : join(app.getAppPath(), 'resources', 'spandrel', 'spandrel_server.py')
}

/** Marker written after `spandrel` is installed into the shared venv. */
export function spandrelMarker(): string {
  return join(pidRepoDir(), '.venv', '.filesmith-spandrel-ready')
}

/** True when the shared torch venv exists and has spandrel — i.e. ComfyUI
 * imported models can run without any further download. */
export function comfyEngineReady(): boolean {
  return existsSync(pidEnvMarker()) && existsSync(spandrelMarker())
}

/** A backbone's checkpoint + VAE, as hosted under nvidia/PiD's `checkpoints/`. */
export interface PidBackbone {
  id: string
  /** The distilled 4-step checkpoint directory (holds model_ema_bf16.pth). */
  checkpointDir: string
  /** The VAE weight file this backbone reads (shared across some backbones). */
  vaeFile: string
  approxBytes: number
}

// Only flux is wired for now (the verified default). Others are a later add.
export const PID_BACKBONES: Record<string, PidBackbone> = {
  flux: {
    id: 'flux',
    checkpointDir: 'checkpoints/PiD_res2k_sr4x_official_flux_distill_4step',
    vaeFile: 'checkpoints/ae.safetensors',
    approxBytes: 2_720_000_000 + 335_000_000
  }
}

/** True when the env is installed and the chosen backbone's weights are present. */
export function pidInstalled(backbone = 'flux'): boolean {
  const bb = PID_BACKBONES[backbone]
  if (!bb) return false
  return (
    // Env marker, not python.exe: a half-built venv (python but no torch) must
    // not read as installed. [[filesmith-pid-upscaler]]
    existsSync(pidEnvMarker()) &&
    existsSync(join(pidRepoDir(), bb.checkpointDir, 'model_ema_bf16.pth')) &&
    existsSync(join(pidRepoDir(), bb.vaeFile))
  )
}
