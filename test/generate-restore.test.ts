import { describe, expect, it } from 'vitest'
import { isRestoreName } from '../src/renderer/src/components/options/generate/restore'

describe('isRestoreName', () => {
  it('flags restoration checkpoints so Generate does not auto-pick them', () => {
    expect(isRestoreName('SUPIR-v0Q')).toBe(true)
  })
  it('leaves ordinary text-to-image models alone', () => {
    expect(isRestoreName('sd_xl_base_1.0')).toBe(false)
  })
})
