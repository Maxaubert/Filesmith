import { spawn, type ChildProcess } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { app } from 'electron'
import { findComfyLaunchPython, findComfyMainPy } from '../comfy/pythonEnv'
import { comfyModelsBases } from '../comfy/discover'

// A headless ComfyUI, driven over its HTTP API. We connect to an already-running
// instance when there is one, otherwise launch our own on a dedicated port using
// the user's ComfyUI Python. This is the "run generation through ComfyUI" path:
// ComfyUI owns all the model-loading/sampling complexity; we just POST a workflow.

const FS_PORT = 8199 // our dedicated headless port (8188 is ComfyUI's default)
let proc: ChildProcess | null = null
let ourUrl: string | null = null

/** The ComfyUI code root (dir with main.py) + its Python, derived from the
 * detected interpreter. Null if we can't locate a launchable ComfyUI. */
export function findComfyLaunch(): { python: string; cwd: string } | null {
  // Generation only needs a torch-capable ComfyUI, not the spandrel (upscale) env.
  const py = findComfyLaunchPython()
  if (!py) return null
  // Prefer a main.py near the interpreter (a portable/venv install keeps them
  // together), but fall back to any main.py we can find. ComfyUI Desktop puts
  // the venv and the source in completely different trees, so requiring them to
  // be adjacent made every Desktop install permanently unlaunchable.
  const near = [
    dirname(dirname(dirname(py))), // <root>/.venv/Scripts/python.exe -> <root>
    join(dirname(dirname(py)), 'ComfyUI'), // <portable>/python_embeded -> sibling ComfyUI
    dirname(dirname(py))
  ]
  for (const c of near) if (existsSync(join(c, 'main.py'))) return { python: py, cwd: c }
  const anywhere = findComfyMainPy()
  return anywhere ? { python: py, cwd: anywhere } : null
}

/**
 * Write an extra_model_paths.yaml pointing at every ComfyUI `models` dir we can
 * find, so a ComfyUI we launch sees the user's checkpoints/VAEs/etc. even when
 * they live in a different folder (e.g. a shared models dir) than the code root.
 * Returns the config path, or null if no model dirs were found.
 */
const MODEL_SUBS = ['checkpoints', 'vae', 'loras', 'diffusion_models', 'text_encoders', 'clip', 'unet', 'upscale_models']

function writeExtraModelPaths(): string | null {
  const dirs = new Set<string>()
  // Include a base if it holds ANY mapped model folder — not just checkpoints/
  // diffusion_models. Otherwise a base that only carries encoders or VAEs (a
  // shared-encoders drive) is dropped and a "runnable" model's CLIP/VAE becomes
  // invisible to the ComfyUI we launch.
  for (const base of comfyModelsBases())
    for (const cand of [base, join(base, 'models')])
      if (MODEL_SUBS.some((s) => existsSync(join(cand, s)))) dirs.add(resolve(cand))
  if (!dirs.size) return null
  const subs = MODEL_SUBS
  let yaml = ''
  let i = 0
  for (const d of dirs) {
    yaml += `filesmith_${i}:\n    base_path: ${d.replace(/\\/g, '/')}\n`
    for (const s of subs) yaml += `    ${s}: ${s}\n`
    i += 1
  }
  const file = join(app.getPath('userData'), 'comfy-extra-model-paths.yaml')
  writeFileSync(file, yaml)
  return file
}

async function alive(baseUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

/** Returns whether we could reach or launch a ComfyUI at all (for status/UI). */
export function comfyGenerationAvailable(): boolean {
  return findComfyLaunch() != null
}

/** A ready ComfyUI base URL — reuse a running one, else launch ours and wait. */
export async function ensureComfyServer(onStatus?: (s: string) => void): Promise<string> {
  for (const p of [8188, FS_PORT]) {
    const url = `http://127.0.0.1:${p}`
    if (await alive(url)) return url
  }
  const launch = findComfyLaunch()
  if (!launch)
    throw new Error('Could not find ComfyUI to run generation. Open ComfyUI once so Filesmith can find it.')

  if (!proc) {
    onStatus?.('Starting ComfyUI (first run of the session)…')
    const args = ['main.py', '--port', String(FS_PORT), '--listen', '127.0.0.1', '--disable-auto-launch']
    const extraPaths = writeExtraModelPaths()
    if (extraPaths) args.push('--extra-model-paths-config', extraPaths)
    proc = spawn(launch.python, args, {
      cwd: launch.cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1' }
    })
    proc.on('exit', () => {
      proc = null
      ourUrl = null
    })
  }
  ourUrl = `http://127.0.0.1:${FS_PORT}`
  const started = Date.now()
  while (Date.now() - started < 240_000) {
    if (await alive(ourUrl)) return ourUrl
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('ComfyUI did not become ready in time.')
}

/** Stop the ComfyUI instance WE launched (leave a user-run one alone). */
export function stopComfyServer(): void {
  if (proc) {
    proc.kill()
    proc = null
    ourUrl = null
  }
}

/** Interrupt the currently-running prompt (cancel). Best-effort. */
export async function interruptComfy(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(3000) })
  } catch {
    /* best effort */
  }
}

