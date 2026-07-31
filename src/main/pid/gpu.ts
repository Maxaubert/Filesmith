import { run } from '../run'

// PiD needs an NVIDIA CUDA GPU. The Advanced tier is only offered when one is
// present, so this probe gates the UI. It never touches the GPU compute path,
// it just reads the adapter list via nvidia-smi, so it is safe to call freely.

export interface NvidiaGpu {
  name: string
  /** Total VRAM in MB, when nvidia-smi reports it. */
  vramMb: number | null
  /** CUDA compute capability as a number (8.9 for Ada, 6.1 for Pascal). */
  computeCap: number | null
  /** Driver version string, e.g. "581.15". */
  driver: string | null
}

/**
 * The floor for the CUDA tier. torch is installed from the cu128 index, whose
 * kernels are built for sm_75 and up: a Pascal (6.1) card downloads ~3 GB and
 * then fails with a CUDA kernel-image error, having been told nothing beforehand.
 * `nvidia-smi answered` was the ONLY gate.
 */
export const MIN_COMPUTE_CAP = 7.5
export const MIN_DRIVER = 525

/**
 * Parse `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits`
 * output into the first GPU, or null if there's no usable line. Pure, so the
 * parsing is testable without a GPU. VRAM is null when the field isn't a number.
 */
export function parseNvidiaSmi(stdout: string): NvidiaGpu | null {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  if (!line) return null
  const [name, mb, cap, driver] = line.split(',').map((s) => s.trim())
  if (!name) return null
  const vramMb = Number(mb)
  const computeCap = Number(cap)
  return {
    name,
    vramMb: Number.isFinite(vramMb) ? vramMb : null,
    // An absent compute_cap (older nvidia-smi builds don't report it) must read
    // as "unknown", never as "too old" — otherwise working hardware is refused.
    computeCap: cap && Number.isFinite(computeCap) ? computeCap : null,
    driver: driver || null
  }
}

/**
 * Whether this GPU can run the CUDA tier, and why not if it can't. Unknown
 * fields count as acceptable: refusing on missing information would block
 * hardware that works.
 *
 * The old gate was "nvidia-smi answered" and nothing else, so a GTX 10xx
 * (Pascal, 6.1) owner sat through a ~3 GB cu128 torch download and only then hit
 * a CUDA kernel-image error.
 */
export function cudaTierSupport(gpu: NvidiaGpu | null): { ok: boolean; reason?: string } {
  if (!gpu) return { ok: false, reason: 'No NVIDIA GPU was detected.' }
  if (gpu.computeCap != null && gpu.computeCap < MIN_COMPUTE_CAP)
    return {
      ok: false,
      reason: `The AI engine needs an RTX-class NVIDIA GPU (compute capability ${MIN_COMPUTE_CAP} or newer). Your ${gpu.name} reports ${gpu.computeCap}, so the download would fail after several GB.`
    }
  const major = Number((gpu.driver ?? '').split('.')[0])
  if (Number.isFinite(major) && major > 0 && major < MIN_DRIVER)
    return {
      ok: false,
      reason: `Your NVIDIA driver (${gpu.driver}) is too old for the AI engine. Update to ${MIN_DRIVER} or newer and try again.`
    }
  return { ok: true }
}

let cached: { gpu: NvidiaGpu | null } | null = null

/**
 * The first NVIDIA GPU nvidia-smi reports, or null if there is none (no NVIDIA
 * driver, or an AMD/Intel/no GPU machine). Cached: the answer does not change
 * within a session and the probe spawns a process.
 */
export async function detectNvidia(): Promise<NvidiaGpu | null> {
  if (cached) return cached.gpu
  let gpu: NvidiaGpu | null = null
  try {
    const { code, stdout } = await run('nvidia-smi', [
      '--query-gpu=name,memory.total,compute_cap,driver_version',
      '--format=csv,noheader,nounits'
    ])
    if (code === 0) gpu = parseNvidiaSmi(stdout)
    // compute_cap is unavailable on older nvidia-smi builds, which makes the
    // whole query fail — fall back to the fields that have always existed
    // rather than reporting "no NVIDIA GPU" on a perfectly good card.
    if (!gpu) {
      const basic = await run('nvidia-smi', [
        '--query-gpu=name,memory.total',
        '--format=csv,noheader,nounits'
      ])
      if (basic.code === 0) gpu = parseNvidiaSmi(basic.stdout)
    }
  } catch {
    // nvidia-smi not on PATH => no NVIDIA GPU.
  }
  cached = { gpu }
  return gpu
}

/** True when a usable NVIDIA GPU is present. */
export async function hasNvidia(): Promise<boolean> {
  return (await detectNvidia()) != null
}
