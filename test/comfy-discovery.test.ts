import * as fs from 'fs'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// comfyModelsBases() normally searches the user's drives; point it at a temp
// base so listCompanionPools / scanGenerationModels walk a known tree.
const h = vi.hoisted(() => ({ bases: [] as string[] }))
vi.mock('../src/main/comfy/discover', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/comfy/discover')>()
  return { ...real, comfyModelsBases: () => h.bases }
})

import {
  MODEL_WALK_MAX_DEPTH,
  resolveExtraPaths,
  resolveUpscaleDirs,
  scanModelFiles,
  walkModelFiles
} from '../src/main/comfy/discover'
import { listCompanionPools } from '../src/main/generate/archRegistry'
import { scanGenerationModels } from '../src/main/generate/models'
import { comfySearchRoots, probeDriveRoots, resetDriveRootsCache } from '../src/main/comfy/roots'

const root = mkdtempSync(join(tmpdir(), 'filesmith-discovery-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

let n = 0
function fresh(): string {
  const d = join(root, `case${++n}`)
  mkdirSync(d, { recursive: true })
  return d
}
function touch(p: string): void {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, 'x')
}
const anyModel = (name: string): boolean => /\.(pth|safetensors)$/i.test(name)

describe('walkModelFiles', () => {
  it('ends on a junction that points back at its parent, listing each model once', () => {
    const up = join(fresh(), 'upscale_models')
    touch(join(up, '4x-A.pth'))
    touch(join(up, 'sub', 'B.safetensors'))
    symlinkSync(up, join(up, 'link'), 'junction')

    const walked = walkModelFiles(up, { accept: anyModel })
    expect(walked.map((f) => f.rel).sort()).toEqual(['4x-A.pth', 'sub/B.safetensors'])

    const files = scanModelFiles([up])
    expect(files.sort()).toEqual(
      [resolve(join(up, '4x-A.pth')), resolve(join(up, 'sub', 'B.safetensors'))].sort()
    )
  })

  it('de-duplicates by real path when a dir is reached twice through a junction', () => {
    const base = fresh()
    const real = join(base, 'real')
    touch(join(real, 'M.pth'))
    symlinkSync(real, join(base, 'alias'), 'junction')
    // Two dirs, one the junction of the other: one file, not two.
    expect(scanModelFiles([real, join(base, 'alias')])).toEqual([resolve(join(real, 'M.pth'))])
  })

  it('caps the depth: the root is depth 0 and depth MAX is still read', () => {
    const top = fresh()
    const deepest = Array.from({ length: MODEL_WALK_MAX_DEPTH }, (_, i) => `d${i + 1}`)
    touch(join(top, ...deepest, 'ok.pth'))
    touch(join(top, ...deepest, 'too-deep', 'no.pth'))
    const rels = walkModelFiles(top, { accept: anyModel }).map((f) => f.rel)
    expect(rels).toEqual([[...deepest, 'ok.pth'].join('/')])
    expect(walkModelFiles(top, { accept: anyModel, maxDepth: 1 })).toEqual([])
  })

  it('survives a missing root and returns a stable, name-ordered list', () => {
    expect(walkModelFiles(join(root, 'nope'), { accept: anyModel })).toEqual([])
    const top = fresh()
    for (const f of ['b.pth', 'A.pth', 'c/z.pth', 'C.pth']) touch(join(top, f))
    const rels = walkModelFiles(top, { accept: anyModel }).map((f) => f.rel)
    expect(rels).toEqual(['A.pth', 'b.pth', 'c/z.pth', 'C.pth'])
    expect(walkModelFiles(top, { accept: anyModel }).map((f) => f.rel)).toEqual(rels)
  })
})

describe('callers keep their own semantics on a plain tree', () => {
  it('scanModelFiles: absolute paths, model extensions only (.pt excluded)', () => {
    const up = fresh()
    touch(join(up, 'a.pth'))
    touch(join(up, 'b.ckpt'))
    touch(join(up, 'c.pt'))
    touch(join(up, 'notes.txt'))
    expect(scanModelFiles([up]).sort()).toEqual(
      [resolve(join(up, 'a.pth')), resolve(join(up, 'b.ckpt'))].sort()
    )
  })

  it('listCompanionPools: ComfyUI-relative names, base is the subdir, .pt included', () => {
    const base = fresh()
    touch(join(base, 'text_encoders', 't5', 'enc.safetensors'))
    touch(join(base, 'clip', 'clip_l.pt'))
    touch(join(base, 'vae', 'ae.sft'))
    touch(join(base, 'vae', 'readme.md'))
    h.bases = [base]
    try {
      const { encoders, vaes } = listCompanionPools()
      expect(encoders).toEqual([
        {
          rel: 't5/enc.safetensors',
          abs: resolve(join(base, 'text_encoders', 't5', 'enc.safetensors')),
          base: join(base, 'text_encoders')
        },
        {
          rel: 'clip_l.pt',
          abs: resolve(join(base, 'clip', 'clip_l.pt')),
          base: join(base, 'clip')
        }
      ])
      expect(vaes.map((v) => v.rel)).toEqual(['ae.sft'])
    } finally {
      h.bases = []
    }
  })

  it('walkModels (via scanGenerationModels): de-duplicated by relative name across bases', () => {
    const b1 = fresh()
    const b2 = fresh()
    touch(join(b1, 'checkpoints', 'sub', 'Model.ckpt'))
    touch(join(b2, 'checkpoints', 'SUB', 'model.ckpt')) // same name, other case
    touch(join(b2, 'checkpoints', 'other.ckpt'))
    h.bases = [b1, b2]
    try {
      const ckpts = scanGenerationModels().models.filter((m) => m.source === 'checkpoint')
      expect(ckpts.map((m) => m.name).sort()).toEqual(['other.ckpt', 'sub/Model.ckpt'])
      expect(ckpts.find((m) => m.name === 'sub/Model.ckpt')?.baseDir).toBe(b1)
    } finally {
      h.bases = []
    }
  })
})

describe('extra_model_paths.yaml', () => {
  function setup(yaml: string, dirs: string[]): { comfy: string; out: string[] } {
    const comfy = fresh()
    for (const d of dirs) mkdirSync(join(comfy, d), { recursive: true })
    const cfg = join(comfy, 'extra_model_paths.yaml')
    writeFileSync(cfg, yaml)
    return { comfy, out: resolveExtraPaths(cfg).map((p) => resolve(p)) }
  }

  it('reads a block scalar, one path per indented line (the a111 example)', () => {
    const { comfy, out } = setup(
      [
        'a111:',
        '    base_path: ./sd',
        '    # a comment',
        '    upscale_models: |',
        '        models/ESRGAN',
        '',
        '        models/RealESRGAN',
        '        models/SwinIR',
        '    embeddings: embeddings',
        ''
      ].join('\n'),
      []
    )
    expect(out).toEqual(
      ['ESRGAN', 'RealESRGAN', 'SwinIR'].map((m) => resolve(join(comfy, 'sd', 'models', m)))
    )
  })

  it('reads list items and strips quotes and trailing comments', () => {
    const { comfy, out } = setup(
      [
        'shared:',
        '  base_path: "./base"',
        '  upscale_models:',
        '    - "up1"',
        "    - 'up2' # second",
        '  vae: vae',
        ''
      ].join('\n'),
      []
    )
    expect(out).toEqual([resolve(join(comfy, 'base', 'up1')), resolve(join(comfy, 'base', 'up2'))])
  })

  it('resolves a relative base_path against the yaml folder, not the cwd', () => {
    const { comfy, out } = setup('x:\r\n  base_path: rel\r\n  upscale_models: up\r\n', [])
    expect(out).toEqual([resolve(join(comfy, 'rel', 'up'))])
  })

  it("does not carry one section's base_path into the next", () => {
    const { comfy, out } = setup(
      [
        'one:',
        '  base_path: /abs/one',
        '  upscale_models: u1',
        'two:',
        '  upscale_models: u2',
        ''
      ].join('\n'),
      []
    )
    expect(out).toEqual([resolve(join('/abs/one', 'u1')), resolve(join(comfy, 'u2'))])
  })

  it('still reads the single-line form, end to end through resolveUpscaleDirs', () => {
    const comfy = fresh()
    const shared = join(comfy, 'shared')
    mkdirSync(join(shared, 'upscale_models'), { recursive: true })
    mkdirSync(join(shared, 'ESRGAN'), { recursive: true })
    writeFileSync(
      join(comfy, 'extra_model_paths.yaml'),
      `comfyui:\n    base_path: ${shared.replace(/\\/g, '/')}\n    upscale_models: upscale_models/\n` +
        `a111:\n    base_path: ${shared.replace(/\\/g, '/')}\n    upscale_models: |\n      ESRGAN\n`
    )
    const dirs = resolveUpscaleDirs(comfy)
    expect(dirs).toContain(resolve(join(shared, 'upscale_models')))
    expect(dirs).toContain(resolve(join(shared, 'ESRGAN')))
  })
})

describe.runIf(process.platform === 'win32')('drive roots probe (never blocks main)', () => {
  const drives = (r: string[]): string[] => r.filter((x) => /^[A-Z]:\\$/.test(x))

  beforeEach(() => resetDriveRootsCache())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetDriveRootsCache()
  })

  it('probes once, then answers from the cache with no new fs probing', async () => {
    const stat = vi.spyOn(fs.promises, 'stat').mockImplementation((async (p: fs.PathLike) => {
      if (p === 'C:\\' || p === 'Q:\\') return { isDirectory: () => true } as fs.Stats
      throw new Error('ENOENT')
    }) as typeof fs.promises.stat)

    // First call: answers at once with the system drive, probe runs behind it.
    const first = drives(comfySearchRoots())
    expect(first).toHaveLength(1)
    await probeDriveRoots()
    const probes = stat.mock.calls.length
    expect(probes).toBe(24) // C: to Z:

    expect(drives(comfySearchRoots())).toEqual(['C:\\', 'Q:\\'])
    expect(drives(comfySearchRoots())).toEqual(['C:\\', 'Q:\\'])
    expect(stat.mock.calls.length).toBe(probes)
  })

  it('a drive that never answers does not block and is not probed again', async () => {
    vi.useFakeTimers()
    const stat = vi.spyOn(fs.promises, 'stat').mockImplementation(((p: fs.PathLike) =>
      p === 'Z:\\'
        ? new Promise<fs.Stats>(() => {}) // an offline NAS: never settles
        : Promise.reject(new Error('ENOENT'))) as typeof fs.promises.stat)

    const t0 = Date.now()
    const roots = comfySearchRoots() // returns synchronously
    expect(Date.now() - t0).toBe(0)
    expect(drives(roots)).toHaveLength(1)

    const done = probeDriveRoots()
    await vi.advanceTimersByTimeAsync(1500)
    expect(await done).toEqual([])

    // A later refresh skips the letter that hung.
    const before = stat.mock.calls.length
    await probeDriveRoots()
    expect(stat.mock.calls.length - before).toBe(23)
    expect(stat.mock.calls.slice(before).some(([p]) => p === 'Z:\\')).toBe(false)
  })
})
