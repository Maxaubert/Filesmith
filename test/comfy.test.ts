import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { classifyModel, normalizeModelName } from '../src/shared/comfy'
import { classifySpandrelLine } from '../src/main/comfy/sidecar'
import { resolveUpscaleDirs, scanModelFiles } from '../src/main/comfy/discover'
import { candidateComfyUrls } from '../src/main/generate/comfy'
import {
  COMFY_DIR_NAMES,
  comfyCandidateDirs,
  comfyNestedDirs,
  comfySearchRoots
} from '../src/main/comfy/roots'

describe('ComfyUI search roots (one list, used everywhere)', () => {
  it('probes real drive letters instead of a hardcoded C:/D:/E:', () => {
    const roots = comfySearchRoots()
    // Every drive root returned must actually exist — the point of enumerating.
    const drives = roots.filter((r) => /^[A-Z]:\\$/.test(r))
    expect(drives.length).toBeGreaterThan(0)
    for (const d of drives) expect(existsSync(d)).toBe(true)
  })

  it('includes the OneDrive-redirected Documents/Desktop when set', () => {
    const prev = process.env.OneDrive
    process.env.OneDrive = 'C:\\Users\\x\\OneDrive - Contoso'
    try {
      const roots = comfySearchRoots()
      expect(roots).toContain('C:\\Users\\x\\OneDrive - Contoso')
      expect(roots).toContain(join('C:\\Users\\x\\OneDrive - Contoso', 'Documents'))
    } finally {
      if (prev === undefined) delete process.env.OneDrive
      else process.env.OneDrive = prev
    }
  })

  it('yields deduplicated candidates covering every known folder name', () => {
    const dirs = comfyCandidateDirs()
    expect(new Set(dirs).size).toBe(dirs.length)
    for (const n of COMFY_DIR_NAMES) expect(dirs.some((d) => d.endsWith(n))).toBe(true)
  })

  it('nests into the ComfyUI Desktop layouts, not just <root>/ComfyUI', () => {
    // Desktop keeps its venv in the user's base dir and the source under the
    // Electron app's resources/, so these depths are what make it findable.
    const nested = comfyNestedDirs('D:\\AI')
    expect(nested).toContain('D:\\AI')
    expect(nested).toContain(join('D:\\AI', 'ComfyUI'))
    expect(nested).toContain(join('D:\\AI', 'resources', 'ComfyUI'))
    expect(nested).toContain(join('D:\\AI', 'resources', 'app', 'ComfyUI'))
  })
})

describe('ComfyUI server URLs', () => {
  it('tries an explicit override before the default port', () => {
    const prev = process.env.FILESMITH_COMFY_URL
    process.env.FILESMITH_COMFY_URL = 'http://10.0.0.4:8188/'
    try {
      const urls = candidateComfyUrls()
      expect(urls[0]).toBe('http://10.0.0.4:8188') // trailing slash trimmed
      expect(urls).toContain('http://127.0.0.1:8188')
    } finally {
      if (prev === undefined) delete process.env.FILESMITH_COMFY_URL
      else process.env.FILESMITH_COMFY_URL = prev
    }
  })

  it('always includes ComfyUI’s default, with no duplicates', () => {
    const urls = candidateComfyUrls()
    expect(urls).toContain('http://127.0.0.1:8188')
    expect(new Set(urls).size).toBe(urls.length)
  })
})

describe('normalizeModelName', () => {
  it('lowercases, drops the extension, and strips non-alphanumerics', () => {
    expect(normalizeModelName('4x-UltraSharpV2.safetensors')).toBe('4xultrasharpv2')
    expect(normalizeModelName('4x_NMKD-Siax_200k.pth')).toBe('4xnmkdsiax200k')
  })
})

