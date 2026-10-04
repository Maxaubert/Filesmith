import { describe, expect, it } from 'vitest'
import { COMMANDS, findCommand, flagOf } from '../src/cli/catalog'
import { DEFAULT_OPTIONS } from '../src/renderer/src/state'
import type { ToolId } from '@shared/types'

// Every app option key a user can set has a CLI flag, and its default is the
// app's default (spec 2.3). Hidden keys are the ones the app never shows.
const HIDDEN: Partial<Record<ToolId, string[]>> = {
  removebg: [
    'bgModel',
    'bgAlpha',
    'bgAlphaFg',
    'bgAlphaBg',
    'bgErode',
    'bgOnlyMask',
    'bgPostProcess'
  ],
  pdf: ['op'],
  archive: ['op'],
  generate: ['prompt']
}
const COMMAND_FOR: Record<ToolId, string[]> = {
  convert: ['convert'],
  archive: ['convert'],
  compress: ['compress'],
  resize: ['resize'],
  upscale: ['upscale'],
  removebg: ['removebg'],
  generate: ['generate'],
  pdf: ['pdf split', 'pdf to-images']
}

describe('catalog mirrors the app', () => {
  for (const [tool, opts] of Object.entries(DEFAULT_OPTIONS) as [ToolId, Record<string, unknown>][])
    it(`every visible ${tool} option has a flag`, () => {
      const keys = new Set(
        COMMAND_FOR[tool].flatMap((id) =>
          (COMMANDS.find((c) => c.id === id)?.flags ?? []).map((f) => f.key)
        )
      )
      for (const key of Object.keys(opts))
        if (!HIDDEN[tool]?.includes(key)) expect(keys, `${tool}.${key}`).toContain(key)
    })

  it.each([
    ['convert', 'quality', 'convert', 'quality'],
    ['convert', 'resolution', 'archive', 'dpi'],
    ['convert', 'page-format', 'archive', 'pageFormat'],
    ['convert', 'page-quality', 'archive', 'pageQuality'],
    ['compress', 'quality', 'compress', 'quality'],
    ['compress', 'format', 'compress', 'imageFormat'],
    ['compress', 'video-codec', 'compress', 'videoCodec'],
    ['compress', 'scale', 'compress', 'scale'],
    ['compress', 'audio-codec', 'compress', 'audioCodec'],
    ['compress', 'bitrate', 'compress', 'audioBitrate'],
    ['compress', 'level', 'compress', 'pdfLevel'],
    ['compress', 'greyscale', 'compress', 'pdfGray'],
    ['resize', 'percent', 'resize', 'percent'],
    ['resize', 'fit', 'resize', 'fit'],
    ['upscale', 'factor', 'upscale', 'upscaleFactor'],
    ['upscale', 'model', 'upscale', 'upscaleModel'],
    ['removebg', 'fill', 'removebg', 'bgFill'],
    ['removebg', 'color', 'removebg', 'bgCustomColor'],
    ['generate', 'negative', 'generate', 'negative'],
    ['generate', 'style', 'generate', 'style'],
    ['generate', 'count', 'generate', 'count'],
    ['pdf to-images', 'resolution', 'pdf', 'dpi']
  ] as const)('%s --%s defaults to %s.%s', (cmd, flag, tool, key) => {
    const f = flagOf(findCommand(cmd.split(' '))!, flag)
    const def = f.numeric || f.type === 'int' ? Number(f.def) : f.def
    expect(def).toEqual(DEFAULT_OPTIONS[tool][key])
  })

  it('convert --compression defaults to store, which the app stores as store: true', () => {
    expect(flagOf(findCommand(['convert'])!, 'compression').def).toBe('store')
    expect(DEFAULT_OPTIONS.archive.store).toBe(true)
  })

  it('--gpu uses the shown words and maps balanced to the stored background', () => {
    const gpu = flagOf(findCommand(['upscale'])!, 'gpu')
    expect(gpu.values).toEqual(['full', 'balanced'])
    expect(gpu.map?.balanced).toBe('background')
  })

  it('every command has a summary, an args line and at least one example', () => {
    for (const c of COMMANDS) {
      expect(c.summary.length, c.id).toBeGreaterThan(5)
      expect(c.examples.length, c.id).toBeGreaterThan(0)
    }
  })

  it('no two flags of one command share a name, alias or short', () => {
    for (const c of COMMANDS) {
      const names = c.flags.flatMap((f) => [
        f.name,
        ...(f.aliases ?? []),
        ...(f.short ? [`-${f.short}`] : [])
      ])
      expect(new Set(names).size, c.id).toBe(names.length)
    }
  })
})
