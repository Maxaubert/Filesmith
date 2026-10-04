import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { main, type CliDeps } from '../src/cli/main'
import type { CliIO } from '../src/cli/io'
import { fileInfoFromPath } from '../src/main/fileInfo'
import { pathState } from '../src/cli/inputs'
import { VERSION } from '../src/cli/version'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-main-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function harness(argv: string[], over: Partial<CliDeps['files']> = {}) {
  let out = ''
  let err = ''
  const io: CliIO = {
    argv,
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    stdoutTTY: false,
    stderrTTY: false,
    env: {},
    cwd: dir,
    readStdin: async () => '',
    signal: new AbortController().signal
  }
  const deps: CliDeps = {
    clock: () => 0,
    files: {
      queue: (emit) => ({
        add: (req) => {
          emit({ id: req.id, status: 'running' })
          emit({ id: req.id, status: 'done', outputPath: join(dir, 'out.webp') })
        },
        cancelAll: () => {}
      }),
      hasRar: () => false,
      readiness: async () => ({ ok: true }),
      resolveUpscaleModel: (v) => v,
      fileInfo: fileInfoFromPath,
      statOutput: () => ({ outSize: 1 }),
      pathState,
      mkdirp: () => {},
      ...over
    }
  }
  return {
    run: () => main(io, deps),
    out: () => out,
    err: () => err,
    events: () =>
      out
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
  }
}

describe('main', () => {
  it('--version prints the version', async () => {
    const h = harness(['--version'])
    expect(await h.run()).toBe(0)
    expect(h.out()).toBe(`${VERSION}\n`)
  })

  it('a usage error in JSON mode is an error event plus a summary on stdout, exit 2', async () => {
    const h = harness(['convert', 'a.png', '--json'])
    expect(await h.run()).toBe(2)
    expect(h.events().map((e) => [e.event, e.code ?? e.exitCode])).toEqual([
      ['error', 'USAGE'],
      ['summary', 2]
    ])
    expect(h.err()).toBe('')
  })

  it('a usage error in human mode goes to stderr with the usage line', async () => {
    const h = harness(['convert', 'a.png'])
    expect(await h.run()).toBe(2)
    expect(h.err()).toContain('filesmith: filesmith convert needs --to <format>')
    expect(h.err()).toContain('Usage: filesmith convert <files...> --to <format> [options]')
    expect(h.out()).toBe('')
  })

  it('runs a convert: run, start, done, summary', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    const h = harness(['convert', 'a.png', '--to', 'webp', '--json'])
    expect(await h.run()).toBe(0)
    expect(h.events().map((e) => e.event)).toEqual(['run', 'start', 'done', 'summary'])
    expect(h.events()[0]).toMatchObject({ v: 1, command: 'convert', dryRun: false, inputs: 1 })
  })

  it('a dry run plans and writes nothing', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    const h = harness(['convert', 'a.png', '--to', 'webp', '--dry-run', '--json'], {
      queue: () => {
        throw new Error('the queue must not be created in a dry run')
      }
    })
    expect(await h.run()).toBe(0)
    expect(h.events().map((e) => e.event)).toEqual(['run', 'plan', 'summary'])
    expect(h.events()[1]).toMatchObject({
      id: '1',
      ready: true,
      output: join(dir, 'a.webp'),
      outputKind: 'file'
    })
  })

  it('--out pointing at a file: exit 2 OUT_DIR_MISSING, nothing runs', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    writeFileSync(join(dir, 'taken'), 'x')
    const h = harness(['convert', 'a.png', '--to', 'webp', '--out', 'taken', '--json'])
    expect(await h.run()).toBe(2)
    expect(h.events().find((e) => e.event === 'error')).toMatchObject({ code: 'OUT_DIR_MISSING' })
    expect(h.events().some((e) => e.event === 'start')).toBe(false)
  })

  it('a missing --out folder is created only for a real run (O6)', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    const made: string[] = []
    const dry = harness(['convert', 'a.png', '--to', 'webp', '--out', 'new', '--dry-run'], {
      mkdirp: (p) => made.push(p)
    })
    expect(await dry.run()).toBe(0)
    expect(made).toEqual([])
    expect(dry.err()).toContain('warn: Would create the output folder')
    const real = harness(['convert', 'a.png', '--to', 'webp', '--out', 'new'], {
      mkdirp: (p) => made.push(p)
    })
    expect(await real.run()).toBe(0)
    expect(made).toEqual([join(dir, 'new')])
  })

  it('a requirement that fails for every input is exit 2 with the hint', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    const h = harness(['removebg', 'a.png', '--json'], {
      readiness: async () => ({
        ok: false,
        code: 'SETUP_REQUIRED',
        message: 'Background removal is not set up yet.',
        hint: 'filesmith setup removebg'
      })
    })
    expect(await h.run()).toBe(2)
    expect(h.events().find((e) => e.event === 'error')).toMatchObject({
      code: 'SETUP_REQUIRED',
      hint: 'filesmith setup removebg'
    })
  })

  it('only missing inputs: per-argument errors, then exit 2', async () => {
    const h = harness(['resize', 'nope.png', '--json'])
    expect(await h.run()).toBe(2)
    expect(h.events().map((e) => [e.event, e.code])).toEqual([
      ['run', undefined],
      ['error', 'NOT_FOUND'],
      ['error', 'NOT_FOUND'],
      ['summary', undefined]
    ])
  })
})
