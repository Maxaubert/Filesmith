import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { engineEnv, setEngineEnv } from '../src/main/env'
import { layerDir, loadRegistry, reloadRegistry } from '../src/main/registry/load'
import {
  selectCompanions,
  validateEntry,
  type CompanionSpec,
  type RegistryEntry
} from '../src/shared/registry'

// Audit 2026-11-23, finding 23: a malformed user-layer file threw during load,
// the cache stayed null, and every later Generate, remove-bg or doctor call
// threw again. A bad entry must be skipped with a warning instead.

const companion = (filename: string): CompanionSpec => ({
  role: 'clip',
  label: filename,
  subdir: 'text_encoders',
  identify: {},
  download: { filename, approxSize: '1 GB', urls: [`https://example.com/${filename}`] }
})

const good = {
  id: 'my-good-model',
  kind: 'generate',
  label: 'My good model',
  companions: [companion('enc.safetensors')]
}

describe('malformed user registry entries', () => {
  const saved = engineEnv()
  let root = ''
  let userDir = ''
  beforeAll(() => {
    // Our own userData, so no other test file shares this user layer.
    root = mkdtempSync(join(tmpdir(), 'filesmith-registry-malformed-'))
    setEngineEnv({ ...saved, userData: root })
    userDir = layerDir('user')!
  })
  beforeEach(() => {
    rmSync(userDir, { recursive: true, force: true })
    mkdirSync(userDir, { recursive: true })
  })
  afterAll(() => {
    setEngineEnv(saved)
    rmSync(root, { recursive: true, force: true })
    reloadRegistry()
  })

  const writeUser = (entries: unknown[]): void =>
    writeFileSync(join(userDir, 'mine.json'), JSON.stringify({ schemaVersion: 1, entries }))

  const bad: [string, unknown][] = [
    ['entries: [null]', null],
    ['a number entry', 5],
    ['an array entry', ['x']],
    ['companions as an object', { ...good, id: 'b1', companions: {} }],
    ['a null companion', { ...good, id: 'b2', companions: [null] }],
    [
      'a companion set whose companions is a string',
      { ...good, id: 'b3', companionSets: [{ id: 's', companions: 'x' }] }
    ],
    [
      'a companion with no download',
      { ...good, id: 'b4', companions: [{ ...companion('a.safetensors'), download: undefined }] }
    ],
    [
      'a download whose urls is not a list',
      {
        ...good,
        id: 'b5',
        companions: [{ ...companion('a.safetensors'), download: { filename: 'a', urls: 'x' } }]
      }
    ],
    [
      'a workflow template that is a string',
      { ...good, id: 'b6', workflow: { format: 'comfy-api-v1', template: 'x' } }
    ],
    ['companionSets that is a number', { ...good, id: 'b7', companionSets: 5 }]
  ]

  for (const [name, entry] of bad) {
    it(`skips ${name} next to a good entry, with one warning`, () => {
      const baseline = reloadRegistry().warnings.length // user layer still empty
      writeUser([entry, good])
      let result: ReturnType<typeof reloadRegistry> | undefined
      expect(() => {
        result = reloadRegistry()
      }).not.toThrow()
      expect(result!.entries.some((e) => e.id === 'my-good-model')).toBe(true)
      expect(result!.warnings.length).toBe(baseline + 1)
      expect(result!.warnings.some((w) => w.startsWith('user/mine.json'))).toBe(true)
      // The cache is filled, so a second call works too.
      expect(() => loadRegistry()).not.toThrow()
      expect(loadRegistry().entries.some((e) => e.id === 'my-good-model')).toBe(true)
    })
  }

  it('ignores a provenance that is not an object and still assigns the layer', () => {
    writeUser([null, { ...good, provenance: 'oops' }])
    const e = reloadRegistry().entries.find((x) => x.id === 'my-good-model')!
    expect(e.provenance).toEqual({ source: 'user' })
  })
})

describe('validateEntry reports bad shapes instead of throwing', () => {
  const base = { id: 'x', kind: 'generate', label: 'X', provenance: { source: 'user' } }
  for (const extra of [
    { companions: {} },
    { companions: [null] },
    { companions: [7] },
    { companionSets: {} },
    { companionSets: [null] },
    { companionSets: [{ id: 's', companions: 'x' }] },
    { companionSets: [{ id: 's', companions: [null] }] },
    { companions: [{ ...companion('a.safetensors'), download: null }] },
    { companions: [{ ...companion('a.safetensors'), download: { filename: 'a', urls: {} } }] },
    { workflow: 'x' },
    { workflow: { format: 'comfy-api-v1', template: 5 } }
  ]) {
    it(JSON.stringify(extra), () => {
      const e = { ...base, ...extra } as unknown as RegistryEntry
      let errs: string[] = []
      expect(() => (errs = validateEntry(e))).not.toThrow()
      expect(errs.length).toBeGreaterThan(0)
    })
  }
})

// Audit 2026-11-23, finding 32: the Flux 2 sets used byte size only when it was
// known, so a 9B Q4 GGUF (under 6 GB, "9b" in its name) got the 4B encoder.
describe('selectCompanions: name first, size only for non-GGUF files', () => {
  const flux2Like = {
    id: 'f2',
    kind: 'generate',
    label: 'F2',
    provenance: { source: 'builtin' },
    companionSets: [
      {
        id: '9b',
        when: { minBytes: 6e9, nameHint: '9b' },
        companions: [companion('big.safetensors')]
      },
      { id: '4b', companions: [companion('small.safetensors')] }
    ]
  } as unknown as RegistryEntry
  const pick = (name: string, size?: number): string =>
    selectCompanions(flux2Like, name, size)[0].download.filename

  it('a 9B GGUF of 5e9 bytes with "9b" in its name gets the 9B set', () => {
    expect(pick('flux-2-klein-9b-Q4_K_M.gguf', 5e9)).toBe('big.safetensors')
  })
  // models.ts passes the path under diffusion_models or unet, folders included.
  it('"9b" in a folder name does not count, only the base file name', () => {
    expect(pick('klein-4b-and-9b/flux-2-klein-4b-fp8.safetensors', 3.8e9)).toBe('small.safetensors')
    expect(pick('klein-4b-and-9b\\flux-2-klein-4b-fp8.safetensors', 3.8e9)).toBe(
      'small.safetensors'
    )
    expect(pick('9b/flux-2-klein-4b-Q4_K_M.gguf', 3e9)).toBe('small.safetensors')
    expect(pick('9b/sub/flux-2-klein-4b.safetensors')).toBe('small.safetensors')
  })
  it('a "9b" base file name still counts inside a folder', () => {
    expect(pick('flux/flux-2-klein-9b-Q4_K_M.gguf', 5e9)).toBe('big.safetensors')
  })
  it('an unnamed 7e9-byte safetensors gets the 9B set by size', () => {
    expect(pick('my-model.safetensors', 7e9)).toBe('big.safetensors')
  })
  it('a 4B fp8 file gets the default set', () => {
    expect(pick('flux-2-klein-4b-fp8.safetensors', 3.8e9)).toBe('small.safetensors')
  })
  it('with an unknown size the name decides', () => {
    expect(pick('flux-2-klein-9b.safetensors')).toBe('big.safetensors')
    expect(pick('flux-2-klein-4b.safetensors')).toBe('small.safetensors')
  })
  it('a GGUF with no size token gets the default set, whatever its size', () => {
    expect(pick('my-model-Q8_0.gguf', 9e9)).toBe('small.safetensors')
  })
})
