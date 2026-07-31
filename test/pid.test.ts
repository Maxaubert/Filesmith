import { describe, expect, it } from 'vitest'
import { cudaTierSupport, parseNvidiaSmi } from '../src/main/pid/gpu'
import { classifySidecarLine } from '../src/main/pid/sidecar'

describe('parseNvidiaSmi', () => {
  it('parses name and VRAM from the first line', () => {
    // An older nvidia-smi reports only these two fields; the rest must come back
    // as null (unknown), never as a value that would fail a floor check.
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 5090, 32607\n')).toEqual({
      name: 'NVIDIA GeForce RTX 5090',
      vramMb: 32607,
      computeCap: null,
      driver: null
    })
  })

  it('takes the first GPU when several are listed', () => {
    const out = 'NVIDIA RTX A6000, 49140\nNVIDIA GeForce RTX 3080, 10240\n'
    expect(parseNvidiaSmi(out)?.name).toBe('NVIDIA RTX A6000')
  })

  it('returns null VRAM when the field is not a number', () => {
    expect(parseNvidiaSmi('NVIDIA T4, [N/A]')).toMatchObject({ name: 'NVIDIA T4', vramMb: null })
  })

  it('returns null for empty output (no NVIDIA GPU)', () => {
    expect(parseNvidiaSmi('')).toBeNull()
    expect(parseNvidiaSmi('\n  \n')).toBeNull()
  })
})

describe('classifySidecarLine', () => {
  it('detects the ready handshake', () => {
    expect(classifySidecarLine('{"ready": true}')).toEqual({ kind: 'ready' })
  })

  it('parses a successful reply with id, output and ms', () => {
    expect(classifySidecarLine('{"id": 7, "ok": true, "output": "C:/out.png", "ms": 1234}')).toEqual({
      kind: 'ok',
      id: 7,
      output: 'C:/out.png',
      ms: 1234
    })
  })

  it('defaults ms to 0 when missing or non-numeric', () => {
    expect(classifySidecarLine('{"id": 1, "ok": true, "output": "o.png"}')).toEqual({
      kind: 'ok',
      id: 1,
      output: 'o.png',
      ms: 0
    })
  })

  it('reports id as null when the reply omits it', () => {
    expect(classifySidecarLine('{"ok": true, "output": "o.png", "ms": 5}')).toEqual({
      kind: 'ok',
      id: null,
      output: 'o.png',
      ms: 5
    })
  })

  it('treats an ok reply with no output path as an error, not "undefined"', () => {
    expect(classifySidecarLine('{"id": 3, "ok": true, "ms": 10}')).toEqual({
      kind: 'error',
      id: 3,
      error: 'PiD returned no output path'
    })
  })

  it('parses a failure reply with its id and error message', () => {
    expect(classifySidecarLine('{"id": 4, "ok": false, "error": "no caption"}')).toEqual({
      kind: 'error',
      id: 4,
      error: 'no caption'
    })
  })

  it('supplies a fallback error message when none is given', () => {
    expect(classifySidecarLine('{"id": 2, "ok": false}')).toEqual({
      kind: 'error',
      id: 2,
      error: 'PiD failed'
    })
  })

  it('ignores non-JSON diagnostic lines (torch banners, tracebacks)', () => {
    expect(classifySidecarLine('Loading model...')).toEqual({ kind: 'ignore' })
    expect(classifySidecarLine('  Traceback (most recent call last):')).toEqual({ kind: 'ignore' })
    expect(classifySidecarLine('')).toEqual({ kind: 'ignore' })
  })

  it('ignores malformed JSON without throwing', () => {
    expect(classifySidecarLine('{ not valid json')).toEqual({ kind: 'ignore' })
  })

  it('ignores a JSON object that is neither handshake nor reply', () => {
    expect(classifySidecarLine('{"info": "warming up"}')).toEqual({ kind: 'ignore' })
  })
})

describe('cudaTierSupport (the gate before a ~3 GB cu128 download)', () => {
  it('reads compute capability and driver when nvidia-smi reports them', () => {
    const g = parseNvidiaSmi('NVIDIA GeForce RTX 5090, 32607, 12.0, 581.15')
    expect(g).toMatchObject({ computeCap: 12, driver: '581.15' })
  })

  it('refuses a Pascal card BEFORE the download instead of after it', () => {
    // A GTX 10xx owner used to sit through the whole install and then hit a CUDA
    // kernel-image error. `nvidia-smi answered` was the only gate.
    const r = cudaTierSupport(parseNvidiaSmi('NVIDIA GeForce GTX 1080, 8192, 6.1, 552.22'))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/GTX 1080/)
  })

  it('accepts an RTX-class card', () => {
    expect(cudaTierSupport(parseNvidiaSmi('NVIDIA GeForce RTX 4070, 12282, 8.9, 581.15')).ok).toBe(true)
  })

  it('refuses a driver below the floor', () => {
    const r = cudaTierSupport(parseNvidiaSmi('NVIDIA GeForce RTX 4070, 12282, 8.9, 470.10'))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/driver/i)
  })

  it('treats UNKNOWN fields as acceptable, never as too old', () => {
    // An older nvidia-smi doesn't report compute_cap; refusing on missing
    // information would lock out hardware that works perfectly well.
    expect(cudaTierSupport(parseNvidiaSmi('NVIDIA GeForce RTX 3060, 12288')).ok).toBe(true)
  })

  it('reports no GPU as unsupported with a reason', () => {
    expect(cudaTierSupport(null)).toMatchObject({ ok: false })
  })
})
