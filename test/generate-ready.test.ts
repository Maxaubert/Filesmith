import { describe, expect, it } from 'vitest'
import { genBlockReason } from '../src/renderer/src/components/options/generate/genReady'

describe('genBlockReason', () => {
  it('does not block before the scan answers', () => {
    expect(genBlockReason(null)).toBeNull()
  })
  it('does not block when a model exists', () => {
    expect(genBlockReason({ models: [{}], comfyFolder: null })).toBeNull()
  })
  it('asks for a ComfyUI folder when none is set', () => {
    expect(genBlockReason({ models: [], comfyFolder: null })).toBe(
      'Choose your ComfyUI folder to generate'
    )
    expect(genBlockReason({ models: [] })).toBe('Choose your ComfyUI folder to generate')
  })
  it('asks for a model when the folder has none', () => {
    expect(genBlockReason({ models: [], comfyFolder: 'C:/ComfyUI' })).toBe(
      'Add an image model to generate'
    )
  })
})
