import { describe, expect, it } from 'vitest'
import { HumanReporter, fmtEta, pctChange, resultLine, summaryLine } from '../src/cli/human'

function sink(): { out: { write: (s: string) => void }; text: () => string } {
  let buf = ''
  return { out: { write: (s) => (buf += s) }, text: () => buf }
}

describe('formatters', () => {
  it('pctChange', () => {
    expect(pctChange(2_400_000, 310_000)).toBe('-87%')
    expect(pctChange(100, 112)).toBe('+12%')
    expect(pctChange(0, 5)).toBeNull()
  })
  it('fmtEta', () => {
    expect(fmtEta(4.4)).toBe('4s')
    expect(fmtEta(125)).toBe('2m05s')
  })
  it('resultLine keeps a two-space gap after a name longer than the column', () => {
    const long = 'photo one.png -> photo one (converted).webp'
    expect(resultLine('ok', long, '1.9 KB', false)).toBe(`ok      ${long}  1.9 KB
`)
    expect(resultLine('ok', 'a.png -> a.webp', '1 KB', false)).toBe(
      `ok      ${'a.png -> a.webp'.padEnd(34)} 1 KB
`
    )
  })
  it('summaryLine', () => {
    expect(summaryLine({ ok: 1, failed: 1, skipped: 1, canceled: 0, ms: 4200 }, false)).toBe(
      '3 files: 1 ok, 1 skipped, 1 failed (4.2 s)\n'
    )
    expect(summaryLine({ ok: 1, failed: 0, skipped: 0, canceled: 0, ms: 0 }, true)).toBe(
      '1 file: 1 would run, 0 skipped, 0 would fail (0.0 s)\n'
    )
  })
})

describe('HumanReporter', () => {
  it('counts a folder output as 1 file or N files', () => {
    for (const [files, word] of [
      [1, '1 file'],
      [3, '3 files']
    ] as const) {
      const o = sink()
      const r = new HumanReporter(o.out, sink().out, { color: false, stderrTTY: false })
      r.emit({
        event: 'done',
        id: '1',
        input: 'C:\\x\\a.pdf',
        output: 'C:\\x\\a (pages)',
        outputKind: 'dir',
        files,
        inSize: 10,
        ms: 1
      })
      expect(o.text().trimEnd().endsWith(word)).toBe(true)
    }
  })
  it('prints result lines and the summary on stdout, warnings on stderr, no colour', () => {
    const o = sink()
    const e = sink()
    const r = new HumanReporter(o.out, e.out, { color: false, stderrTTY: false })
    r.emit({
      event: 'run',
      command: 'convert',
      version: '0.6.0',
      dryRun: false,
      inputs: 3,
      options: {}
    })
    r.emit({ event: 'start', id: '1', input: 'C:\\x\\photo.png', inSize: 2_400_000, op: 'convert' })
    r.emit({ event: 'progress', id: '1', pct: 50 })
    r.emit({
      event: 'done',
      id: '1',
      input: 'C:\\x\\photo.png',
      output: 'C:\\x\\photo.webp',
      outputKind: 'file',
      inSize: 2_400_000,
      outSize: 310_000,
      ms: 900
    })
    r.emit({
      event: 'skipped',
      id: '2',
      input: 'C:\\x\\logo.webp',
      code: 'SAME_FORMAT',
      message: 'already webp'
    })
    r.emit({
      event: 'error',
      id: '3',
      input: 'C:\\x\\broken.jpg',
      code: 'TOOL_FAILED',
      message: 'magick: improper image header'
    })
    r.emit({ event: 'warning', code: 'QUALITY_IGNORED', message: '--quality has no effect here' })
    r.emit({
      event: 'summary',
      ok: 1,
      failed: 1,
      skipped: 1,
      canceled: 0,
      inBytes: 0,
      outBytes: 0,
      ms: 4200,
      exitCode: 1
    })
    // label column 8, name column 34, one space, then the right-hand detail
    const row = (label: string, left: string, right: string): string =>
      `${label.padEnd(8)}${left.padEnd(34)} ${right}`
    expect(o.text()).toBe(
      [
        row('ok', 'photo.png -> photo.webp', '2.3 MB -> 303 KB  (-87%)'),
        row('skip', 'logo.webp', 'already webp'),
        row('fail', 'broken.jpg', 'magick: improper image header'),
        '3 files: 1 ok, 1 skipped, 1 failed (4.2 s)',
        ''
      ].join('\n')
    )
    expect(e.text()).toBe('warn: --quality has no effect here\n')
  })

  it('draws one redrawn progress line on a TTY stderr and clears it before results', () => {
    const o = sink()
    const e = sink()
    const r = new HumanReporter(o.out, e.out, { color: false, stderrTTY: true })
    r.emit({
      event: 'run',
      command: 'compress',
      version: '0.6.0',
      dryRun: false,
      inputs: 2,
      options: {}
    })
    r.emit({ event: 'start', id: '2', input: 'C:\\a.mp4', inSize: 1, op: 'compress' })
    r.emit({ event: 'progress', id: '2', pct: 62, etaSec: 4 })
    r.emit({ event: 'canceled', id: '2', input: 'C:\\a.mp4' })
    expect(e.text()).toBe('\r\x1b[2K[2/2] a.mp4 62% (4s)\r\x1b[2K')
    expect(o.text()).toBe('stop    a.mp4\n')
  })

  it('prints a run-level error and its hint on stderr', () => {
    const o = sink()
    const e = sink()
    const r = new HumanReporter(o.out, e.out, { color: false, stderrTTY: false })
    r.emit({
      event: 'error',
      code: 'SETUP_REQUIRED',
      message: 'PiD is not installed.',
      hint: 'filesmith setup pid'
    })
    expect(e.text()).toBe('filesmith: PiD is not installed.\n  hint: filesmith setup pid\n')
    expect(o.text()).toBe('')
  })

  it('colours only the status word, only when asked', () => {
    const o = sink()
    const r = new HumanReporter(o.out, sink().out, { color: true, stderrTTY: false })
    r.emit({
      event: 'skipped',
      id: '1',
      input: 'a.webp',
      code: 'SAME_FORMAT',
      message: 'already webp'
    })
    expect(o.text().startsWith('\x1b[33mskip    \x1b[0m')).toBe(true)
  })
})

