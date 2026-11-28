import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { planJobs, type PlanEnv } from '../src/cli/plan'
import { buildOptions } from '../src/cli/options'
import { findCommand } from '../src/cli/catalog'
import { UsageError } from '../src/cli/exit'
import { pickComfyModel } from '../src/cli/deps'
import { buildFormats, runFormats, type FormatsDeps } from '../src/cli/commands/formats'
import { parseArgv } from '../src/cli/parse'
import { fileKind } from '@shared/fileKind'
import type { FileInfo, JobOptions } from '@shared/types'
import type { Reporter } from '../src/cli/events'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-clifix-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = (name: string): FileInfo => {
  writeFileSync(join(dir, name), 'x')
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return { path: join(dir, name), name, ext, kind: fileKind(ext), size: 100 }
}
const built = (options: JobOptions) => ({ options, warnings: [], explicit: new Set<string>() })
const env: PlanEnv = { hasRar: true, readiness: { ok: true } }
const FINISH = {
  replaceOriginals: true,
  rename: true,
  renamePattern: '{name}-web',
  keepDates: false,
  stripMetadata: true
}

describe('convert plan keeps the output flags', () => {
  it('normal convert', () => {
    const r = planJobs('convert', [file('a.heic')], built({ format: '.jpg', ...FINISH }), env)
    expect(r.jobs[0].tool).toBe('convert')
    expect(r.jobs[0].options).toMatchObject(FINISH)
  })
  it('archive-routed convert', () => {
    const o = { format: '.7z', keepDates: true, stripMetadata: true }
    const r = planJobs('convert', [file('a.zip')], built(o), env)
    expect(r.jobs[0].tool).toBe('archive')
    expect(r.jobs[0].options).toMatchObject(o)
  })
})

describe('archive-routed convert refuses --replace, --rename and --dates', () => {
  const plan = (inputs: string[], flags: Record<string, string | boolean>) => {
    const cmd = findCommand(['convert'])!
    const b = buildOptions(cmd, flags, { cwd: dir, pathState: () => 'missing' })
    return planJobs('convert', inputs.map(file), b, env)
  }
  const cases: [string, Record<string, string | boolean>][] = [
    ['--replace', { replace: true }],
    ['--rename', { rename: '{name}-web' }],
    ['--dates', { dates: 'today' }],
    ['--dates', { dates: 'keep' }]
  ]

  it.each(cases)('%s throws a UsageError (%o)', (flag, flags) => {
    for (const [input, to] of [
      ['a.zip', '7z'],
      ['b.cbz', 'pdf'],
      ['c.pdf', 'cbz']
    ]) {
      const run = () => plan([input], { to, ...flags })
      expect(run).toThrow(UsageError)
      expect(run).toThrow(`${flag} cannot be used with archive conversions (${input})`)
    }
  })

  it('names every typed flag', () => {
    expect(() => plan(['a.zip'], { to: '7z', rename: 'x', dates: 'today' })).toThrow(
      /^--rename, --dates cannot .* without them\.$/
    )
  })

  it('the --dates default and --no-replace do not count as typed', () => {
    const r = plan(['a.zip'], { to: '7z', replace: false })
    expect(r.jobs[0]).toMatchObject({ tool: 'archive', state: 'ready' })
  })

  it('a mixed batch is refused as a whole and names only the archive files', () => {
    expect(() => plan(['doc.docx', 'a.zip'], { to: 'pdf', replace: true })).toThrow(
      /\(a\.zip\)\. Nothing was converted/
    )
  })

  it('a mixed batch without the flags still plans both routes', () => {
    const r = plan(['doc.docx', 'a.zip'], { to: 'pdf' })
    expect(r.jobs.map((j) => [j.tool, j.state])).toEqual([
      ['convert', 'ready'],
      ['archive', 'ready']
    ])
  })

  it('skipped and unsupported files do not count as archive-routed', () => {
    const mixed = plan(['a.png', 'c.mp3'], { to: 'jpg', replace: true, dates: 'today' })
    expect(mixed.jobs.map((j) => j.state)).toEqual(['ready', 'error'])
    const same = plan(['x.cbz'], { to: 'cbz', replace: true })
    expect(same.jobs[0].state).toBe('skip')
  })
})

const fdeps = (models: { path: string; name: string }[]): FormatsDeps =>
  ({
    hasRar: () => false,
    ncnnModels: () => [],
    comfyModels: () => models.map((m) => ({ ...m, scale: 4, badge: 'verified' })),
    comfyReady: () => true,
    pidInstalled: () => false,
    cudaOk: async () => false,
    rembgReady: () => true,
    generationModels: () => []
  }) as unknown as FormatsDeps

const P = (...p: string[]): string => resolve('/m', ...p)

describe('ambiguous comfy model names', () => {
  const models = [
    { path: P('a', 'x.pth'), name: 'x' },
    { path: P('b', 'X.pth'), name: 'X' },
    { path: P('b', 'y.pth'), name: 'y' }
  ]
  it('formats lists duplicate names by full path and unique ones short', async () => {
    const f = await buildFormats(fdeps(models))
    const values = (f.upscale.models as { value: string }[])
      .map((m) => m.value)
      .filter((v) => v.startsWith('comfy:'))
    expect(values).toEqual([`comfy:${P('a', 'x.pth')}`, `comfy:${P('b', 'X.pth')}`, 'comfy:y.pth'])
  })
  it('pickComfyModel: exact path wins, ambiguous name throws with paths', () => {
    expect(pickComfyModel(models, P('b', 'X.pth'))).toBe(models[1])
    expect(pickComfyModel(models, 'y')).toBe(models[2])
    expect(() => pickComfyModel(models, 'x')).toThrow(/ambiguous/)
    expect(pickComfyModel(models, 'nope')).toBeUndefined()
  })
})

describe('formats with inherited keys', () => {
  it('rejects toString and constructor like an unknown verb', async () => {
    const r: Reporter = { emit: () => {}, text: () => {}, close: () => {} }
    for (const w of ['toString', 'constructor'])
      await expect(runFormats(parseArgv(['formats', w]), r, fdeps([]))).rejects.toThrow(
        /Unknown verb for formats/
      )
  })
})
