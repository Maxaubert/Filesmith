# Models

Filesmith uses three kinds of AI model. None of them is baked into the app, so you can add your own.

| Kind                    | Used by          | Where the files live                                          |
| ----------------------- | ---------------- | ------------------------------------------------------------- |
| Real-ESRGAN (ncnn)      | Upscale          | Bundled, plus `%APPDATA%\Filesmith\models\realesrgan`         |
| ComfyUI upscale models  | Upscale (NVIDIA) | Your ComfyUI `models\upscale_models`, read in place           |
| Image generation models | Generate         | Your ComfyUI `models\checkpoints`, `diffusion_models`, `unet` |

All of Filesmith's own data lives in `%APPDATA%\Filesmith`. Your ComfyUI folder is only read, except
for one case: **Download required files** on Generate writes text encoders and VAEs into it.

## Point Filesmith at ComfyUI

Generate and the Upscale AI models both read one remembered ComfyUI folder. Filesmith guesses common
locations (your profile, Documents, OneDrive, drive roots, names like `ComfyUI`,
`ComfyUI_windows_portable`, `StabilityMatrix`, plus ComfyUI Desktop's settings in
`%APPDATA%\ComfyUI`). If the guess misses, set it yourself. Any of these works:

- **Settings > Tools > ComfyUI folder > Choose folder** (or **Change folder**).
- **Generate**, with no model found: **Choose ComfyUI folder**.
- **Generate > Your models > Change ComfyUI folder**.
- **Generate**, when ComfyUI was not found: **Locate my ComfyUI folder**.
- **Upscale > AI models > ComfyUI models**: **Locate my ComfyUI folder** or **Browse to ComfyUI folder**
  (**Change ComfyUI folder** or **Change folder** once one is set).
- CLI: `filesmith setup comfy --folder "D:\ComfyUI"`.

You can pick the ComfyUI root, its `models` folder or its `upscale_models` folder. The choice is stored
in `%APPDATA%\Filesmith\comfy-upscalers.json`. One pick fixes Generate, Upscale and the companion
downloads at once.

## Upscale

The **Model** picker on Upscale lists the Real-ESRGAN models on disk, then **AI models** when an NVIDIA
GPU that can run CUDA is present. If a GPU is too old for it, the picker says why.

### Add a Real-ESRGAN model

1. Upscale > **Add your own model**, or **Settings > Tools > Upscale models > Open folder**. Both open
   `%APPDATA%\Filesmith\models\realesrgan`.
2. Drop in an ncnn model pair: `name.param` and `name.bin`. A `.param` without its `.bin` is ignored.
3. Reopen the Upscale picker. Your model shows as `Name, added by you`. A bundled model with the same
   name wins.

### Use your ComfyUI upscale models

Filesmith loads the ESRGAN-family files in ComfyUI's `upscale_models` (4x-UltraSharp, Remacri, NMKD,
AnimeSharp, RealESRGAN and similar) with spandrel, the loader ComfyUI itself uses. ComfyUI does not
need to be running and no workflow is involved. Files are referenced in place, never copied.

1. Upscale > Model > **AI models**. The **ComfyUI models** card appears below.
2. If the card says **Set up upscale engine**, the engine needs Python with torch and spandrel:
   - If your ComfyUI's own Python already has both, nothing is downloaded. Use **Locate my ComfyUI
     folder** so Filesmith can find it.
   - Otherwise **Set up upscale engine** builds a shared env in `%APPDATA%\Filesmith\pid`, about 3 GB.
     PiD uses the same env, so if PiD is installed setup is quick.
3. Choose **Browse to ComfyUI folder** (or **Change folder**). Filesmith scans:
   - `upscale_models` under the folder you picked, at the usual nesting depths,
   - extra `upscale_models` paths from `extra_model_paths.yaml`, if present.
4. Pick a model in the second **AI model** list. Each shows its native scale, for example
   `4x-UltraSharp, 4×`. Use **Rescan** after adding or removing files.

The scan opens `.pth`, `.safetensors` and `.ckpt`. It skips `.pt`, because spandrel loads `.pt` without
the restricted unpickler, and a scan touches every file in the folder.

Each file gets a badge:

- **Verified**: spandrel read a known architecture (ESRGAN, RealESRGAN, SPAN, DAT, HAT, SwinIR, Compact,
  PLKSR and others), or the name matches a well-known model.
- **Experimental**: spandrel loaded it but the architecture is not on the list. Still fully usable; the
  picker adds `, experimental` to the label.
- **Unsupported**: spandrel could not load it (diffusion checkpoints, LoRAs, VAEs, unknown formats).
  These are listed under "N files not usable" with the reason.

