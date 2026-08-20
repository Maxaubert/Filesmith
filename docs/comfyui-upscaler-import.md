# ComfyUI Upscaler Import

## Goal

Let a user point Filesmith at their ComfyUI install and use the ESRGAN-family
image-upscale models they already have (4x-UltraSharp, Remacri, NMKD, AnimeSharp,
RealESRGAN variants, …) directly inside Filesmith — no ComfyUI running, no
workflow engine. Models are loaded with **spandrel** (the exact loader ComfyUI
uses) and run through our own tiled upscaler.

## Why this over bundling

- **Licensing**: most good community upscalers are non-commercial (CC-BY-NC-SA),
  so we can't ship them. Running the user's _own_ files is distribution-free.
- **VRAM**: tiled ESRGAN inference is bounded, so it avoids the large-output
  blow-ups the diffusion path (PiD) hits.
- **Coverage**: spandrel auto-detects architecture, so one code path handles the
  hundreds of community upscalers.

## Decisions (agreed)

1. **Import policy** — load anything spandrel accepts; badge known-good models
   **Verified**, the rest **Experimental**; diffusion/unloadable files are shown
   greyed as **Unsupported** with the reason.
2. **Placement** — imported models sit _alongside_ the existing options
   (Photo / Anime bundled Real-ESRGAN, PiD). Nothing is removed. PiD keeps its
   own diffusion path (and its pending input-resize fix).
3. **Storage** — **reference in place**: read models straight from the ComfyUI
   folder, nothing copied. Remember the folder; offer Rescan / Change folder.

## We load files, not workflows

We do **not** execute ComfyUI graphs. We read `models/upscale_models/*.pth`
(and `.safetensors`), load each with `spandrel.ModelLoader().load_from_file()`,
which returns a wrapped model plus its architecture and native scale, and run a
tiled forward pass ourselves.

## Architecture

### Engine — a spandrel sidecar (NVIDIA / torch)

- Reuses the existing PiD torch env (`<userData>/pid/repo/.venv`, torch 2.10
  cu128) with `spandrel` added — no second multi-GB install. If PiD isn't
  installed, the first ComfyUI import triggers the same env bootstrap (env only,
  no PiD weights).
- `resources/spandrel/spandrel_server.py`: a resident sidecar mirroring the PiD
  one (newline-JSON over stdin/stdout, id-framed, kept warm). Requests:
  `{"id","model_path","input","output","tile","scale_to"}`. Loads the model once
  per path (cache by path), tiles the input with overlap, upscales, stitches,
  optionally resamples to a target size, saves PNG, returns `{ok, output, ms}`.
- **Tiling**: default 512 px tiles, 32 px overlap; auto-halve tile size and retry
  on CUDA OOM so any image size succeeds within VRAM.
- **Alpha**: reuse the existing `restoreAlpha` step (ESRGAN models are RGB).
- Gated on an NVIDIA GPU, like PiD. Non-NVIDIA users keep bundled Real-ESRGAN.
  (Cross-GPU via ONNX/DirectML is a later, separate track — out of scope here.)

### Discovery — `src/main/comfy/discover.ts`

- User picks a folder: the ComfyUI root, a `models/` dir, or an
  `upscale_models/` dir — all accepted. We resolve `upscale_models/` under it,
  and also parse `extra_model_paths.yaml` at the root (if present) to pick up
  additional upscale-model paths (the shared-folder case).
- Scan for `*.pth` / `*.safetensors`. For each, a cheap **CPU** probe via
  spandrel identifies architecture + native scale WITHOUT running on GPU
  (`spandrel_server.py --probe <path>` → `{arch, scale, ok, reason}`).
- Classify:
  - **Verified** — filename stem (case-folded) or SHA-256 matches a bundled
    `verified-upscalers.json` allow-list (UltraSharp/UltraSharpV2, Remacri,
    Siax/NMKD, 4x-AnimeSharp, RealESRGAN x4plus/anime, LSDIR, …).
  - **Experimental** — spandrel loaded it (known arch) but it's not on the list.
  - **Unsupported** — spandrel can't load it (diffusion checkpoints, LoRAs, VAEs,
    unknown arch) → greyed with the reason.

### Persistence — `src/main/comfy/store.ts`

- `<userData>/comfy-upscalers.json`: remembered root folder + the last scan
  result (path, name, arch, scale, badge, hash). Referenced in place; a Rescan
  re-probes and drops models whose files disappeared.

### IPC / preload

- `comfy:pick-folder` (dialog), `comfy:scan` (returns the classified list),
  `comfy:status` (remembered folder + count). Streamed scan progress for the
  probe pass.

### UI

- **Upscale options** model row gains a divider and the imported models beneath
  Photo / Anime / PiD, each with its badge (✔ Verified / ⚠ Experimental) and
  native scale. An **“Import from ComfyUI…”** affordance opens the folder picker;
  if none imported yet, a compact call-to-action card (mirrors the PiD install
  card) explains the one-time folder select. Unsupported files are listed greyed
  under a “Not usable” disclosure so the user isn't confused about omissions.
- **Scale**: when an imported model is selected, the scale control shows the
  model's **native** scale (e.g. 4×). If the user still wants 2×/3×, we upscale
  at native then Lanczos-resample down (stated in the output preview). First-use
  Experimental models show a one-line “not vetted — may error” note.
- **Progress**: tiled upscaling reports a **measured** percentage
  (tiles done / total) — genuinely accurate, plus the estimate helper as a floor.

## Plan (phased, each independently testable)

1. **Spandrel in the env + probe** — add `spandrel` to the torch env bootstrap;
   `spandrel_server.py` with `--probe` (CPU arch/scale ID) and a resident
   upscale loop (tiling + OOM backoff). Unit-test the tiler math + protocol
   framing (no GPU).
2. **Discovery + classification** — `discover.ts` (folder resolve,
   `extra_model_paths.yaml` parse, scan), `verified-upscalers.json`, badge
   classifier. Unit-test path resolution + classification against fixtures.
3. **Store + IPC + preload** — persistence, `comfy:pick-folder/scan/status`,
   preload surface, typed results.
4. **Engine wiring** — `comfy/sidecar.ts` (spandrel sidecar client, id-framed,
   AbortSignal, warm), `upscaleWithComfy(file, modelPath, scaleTo, ctx)` in the
   tool registry; route `options.upscaleModel === 'comfy:<path>'` to it; alpha +
   measured tile progress.
5. **UI** — imported models in the picker with badges, folder-select / rescan,
   native-scale handling, Experimental note, Unsupported disclosure.
6. **Confirmation** — one GPU run on 4x-UltraSharpV2 (with permission), timed.

## Verification

- Non-GPU unit tests: tiler geometry, protocol framing, folder/`extra_model_paths`
  resolution, badge classification (fixtures for verified/experimental/unsupported).
- Typecheck / lint / build green each phase.
- Final: one permissioned GPU upscale through 4x-UltraSharpV2.

## Out of scope (v1)

- Running ComfyUI workflows / graphs.
- Diffusion upscalers other than PiD (SUPIR, SeedVR2) — each needs its own
  pipeline.
- Cross-GPU (AMD/Intel) execution of imported models (ONNX/DirectML) — later.
- Copying/managing models; face-restore or multi-pass chains.
