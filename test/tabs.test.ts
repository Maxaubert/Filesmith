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

  it('groups tool cards by what they act on', () => {
    expect(toolGroups().map((g) => g.name)).toEqual(['PDF', 'Archives'])
  })

  it('keeps cross-group conversions in Tools, not Convert', () => {
    expect(toolCardById('archive-to-pdf')?.tool).toBe('archive')
    expect(toolCardById('archive-to-pdf')?.opKey).toBe('to-pdf')
    expect(toolCardById('pdf-to-cbz')?.opKey).toBe('from-pdf')
    expect(toolCardById('archive-extract')?.opKey).toBe('extract')
  })

  it('routes an archive Convert to the archive engine, not the convert one', () => {
    // The tab-to-tool mapping is not 1:1: repacking a .cbz is the archive tool
    // with op 'repack', even though the tab is Convert.
    expect(engineFor('convert', 'archive')).toEqual({ tool: 'archive', op: 'repack' })
    expect(engineFor('convert', 'image')).toEqual({ tool: 'convert' })
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
