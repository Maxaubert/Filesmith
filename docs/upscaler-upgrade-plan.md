# Image Upscale v2: PiD flagship + cross-GPU ONNX engine

Status: APPROVED 2026-07-21. Order: PiD first, then ONNX Standard tier, then custom import.

## Goal

Level up the "Image Upscale" tool beyond the current Real-ESRGAN (ncnn-vulkan) baseline, in
three tiers:

1. **Standard (any GPU)** — the shippable upgrade for every user.
2. **Advanced (NVIDIA) / PiD** — the flagship, for the dev's own RTX machine. Not shippable.
3. **Custom import** — user-supplied `.onnx` models (UltraSharp-class), license burden on the user.

## Why these choices (from the research brief)

- **PiD** = NVIDIA Pixel Diffusion. Best-in-class restoration, but weights are NVIDIA
  non-commercial (NSCLv1), NVIDIA-CUDA only, and it needs the torch/diffusers diffusion stack.
  So it can never ship in the product; it lives as a gated, opt-in, download-on-first-use tier
  the user runs on their own hardware. Verified: `nv-tlabs/PiD` provides STANDALONE inference
  (no ComfyUI) via torch+diffusers.
- **ONNX Runtime + DirectML** (`onnxruntime-node`) is the shippable engine: one model format,
  accelerates on NVIDIA/AMD/Intel via DirectML, CPU fallback, NO Python/torch in the installer
  (torch used only at build time to export `.onnx`), and reaches the transformer SR tier that
  ncnn cannot.
- The famous community models (UltraSharp, Remacri, AnimeSharp) are CC-BY-NC-SA
  (non-commercial). Never bundled; offered via custom import.
- Delivery: download-on-first-use for all models (keep the installer lean). Import accepts
  pre-converted `.onnx` only (no on-device `.pth` converter).

## Tiers and models

| Tier              | Engine                               | Runs on                | Models                                                               | Ships?      |
| ----------------- | ------------------------------------ | ---------------------- | -------------------------------------------------------------------- | ----------- |
| Standard          | ONNX + DirectML (`onnxruntime-node`) | NVIDIA/AMD/Intel + CPU | Real-ESRGAN (default), NMKD-Superscale, one transformer (SwinIR/DAT) | yes         |
| Advanced (NVIDIA) | torch + diffusers via uv/Python      | NVIDIA CUDA only       | PiD (backbone VAE: flux/sd3)                                         | no (opt-in) |
| Custom            | ONNX + DirectML                      | any                    | user `.onnx` from OpenModelDB                                        | n/a         |

Cross-cutting: **tiling with OOM back-off** (halve tile on allocator error, retry) so one build
survives an 8GB laptop GPU, CPU fallback, and the RTX 5090.

## PiD standalone invocation (verified)

```
python -m pid._src.inference.from_clean --backbone flux \
  --input_path IMG --scale 4 --pid_inference_steps 4 --output_dir OUT
```

Deps: torch (CUDA 12.8 for Blackwell / RTX 5090), transformers>=4.57, diffusers>=0.37, plus the
repo's utility deps. Weights: `nvidia/PiD` checkpoint + a backbone VAE. Code Apache-2.0, weights
non-commercial.

## Plan (phased)

### Spike B result (PiD) — DONE 2026-07-21

- torch 2.10.0+cu128 installs on Windows and runs on the RTX 5090 (Blackwell sm_120). CUDA OK.
- `nvidia/PiD` is PUBLIC/UNGATED. The backbone VAE (`ae.safetensors`, 320MB) is bundled in that
  same repo and read locally, so there is NO runtime download of the gated FLUX/SD3 repos.
  => one-click end-user download is viable: one public repo, no HF token, no license gate.
- `from_clean.py --backbone flux --scale 4 --prompt "a photo"` ran standalone (no ComfyUI) and
  produced a clean, diffusion-quality 4x (400x267 -> 1600x1024). A `--prompt` is REQUIRED even at
  cfg_scale=1 (text-conditioned model).
- Download budget: ~3GB torch env (once) + flux checkpoint 2.6GB + VAE 320MB (per model).
- **SPEED CONCERN:** model load ~19s; the 4-step diffusion DECODE itself took ~7-8 min for one
  small image on the 5090 (first run 466s total; a second run exceeded 10 min). This is dominated
  by the decode, not loading, and likely by Blackwell PTX/JIT kernel compilation with no
  persistent cache + no `--compile`. PiD is inherently a heavy "minutes per image" tool.
  Phase 1 MUST: run a resident sidecar (load once), enable `--compile`, persist the CUDA/inductor
  cache, and set honest "this takes minutes" UX expectations. Even optimized, PiD is a
  best-quality/be-patient tier, not a fast one. Warm per-image time still to be measured properly.

### Phase 0 — Feasibility spikes (de-risk before building)

- **Spike A (ONNX):** get `onnxruntime-node` with the DirectML EP running a Real-ESRGAN `.onnx`
  on this box; confirm the DML native libs package for Windows-x64 and measure speed. Record the
  exact npm package + version that ships DML binaries.
- **Spike B (PiD):** clone `nv-tlabs/PiD`, set up a uv/torch(CUDA12.8)/diffusers env, download a
  backbone + PiD checkpoint, run `from_clean.py --scale 4` on a real photo. Confirm it produces a
  4x image on the 5090 and record VRAM/time. This is Phase 1's foundation.

### Phase 1 — PiD Advanced tier (the flagship)

- `resolvePid()` / uv env bootstrap (mirror the rembg resolver): pinned torch+cu128, diffusers,
  PiD repo installed editable, weights cached under `%LOCALAPPDATA%/Filesmith/pid`.
- `src/main/tools/pidUpscale.ts`: arg builder for `from_clean.py`; pre-convert exotic inputs to
  PNG (reuse the magick pre-convert); output PNG; parse progress from stderr.
- Register as an operation/model within the Image Upscale tool, gated: only offered when an
  NVIDIA GPU is detected; first selection shows a non-commercial-use notice + download prompt.
- Tiling/size guard: PiD has no built-in tiling; cap input size or tile ourselves, with OOM
  back-off.
- Tests: arg builder, gating logic, error messages (no-NVIDIA, download-failed, OOM).

### Phase 2 — Standard tier (cross-GPU ONNX engine)

- Add `onnxruntime-node` (DirectML build) as a runtime dependency.
- `src/main/tools/onnxUpscale.ts`: load an `.onnx` SR model, run image->image with tiling +
  OOM back-off, EP preference DirectML -> CPU.
- Curated model registry (Real-ESRGAN, NMKD, one transformer) with download-on-first-use into
  `%LOCALAPPDATA%/Filesmith/models`, checksum-verified.
- Migrate the Image Upscale model picker to these tiers; keep or retire the ncnn path per Spike A.
- Tests: registry, tiling math, EP fallback, arg/inference wiring via the harness.

### Phase 3 — Custom import + polish

- "Import model" (pre-converted `.onnx`): validate it's a loadable SR graph, add to the picker.
- UI polish: tier grouping in the model dropdown, per-model download state, GPU-requirement
  messaging for the Advanced tier.

## Open risks

- `onnxruntime-node` DirectML packaging on Windows-x64 (Spike A confirms).
- PiD on Blackwell (RTX 5090) needs a very recent torch+CUDA 12.8 build (Spike B confirms).
- PiD backbone VAE weights are large and may themselves be license-gated (flux). Record sizes.
- Big first-run downloads for PiD (torch ~2-3GB + weights) — must be clearly communicated + resumable.
