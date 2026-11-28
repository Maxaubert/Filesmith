import { describe, expect, it } from 'vitest'
import {
  dropHighlightOn,
  nextDropDepth,
  type DropHighlightEvent
} from '../src/renderer/src/components/shell/dropHighlight'
import { archDimCaps, buildWorkflow, imageMeta } from '../src/main/generate/workflow'
import { GEN_DEFAULTS, type GenerateOptions } from '../src/shared/generate'
import type { GenModel } from '../src/shared/genArch'

function run(events: DropHighlightEvent[]): number {
  return events.reduce(nextDropDepth, 0)
}

const enter: DropHighlightEvent = { type: 'enter' }
const leave: DropHighlightEvent = { type: 'leave', leftWindow: false }
const leaveWindow: DropHighlightEvent = { type: 'leave', leftWindow: true }

describe('drop highlight', () => {
  it('stays on while the drag moves between nested children', () => {
    // Crossing into a child fires enter on it before leave on the parent.
    const depth = run([enter, enter, leave, enter, leave])
    expect(dropHighlightOn(depth)).toBe(true)
  })
  it('turns off when the drag leaves through the last element', () => {
    expect(dropHighlightOn(run([enter, enter, leave, leave]))).toBe(false)
  })
  it('turns off when the pointer leaves the window from a child', () => {
    // The old check only cleared when the leave target was .app itself.
    expect(dropHighlightOn(run([enter, enter, enter, leaveWindow]))).toBe(false)
  })
  it('turns off on drop, dragend and blur', () => {
    expect(dropHighlightOn(run([enter, enter, { type: 'reset' }]))).toBe(false)
  })
  it('never goes negative', () => {
    expect(run([leave, leave, leaveWindow])).toBe(0)
    expect(dropHighlightOn(run([leave, leave, enter]))).toBe(true)
  })
})

const opts = (o: Partial<GenerateOptions>): GenerateOptions => ({
  ...GEN_DEFAULTS,
  model: 'm.safetensors',
  prompt: 'a cat',
  ...o
})

describe('generated image meta', () => {
  it('steps a fixed seed by one per image', () => {
    const o = opts({ seed: 100 })
    expect([0, 1, 2].map((i) => imageMeta(o, i).seed)).toEqual([100, 101, 102])
  })
  it('resolves a random seed to a concrete non-negative one', () => {
    const { seed } = imageMeta(opts({ seed: -1 }), 3)
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
  })
  it('reports the size the workflow is really built with', () => {
    const gm: GenModel = {
      name: 'checkpoints/m.safetensors',
      label: 'm',
      arch: 'sdxl',
      source: 'checkpoint',
      group: 'SDXL',
      runnable: true
    } as GenModel
    const o = opts({ seed: 7, width: 99_999, height: 333 })
    const meta = imageMeta(o, 0, archDimCaps(gm.arch))
    expect(meta.width).toBeLessThan(99_999)
    const wf = buildWorkflow(gm, { ...o, seed: meta.seed }, undefined, true)
    const latent = Object.values(wf).find((n) => 'width' in n.inputs)
    expect(latent?.inputs.width).toBe(meta.width)
    expect(latent?.inputs.height).toBe(meta.height)
    const sampler = Object.values(wf).find((n) => 'seed' in n.inputs)
    expect(sampler?.inputs.seed).toBe(7)
  })
})
