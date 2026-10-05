import { describe, expect, it } from 'vitest'
import { HumanReporter } from '../src/cli/human'
import { sanitizeField, sanitizeText } from '../src/cli/sanitize'
import type { EventBody } from '../src/cli/events'

const ESC = '\x1b'
const CSI8 = '\u009b'
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/
// The reporter's own color codes are the only escapes allowed out of it.
const ownColor = new RegExp(`${ESC}\\[(?:3[123]|0)m`, 'g')

describe('sanitizeField', () => {
  it('ESC[2J (clear screen) loses its ESC', () => {
    expect(sanitizeField(`a${ESC}[2Jb.png`)).toBe('a\uFFFD[2Jb.png')
  })
  it('an OSC 8 hyperlink cannot hide its target', () => {
    const osc = `${ESC}]8;;https://evil.example${ESC}\\safe.png${ESC}]8;;${ESC}\\`
    const s = sanitizeField(osc)
    expect(s).not.toMatch(BAD)
    expect(s).toContain('https://evil.example')
    expect(sanitizeField(`x${ESC}]0;title\x07y`)).toBe('x\uFFFD]0;title\uFFFDy')
  })
  it('a \\r overwrite trick and line breaks become spaces', () => {
    expect(sanitizeField('evil.exe\rgood.png')).toBe('evil.exe good.png')
    expect(sanitizeField('a\nb\tc\r\nd')).toBe('a b c  d')
  })
  it('C1 CSI (U+009B), DEL, NUL and BEL are replaced', () => {
    expect(sanitizeField(`a${CSI8}2Jb\u007fc\u0000d\u0007`)).toBe('a\uFFFD2Jb\uFFFDc\uFFFDd\uFFFD')
  })
  it('ordinary text, non-ASCII letters and symbols pass unchanged', () => {
    for (const s of ['Æble æøå.png', 'my file & co.png', 'C:\\x\\y z', '日本.png', 'ü€'])
      expect(sanitizeField(s)).toBe(s)
  })
})

describe('sanitizeText', () => {
  it('keeps newlines and tabs, drops \\r and escapes', () => {
    expect(sanitizeText(`a\r\nb\tc\n${ESC}[31md\re`)).toBe('a\nb\tc\n\uFFFD[31md\uFFFDe')
  })
})

describe('HumanReporter prints no control character from an event', () => {
  const evil = `x${ESC}[2J${ESC}]8;;http://e${ESC}\\y${CSI8}1A\rz\u007f`
  const events: EventBody[] = [
    { event: 'run', command: 'convert', version: '1', dryRun: false, inputs: 2, options: {} },
    { event: 'start', id: '1', input: `C:\\in\\${evil}.png`, inSize: 1, op: 'convert' },
    { event: 'progress', id: '1', pct: 50, message: evil },
    {
      event: 'done',
      id: '1',
      input: `C:\\in\\${evil}.png`,
      output: `C:\\in\\${evil}.webp`,
      outputKind: 'file',
      inSize: 10,
      outSize: 5,
      ms: 1
    },
    { event: 'skipped', input: `C:\\${evil}`, code: 'SAME_FORMAT', message: evil },
    {
      event: 'error',
      id: '2',
      input: `C:\\${evil}`,
      code: 'TOOL_FAILED',
      message: evil,
      hint: evil
    },
    { event: 'error', code: 'TOOL_FAILED', message: evil, hint: evil },
    { event: 'warning', code: 'W', message: evil },
    { event: 'canceled', id: '3', input: `C:\\${evil}` },
    {
      event: 'plan',
      id: '4',
      input: `C:\\${evil}`,
      inSize: 1,
      op: evil,
      output: `C:\\${evil}`,
      ready: true,
      message: evil
    },
    {
      event: 'plan',
      id: '5',
      input: `C:\\${evil}`,
      inSize: 1,
      op: 'x',
      ready: false,
      message: evil,
      hint: evil
    },
    { event: 'check', id: evil, group: 'g', status: 'fail', detail: evil, fix: evil },
    { event: 'step', step: evil, pct: 10 },
    { event: 'step', step: evil, pct: null, detail: evil },
    { event: 'heartbeat', step: evil, elapsedSec: 3 },
    { event: 'done', tool: evil, alreadyDone: false },
    { event: 'done', path: evil, updated: true, previousVersion: evil },
    { event: 'version', version: evil }
  ]
  for (const tty of [true, false])
    it(`stdout and stderr stay clean (stderr TTY ${tty})`, () => {
      let out = ''
      let err = ''
      const r = new HumanReporter(
        { write: (s) => (out += s) },
        { write: (s) => (err += s) },
        { color: true, stderrTTY: tty }
      )
      for (const e of events) r.emit(e)
      r.text(`table\n${evil}\n`)
      r.close()
      expect(out.replace(ownColor, '')).not.toMatch(BAD)
      // Progress redraws use \r ESC[2K; nothing else may carry a control.
      expect(err.split(`\r${ESC}[2K`).join('')).not.toMatch(BAD)
      expect(out).toContain('\uFFFD[2J')
    })
})