Upscaling is tiled, so any image size fits in VRAM. Alpha is restored after the RGB pass. A model you
remove from disk drops out of the picker on the next check.

PiD (a separate diffusion upscaler) also sits under AI models. It is offered once installed, or when
its weights are found in your ComfyUI and can be reused.

## Generate

Generate runs text-to-image through ComfyUI over its HTTP API. Filesmith connects to a running ComfyUI
(`FILESMITH_COMFY_URL`, a stored server URL, then `http://127.0.0.1:8188`), or launches your ComfyUI
headless on a free port with its own Python. Filesmith never installs ComfyUI.

### Which models show up

Filesmith scans every ComfyUI models folder it knows:

- `checkpoints`: single-file checkpoints (`.safetensors`, `.ckpt`, `.sft`).
- `diffusion_models` and `unet`: bare diffusion models (`.safetensors`, `.sft`, `.gguf`).

Each file's header is read (not the weights) to find its family. Built-in families: SDXL and
single-file checkpoints, Flux 1, Flux 2 [klein], Z-Image Turbo and Krea 2. Video, 3D and audio models
are dropped. An unrecognized image model is shown with a reason and a **Try anyway** button, which runs
it through a generic graph.

### When there is no model

If the scan finds nothing, the Model section shows **No image model yet** with two buttons:

- **Choose ComfyUI folder**: point Filesmith at a ComfyUI that has models.
- **Add a model**: import a registry entry or a ComfyUI workflow (see below).

### Missing text encoders or VAE

A model that needs files you do not have shows **Required files**, with each file and its size.
**Download required files** fetches them into the same ComfyUI models tree the model lives in
(`text_encoders`, `vae` and so on). Disk space is checked first. Downloads are sha256-checked when the
registry has a hash. The CLI equivalent is `filesmith setup generate --model <name>`.

## Add a generation model (the model registry)

What a model family is (how to recognize it, which files it needs, which ComfyUI graph runs it) is
data in JSON files, so a new family needs no app release.

### Where the registry lives

Three layers, merged by `id`. Later layers win field by field.

| Layer       | Path                                   | Written by                         |
| ----------- | -------------------------------------- | ---------------------------------- |
| 1. Built-in | `<install>\resources\registry\*.json`  | the installer, read-only           |
| 2. Channel  | `%APPDATA%\Filesmith\registry\channel` | signed network updates (off today) |
| 3. Yours    | `%APPDATA%\Filesmith\registry\user`    | you                                |

- An app update replaces layer 1 only. Your layer 3 files survive every update.
- Layer 1 ships in the installer, so an offline install has the full catalog.
- Open your folder from **Settings > Tools > Model registry > Open folder**, or **Generate > Your
  models > Open folder**. Edits are picked up the next time Generate checks, no restart needed.

### Easiest: import a ComfyUI workflow

If a model already works in ComfyUI:

1. In ComfyUI, export the workflow in API format (**Workflow > Export (API)**).
2. In Filesmith, **Generate > Add a model** and pick that `.json`.

Filesmith turns it into a registry entry named after the file. It wires these inputs to placeholders:
the model loader (`UNETLoader`, `UnetLoaderGGUF` or `CheckpointLoaderSimple`), `VAELoader`,
`CLIPLoader`/`DualCLIPLoader`, the first `CLIPTextEncode` (prompt) and the second (negative),
`EmptyLatentImage`/`EmptySD3LatentImage` (size, batch), `KSampler` seed and steps, and `SaveImage`.
Sampler defaults are copied from the exported `KSampler`. A note tells you what it could not wire.
The file is saved in your user layer under a new name; an existing file is never replaced.

**Add a model** also accepts a registry entry or a pack (`{ "schemaVersion": 1, "entries": [...] }`).

### Quick fix: a download URL went dead

