import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { classifyModel, normalizeModelName } from '../src/shared/comfy'
import { classifySpandrelLine } from '../src/main/comfy/sidecar'
import { resolveUpscaleDirs, scanModelFiles } from '../src/main/comfy/discover'

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

  it('marks an unknown-but-loadable model experimental', () => {
    const m = classifyModel({ path: '/m/SomeRandomUpscaler.pth', ok: true, arch: 'DAT', scale: 2 })
    expect(m.badge).toBe('experimental')
    expect(m.scale).toBe(2)
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
