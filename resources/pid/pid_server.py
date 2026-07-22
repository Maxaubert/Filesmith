"""Resident PiD upscale sidecar for Filesmith.

PiD's own `from_clean.py` is a one-shot CLI: it reloads the 2.6GB model and pays
Blackwell's kernel-compile cost on every invocation, which is minutes. This
server pays that once, keeps the model resident, and then serves upscale
requests over stdin/stdout so subsequent images are warm.

Protocol (one JSON object per line):
  in  : {"id": 1, "input": "<path>", "output": "<path>", "scale": 4, "prompt": "a photo"}
  out : {"id": 1, "ok": true, "output": "<path>", "ms": 1234}   on success
        {"id": 1, "ok": false, "error": "<message>"}            on failure
  The request "id" is echoed back so the caller can match a reply to its request
  by id rather than by stdout order. A single {"ready": true} line is printed once
  the model is loaded.

Run:  python pid_server.py --backbone flux --output_dir <dir>
The repo is launched on PYTHONPATH by the Filesmith resolver, with CWD set to the
repo so PiD finds its config and ./checkpoints weights.
"""

import argparse
import json
import os
import sys
import time

# Persist compiled kernels ACROSS sessions. torch 2.10 on a brand-new GPU arch
# (Blackwell / sm_120) JIT-compiles CUDA kernels from PTX on first use, which is
# the multi-minute cost; pointing the CUDA + inductor caches at a stable dir
# means that compile happens once (at install / first run) and every later
# session is warm. Must be set BEFORE torch is imported. The launcher passes
# FILESMITH_PID_CACHE; fall back to a dir beside this file.
_CACHE = os.environ.get("FILESMITH_PID_CACHE") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".kernel-cache"
)
os.makedirs(_CACHE, exist_ok=True)
os.environ.setdefault("CUDA_CACHE_PATH", os.path.join(_CACHE, "cuda"))
os.environ.setdefault("TORCHINDUCTOR_CACHE_DIR", os.path.join(_CACHE, "inductor"))

import torch

from pid._src.inference.cli_utils import parse_clean_args
from pid._src.inference.decoder import add_noise, load_our_decoder
from pid._src.inference.inference_utils import load_input_image, save_image

torch.enable_grad(False)


def log(msg: str) -> None:
    # Diagnostics go to stderr so stdout stays a clean JSON protocol stream.
    print(msg, file=sys.stderr, flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backbone", default="flux")
    ap.add_argument("--output_dir", default="./_pid_tmp")
    # torch.compile the decoder. OFF by default: it needs Triton, which has no
    # working Windows build (TritonMissing at generate time otherwise). The
    # resident server already gives the big win (load once, stay warm), and
    # Blackwell's CUDA kernel JIT is cached via CUDA_CACHE_PATH regardless of
    # compile. --compile stays available for platforms that do have Triton.
    ap.add_argument("--compile", dest="compile", action="store_true")
    ap.set_defaults(compile=False)
    args_ns, _ = ap.parse_known_args()

    # Reuse PiD's own parser so backbone -> experiment/checkpoint/config resolution
    # (and every default the loader reads) matches the official CLI exactly.
    sys.argv = [
        "pid_server",
        "--backbone", args_ns.backbone,
        "--input_path", "unused",
        "--prompt", "a photo",
        "--degrade_sigmas", "0.0",
        "--cfg_scale", "1",
        "--pid_inference_steps", "4",
        "--scale", "4",
        "--output_dir", args_ns.output_dir,
    ]
    if args_ns.compile:
        sys.argv.append("--compile")
    args = parse_clean_args()

    t0 = time.time()
    log(f"[pid] loading model (backbone={args.backbone}) ...")
    model = load_our_decoder(args, [], True)
    caption_key = model.config.input_caption_key
    vae_compression = int(model.vae_encoder.spatial_compression_factor)
    log(f"[pid] model ready in {time.time() - t0:.1f}s")
    print(json.dumps({"ready": True}), flush=True)

    # Requests carry filesystem paths that may contain non-ASCII characters (e.g.
    # a non-English Windows username). The pipe decodes with the locale codepage
    # by default, which mojibakes or crashes; force UTF-8 to match Node's writer.
    try:
        sys.stdin.reconfigure(encoding="utf-8")
    except Exception:
        pass

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"ok": False, "error": "bad request json"}), flush=True)
            continue
        req_id = req.get("id")
        try:
            out = _upscale(model, caption_key, vae_compression, args, req)
            out["id"] = req_id
            print(json.dumps(out), flush=True)
        except Exception as e:  # noqa: BLE001 - report any failure to the caller
            print(json.dumps({"id": req_id, "ok": False, "error": f"{type(e).__name__}: {e}"}), flush=True)


