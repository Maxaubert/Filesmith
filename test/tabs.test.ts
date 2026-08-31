import { describe, expect, it } from 'vitest'
import {
  TABS,
  TOOL_CARDS,
  engineFor,
  tabAccepts,
  tabById,
  toolCardById,
  toolGroups
} from '@shared/tabs'

describe('tab model', () => {
  it('lists the seven verbs in rail order', () => {
    expect(TABS.map((t) => t.id)).toEqual([
      'convert',
      'compress',
      'resize',
      'upscale',
      'removebg',
      'generate',
      'tools'
    ])
  })

  it('accepts the kinds each verb can actually do', () => {
    expect(tabAccepts('convert', 'image')).toBe(true)
    expect(tabAccepts('convert', 'archive')).toBe(true)
    // PDF is a real convert source today: familyFormats puts pdf, document and
    // text in one family, so PDF -> DOCX/TXT/RTF works.
    expect(tabAccepts('convert', 'pdf')).toBe(true)
    expect(tabAccepts('compress', 'pdf')).toBe(true)
    expect(tabAccepts('compress', 'archive')).toBe(false)
    expect(tabAccepts('upscale', 'image')).toBe(true)
    expect(tabAccepts('upscale', 'video')).toBe(false)
    expect(tabAccepts('resize', 'image')).toBe(true)
    expect(tabAccepts('removebg', 'image')).toBe(true)
  })

  it('gives Generate no input kinds at all', () => {
    expect(tabById('generate').kinds).toEqual([])
    expect(tabAccepts('generate', 'image')).toBe(false)
  })

  it('routes every tab to a real engine tool', () => {
    const tools = [
      'convert',
      'compress',
      'resize',
      'upscale',
      'removebg',
      'generate',
      'archive',
      'pdf'
    ]
    for (const t of TABS) expect(tools, t.id).toContain(t.tool)
  })

  it('keeps only the PDF one-offs in Tools', () => {
    // Anything that turns a file into another FILE is an ordinary Convert and
    // belongs on the Convert tab, where people go looking for it.
    expect(toolGroups().map((g) => g.name)).toEqual(['PDF'])
    expect(toolCardById('archive-to-pdf')).toBeUndefined()
    expect(toolCardById('pdf-to-cbz')).toBeUndefined()
    expect(toolCardById('archive-extract')).toBeUndefined()
  })

  it('routes a Convert by its TARGET, not just its source', () => {
    const cbz = { kind: 'archive' as const, ext: '.cbz' }
    const pdf = { kind: 'pdf' as const, ext: '.pdf' }
    const png = { kind: 'image' as const, ext: '.png' }
    expect(engineFor('convert', 'archive', null, cbz, '.cb7')).toEqual({
      tool: 'archive',
      op: 'repack'
    })
    // Same source, different target, different verb entirely.
    expect(engineFor('convert', 'archive', null, cbz, '.pdf')).toEqual({
      tool: 'archive',
      op: 'to-pdf'
    })
    expect(engineFor('convert', 'doc', null, pdf, '.cbz')).toEqual({
      tool: 'archive',
      op: 'from-pdf'
    })
    expect(engineFor('convert', 'doc', null, pdf, '.docx')).toEqual({ tool: 'convert' })
    expect(engineFor('convert', 'image', null, png, '.webp')).toEqual({ tool: 'convert' })
    expect(engineFor('compress', 'doc')).toEqual({ tool: 'compress' })
  })

  it('lets a tool card name its own tool and verb', () => {
    expect(engineFor('tools', 'pdf', toolCardById('pdf-merge'))).toEqual({
      tool: 'pdf',
      op: 'merge'
    })
  })

  it('gives every tool card a unique id and an accepted kind', () => {
    const ids = TOOL_CARDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of TOOL_CARDS) expect(c.kinds.length, c.id).toBeGreaterThan(0)
  })
})
