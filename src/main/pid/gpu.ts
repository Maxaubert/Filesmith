import { run } from '../run'

// PiD needs an NVIDIA CUDA GPU. The Advanced tier is only offered when one is
// present, so this probe gates the UI. It never touches the GPU compute path,
// it just reads the adapter list via nvidia-smi, so it is safe to call freely.

export interface NvidiaGpu {
  name: string
  /** Total VRAM in MB, when nvidia-smi reports it. */
  vramMb: number | null
}

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
  const [name, mb] = line.split(',').map((s) => s.trim())
  if (!name) return null
  const vramMb = Number(mb)
  return { name, vramMb: Number.isFinite(vramMb) ? vramMb : null }
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
      '--query-gpu=name,memory.total',
      '--format=csv,noheader,nounits'
    ])
    if (code === 0) gpu = parseNvidiaSmi(stdout)
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