describe('HumanReporter summaries per command', () => {
  it('doctor counts its warnings in the closing line', () => {
    const o = sink()
    const r = new HumanReporter(o.out, sink().out, { color: false, stderrTTY: false })
    r.emit({
      event: 'run',
      command: 'doctor',
      version: '0.6.0',
      dryRun: false,
      inputs: 0,
      options: {}
    })
    r.emit({
      event: 'check',
      id: 'skill',
      group: 'environment',
      status: 'warn',
      detail: 'Claude skill not installed',
      fix: 'filesmith skill install'
    })
    r.emit({
      event: 'summary',
      ok: 0,
      failed: 0,
      skipped: 0,
      canceled: 0,
      inBytes: 0,
      outBytes: 0,
      ms: 1,
      exitCode: 0
    })
    expect(o.text().endsWith('No problems found, 1 warning.\n')).toBe(true)
  })
  it('doctor says whether anything failed; setup prints no file summary', () => {
    const o = sink()
    const r = new HumanReporter(o.out, sink().out, { color: false, stderrTTY: false })
    r.emit({
      event: 'run',
      command: 'doctor',
      version: '0.6.0',
      dryRun: false,
      inputs: 0,
      options: {}
    })
    r.emit({
      event: 'summary',
      ok: 9,
      failed: 0,
      skipped: 1,
      canceled: 0,
      inBytes: 0,
      outBytes: 0,
      ms: 1,
      exitCode: 0
    })
    r.emit({
      event: 'run',
      command: 'setup pid',
      version: '0.6.0',
      dryRun: false,
      inputs: 0,
      options: {}
    })
    r.emit({
      event: 'summary',
      ok: 1,
      failed: 0,
      skipped: 0,
      canceled: 0,
      inBytes: 0,
      outBytes: 0,
      ms: 1,
      exitCode: 0
    })
    expect(o.text()).toBe('No problems found.\n')
  })
})
