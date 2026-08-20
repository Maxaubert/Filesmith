import type { ComfyModel } from './comfy'

// IPC payloads that cross main -> preload -> renderer, declared ONCE.
// pid:status used to be typed three times (the handler, the preload wrapper,
// and the renderer hook), and the narrowest copy won — which is exactly how
// cudaReason got computed, serialized, and thrown away before any UI saw it.

export interface GpuInfo {
  name: string
  vramMb: number | null
}

/** pid:status — NVIDIA/PiD availability for the Advanced upscale tier. */
export interface PidStatus {
  /** The detected GPU, or null when none exists OR it cannot run the CUDA
   * tier (see cudaReason) — the gating the UI keys off. */
  nvidia: GpuInfo | null
  installed: boolean
  backbone: string
  cudaOk: boolean
  /** Why the CUDA tier is unavailable (driver too old, pre-Turing card, …). */
  cudaReason: string | null
}

/** comfy:status — ComfyUI-imported upscaler availability. */
export interface ComfyStatus {
  nvidia: GpuInfo | null
  cudaReason: string | null
  engineReady: boolean
  /** The shared torch env already exists (setup is then just the spandrel loader). */
  envExists: boolean
  /** The user's ComfyUI has PiD weights we can reuse — PiD is only offered when
   * this is true or PiD is already installed. */
  pidReusable: boolean
  folder: string | null
  models: ComfyModel[]
}
