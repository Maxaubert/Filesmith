import { describe, expect, it } from 'vitest'
import {
  buildFormats,
  renderFormats,
  runFormats,
  type FormatsDeps
} from '../src/cli/commands/formats'
import { parseArgv } from '../src/cli/parse'
import type { EventBody, Reporter } from '../src/cli/events'

const deps = (over: Partial<FormatsDeps> = {}): FormatsDeps => ({
  hasRar: () => false,
  ncnnModels: () => [
    { name: 'realesrgan-x4plus', label: 'Photo', user: false },
    { name: 'realesrgan-x4plus-anime_6B', label: 'Anime (6B)', user: false }
  ],
  comfyModels: () => [
    { path: 'D:\\models\\4x-Ultra.pth', name: '4x-Ultra', scale: 4, badge: 'verified' }
  ],
  comfyReady: () => true,
  pidInstalled: () => false,
  cudaOk: async () => false,
  rembgReady: () => true,
  generationModels: () => [
    {
      name: 'checkpoints/sdxl.safetensors',
      label: 'sdxl',
      arch: 'sdxl',
      source: 'checkpoint',
      group: 'Checkpoints',
      runnable: true
    }
  ],
  ...over
})

describe('formats', () => {
  it('lists targets per source group, the option values and the models with readiness', async () => {
    const f = await buildFormats(deps())
    const groups = f.convert.groups as { group: string; to: string[] }[]
    expect(groups.find((g) => g.group === 'image')?.to).toContain('webp')
    expect(f.convert.rar).toBe(false)
    expect(f.compress.levels).toEqual(['lossless', 'high', 'balanced', 'smallest'])
    const models = f.upscale.models as { value: string; engine: string; ready: boolean }[]
    expect(models.map((m) => m.value)).toEqual([
      'photo',
      'realesrgan-x4plus-anime_6B',
      'pid',
      'comfy:4x-Ultra.pth'
    ])
    expect(models.find((m) => m.value === 'pid')?.ready).toBe(false)
    expect(models.find((m) => m.engine === 'comfy')?.ready).toBe(false) // no CUDA tier
  })

  it('formats <verb> narrows; an unknown verb is a usage error', async () => {
    const events: EventBody[] = []
    let text = ''
    const r: Reporter = { emit: (e) => events.push(e), text: (s) => (text += s), close: () => {} }
    expect(await runFormats(parseArgv(['formats', 'upscale']), r, deps())).toBe(0)
    expect(Object.keys((events[0] as { data: object }).data)).toEqual(['upscale'])
    expect(text).toContain('UPSCALE')
    await expect(runFormats(parseArgv(['formats', 'nope']), r, deps())).rejects.toThrow(
      /Unknown verb for formats: nope/
    )
  })

  it('the human rendering fits 80 columns', async () => {
    for (const line of renderFormats(await buildFormats(deps())).split('\n'))
      expect(line.length, line).toBeLessThanOrEqual(80)
  })
})
