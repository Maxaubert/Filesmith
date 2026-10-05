import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import type { ChildProcess } from 'child_process'
import { LineSplitter } from '../src/main/console/lines'
import { startCliRun, type RunDeps } from '../src/main/console/runCli'
import { resolveCd } from '../src/main/console/dirs'
import { validateRun } from '../src/main/console/validate'

describe('LineSplitter', () => {
  it('emits whole lines across chunks, drops CR, flushes the rest', () => {
    const got: string[] = []
    const s = new LineSplitter((l) => got.push(l))
    s.push('ok  a.png\r\nok  b')
    s.push('.png\n3 files')
    expect(got).toEqual(['ok  a.png', 'ok  b.png'])
    s.flush()
    expect(got).toEqual(['ok  a.png', 'ok  b.png', '3 files'])
  })
})

function fakeChild() {
  const c = Object.assign(new EventEmitter(), {
    pid: 4242,
    connected: true,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    send: vi.fn(() => true)
  })
  return c
}

function setup() {
  const child = fakeChild()
  const timers: (() => void)[] = []
  const deps: RunDeps = {
    fork: vi.fn(() => child as unknown as ChildProcess),
    kill: vi.fn(),
    later: (fn) => {
      timers.push(fn)
      return () => {}
    }
  }
  const out: unknown[] = []
  const h = startCliRun(
    {
      script: 'X:\\out\\main\\cli.js',
      argv: ['convert', 'a b.png', '&', '--to', 'webp'],
      cwd: 'D:\\P',
      emit: (e) => out.push(e)
    },
    deps
  )
  return { child, deps, out, h, timers }
}

describe('startCliRun', () => {
  it('forks cli.js as Node with the argv array, no shell, the folder as cwd', () => {
    const { deps } = setup()
    const [script, argv, opts] = (deps.fork as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(script).toBe('X:\\out\\main\\cli.js')
    expect(argv).toEqual(['convert', 'a b.png', '&', '--to', 'webp'])
    expect(opts).toMatchObject({
      cwd: 'D:\\P',
      execArgv: ['--use-system-ca'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true
    })
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(opts.shell).toBeUndefined()
  })
  it('streams lines and events, resolves with the exit code', async () => {
    const { child, out, h } = setup()
    child.stdout.write('ok      a.png -> a.webp\n')
    child.stderr.write('filesmith: oops\n')
    // Stream data arrives on a later tick; IPC messages are emitted at once.
    await new Promise((r) => setImmediate(r))
    child.emit('message', '{"v":1,"event":"done","output":"D:\\\\P\\\\a.webp"}\n')
    child.emit('close', 0, null)
    expect(await h.done).toBe(0)
    expect(out).toEqual([
      { kind: 'out', text: 'ok      a.png -> a.webp' },
      { kind: 'err', text: 'filesmith: oops' },
      { kind: 'event', ev: { v: 1, event: 'done', output: 'D:\\P\\a.webp' } },
      { kind: 'exit', code: 0 }
    ])
  })
  it('cancel: interrupt, interrupt again, then a tree kill after the timer', async () => {
    const { child, deps, h, timers } = setup()
    h.cancel()
    expect(child.send).toHaveBeenCalledWith('interrupt')
    expect(timers).toHaveLength(0)
    h.cancel()
    expect(child.send).toHaveBeenCalledTimes(2)
    expect(timers).toHaveLength(1)
    timers[0]()
    expect(deps.kill).toHaveBeenCalledWith(4242)
    // taskkill /F exits the tree with code 1; a stopped run still reports 130.
    child.emit('close', 1, null)
    expect(await h.done).toBe(130)
  })
  it('a spawn error ends the run with exit 1 and the message', async () => {
    const { child, out, h } = setup()
    child.emit('error', new Error('ENOENT'))
    expect(await h.done).toBe(1)
    expect(out).toContainEqual({ kind: 'err', text: 'filesmith: could not start: ENOENT' })
  })
})

describe('resolveCd', () => {
  const home = 'C:\\Users\\Ove'
  it('resolves relative, parent, home, a bare drive and absolute paths', () => {
    expect(resolveCd('D:\\Photos\\Trip', '..', home)).toBe('D:\\Photos')
    expect(resolveCd('D:\\Photos', 'Trip\\Day 1', home)).toBe('D:\\Photos\\Trip\\Day 1')
    expect(resolveCd('D:\\Photos', '~', home)).toBe(home)
    expect(resolveCd('D:\\Photos', '~\\Downloads', home)).toBe('C:\\Users\\Ove\\Downloads')
    expect(resolveCd('D:\\Photos', 'E:', home)).toBe('E:\\')
    expect(resolveCd('D:\\Photos', 'C:\\Temp', home)).toBe('C:\\Temp')
  })
})

describe('validateRun', () => {
  const ok = (p: string): boolean => p === 'D:\\P'
  it('refuses non-filesmith lines and bad folders before anything starts', () => {
    expect(validateRun('calc', 'D:\\P', ok)).toEqual({
      ok: false,
      error:
        '`calc` is not a filesmith command. This console only runs filesmith; use a terminal for anything else.'
    })
    expect(validateRun('doctor', 'relative', ok)).toEqual({
      ok: false,
      error: 'The console folder does not exist.'
    })
    expect(validateRun('doctor', 'D:\\P', ok)).toEqual({ ok: true, argv: ['doctor'], cwd: 'D:\\P' })
    expect(validateRun(['calc'], 'D:\\P', ok).ok).toBe(false)
    expect(validateRun('doctor', { toString: () => 'D:\\P' }, ok).ok).toBe(false)
    expect(validateRun('cd ..', 'D:\\P', ok).ok).toBe(false)
    expect(validateRun('filesmith cmd /c calc', 'D:\\P', ok).ok).toBe(false)
  })
})
