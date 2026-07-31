# Adding a model to Filesmith

Filesmith does not bake models in. What a model *is* — how to recognize it, what files it needs,
which ComfyUI graph runs it — is **data on disk**, so you can add a model family that did not exist
when your copy of Filesmith was built, without waiting for a release.

## Where the registry lives

Three layers, merged by `id`, later layers winning **field by field**:

| Layer | Path | Who writes it |
|---|---|---|
| 1. Built-in | `<install>/resources/registry/*.json` | ships in the installer, read-only |
| 2. Channel | `%APPDATA%/Filesmith/registry/channel/` | refreshed over the network (signed) |
| 3. **Yours** | `%APPDATA%/Filesmith/registry/user/` | you |

Two rules that will not change:

- **An app update replaces layer 1 only.** It never reads, writes or deletes layer 3. Your entries
  survive every update, forever.
- **Layer 1 ships in the installer**, so a completely offline install still has a full catalog.
  Offline is a first-class state, not a degraded one.

Filesmith creates the layer 2 and 3 folders on first launch, so they are already there.

## The 30-second case: a download URL went dead

Hugging Face repos get reorganized, and when one does, a `resolve/main` URL 404s and the model
becomes un-runnable. You do not need to redefine the model — override just that one field. Create
`%APPDATA%/Filesmith/registry/user/fix-flux2.json`:

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
                "urls": ["https://huggingface.co/<the-new-location>/qwen_3_4b.safetensors"]
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Everything else about `flux2` — its workflow graph, its sampler settings, its node requirements —
is inherited from the built-in entry. Restart Filesmith.

## The full case: a brand-new architecture

Copy `resources/registry/gen-archs.json` as a starting point. A generate entry has five parts:

### `detect` — how to recognize it FROM THE FILE

Never from the filename alone; a filename is something the user can change.

```json
"detect": {
  "tensorKeys": { "all": ["cap_embedder", "noise_refiner"], "none": ["double_blocks"] },
  "metaArch": ["z-image", "zimage"],
  "sizeBytesRange": [4000000000, 14000000000],
  "nameHint": "z.?image"
}
```

Tensor keys are matched as substrings against the safetensors header (which Filesmith reads without
touching the multi-GB weights). `all` must all be present, `any` needs at least one, `none` rejects.
`nameHint` is advisory and scores far below content evidence — it can never outvote the tensors.

`detect` is only consulted for files Filesmith's built-in classifier could not place, so adding one
cannot disturb a family that already works.

### `capabilities` — what it can do

```json
"capabilities": { "task": "text-to-image", "minDim": 256, "maxDim": 2048, "dimStep": 8 }
```

### `sampler` — the defaults the UI fills in

`cfg` is not cosmetic: a distilled/turbo model needs `cfg: 1`, and running it at 7 produces garbage.

```json
"sampler": {
  "name": "res_multistep", "scheduler": "simple",
  "steps": 8, "cfg": 1, "guidance": 0, "hasGuidance": false
}
```

### `requires` — what this ComfyUI must have

Checked against the live server's `/object_info` before anything is queued, so a missing node
produces a clear message instead of an HTTP 400.

```json
"requires": {
  "nodes": ["CLIPTextEncode", "KSampler", "VAEDecode", "SaveImage"],
  "clipLoader": { "node": "CLIPLoader", "type": "lumina2" },
  "minComfyNote": "This needs ComfyUI v0.6.0 or newer."
}
```

### `workflow` — the graph

A ComfyUI **API-format** graph. The easiest way to get one: build the model in ComfyUI itself, then
use its own **Save (API format)** export and replace the values you want Filesmith to fill in with
placeholders.

Available placeholders:

`${unet}` `${clip}` `${clip2}` `${vae}` `${model}` · `${prompt}` `${negative}` `${seed}` `${steps}`
`${cfg}` `${guidance}` `${sampler}` `${scheduler}` `${width}` `${height}` `${batch}` `${prefix}`

A value that is *exactly* one placeholder is replaced with the raw value, so `"seed": "${seed}"`
yields a number, not a string. Use `workflow` for a bare diffusion model (UNETLoader + separate
encoders) and `checkpointWorkflow` for an all-in-one single-file checkpoint. An entry can have both.

## What Filesmith will refuse, and why

Your entry is validated at load. If it fails, that entry is skipped with a warning and the rest of
the registry keeps working — a bad file can never brick the app.

- `subdir` must be one of `text_encoders`, `clip`, `vae`, `checkpoints`, `diffusion_models`, `unet`,
  `upscale_models`. Anything else is rejected: `subdir` and `filename` are joined onto your ComfyUI
  models root, so an unconstrained value would be a path-traversal sink.
- `filename` must be a plain name — no `/`, no `\`, no `..`.
- Download URLs must be `https:`.
- A workflow template must be an object of `{class_type, inputs}` nodes, and may only use the
  placeholders listed above.
- Workflow templates are **data**. They are parsed as JSON, never evaluated, and the result is only
  ever POSTed to a loopback ComfyUI. No entry can cause code to run.
- An entry whose `schemaVersion` is newer than your Filesmith is skipped with a note telling you to
  update, rather than crashing the load.

## Checking your work

Launch Filesmith and open the Generate panel. Problems with any registry file are reported there.
Your models appear alongside the built-in families; unrecognized files are listed too, so you can
always tell whether Filesmith saw the file at all.

---

# For the maintainer

## Keeping the shipped hashes current

Every download in `resources/registry/gen-archs.json` carries a real `sha256` and a URL pinned to
an immutable commit revision, with the `resolve/main` branch URL kept after it as a fallback mirror.

The hashes are not invented: Hugging Face stores large files in git-LFS, and an LFS object id *is*
the sha256 of the content, exposed per file by the repo tree API.

```
node scripts/registry-hashes.mjs           # refresh hashes + pins from upstream
node scripts/registry-hashes.mjs --check   # CI-friendly: fails if the pack is stale
```

A pinned URL and its hash agree forever, so verification can be strict. The declared hash is
deliberately **not** enforced against the fallback mirror — the branch copy may legitimately hold
different bytes, and rejecting it would defeat the rescue the mirror exists for. A fallback falls
back to trust-on-first-use.

If a repo is gated or renamed, that one entry is left untouched and reported; it simply keeps
trust-on-first-use, which is where everything was before.

## Publishing a channel update

Every companion URL points into someone else's repo. When one is reorganized, every *installed*
copy of Filesmith gets a 404 and stays broken until a new release ships. The channel fixes that
without a release: publish a signed pack, and every install picks it up within a day.

It is **off** until a signing key exists, which is the safe default — an unsigned channel would mean
trusting whatever the network returns, and a registry entry can name files to download.

To turn it on, once:

```
node scripts/registry-channel.mjs keygen
```

That writes `channel-private.pem` (gitignored — back it up; losing it means no existing install will
ever accept another update) and prints the public key to paste into `CHANNEL_PUBLIC_KEY_B64` in
`src/main/registry/channel.ts`. Then, whenever something upstream moves:

```
node scripts/registry-hashes.mjs                                   # pick up the new location
node scripts/registry-channel.mjs sign resources/registry/gen-archs.json
node scripts/registry-channel.mjs verify channel.json <publicKeyB64>
```

Publish the resulting `channel.json` at the URL the app checks (`FILESMITH_CHANNEL_URL`; a GitHub
Pages file is enough). Installs check at most once a day, in the background. A bad signature, a
malformed pack or no network all leave the previous cache in place — offline is a first-class state,
never an error.
