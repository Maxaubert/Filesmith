import { describe, expect, it } from 'vitest'
import {
  consoleReducer,
  INITIAL,
  MAX_LINES,
  outputForLine,
  progressText,
  styleOf,
  type Block,
  type ConsoleAction,
  type ConsoleState
} from '../src/renderer/src/components/console/consoleModel'
import {
  HIST_IDLE,
  histStep,
  pushHistory
} from '../src/renderer/src/components/console/consoleHistory'
import {
  clampConsoleHeight,
  parseHeight
} from '../src/renderer/src/components/console/consoleHeight'
import { HELP_LINES } from '../src/renderer/src/components/console/consoleHelp'

const cmd = (s: ConsoleState, id = 'r1') =>
  s.blocks.find((b) => b.id === id) as Extract<Block, { kind: 'cmd' }>
const run = (actions: ConsoleAction[]): ConsoleState => actions.reduce(consoleReducer, INITIAL)

describe('styleOf', () => {
  it('styles CLI lines by their start without rewording them', () => {
    expect(styleOf('ok      a.png -> a.webp  3 MB -> 1 MB  (-66%)')).toBe('ok')
    expect(styleOf('skip    b.webp  already webp')).toBe('skip')
    expect(styleOf('fail    c.jpg  Unsupported compression')).toBe('fail')
    expect(styleOf('stop    d.png')).toBe('stop')
    expect(styleOf('plan    e.png -> e.webp  convert')).toBe('plan')
    expect(styleOf('        hint: Open it in an editor')).toBe('hint')
    expect(styleOf('  fix: setup removebg')).toBe('hint')
    expect(styleOf('3 files: 3 ok, 0 skipped, 0 failed (3.3 s)')).toBe('sum')
    expect(styleOf('filesmith: convert needs --to <format>')).toBe('err')
    expect(styleOf('okay then')).toBe('text')
  })
})

describe('consoleReducer', () => {
  it('runs a block: lines, progress from events, outputs, exit status', () => {
    const s = run([
      { type: 'start', id: 'r1', cwd: 'D:\\P', line: 'resize *.png --percent 50', at: 1000 },
      { type: 'event', id: 'r1', ev: { event: 'run', inputs: 4 } },
      { type: 'event', id: 'r1', ev: { event: 'start', id: 'j1', input: 'D:\\P\\a.png' } },
      { type: 'event', id: 'r1', ev: { event: 'progress', id: 'j1', pct: 62, etaSec: 4 } }
    ])
    expect(cmd(s).status).toBe('running')
    expect(progressText(cmd(s).progress!)).toBe('[1/4]  a.png 62%(4s)')
    const more: ConsoleAction[] = [
      {
        type: 'event',
        id: 'r1',
        ev: { event: 'done', id: 'j1', output: 'D:\\P\\a (resized).png' }
      },
      { type: 'out', id: 'r1', text: 'ok      a.png -> a (resized).png  1 MB -> 0.3 MB  (-73%)' },
      { type: 'exit', id: 'r1', code: 0, at: 4300 }
    ]
    const s2 = more.reduce(consoleReducer, s)
    const b = cmd(s2)
    expect(b.progress).toBeNull()
    expect(b.outputs).toEqual(['D:\\P\\a (resized).png'])
    expect(b.lines).toEqual([
      { text: 'ok      a.png -> a (resized).png  1 MB -> 0.3 MB  (-73%)', style: 'ok' }
    ])
    expect(b).toMatchObject({ status: 'done', code: 0, ms: 3300 })
  })
  it('steps and heartbeats show as progress without a job count', () => {
    const s = run([
      { type: 'start', id: 'r1', cwd: 'C:\\', line: 'setup removebg', at: 0 },
      {
        type: 'event',
        id: 'r1',
        ev: { event: 'step', step: 'download model', pct: 41, etaSec: 12 }
      }
    ])
    expect(progressText(cmd(s).progress!)).toBe('download model 41%(12s)')
    const h = consoleReducer(s, {
      type: 'event',
      id: 'r1',
      ev: { event: 'heartbeat', step: 'unpack', elapsedSec: 75 }
    })
    expect(progressText(cmd(h).progress!)).toBe('unpack (1m15s)')
  })
  it('refusals, notes, stopping and clear', () => {
    let s = run([
      {
        type: 'refuse',
        id: 'r1',
        cwd: 'C:\\',
        line: 'del *.*',
        text: '`del` is not a filesmith command.'
      },
      { type: 'note', id: 'n1', text: 'Folder is now D:\\.' },
      { type: 'start', id: 'r2', cwd: 'D:\\', line: 'doctor', at: 0 },
      { type: 'stopping', id: 'r2' }
    ])
    expect(cmd(s, 'r1')).toMatchObject({
      status: 'refused',
      refusal: '`del` is not a filesmith command.'
    })
    expect(cmd(s, 'r2').stopping).toBe(true)
    s = consoleReducer(s, { type: 'clear' })
    expect(s.blocks.map((b) => b.id)).toEqual(['r2'])
  })
  it('drops the oldest finished blocks past MAX_LINES, never the running one', () => {
    let s = run([
      {
        type: 'builtin',
        id: 'old',
        cwd: 'C:\\',
        line: 'history',
        lines: Array(MAX_LINES).fill('x')
      }
    ])
    s = consoleReducer(s, { type: 'start', id: 'r1', cwd: 'C:\\', line: 'doctor', at: 0 })
    for (let i = 0; i < 10; i++) s = consoleReducer(s, { type: 'out', id: 'r1', text: `line ${i}` })
    expect(s.blocks.map((b) => b.id)).toEqual(['r1'])
  })
  it('maps an ok row to its full output path', () => {
    expect(
      outputForLine('ok      a.png -> a (resized).png  1 MB', ['D:\\P\\a (resized).png'])
    ).toBe('D:\\P\\a (resized).png')
    expect(outputForLine('3 files: 3 ok', ['D:\\P\\a.png'])).toBeNull()
  })
})

describe('history', () => {
  it('keeps 100 lines, no repeat in a row', () => {
    expect(pushHistory(['a'], 'a')).toEqual(['a'])
    expect(
      pushHistory(
        Array.from({ length: 100 }, (_, i) => `${i}`),
        'new'
      )
    ).toHaveLength(100)
  })
  it('walks up and down and restores the draft', () => {
    const h = ['one', 'two']
    const up1 = histStep(h, HIST_IDLE, 'dra', -1)!
    expect(up1.text).toBe('two')
    const up2 = histStep(h, up1.nav, up1.text, -1)!
    expect(up2.text).toBe('one')
    expect(histStep(h, up2.nav, 'one', -1)!.text).toBe('one')
    const down = histStep(h, up2.nav, 'one', 1)!
    const back = histStep(h, down.nav, 'two', 1)!
    expect(back).toEqual({ nav: HIST_IDLE, text: 'dra' })
    expect(histStep([], HIST_IDLE, '', -1)).toBeNull()
  })
})

describe('height and help', () => {
  it('clamps between 120 and the center minus head and 120', () => {
    expect(clampConsoleHeight(50, 800)).toBe(120)
    expect(clampConsoleHeight(900, 800)).toBe(800 - 32 - 120)
    expect(clampConsoleHeight(300, 200)).toBe(120)
    expect(parseHeight('abc')).toBe(280)
    expect(parseHeight('333')).toBe(333)
  })
  it('help text names the folder and has no em-dash', () => {
    expect(HELP_LINES('D:\\P')[0]).toBe('Commands run in D:\\P, without the "filesmith" prefix:')
  })
})
