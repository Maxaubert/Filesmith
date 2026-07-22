"""Resident spandrel upscale sidecar for Filesmith (ComfyUI model import).

Loads ESRGAN-family upscale models (the ComfyUI `upscale_models/` family) with
spandrel — ComfyUI's own loader — and runs a tiled upscale. We load model FILES,
never run ComfyUI workflows.

Two modes:

  --probe : read newline-delimited model paths on stdin, print one JSON per line
            on stdout, CPU only (no GPU), used to classify a folder:
              {"path","ok":true,"arch":"<name>","scale":N}
              {"path","ok":false,"reason":"<why>"}

  default (resident): print {"ready":true} once torch is up, then read
            newline-JSON requests and reply one JSON per request:
              in  : {"id",N,"model_path","input","output","tile","overlap","scale_to"}
              prog: {"id":N,"progress":0.0..1.0}         (per tile, on stdout)
              out : {"id":N,"ok":true,"output","ms","size":[w,h]}
                    {"id":N,"ok":false,"error":"<why>"}
"""

import argparse
import json
import os
import sys
import time

# Persist compiled CUDA kernels across sessions (Blackwell JIT), like the PiD
# server. Must be set before torch is imported.
_CACHE = os.environ.get("FILESMITH_PID_CACHE") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".kernel-cache"
)
os.makedirs(_CACHE, exist_ok=True)
os.environ.setdefault("CUDA_CACHE_PATH", os.path.join(_CACHE, "cuda"))
os.environ.setdefault("TORCHINDUCTOR_CACHE_DIR", os.path.join(_CACHE, "inductor"))


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _load(path):
    # Imported lazily so --probe can report a clean error if spandrel is missing.
    from spandrel import ImageModelDescriptor, ModelLoader

    d = ModelLoader().load_from_file(path)
    if not isinstance(d, ImageModelDescriptor):
        raise ValueError("not an image super-resolution model")
    return d


def _arch_name(d) -> str:
    arch = getattr(d, "architecture", None)
    name = getattr(arch, "name", None) or getattr(arch, "id", None)
    return str(name) if name else type(d.model).__name__


def _utf8_stdin() -> None:
    # Paths may contain non-ASCII characters (non-English usernames); the pipe
    # decodes with the locale codepage by default, so force UTF-8 to match Node.
    try:
        sys.stdin.reconfigure(encoding="utf-8")
    except Exception:
        pass


def probe_mode() -> None:
    _utf8_stdin()
    # One process for the whole scan: read paths, emit one classification per line.
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            d = _load(path)
            print(
                json.dumps(
                    {"path": path, "ok": True, "arch": _arch_name(d), "scale": int(d.scale)}
                ),
                flush=True,
            )
        except Exception as e:  # noqa: BLE001 - report every failure to the caller
            print(
                json.dumps({"path": path, "ok": False, "reason": f"{type(e).__name__}: {e}"}),
                flush=True,
            )


def _to_tensor(img):
    import numpy as np
    import torch

    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(a).permute(2, 0, 1).unsqueeze(0)


def _to_image(t):
    import numpy as np
    from PIL import Image

    a = t.squeeze(0).clamp(0, 1).permute(1, 2, 0).cpu().float().numpy()
    return Image.fromarray((a * 255.0 + 0.5).astype(np.uint8), "RGB")


def _tiled_upscale(d, t, scale, tile, overlap, on_tile, pace_ms=0):
    import torch

    _, _, h, w = t.shape
    # Accumulate the full-size output on the CPU: the finished image can be huge
    # (a 4x of a large photo), and keeping it on the GPU would OOM regardless of
    # tile size — defeating the tile-halving backoff. Only one tile is on the GPU
    # at a time.
    out = torch.zeros((1, 3, h * scale, w * scale), dtype=torch.float32, device="cpu")
    weight = torch.zeros_like(out)
    step = max(1, tile - overlap)
    ys = list(range(0, h, step))
    xs = list(range(0, w, step))
    total = len(ys) * len(xs)
    done = 0
    for y in ys:
        for x in xs:
            y2 = min(y + tile, h)
            x2 = min(x + tile, w)
            piece = d(t[:, :, y:y2, x:x2]).float().cpu()
            out[:, :, y * scale : y2 * scale, x * scale : x2 * scale] += piece
            weight[:, :, y * scale : y2 * scale, x * scale : x2 * scale] += 1.0
            done += 1
            on_tile(done, total)
            # Background mode: pause between tiles so average GPU utilisation
            # stays low and the machine stays responsive for other work.
            if pace_ms:
                torch.cuda.synchronize()
                time.sleep(pace_ms / 1000.0)
    return out / weight.clamp(min=1.0)


def _upscale(cache, req):
    import torch
    from PIL import Image

    rid = req.get("id")
    model_path = req["model_path"]
    inp = req["input"]
    outp = req["output"]
    tile = int(req.get("tile", 512))
    overlap = int(req.get("overlap", 32))
    scale_to = int(req.get("scale_to", 0))  # desired final factor; 0 = native
    mem_fraction = float(req.get("mem_fraction", 0) or 0)  # 0/1 = uncapped
    pace_ms = int(req.get("pace_ms", 0) or 0)
    t0 = time.time()

    # Background mode caps how much VRAM this process may allocate, so other apps
    # (games, ComfyUI) keep their memory. Set per request; 1.0 lifts the cap.
    try:
        torch.cuda.set_per_process_memory_fraction(mem_fraction if 0 < mem_fraction < 1 else 1.0)
    except Exception:  # noqa: BLE001 - non-fatal; just skip the cap
        pass

    d = cache.get(model_path)
    if d is None:
        d = _load(model_path).to("cuda").eval()
        cache[model_path] = d
    native = int(d.scale)

    img = Image.open(inp)
    src = _to_tensor(img).to(dtype=torch.float32, device="cuda")

    def emit(done, total):
        print(json.dumps({"id": rid, "progress": done / max(1, total)}), flush=True)

    with torch.no_grad():
        cur_tile = tile
        while True:
            try:
                up = _tiled_upscale(d, src, native, cur_tile, overlap, emit, pace_ms)
                break
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                if cur_tile <= 128:
                    raise
                cur_tile = max(128, cur_tile // 2)
                log(f"[spandrel] OOM, retrying with tile={cur_tile}")

    result = _to_image(up)
    # If a different final factor was asked for than the model's native scale,
    # resample (Lanczos) from the native-upscaled result to the target size.
    if scale_to and scale_to != native:
        target = (img.width * scale_to, img.height * scale_to)
        result = result.resize(target, Image.LANCZOS)
    result.save(outp)
    return {"id": rid, "ok": True, "output": outp, "ms": int((time.time() - t0) * 1000), "size": [result.width, result.height]}


def serve() -> None:
    import torch

    torch.enable_grad(False)
    cache = {}
    log("[spandrel] ready")
    print(json.dumps({"ready": True}), flush=True)
    _utf8_stdin()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"ok": False, "error": "bad request json"}), flush=True)
            continue
        rid = req.get("id")
        try:
            print(json.dumps(_upscale(cache, req)), flush=True)
        except Exception as e:  # noqa: BLE001 - report any failure to the caller
            print(json.dumps({"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"}), flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    args, _ = ap.parse_known_args()
    if args.probe:
        probe_mode()
    else:
        serve()


if __name__ == "__main__":
    main()
