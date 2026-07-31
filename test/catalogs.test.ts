import { describe, expect, it } from 'vitest'
import { pickNcnnModel, type NcnnModel } from '../src/main/tools/ncnnModels'
import { classifyModel, VERIFIED_ARCHS, VERIFIED_TOKENS } from '../src/shared/comfy'
import { allowedBgModels } from '../src/main/tools/removebg'
import { BG_MODEL_VALUES } from '../src/shared/removebg'
import { registryEntries } from '../src/main/registry/load'

const model = (name: string, user = false): NcnnModel => ({
  name,
  dir: user ? 'C:/user/models' : 'C:/app/models',
  label: name,
  user
})

describe('Real-ESRGAN models come from disk, not from a build-time literal', () => {
  const shipped = [model('realesrgan-x4plus'), model('realesrgan-x4plus-anime')]

  it('keeps the legacy photo/anime aliases working for stored sessions', () => {
    expect(pickNcnnModel(shipped, 'photo')!.name).toBe('realesrgan-x4plus')
    expect(pickNcnnModel(shipped, 'anime')!.name).toBe('realesrgan-x4plus-anime')
  })

  it('selects a model the app has never heard of, by name', () => {
    // The whole point: a .param/.bin pair dropped in is immediately usable.
    const withNew = [...shipped, model('4x-SomeArch-2027', true)]
    expect(pickNcnnModel(withNew, 'esrgan:4x-SomeArch-2027')!.name).toBe('4x-SomeArch-2027')
    expect(pickNcnnModel(withNew, 'esrgan:4x-SomeArch-2027')!.dir).toBe('C:/user/models')
  })

  it('degrades to something usable when the stored choice is gone', () => {
    // A build that shipped a different model set must still upscale rather than
    // failing on a name that no longer exists.
    const other = [model('4x-Nomos8k')]
    expect(pickNcnnModel(other, 'photo')!.name).toBe('4x-Nomos8k')
    expect(pickNcnnModel(other, 'esrgan:realesrgan-x4plus')!.name).toBe('4x-Nomos8k')
    expect(pickNcnnModel(other, 'anime')!.name).toBe('4x-Nomos8k')
  })

  it('prefers a non-anime model for photo and an anime one for anime', () => {
    const set = [model('4x-Generic'), model('4x-AnimeThing')]
    expect(pickNcnnModel(set, 'photo')!.name).toBe('4x-Generic')
    expect(pickNcnnModel(set, 'anime')!.name).toBe('4x-AnimeThing')
  })

  it('returns null rather than guessing when nothing is installed', () => {
    expect(pickNcnnModel([], 'photo')).toBeNull()
  })
})

describe('upscaler badge follows the probed architecture, not the calendar', () => {
  it('verifies by architecture even when the name is unknown', () => {
    // Previously this was "experimental" for the sole reason that nobody had
    // added the filename to a token list — so every model released after the
    // build was downgraded automatically.
    const m = classifyModel({
      path: 'C:/m/4x-ModelNobodyHasHeardOf.safetensors',
      ok: true,
      arch: 'DAT',
      scale: 4
    })
    expect(m.badge).toBe('verified')
    expect(VERIFIED_ARCHS).toContain('DAT')
  })

  it('still verifies a known name whose architecture we do not list', () => {
    const m = classifyModel({ path: '/m/4x-UltraSharpV2.pth', ok: true, arch: 'SomethingNew', scale: 4 })
    expect(m.badge).toBe('verified')
    expect(VERIFIED_TOKENS).toContain('ultrasharp')
  })

  it('badges a genuinely unknown model experimental, but keeps it usable', () => {
    const m = classifyModel({ path: '/m/mystery.pth', ok: true, arch: 'WhoKnows', scale: 2 })
    expect(m.badge).toBe('experimental')
    expect(m.scale).toBe(2) // still selectable — a badge never gates availability
  })

  it('marks a file spandrel could not load unsupported', () => {
    expect(classifyModel({ path: '/m/x.pt', ok: false, reason: 'nope' }).badge).toBe('unsupported')
  })
})

describe('the rembg allowlist moved into the registry but is still an allowlist', () => {
  it('ships exactly the licence-vetted sessions', () => {
    expect(allowedBgModels().sort()).toEqual([...BG_MODEL_VALUES].sort())
  })

  it('never includes the models excluded for licence or provenance reasons', () => {
    // bria-rmbg is CC BY-NC; u2net_human_seg is Supervisely (non-commercial);
    // isnet-anime has scraped provenance; sam is the wrong tool entirely.
    for (const bad of ['bria-rmbg', 'u2net_human_seg', 'isnet-anime', 'sam'])
      expect(allowedBgModels()).not.toContain(bad)
  })
})

describe('the engines pack', () => {
  it('pins the PiD backbone and the spandrel loader floor as data', () => {
    const pid = registryEntries('pid-backbone')
    expect(pid.map((e) => e.id)).toContain('flux')
    const spandrel = registryEntries('upscale').find((e) => e.id === 'spandrel')
    expect(spandrel?.engineSpec).toMatch(/^spandrel>=/)
  })
})