export interface ComfyImage {
  filename: string
  subfolder: string
  type: string
}

// Minimal shape of the global WebSocket, so we don't need the DOM lib in the
// main tsconfig. ComfyUI streams sampler progress over /ws.
type WSLike = {
  close(): void
  addEventListener(type: string, cb: (ev: { data?: unknown }) => void): void
}

/**
 * Subscribe to ComfyUI's live sampler progress for our client. Calls onProgress
 * with (prompt_id, value, max) as each prompt samples. Best-effort: if WebSocket
 * isn't available it's a no-op (generation still works, just without a bar).
 */
export function openProgressSocket(
  baseUrl: string,
  clientId: string,
  onProgress: (promptId: string, value: number, max: number) => void
): { close: () => void } {
  const WSctor = (globalThis as { WebSocket?: new (url: string) => WSLike }).WebSocket
  if (!WSctor) return { close: () => {} }
  const url = `${baseUrl.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`
  let ws: WSLike | null = null
  try {
    ws = new WSctor(url)
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return // ignore binary preview frames
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string
          data?: { prompt_id?: string; value?: number; max?: number }
        }
        if (msg.type === 'progress' && msg.data?.prompt_id)
          onProgress(String(msg.data.prompt_id), Number(msg.data.value) || 0, Number(msg.data.max) || 0)
      } catch {
        /* non-JSON */
      }
    })
    ws.addEventListener('error', () => {})
  } catch {
    ws = null
  }
  return {
    close: () => {
      try {
        ws?.close()
      } catch {
        /* */
      }
    }
  }
}

/** Queue an API-format workflow; returns its prompt id. */
export async function queuePrompt(
  baseUrl: string,
  workflow: Record<string, unknown>,
  clientId: string
): Promise<string> {
  const r = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`ComfyUI rejected the request (${r.status}): ${body.slice(0, 300)}`)
  }
  const j = (await r.json()) as { prompt_id?: string }
  if (!j.prompt_id) throw new Error('ComfyUI did not return a prompt id.')
  return j.prompt_id
}

/** Poll /history until the prompt produces output images (or errors/times out). */
export async function waitForImages(
  baseUrl: string,
  promptId: string,
  signal?: AbortSignal,
  hasStarted?: () => boolean
): Promise<ComfyImage[]> {
  const started = Date.now()
  const START_TIMEOUT = 150_000 // ~2.5 min to load + emit first sampler progress
  while (Date.now() - started < 900_000) {
    if (signal?.aborted) throw new Error('Generation cancelled')
    // A checkpoint that loads but never samples (e.g. a restoration model, not a
    // text-to-image one) would otherwise spin forever — fail it with a clear hint.
    if (hasStarted && !hasStarted() && Date.now() - started > START_TIMEOUT) {
      await interruptComfy(baseUrl)
      throw new Error(
        "This checkpoint didn't start generating — it may not be a text-to-image model. Try a different one, e.g. sd_xl_base_1.0."
      )
    }
    try {
      const r = await fetch(`${baseUrl}/history/${promptId}`, { signal: AbortSignal.timeout(5000) })
      if (r.ok) {
        const hist = (await r.json()) as Record<string, { status?: { status_str?: string }; outputs?: Record<string, { images?: ComfyImage[] }> }>
        const entry = hist[promptId]
        if (entry) {
          if (entry.status?.status_str === 'error')
            throw new Error('ComfyUI reported an error running the workflow.')
          const imgs: ComfyImage[] = []
          for (const node of Object.values(entry.outputs ?? {}))
            for (const img of node.images ?? []) if (img.type === 'output') imgs.push(img)
          if (imgs.length) return imgs
        }
      }
    } catch (e) {
      if (signal?.aborted) throw e
      // transient poll error — keep waiting
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Generation timed out.')
}

/** Fetch a produced image's bytes. */
export async function fetchImage(baseUrl: string, img: ComfyImage): Promise<Buffer> {
  const q = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder ?? '',
    type: img.type ?? 'output'
  })
  const r = await fetch(`${baseUrl}/view?${q.toString()}`)
  if (!r.ok) throw new Error(`Could not fetch the generated image (${r.status}).`)
  return Buffer.from(await r.arrayBuffer())
}

/** Checkpoints ComfyUI can see (for the model picker). */
export async function listCheckpoints(baseUrl: string): Promise<string[]> {
  try {
    const r = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`, {
      signal: AbortSignal.timeout(5000)
    })
    if (!r.ok) return []
    const j = (await r.json()) as Record<string, { input?: { required?: { ckpt_name?: unknown[][] } } }>
    const names = j.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]
    return Array.isArray(names) ? (names as string[]) : []
  } catch {
    return []
  }
}
