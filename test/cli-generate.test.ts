import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { isRestoreName as rendererIsRestore } from '../src/renderer/src/components/options/generate/restore'
import {
  isRestoreName,
  pickModel,
  runGenerate,
  type GenerateDeps
} from '../src/cli/commands/generate'
import { parseArgv } from '../src/cli/parse'
import type { EventBody, Reporter } from '../src/cli/events'
import type { CliIO } from '../src/cli/io'
import type { GenModel } from '@shared/genArch'
import { engineEnv } from '../src/main/env'
import { generatedOutputDir } from '../src/main/generate'

const model = (over: Partial<GenModel>): GenModel => ({
  name: 'checkpoints/sdxl.safetensors',
  label: 'sdxl',
  arch: 'sdxl',
  source: 'checkpoint',
  group: 'Checkpoints',
  runnable: true,
  ...over
})

function setup(argv: string[], over: Partial<GenerateDeps> = {}, ctrl = new AbortController()) {
  const events: EventBody[] = []
  const reporter: Reporter = { emit: (e) => events.push(e), text: () => {}, close: () => {} }
  const io = { cwd: 'C:\\proj', signal: ctrl.signal } as CliIO
  const calls: unknown[] = []
  const deps: GenerateDeps = {
    scan: () => ({
      models: [model({ label: 'SUPIR-v0Q', name: 'checkpoints/SUPIR-v0Q.safetensors' }), model({})]
    }),
    archInfo: () => ({}),
    dimCaps: () => ({ sdxl: { minDim: 512, maxDim: 1536, dimStep: 64 } }),
    available: async () => true,
    generate: async (opts, onImage, onProgress) => {
      calls.push(opts)
      for (let i = 0; i < opts.count; i++) {
        onProgress(i, 50)
        onImage(i, join(opts.outDir as string, `img-${i}.png`))
      }
    },
    stop: () => calls.push('stop'),
    pathState: () => 'dir',
    mkdirp: () => {},
    outSize: () => 1000,
    ...over
  }
  return { run: () => runGenerate(parseArgv(argv), io, reporter, deps, () => 0), events, calls }
}

describe('generate', () => {
  it('auto-picks the first runnable non-restoration model, like the app', () => {
    expect(pickModel([model({ label: 'refiner' }), model({ label: 'juggernaut' })])?.label).toBe(
      'juggernaut'
    )
    for (const l of [
      'SUPIR-v0Q',
      'sdxl_refiner',
      'inpaint-x',
      'my-upscaler',
      'controlnet',
      'juggernaut'
    ])
      expect(isRestoreName(l), l).toBe(rendererIsRestore(l))
  })

  it('runs with arch defaults, clamps the size with a warning, writes to the current folder', async () => {
    const s = setup(['generate', 'a red kettle', '--count', '2', '--size', '2048x2048', '--json'])
    expect(await s.run()).toBe(0)
    const opts = s.calls[0] as Record<string, unknown>
    expect(opts).toMatchObject({
      model: 'checkpoints/sdxl.safetensors',
      width: 1536,
      height: 1536,
      steps: 28,
      cfg: 7,
      outDir: 'C:\\proj',
      count: 2
    })
    expect(s.events.map((e) => e.event)).toEqual([
      'run',
      'warning',
      'start',
      'progress',
      'done',
      'start',
      'progress',
      'done',
      'summary'
    ])
    expect(s.calls.at(-1)).toBe('stop')
  })

  it('a dry run predicts one output per image and does not generate', async () => {
    const s = setup(['generate', 'A Red Kettle!', '--count', '2', '--dry-run'], {
      generate: async () => {
        throw new Error('must not run')
      }
    })
    expect(await s.run()).toBe(0)
    const plans = s.events.filter((e) => e.event === 'plan') as { output: string }[]
    expect(plans.map((p) => p.output)).toEqual([
      join('C:\\proj', 'a-red-kettle.png'),
      join('C:\\proj', 'a-red-kettle (generated).png')
    ])
  })

  it('missing companions point at setup generate for that model', async () => {
    const s = setup(['generate', 'x', '--model', 'flux'], {
      scan: () => ({
        models: [
          model({
            label: 'flux',
            name: 'diffusion_models/flux.safetensors',
            runnable: false,
            missing: [
              {
                label: 'T5',
                filename: 't5.safetensors',
                url: 'u',
                approxSize: '9 GB',
                subdir: 'text_encoders'
              }
            ]
          })
        ]
      })
    })
    await expect(s.run()).rejects.toMatchObject({
      code: 'SETUP_REQUIRED',
      hint: 'filesmith setup generate --model "diffusion_models/flux.safetensors"'
    })
  })

  it('no ComfyUI and no models are setup errors', async () => {
    await expect(
      setup(['generate', 'x'], { scan: () => ({ models: [] }) }).run()
    ).rejects.toMatchObject({ code: 'SETUP_REQUIRED' })
    await expect(
      setup(['generate', 'x'], { available: async () => false }).run()
    ).rejects.toMatchObject({ code: 'SETUP_REQUIRED' })
  })

  it('Ctrl+C cancels the images not yet made', async () => {
    const ctrl = new AbortController()
    const s = setup(
      ['generate', 'x', '--count', '3'],
      {
        generate: async (opts, onImage) => {
          onImage(0, join(opts.outDir as string, 'one.png'))
          ctrl.abort()
          throw new Error('Generation cancelled')
        }
      },
      ctrl
    )
    expect(await s.run()).toBe(130)
    expect(s.events.filter((e) => e.event === 'canceled')).toHaveLength(2)
  })

  it('the app keeps Downloads when no outDir is given (M3)', () => {
    expect(generatedOutputDir({ outDir: 'D:\\x' } as never)).toBe('D:\\x')
    expect(generatedOutputDir({} as never)).toBe(engineEnv().downloadsDir)
  })
})
