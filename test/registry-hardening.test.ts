import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mergeRegistryChecked, validateEntry, type RegistryEntry } from '../src/shared/registry'
import { layerDir, reloadRegistry } from '../src/main/registry/load'

// The two registry findings from the review:
//  - finding 6: engineSpec reached `uv pip install` unvalidated, so an
//    imported JSON was code execution;
//  - finding 7: the loader validated each layer's FRAGMENT, so the documented
//    partial override ({"id": "x", "companions": [...]}) was silently dropped
//    (missing kind/label) and the "fix a dead URL in thirty seconds" path did
//    nothing at all.

const entry = (over: Partial<RegistryEntry>): RegistryEntry =>
  ({
    id: 'fam',
    kind: 'generate',
    label: 'Family',
    provenance: { source: 'builtin' },
    ...over
  }) as RegistryEntry

describe('validateEntry: engineSpec', () => {
  it('accepts a bare PEP 508 requirement', () => {
    expect(validateEntry(entry({ engineSpec: 'spandrel>=0.4.1' }))).toEqual([])
    expect(validateEntry(entry({ engineSpec: 'spandrel' }))).toEqual([])
    expect(validateEntry(entry({ engineSpec: 'rembg[cli,cpu]>=2.0.75,<3' }))).toEqual([])
  })

  it('rejects URLs, flags, and anything with whitespace', () => {
    // Each of these would be command-line / package-source injection once
    // spliced into `uv pip install <spec>`.
    for (const bad of [
      'https://attacker.example/evil.whl',
      '--index-url=https://attacker.example/simple',
      '-e .',
      'spandrel @ https://attacker.example/evil.whl',
      'spandrel --index-url x'
    ]) {
      expect(validateEntry(entry({ engineSpec: bad }))).not.toEqual([])
    }
  })
})

describe('mergeRegistryChecked', () => {
  it('accepts a companions-only override of an existing entry', () => {
    const base = entry({
      companions: [
        {
          role: 'vae',
          label: 'VAE',
          subdir: 'vae',
          identify: {},
          download: { filename: 'vae.safetensors', approxSize: '335 MB', urls: ['https://a/x'] }
        }
      ]
    })
    const override = {
      id: 'fam',
      provenance: { source: 'user' },
      companions: [
        {
          role: 'vae',
          label: 'VAE',
          subdir: 'vae',
          identify: {},
          download: { filename: 'vae.safetensors', approxSize: '335 MB', urls: ['https://b/y'] }
        }
      ]
    } as RegistryEntry
    const { entries, warnings } = mergeRegistryChecked([
      { file: 'builtin/f.json', entries: [base] },
      { file: 'user/o.json', entries: [override] }
    ])
    expect(warnings).toEqual([])
    expect(entries).toHaveLength(1)
    // The override's URL won; the base's kind/label were inherited.
    expect(entries[0].companions?.[0].download.urls).toEqual(['https://b/y'])
    expect(entries[0].label).toBe('Family')
  })

  it('keeps the previous state when an override would make the entry invalid', () => {
    const base = entry({})
    const evil = { id: 'fam', engineSpec: 'https://attacker/evil.whl' } as RegistryEntry
    const { entries, warnings } = mergeRegistryChecked([
      { file: 'builtin/f.json', entries: [base] },
      { file: 'user/evil.json', entries: [evil] }
    ])
    expect(warnings).toHaveLength(1)
    expect(entries).toHaveLength(1)
    expect(entries[0].engineSpec).toBeUndefined()
    expect(entries[0].provenance.source).toBe('builtin')
  })

  it('skips a NEW entry that is invalid on its own', () => {
    const bad = { id: 'lonely', companions: [] } as unknown as RegistryEntry
    const { entries, warnings } = mergeRegistryChecked([{ file: 'user/l.json', entries: [bad] }])
    expect(entries).toEqual([])
    expect(warnings).toHaveLength(1)
  })
})

describe('partial override end to end through loadRegistry', () => {
  // The electron test stub points userData at a temp dir, so the real loader
  // path (readLayer -> mergeRegistryChecked) can be exercised for real.
  const userDir = layerDir('user')!
  beforeEach(() => {
    rmSync(userDir, { recursive: true, force: true })
    mkdirSync(userDir, { recursive: true })
  })
  afterAll(() => {
    rmSync(userDir, { recursive: true, force: true })
    reloadRegistry()
  })

  it('a user fragment overrides one field of a built-in entry', () => {
    const before = reloadRegistry()
    const target = before.entries.find((e) => e.kind === 'generate' && e.companions?.length)
    if (!target) return // shipped pack carries no companion entry — nothing to override
    writeFileSync(
      join(userDir, 'fix.json'),
      JSON.stringify({
        schemaVersion: 1,
        entries: [{ id: target.id, label: 'Renamed by user' }]
      })
    )
    const after = reloadRegistry()
    const merged = after.entries.find((e) => e.id === target.id)!
    expect(merged.label).toBe('Renamed by user')
    // Everything not overridden is inherited, not lost.
    expect(merged.kind).toBe(target.kind)
    expect(merged.companions?.length).toBe(target.companions?.length)
    expect(merged.provenance.source).toBe('user')
  })
})