def _resize_to_max(t, max_side):
    """Downscale a 1CHW tensor so its longer edge is <= max_side, keeping both
    dimensions a multiple of 16 (PiD's latent grid). No-op if already small."""
    import torch.nn.functional as F

    _, _, h, w = t.shape
    if max(h, w) <= max_side:
        return t
    sc = max_side / max(h, w)
    nh = max(16, (int(h * sc) // 16) * 16)
    nw = max(16, (int(w * sc) // 16) * 16)
    return F.interpolate(t.float(), size=(nh, nw), mode="area").to(dtype=t.dtype)


def _generate(model, caption_key, vae_compression, args, input_tensor, scale, prompt):
    clean_latent = model.encode_lq_latent(input_tensor)
    vae_h = int(clean_latent.shape[-2]) * vae_compression
    vae_w = int(clean_latent.shape[-1]) * vae_compression
    target_hw = (vae_h * scale, vae_w * scale)
    # sigma=0: no degradation, straight upscale. add_noise with 0 returns the clean
    # latent, but we route through it so behaviour matches the reference exactly.
    gen = torch.Generator(device="cuda").manual_seed(0)
    latent = add_noise(clean_latent.float(), 0.0, gen, args.backbone).to(dtype=torch.bfloat16)
    data_batch = {
        caption_key: [prompt],
        "LQ_latent": latent.to(dtype=torch.bfloat16, device="cuda"),
        "degrade_sigma": torch.tensor([0.0], device="cuda", dtype=torch.float32),
    }
    samples_out = model.generate_samples_from_batch(
        data_batch,
        cfg_scale=args.cfg_scale,
        num_steps=args.pid_inference_steps,
        seed=0,
        shift=args.shift,
        image_size=target_hw,
    )
    return samples_out[0].float().cpu().clamp(-1, 1)


def _upscale(model, caption_key, vae_compression, args, req) -> dict:
    inp = req["input"]
    outp = req["output"]
    scale = int(req.get("scale", 4))
    prompt = req.get("prompt") or "a photo"
    t = time.time()

    base = load_input_image(inp).to(dtype=torch.bfloat16, device="cuda")
    # PiD runs the whole frame at once (no tiling), so VRAM scales with the image.
    # On a lower-VRAM card a big frame OOMs; progressively cap the working
    # resolution and retry so we still produce a (slightly smaller) result rather
    # than failing outright. None = native resolution first.
    last_err = None
    for cap in (None, 1536, 1024, 768, 512):
        try:
            src = base if cap is None else _resize_to_max(base, cap)
            img = _generate(model, caption_key, vae_compression, args, src, scale, prompt)
            save_image(img, outp)
            return {
                "ok": True,
                "output": outp,
                "ms": int((time.time() - t) * 1000),
                "size": [int(img.shape[-1]), int(img.shape[-2])],
            }
        except torch.cuda.OutOfMemoryError as e:  # retry at a smaller resolution
            last_err = e
            torch.cuda.empty_cache()
            log(f"[pid] OOM at cap={cap}; retrying smaller")
    raise RuntimeError(
        "Not enough GPU memory for PiD, even at reduced resolution. "
        "Try a smaller image, or use a Photo/Anime/ComfyUI model."
    ) from last_err


if __name__ == "__main__":
    main()