describe('classifyModel', () => {
  it('marks a known token as verified with its arch and scale', () => {
    const m = classifyModel({ path: 'C:/m/4x-UltraSharpV2.safetensors', ok: true, arch: 'ESRGAN', scale: 4 })
    expect(m).toMatchObject({ name: '4x-UltraSharpV2', badge: 'verified', arch: 'ESRGAN', scale: 4 })
  })

  it('marks a model experimental only when BOTH its name and its arch are unknown', () => {
    // A recognized architecture now verifies on its own — spandrel read it out
    // of the file, which is stronger evidence than any filename. `DAT` used to
    // land here purely because nobody had listed that name.
    expect(
      classifyModel({ path: '/m/SomeRandomUpscaler.pth', ok: true, arch: 'DAT', scale: 2 }).badge
    ).toBe('verified')
    const m = classifyModel({ path: '/m/SomeRandomUpscaler.pth', ok: true, arch: 'BrandNew', scale: 2 })
    expect(m.badge).toBe('experimental')
    expect(m.scale).toBe(2) // and it stays fully usable either way
  })

  it('marks an unloadable file unsupported with the reason', () => {
    const m = classifyModel({ path: '/m/supir_v0.safetensors', ok: false, reason: 'not an image upscaler' })
    expect(m).toMatchObject({ badge: 'unsupported', reason: 'not an image upscaler', scale: 0 })
  })
})

describe('classifySpandrelLine', () => {
  it('detects ready', () => {
    expect(classifySpandrelLine('{"ready": true}')).toEqual({ kind: 'ready' })
  })
  it('parses a progress line into a 0-99 percent', () => {
    expect(classifySpandrelLine('{"id": 2, "progress": 0.5}')).toEqual({ kind: 'progress', id: 2, pct: 50 })
  })
  it('parses a success reply', () => {
    expect(classifySpandrelLine('{"id": 1, "ok": true, "output": "o.png", "ms": 42}')).toEqual({
      kind: 'ok',
      id: 1,
      output: 'o.png',
      ms: 42
    })
  })
  it('treats an ok reply with no output as an error', () => {
    expect(classifySpandrelLine('{"id": 1, "ok": true}')).toEqual({
      kind: 'error',
      id: 1,
      error: 'upscaler returned no output path'
    })
  })
  it('parses a failure reply', () => {
    expect(classifySpandrelLine('{"id": 3, "ok": false, "error": "boom"}')).toEqual({
      kind: 'error',
      id: 3,
      error: 'boom'
    })
  })
  it('ignores diagnostics and malformed json', () => {
    expect(classifySpandrelLine('Loading spandrel…')).toEqual({ kind: 'ignore' })
    expect(classifySpandrelLine('{ not json')).toEqual({ kind: 'ignore' })
  })
})

describe('discovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'filesmith-comfy-test-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('resolves upscale_models under a ComfyUI-style root and scans model files', () => {
    const up = join(root, 'models', 'upscale_models')
    mkdirSync(up, { recursive: true })
    writeFileSync(join(up, '4x-UltraSharp.pth'), 'x')
    writeFileSync(join(up, 'note.txt'), 'x') // ignored (not a model ext)
    mkdirSync(join(up, 'sub'))
    writeFileSync(join(up, 'sub', 'Remacri.safetensors'), 'x') // found recursively

    const dirs = resolveUpscaleDirs(root)
    expect(dirs).toContain(resolve(up))

    const files = scanModelFiles(dirs)
    expect(files).toContain(resolve(join(up, '4x-UltraSharp.pth')))
    expect(files).toContain(resolve(join(up, 'sub', 'Remacri.safetensors')))
    expect(files.some((f) => f.endsWith('note.txt'))).toBe(false)
  })

  it('accepts an upscale_models dir picked directly', () => {
    const up = join(root, 'models', 'upscale_models')
    expect(resolveUpscaleDirs(up)).toContain(resolve(up))
  })

  it('reads extra_model_paths.yaml for additional upscale dirs', () => {
    const extraBase = join(root, 'shared')
    const extraUp = join(extraBase, 'upscale_models')
    mkdirSync(extraUp, { recursive: true })
    writeFileSync(join(extraUp, '4x_NMKD-Siax.pth'), 'x')
    writeFileSync(
      join(root, 'extra_model_paths.yaml'),
      `comfyui:\n    base_path: ${extraBase.replace(/\\/g, '/')}\n    upscale_models: upscale_models/\n`
    )
    const dirs = resolveUpscaleDirs(root)
    expect(dirs).toContain(resolve(extraUp))
  })
})
