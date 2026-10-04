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

  describe('an --out folder that cannot be created ends the same in a dry and a real run', () => {
    const states: Record<string, 'file' | 'dir'> = { 'C:\\': 'dir', 'C:\\f.txt': 'file' }
    const pathState = (p: string): 'file' | 'dir' | 'missing' => states[p] ?? 'missing'
    const neverRun = {
      generate: async () => {
        throw new Error('must not run')
      }
    }
    for (const dry of [true, false]) {
      const extra = dry ? ['--dry-run'] : []
      it(`--out is an existing file (${dry ? 'dry' : 'real'})`, async () => {
        const s = setup(['generate', 'x', '--out', 'C:\\f.txt', ...extra], {
          pathState,
          ...neverRun
        })
        await expect(s.run()).rejects.toMatchObject({ code: 'OUT_DIR_MISSING' })
        expect(s.events).toEqual([])
      })
      it(`--out is a folder under a file (${dry ? 'dry' : 'real'})`, async () => {
        const s = setup(['generate', 'x', '--out', 'C:\\f.txt\\sub\\a', ...extra], {
          pathState,
          ...neverRun
        })
        await expect(s.run()).rejects.toMatchObject({
          code: 'OUT_DIR_MISSING',
          message: expect.stringContaining('C:\\f.txt is a file, not a folder')
        })
        expect(s.events).toEqual([])
      })
      it(`--out is on a missing drive (${dry ? 'dry' : 'real'})`, async () => {
        const s = setup(['generate', 'x', '--out', 'Q:\\nope\\a', ...extra], {
          pathState,
          ...neverRun
        })
        await expect(s.run()).rejects.toMatchObject({
          code: 'OUT_DIR_MISSING',
          message: expect.stringContaining('does not exist')
        })
        expect(s.events).toEqual([])
      })
    }

    it('a creatable --out is announced in a dry run and created in a real run', async () => {
      const dry = setup(['generate', 'x', '--out', 'C:\\new', '--dry-run'], { pathState })
      expect(await dry.run()).toBe(0)
      expect(dry.events.some((e) => e.event === 'warning' && e.code === 'OUT_DIR_CREATE')).toBe(
        true
      )
      const made: string[] = []
      const real = setup(['generate', 'x', '--out', 'C:\\new'], {
        pathState,
        mkdirp: (p) => made.push(p)
      })
      expect(await real.run()).toBe(0)
      expect(made).toEqual(['C:\\new'])
    })

    it('mkdirp failing is OUT_DIR_MISSING, not an internal error, and nothing runs', async () => {
      const s = setup(['generate', 'x', '--out', 'C:\\new'], {
        pathState,
        mkdirp: () => {
          throw new Error('EACCES: permission denied')
        },
        ...neverRun
      })
      await expect(s.run()).rejects.toMatchObject({
        code: 'OUT_DIR_MISSING',
        message: expect.stringContaining('EACCES: permission denied')
      })
      expect(s.events.some((e) => e.event === 'start' || e.event === 'summary')).toBe(false)
    })
  })

  it('an engine failure fails the images not yet made and still stops ComfyUI', async () => {
    const s = setup(['generate', 'x', '--count', '3', '--json'], {
      generate: async (opts, onImage) => {
        onImage(0, join(opts.outDir as string, 'one.png'))
        throw new Error('ComfyUI rejected the prompt. Run: filesmith doctor.')
      }
    })
    expect(await s.run()).toBe(1)
    const errors = s.events.filter((e) => e.event === 'error') as {
      id: string
      message: string
      hint?: string
    }[]
    expect(errors.map((e) => e.id)).toEqual(['2', '3'])
    expect(errors[0]).toMatchObject({
      message: 'ComfyUI rejected the prompt. Run: filesmith doctor.',
      hint: 'filesmith doctor'
    })
    expect(errors[1]).toMatchObject({ message: 'Not generated: an earlier image failed.' })
    expect(errors[1].hint).toBeUndefined()
    const summary = s.events.at(-1) as Record<string, unknown>
    expect(summary).toMatchObject({ event: 'summary', ok: 1, failed: 2, canceled: 0, exitCode: 1 })
    expect(s.calls.at(-1)).toBe('stop')
  })

  it('the app keeps Downloads when no outDir is given (M3)', () => {
    expect(generatedOutputDir({ outDir: 'D:\\x' } as never)).toBe('D:\\x')
    expect(generatedOutputDir({} as never)).toBe(engineEnv().downloadsDir)
  })
})
