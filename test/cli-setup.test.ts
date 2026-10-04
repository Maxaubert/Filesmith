import { describe, expect, it } from 'vitest'
import { StepReporter, runSetup, type SetupDeps, type Timers } from '../src/cli/commands/setup'
import { parseArgv } from '../src/cli/parse'
import type { EventBody, Reporter } from '../src/cli/events'

function rec(): Reporter & { events: EventBody[] } {
  const events: EventBody[] = []
  return { events, emit: (e) => events.push(e), text: () => {}, close: () => {} }
}

function fakeDeps(over: Partial<SetupDeps> = {}): SetupDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    cuda: async () => ({ ok: true }),
    pidInstalled: () => false,
    installPid: async (p) => {
      calls.push('installPid')
      p('Downloading model (2.6 GB)', 50)
    },
    comfyReady: () => false,
    installComfyEngine: async () => void calls.push('installComfyEngine'),
    setComfy: (patch) => void calls.push(`setComfy ${JSON.stringify(patch)}`),
    scanComfy: async () => [],
    generationModels: () => [
      {
        name: 'diffusion_models/flux.safetensors',
        label: 'flux',
        arch: 'flux1',
        source: 'diffusion',
        group: 'Flux',
        runnable: false,
        missing: [
          {
            label: 'T5',
            filename: 't5.safetensors',
            url: 'https://x/t5',
            approxSize: '9 GB',
            subdir: 'text_encoders'
          }
        ]
      }
    ],
    rembgReady: () => false,
    setupRembg: async (model, p) => {
      calls.push(`setupRembg ${model}`)
      p('Ready', 100)
    },
    downloadCompanions: async (m) => void calls.push(`downloadCompanions ${m}`),
    ncnnModels: () => [{ name: 'realesrgan-x4plus', label: 'Photo', user: false }],
    userNcnnDir: () => 'U:\\models\\realesrgan',
    pathState: () => 'dir',
    removeTool: async (t, o) => {
      calls.push(`remove ${t} ${JSON.stringify(o)}`)
      return 'U:\\pid (6 GB)'
    },
    freeBytes: () => 100e9,
    userData: () => 'U:\\',
    ...over
  }
}

const go = (argv: string[], deps: SetupDeps, ctrl = new AbortController()) => {
  const r = rec()
  return { r, run: () => runSetup(parseArgv(argv), 'C:\\work', r, deps, ctrl.signal, () => 0) }
}