When a Hugging Face repo moves, override just that field. Save this as
`%APPDATA%\Filesmith\registry\user\fix-flux2.json`:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "id": "flux2",
      "kind": "generate",
      "label": "Flux 2 [klein]",
      "provenance": { "source": "user" },
      "companionSets": [
        {
          "id": "4b",
          "companions": [
            {
              "role": "clip",
              "label": "Qwen3-4B text encoder",
              "subdir": "text_encoders",
              "identify": { "nameHint": "qwen_3_4b" },
              "download": {
                "filename": "qwen_3_4b.safetensors",
                "approxSize": "8 GB",
                "urls": ["https://huggingface.co/<new-location>/qwen_3_4b.safetensors"]
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Everything else about `flux2` (graph, sampler, required nodes) comes from the built-in entry.

### Full entry: a new architecture

Start from a copy of an entry in `resources\registry\gen-archs.json`. A generate entry has:

- **`detect`**: how to recognize the file from its contents, used only for files the built-in
  classifier could not place.

  ```json
  "detect": {
    "tensorKeys": { "all": ["cap_embedder", "noise_refiner"], "none": ["double_blocks"] },
    "metaArch": ["z-image", "zimage"],
    "sizeBytesRange": [4000000000, 14000000000],
    "nameHint": "z.?image"
  }
  ```

  Tensor keys match as substrings in the safetensors header. `all` must all be present, `any` needs
  one, `none` rejects. `nameHint` scores far below content and never outvotes it.

- **`capabilities`**: `{ "task": "text-to-image", "minDim": 256, "maxDim": 2048, "dimStep": 8 }`.
- **`sampler`**: the defaults the UI fills in. A distilled or turbo model needs `"cfg": 1`.

  ```json
  "sampler": { "name": "res_multistep", "scheduler": "simple", "steps": 8, "cfg": 1, "guidance": 0, "hasGuidance": false }
  ```

- **`requires`**: ComfyUI nodes, checked against the live server before anything is queued, so a
  missing node gives a clear message.

  ```json
  "requires": {
    "nodes": ["CLIPTextEncode", "KSampler", "VAEDecode", "SaveImage"],
    "clipLoader": { "node": "CLIPLoader", "type": "lumina2" },
    "minComfyNote": "This needs ComfyUI v0.6.0 or newer."
  }
  ```

- **`companions`** or **`companionSets`**: the encoder and VAE files, with download URLs.
- **`workflow`**: a ComfyUI API-format graph, `{ "format": "comfy-api-v1", "template": { ... } }`. Use
  `workflow` for a bare diffusion model, `checkpointWorkflow` for a single-file checkpoint and
  `ggufWorkflow` for a GGUF. An entry can have several.

Placeholders:

`${unet}` `${clip}` `${clip2}` `${vae}` `${model}` `${prompt}` `${negative}` `${seed}` `${steps}`
`${cfg}` `${guidance}` `${sampler}` `${scheduler}` `${width}` `${height}` `${batch}` `${prefix}`

A value that is exactly one placeholder gets the raw value, so `"seed": "${seed}"` becomes a number.

### What gets rejected

Entries are validated at load. A bad entry is skipped with a warning and the rest keeps working.

- `subdir` must be one of `text_encoders`, `clip`, `vae`, `checkpoints`, `diffusion_models`, `unet`,
  `upscale_models`. It is joined onto your ComfyUI models folder, so anything else is a path risk.
- `filename` may only use letters, digits, `.`, `_` and `-`.
- Download URLs must be `https:`.
- A workflow must be `{class_type, inputs}` nodes and use only the placeholders above.
- Workflows are data: parsed as JSON, never run as code, and only sent to a local ComfyUI.
- An entry with a newer `schemaVersion` than your Filesmith is skipped with a note to update.

To see registry warnings, run `filesmith doctor`.

## For the maintainer

### Keeping shipped hashes current

Every download in `resources\registry\gen-archs.json` has a `sha256` and a URL pinned to a commit, with
the `resolve/main` URL after it as a fallback. Hugging Face LFS object ids are the sha256 of the file.

```
node scripts/registry-hashes.mjs           # refresh hashes and pins from upstream
node scripts/registry-hashes.mjs --check   # fails if the pack is stale (for CI)
```

The hash is not enforced against the fallback URL, because the branch copy may legitimately differ.
A fallback uses trust-on-first-use. A gated or renamed repo is left as is and reported.

### Publishing a channel update

The channel lets a signed pack fix dead URLs on every install without a release. It is off until a
signing key exists: `CHANNEL_PUBLIC_KEY_B64` in `src\main\registry\channel.ts` is empty.

To turn it on, once:

```
node scripts/registry-channel.mjs keygen
```

This writes `channel-private.pem` (gitignored; back it up, losing it means no install accepts another
update) and prints the public key for `CHANNEL_PUBLIC_KEY_B64`. Then, whenever something moves:

```
node scripts/registry-hashes.mjs
node scripts/registry-channel.mjs sign resources/registry/gen-archs.json
node scripts/registry-channel.mjs verify channel.json <publicKeyB64>
```

Publish `channel.json` at the URL in `FILESMITH_CHANNEL_URL` (a GitHub Pages file is enough). Installs
check at most once a day in the background. A bad signature, a malformed pack or no network keeps the
previous cache.
