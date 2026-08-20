import { describe, expect, it } from 'vitest'
import { bgModelOf, buildCompositeArgs, buildRembgArgs } from '../src/main/tools/removebg'
import { BG_MODEL_VALUES, fillRgba, normalizeAlpha } from '../src/shared/removebg'

const base = { bgModel: 'birefnet-general' }

describe('buildRembgArgs', () => {
  it('turns every quality option on by default', () => {
    // The UI exposes only the background choice, so the default invocation is
    // the best-quality one: alpha matting and mask clean-up both on.
    expect(buildRembgArgs('in.png', 'out.png', base)).toEqual([
      'i',
      '-m',
      'birefnet-general',
      '-a',
      '-af',
      '240',
      '-ab',
      '10',
      '-ae',
      '10',
      '-ppm',
      'in.png',
      'out.png'
    ])
  })

  it('still honours an explicit opt-out', () => {
    const args = buildRembgArgs('in.png', 'out.png', { ...base, bgAlpha: false })
    expect(args).not.toContain('-a')
    expect(args).not.toContain('-af')
  })

  it('emits all four alpha-matting flags together', () => {
    const args = buildRembgArgs('in.png', 'out.png', {
      ...base,
      bgAlpha: true,
      bgAlphaFg: 240,
      bgAlphaBg: 10,
      bgErode: 10
    })
    expect(args).toContain('-a')
    expect(args.slice(args.indexOf('-af'), args.indexOf('-af') + 2)).toEqual(['-af', '240'])
    expect(args.slice(args.indexOf('-ab'), args.indexOf('-ab') + 2)).toEqual(['-ab', '10'])
    expect(args.slice(args.indexOf('-ae'), args.indexOf('-ae') + 2)).toEqual(['-ae', '10'])
  })

  it('passes a background colour as four bare ints', () => {
    const args = buildRembgArgs('in.png', 'out.png', { ...base, bgFill: 'white' })
    const i = args.indexOf('-bgc')
    expect(args.slice(i, i + 5)).toEqual(['-bgc', '255', '255', '255', '255'])
  })

  it('sends no -bgc for a transparent background', () => {
    expect(buildRembgArgs('in.png', 'out.png', { ...base, bgFill: 'transparent' })).not.toContain(
      '-bgc'
    )
  })

  it('drops the background colour when only the mask is wanted', () => {
    const args = buildRembgArgs('in.png', 'out.png', {
      ...base,
      bgOnlyMask: true,
      bgFill: 'green'
    })
    expect(args).toContain('-om')
    expect(args).not.toContain('-bgc')
  })

  it('can turn post-processing off', () => {
    expect(buildRembgArgs('in.png', 'out.png', { ...base, bgPostProcess: false })).not.toContain(
      '-ppm'
    )
  })
})

describe('model allowlist', () => {
  // rembg exposes 19 sessions; these carry non-commercial or unusable terms and
  // must be unreachable no matter what the renderer sends.
  it.each(['bria-rmbg', 'u2net_human_seg', 'isnet-anime', 'sam', 'u2net_cloth_seg', 'silueta'])(
    'refuses to emit %s',
    (banned) => {
      expect(bgModelOf({ bgModel: banned })).toBe('birefnet-general')
      expect(buildRembgArgs('in.png', 'out.png', { bgModel: banned })).not.toContain(banned)
    }
  )

  it('passes through every allowed model', () => {
    for (const m of BG_MODEL_VALUES) expect(bgModelOf({ bgModel: m })).toBe(m)
  })

  it('falls back to the default for junk', () => {
    expect(bgModelOf({})).toBe('birefnet-general')
    expect(bgModelOf({ bgModel: '' })).toBe('birefnet-general')
  })
})

describe('normalizeAlpha', () => {
  it('keeps a valid pair untouched', () => {
    expect(normalizeAlpha(240, 10, 10)).toEqual({ fg: 240, bg: 10, erode: 10 })
  })

  it('separates an inverted pair so the trimap has an unknown band', () => {
    const r = normalizeAlpha(10, 240, 10)
    expect(r.fg).toBeGreaterThan(r.bg)
  })

  it('separates an equal pair', () => {
    const r = normalizeAlpha(100, 100, 5)
    expect(r.fg).toBeGreaterThan(r.bg)
  })

  it('clamps out-of-range values', () => {
    expect(normalizeAlpha(999, -5, 999).fg).toBeLessThanOrEqual(255)
    expect(normalizeAlpha(999, -5, 999).bg).toBeGreaterThanOrEqual(0)
    expect(normalizeAlpha(240, 10, 999).erode).toBe(40)
  })
})

describe('custom image backdrop', () => {
  it('leaves the cutout transparent so the backdrop can show through', () => {
    // rembg has no background-image flag; filling with a colour here would
    // paint over exactly the pixels the composite pass needs to see through.
    expect(fillRgba('image', '#ff0000')).toBeNull()
    expect(buildRembgArgs('in.png', 'out.png', { ...base, bgFill: 'image' })).not.toContain('-bgc')
  })

  it('cover-fits the backdrop instead of stretching it', () => {
    const args = buildCompositeArgs('bg.jpg', 'cut.png', 'out.png', 500, 667)
    // '^' = scale to COVER the frame; without it a wide backdrop letterboxes,
    // and with '!' it distorts.
    expect(args).toContain('500x667^')
    expect(args).toContain('-gravity')
    expect(args).toContain('center')
    expect(args.slice(args.indexOf('-extent'), args.indexOf('-extent') + 2)).toEqual([
      '-extent',
      '500x667'
    ])
    expect(args).toContain('-composite')
  })

  it('reads only the first frame of a multi-frame backdrop', () => {
    expect(buildCompositeArgs('bg.gif', 'cut.png', 'out.png', 10, 10)[0]).toBe('bg.gif[0]')
  })

  it('puts the cutout on top of the backdrop', () => {
    const args = buildCompositeArgs('bg.jpg', 'cut.png', 'out.png', 10, 10)
    expect(args.indexOf('bg.jpg[0]')).toBeLessThan(args.indexOf('cut.png'))
  })
})

describe('fillRgba', () => {
  it('returns null for transparent (so no flag is sent)', () => {
    expect(fillRgba('transparent', '#ffffff')).toBeNull()
  })

  it('maps the presets', () => {
    expect(fillRgba('white', '')).toEqual([255, 255, 255, 255])
    expect(fillRgba('black', '')).toEqual([0, 0, 0, 255])
  })

  it('parses a custom hex colour with or without the hash', () => {
    expect(fillRgba('custom', '#ff8800')).toEqual([255, 136, 0, 255])
    expect(fillRgba('custom', 'ff8800')).toEqual([255, 136, 0, 255])
  })

  it('treats an unparseable custom colour as transparent rather than guessing', () => {
    expect(fillRgba('custom', 'nonsense')).toBeNull()
  })
})
