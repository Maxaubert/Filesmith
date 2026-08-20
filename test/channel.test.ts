import { generateKeyPairSync, sign } from 'crypto'
import { describe, expect, it } from 'vitest'
import { verifyPack } from '../src/main/registry/channel'
import { clampDim, DEFAULT_DIM_CAPS } from '../src/shared/generate'

/** A keypair + a signed pack, the way the channel publisher would produce one. */
function makeSigned(payload: string): {
  pack: { payload: string; signature: string }
  publicKeyB64: string
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  return {
    pack: {
      payload,
      signature: sign(null, Buffer.from(payload, 'utf-8'), privateKey).toString('base64')
    },
    publicKeyB64: raw.toString('base64')
  }
}

describe('channel signature verification', () => {
  const payload = JSON.stringify({ schemaVersion: 1, entries: [] })

  it('accepts a pack signed by the matching key', () => {
    const { pack, publicKeyB64 } = makeSigned(payload)
    expect(verifyPack(pack, publicKeyB64)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    // The whole point: content that changed after signing must not reach the
    // registry, because a channel pack can add downloadable model URLs.
    const { pack, publicKeyB64 } = makeSigned(payload)
    const tampered = {
      ...pack,
      payload: payload.replace('"entries":[]', '"entries":[{"id":"evil"}]')
    }
    expect(verifyPack(tampered, publicKeyB64)).toBe(false)
  })

  it('rejects a valid signature from the wrong key', () => {
    const { pack } = makeSigned(payload)
    const { publicKeyB64: otherKey } = makeSigned(payload)
    expect(verifyPack(pack, otherKey)).toBe(false)
  })

  it('rejects when no key is configured — no key, no trust', () => {
    const { pack } = makeSigned(payload)
    expect(verifyPack(pack, '')).toBe(false)
  })

  it('rejects garbage without throwing', () => {
    const { publicKeyB64 } = makeSigned(payload)
    expect(verifyPack({ payload: 'x', signature: 'not-base64-!!' }, publicKeyB64)).toBe(false)
    expect(verifyPack({ payload: 'x', signature: '' }, 'not-a-key')).toBe(false)
  })
})

describe('per-architecture dimension limits', () => {
  it('uses the default range when a model declares none', () => {
    expect(clampDim(999999)).toBe(DEFAULT_DIM_CAPS.maxDim)
    expect(clampDim(1)).toBe(DEFAULT_DIM_CAPS.minDim)
    expect(clampDim(1023)).toBe(1024) // snapped to the step
  })

  it("honours a model's own higher ceiling instead of one global 2048", () => {
    // A model whose native resolution is above 2048 was silently capped below
    // what it was trained for.
    expect(clampDim(4096, { maxDim: 4096 })).toBe(4096)
    expect(clampDim(3000, { minDim: 512, maxDim: 4096, dimStep: 64 })).toBe(3008)
  })

  it('respects a coarser step', () => {
    expect(clampDim(1000, { dimStep: 64 })).toBe(1024)
    expect(clampDim(1100, { dimStep: 64 })).toBe(1088)
  })

  it('never returns a non-finite or sub-minimum value', () => {
    for (const bad of [NaN, Infinity, -Infinity, -500, 0])
      expect(clampDim(bad)).toBeGreaterThanOrEqual(DEFAULT_DIM_CAPS.minDim)
  })
})
