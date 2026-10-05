import { afterEach, describe, expect, it } from 'vitest'
import { engineEnv, setEngineEnv } from '../src/main/env'
import {
  notReadyMessage,
  removebgReadiness,
  upscaleReadiness,
  type ReadinessDeps
} from '../src/main/tools/readiness'

const saved = engineEnv()
afterEach(() => setEngineEnv(saved))

const deps = (over: Partial<ReadinessDeps> = {}): ReadinessDeps => ({
  pidInstalled: () => true,
  cuda: async () => ({ ok: true }),
  comfyEngineReady: () => true,
  comfyModelKnown: () => true,
  realesrganPresent: () => true,
  ncnnNames: () => ['realesrgan-x4plus', 'realesrgan-x4plus-anime'],
  rembgInstalled: () => true,
  rembgModelPresent: () => true,
  ...over
})

describe('upscaleReadiness', () => {
  it('bundled models are ready', async () => {
    expect(await upscaleReadiness({ upscaleModel: 'photo' }, deps())).toEqual({ ok: true })
    expect(
      await upscaleReadiness({ upscaleModel: 'esrgan:REALESRGAN-X4PLUS-ANIME' }, deps())
    ).toEqual({ ok: true })
  })

  it('an unknown Real-ESRGAN name is a usage error listing the installed ones', async () => {
    const r = await upscaleReadiness({ upscaleModel: 'esrgan:nope' }, deps())
    expect(r).toMatchObject({ ok: false, code: 'USAGE', hint: 'filesmith formats upscale' })
    expect(r.ok === false && r.message).toContain('realesrgan-x4plus')
  })

  it('missing Real-ESRGAN binary is TOOL_MISSING', async () => {
    const r = await upscaleReadiness({}, deps({ realesrganPresent: () => false }))
    expect(r).toMatchObject({ ok: false, code: 'TOOL_MISSING', hint: 'filesmith doctor' })
  })

  it('pid: GPU gate first, then install state', async () => {
    const gpu = await upscaleReadiness(
      { upscaleModel: 'pid' },
      deps({ cuda: async () => ({ ok: false, reason: 'Driver 470 is too old.' }) })
    )
    expect(gpu).toEqual({ ok: false, code: 'GPU_UNSUPPORTED', message: 'Driver 470 is too old.' })
    const setup = await upscaleReadiness(
      { upscaleModel: 'pid' },
      deps({ pidInstalled: () => false })
    )
    expect(setup).toMatchObject({ ok: false, code: 'SETUP_REQUIRED', hint: 'filesmith setup pid' })
  })

  it('comfy:<path>: engine, then the scanned list', async () => {
    const engine = await upscaleReadiness(
      { upscaleModel: 'comfy:C:\\m\\x.pth' },
      deps({ comfyEngineReady: () => false })
    )
    expect(engine).toMatchObject({ code: 'SETUP_REQUIRED', hint: 'filesmith setup spandrel' })
    const unknown = await upscaleReadiness(
      { upscaleModel: 'comfy:C:\\m\\x.pth' },
      deps({ comfyModelKnown: () => false })
    )
    expect(unknown).toMatchObject({ code: 'SETUP_REQUIRED' })
  })
})

describe('removebgReadiness', () => {
  it('needs the installed tool and the model file', () => {
    expect(removebgReadiness({}, deps())).toEqual({ ok: true })
    expect(removebgReadiness({}, deps({ rembgModelPresent: () => false }))).toMatchObject({
      ok: false,
      code: 'SETUP_REQUIRED',
      hint: 'filesmith setup removebg'
    })
  })
})

describe('notReadyMessage', () => {
  it('names the setup command in the CLI and keeps the app wording in the app', () => {
    setEngineEnv({ ...saved, host: 'cli' })
    expect(notReadyMessage('pid')).toBe('PiD is not installed. Run: filesmith setup pid.')
    setEngineEnv({ ...saved, host: 'app' })
    expect(notReadyMessage('pid')).toContain('Pick PiD in the options panel')
  })
})