describe('runSetup', () => {
  it('with no tool lists readiness with fix commands', async () => {
    const s = go(['setup'], fakeDeps({ pidInstalled: () => true }))
    expect(await s.run()).toBe(0)
    const checks = s.r.events.filter((e) => e.event === 'check') as {
      id: string
      status: string
      fix?: string
    }[]
    expect(checks.find((c) => c.id === 'pid')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'removebg')).toMatchObject({
      status: 'warn',
      fix: 'filesmith setup removebg'
    })
  })

  it('unknown tools are usage errors', async () => {
    await expect(go(['setup', 'nope'], fakeDeps()).run()).rejects.toThrow(
      /Unknown setup tool: nope/
    )
  })

  it('removebg: dry run lists the plan and downloads nothing', async () => {
    const d = fakeDeps()
    const s = go(['setup', 'removebg', '--dry-run'], d)
    expect(await s.run()).toBe(0)
    expect(d.calls).toEqual([])
    expect(s.r.events.filter((e) => e.event === 'step').length).toBeGreaterThan(2)
  })

  it('removebg: installs the default model and reports done', async () => {
    const d = fakeDeps()
    const s = go(['setup', 'remove-bg'], d)
    expect(await s.run()).toBe(0)
    expect(d.calls).toEqual(['setupRembg birefnet-general'])
    expect(s.r.events.find((e) => e.event === 'done')).toMatchObject({
      tool: 'removebg',
      alreadyDone: false
    })
  })

  it('already set up is exit 0 with alreadyDone', async () => {
    const s = go(['setup', 'removebg'], fakeDeps({ rembgReady: () => true }))
    expect(await s.run()).toBe(0)
    expect(s.r.events.find((e) => e.event === 'done')).toMatchObject({ alreadyDone: true })
  })

  it('pid: an unsupported GPU is a run-level error', async () => {
    await expect(
      go(
        ['setup', 'pid'],
        fakeDeps({ cuda: async () => ({ ok: false, reason: 'Pascal is too old.' }) })
      ).run()
    ).rejects.toMatchObject({ code: 'GPU_UNSUPPORTED', message: 'Pascal is too old.' })
  })

  it('a failing install is exit 1 with an error event; a canceled one is 130', async () => {
    const failing = go(
      ['setup', 'pid'],
      fakeDeps({
        installPid: async () => {
          throw new Error('uv pip install failed')
        }
      })
    )
    expect(await failing.run()).toBe(1)
    expect(failing.r.events.find((e) => e.event === 'error')).toMatchObject({
      message: 'uv pip install failed'
    })
    const ctrl = new AbortController()
    const canceled = go(
      ['setup', 'pid'],
      fakeDeps({
        installPid: async () => {
          ctrl.abort()
          throw new Error('Download cancelled')
        }
      }),
      ctrl
    )
    expect(await canceled.run()).toBe(130)
  })

  it('comfy needs --folder or --url and records them', async () => {
    await expect(go(['setup', 'comfy'], fakeDeps()).run()).rejects.toThrow(/needs --folder/)
    const d = fakeDeps()
    expect(await go(['setup', 'comfy', '--folder', 'D:\\ComfyUI'], d).run()).toBe(0)
    expect(d.calls).toEqual(['setComfy {"folder":"D:\\\\ComfyUI"}'])
  })

  it('generate: dry run lists the missing files; the real run downloads them', async () => {
    const d = fakeDeps()
    const dry = go(['setup', 'generate', '--model', 'flux', '--dry-run'], d)
    expect(await dry.run()).toBe(0)
    expect(dry.r.events.find((e) => e.event === 'step')).toMatchObject({ step: 'T5' })
    expect(await go(['setup', 'generate', '--model', 'flux'], d).run()).toBe(0)
    expect(d.calls).toEqual(['downloadCompanions diffusion_models/flux.safetensors'])
  })

  it('remove pid warns about the shared environment and passes --permanent', async () => {
    const d = fakeDeps()
    const s = go(['setup', 'remove', 'pid', '--permanent'], d)
    expect(await s.run()).toBe(0)
    expect(s.r.events.find((e) => e.event === 'warning')).toMatchObject({ code: 'SHARED_ENV' })
    expect(d.calls).toEqual(['remove pid {"permanent":true,"dryRun":false}'])
  })
})

describe('StepReporter', () => {
  it('heartbeats every 5 s while a step has no percentage, and computes an ETA from bytes', () => {
    const r = rec()
    // A holder object, so TypeScript does not narrow the callback slot to null.
    const tick: { fn: (() => void) | null } = { fn: null }
    let now = 0
    const timers: Timers = {
      set: (fn) => {
        tick.fn = fn
        return 1
      },
      clear: () => {
        tick.fn = null
      }
    }
    const s = new StepReporter(r, () => now, timers)
    s.onProgress('Installing PyTorch', null)
    now = 5000
    tick.fn?.()
    expect(r.events.at(-1)).toEqual({
      event: 'heartbeat',
      step: 'Installing PyTorch',
      elapsedSec: 5
    })
    s.onProgress('Downloading model', 0)
    expect(tick.fn).toBeNull()
    s.onBytes(0, 1000)
    now = 7000
    s.onBytes(500, 1000)
    expect(r.events.at(-1)).toMatchObject({
      event: 'step',
      pct: 50,
      bytes: 500,
      totalBytes: 1000,
      etaSec: 2
    })
    s.stop()
  })
})
