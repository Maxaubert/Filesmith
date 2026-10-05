import { formatBytes } from '@shared/compress'
import { baseName } from '@shared/fileKind'
import type { EventBody, Out, Reporter } from './events'

type Label = 'ok' | 'skip' | 'fail' | 'stop' | 'plan'
const COLOR: Partial<Record<Label, string>> = { ok: '\x1b[32m', skip: '\x1b[33m', fail: '\x1b[31m' }
const RESET = '\x1b[0m'
const CLEAR = '\r\x1b[2K'

export function pctChange(inSize: number, outSize: number): string | null {
  if (!(inSize > 0)) return null
  const d = Math.round(((outSize - inSize) / inSize) * 100)
  return `${d > 0 ? '+' : ''}${d}%`
}

export function fmtEta(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function resultLine(label: Label, left: string, right: string, color: boolean): string {
  const tag = label.padEnd(8)
  const c = color ? COLOR[label] : undefined
  // A name longer than the column still gets a two-space gap before the sizes.
  const cell = left.length < 34 ? left.padEnd(34) + ' ' : left + '  '
  return `${c ? `${c}${tag}${RESET}` : tag}${cell}${right}`.trimEnd() + '\n'
}

export function summaryLine(
  s: { ok: number; failed: number; skipped: number; canceled: number; ms: number },
  dryRun: boolean
): string {
  const n = s.ok + s.failed + s.skipped + s.canceled
  const parts = dryRun
    ? [`${s.ok} would run`, `${s.skipped} skipped`, `${s.failed} would fail`]
    : [`${s.ok} ok`, `${s.skipped} skipped`, `${s.failed} failed`]
  if (s.canceled) parts.push(`${s.canceled} canceled`)
  return `${n} ${n === 1 ? 'file' : 'files'}: ${parts.join(', ')} (${(s.ms / 1000).toFixed(1)} s)\n`
}

const nameOf = (input: string | string[]): string =>
  Array.isArray(input)
    ? `${baseName(input[0] ?? '')}${input.length > 1 ? ` +${input.length - 1}` : ''}`
    : baseName(input)

/** Human output (spec 2.5): results on stdout, progress and warnings on stderr. */
export class HumanReporter implements Reporter {
  private names = new Map<string, string>()
  private total = 0
  private dryRun = false
  private progressShown = false
  private lastStep = ''
  private command = ''
  /** doctor: `warn` checks are not failures, but the closing line counts them. */
  private warns = 0

  constructor(
    private readonly stdout: Out,
    private readonly stderr: Out,
    private readonly opts: { color: boolean; stderrTTY: boolean }
  ) {}

  private out(s: string): void {
    this.clearProgress()
    this.stdout.write(s)
  }

  private err(s: string): void {
    this.clearProgress()
    this.stderr.write(s)
  }

  private clearProgress(): void {
    if (!this.progressShown) return
    this.stderr.write(CLEAR)
    this.progressShown = false
  }

  private redraw(s: string): void {
    this.stderr.write(CLEAR + s)
    this.progressShown = true
  }

  emit(e: EventBody): void {
    const color = this.opts.color
    switch (e.event) {
      case 'run':
        this.dryRun = e.dryRun
        this.command = e.command
        this.total = e.inputs
        this.warns = 0
        return
      case 'plan': {
        const left = e.output
          ? `${nameOf(e.input)} -> ${baseName(e.output)}${e.outputKind === 'dir' ? '\\' : ''}`
          : nameOf(e.input)
        if (e.ready)
          this.out(resultLine('plan', left, `${e.op}${e.message ? `  ${e.message}` : ''}`, color))
        else {
          this.out(resultLine('fail', nameOf(e.input), `would fail: ${e.message ?? ''}`, color))
          if (e.hint) this.out(`        hint: ${e.hint}\n`)
        }
        return
      }
      case 'start':
        this.names.set(e.id, baseName(e.input))
        return
      case 'progress': {
        if (!this.opts.stderrTTY) return
        const pct = e.pct == null ? 'working' : `${Math.round(e.pct)}%`
        const eta = e.etaSec != null ? ` (${fmtEta(e.etaSec)})` : ''
        this.redraw(`[${e.id}/${this.total}] ${this.names.get(e.id) ?? ''} ${pct}${eta}`)
        return
      }
      case 'done': {
        if ('tool' in e) {
          this.out(resultLine('ok', e.tool, e.alreadyDone ? 'already set up' : 'set up', color))
          return
        }
        if ('updated' in e) {
          const prev = e.previousVersion ? ` (was ${e.previousVersion})` : ''
          this.out(
            resultLine(
              'ok',
              'skill',
              `${e.updated ? 'updated' : 'installed'} at ${e.path}${prev}`,
              color
            )
          )
          return
        }
        const left = `${baseName(e.input)} -> ${baseName(e.output)}${e.outputKind === 'dir' ? '\\' : ''}`
        let right = ''
        if (e.outputKind === 'dir') {
          const n = e.files ?? 0
          right = `${n} ${n === 1 ? 'file' : 'files'}`
        } else if (e.outSize != null) {
          const change = pctChange(e.inSize, e.outSize)
          right = `${formatBytes(e.inSize)} -> ${formatBytes(e.outSize)}${change ? `  (${change})` : ''}`
        }
        this.out(resultLine('ok', left, right, color))
        return
      }
      case 'skipped':
        this.out(resultLine('skip', baseName(e.input), e.message, color))
        return
      case 'error':
        if (e.id || e.input) {
          this.out(resultLine('fail', e.input ? baseName(e.input) : `#${e.id}`, e.message, color))
          if (e.hint) this.out(`        hint: ${e.hint}\n`)
        } else {
          this.err(`filesmith: ${e.message}\n`)
          if (e.hint) this.err(`  hint: ${e.hint}\n`)
        }
        return
      case 'warning':
        this.err(`warn: ${e.message}\n`)
        return
      case 'canceled':
        this.out(resultLine('stop', baseName(e.input), '', color))
        return
      case 'summary':
        if (this.command === 'doctor')
          this.out(
            e.failed
              ? `${e.failed} ${e.failed === 1 ? 'check' : 'checks'} failed.\n`
              : this.warns
                ? `No problems found, ${this.warns} ${this.warns === 1 ? 'warning' : 'warnings'}.\n`
                : 'No problems found.\n'
          )
        else if (!this.command.startsWith('setup') && !this.command.startsWith('skill'))
          this.out(summaryLine(e, this.dryRun))
        return
      case 'version':
        this.out(`${e.version}\n`)
        return
      case 'check':
        if (e.status === 'warn') this.warns += 1
        this.out(`  ${e.status.padEnd(6)}${e.id.padEnd(18)}${e.detail}\n`)
        if (e.fix && e.status !== 'ok') this.out(`        fix: ${e.fix}\n`)
        return
      case 'step': {
        const pct = e.pct == null ? '' : ` ${Math.round(e.pct)}%`
        const eta = e.etaSec != null ? ` (${fmtEta(e.etaSec)})` : ''
        if (e.detail) this.out(`  - ${e.step}: ${e.detail}\n`)
        else if (this.opts.stderrTTY) this.redraw(`${e.step}${pct}${eta}`)
        else if (e.step !== this.lastStep) this.err(`${e.step}\n`)
        this.lastStep = e.step
        return
      }
      case 'heartbeat':
        if (this.opts.stderrTTY) this.redraw(`${e.step} (${fmtEta(e.elapsedSec)})`)
        return
      case 'formats':
        return
    }
  }

  text(s: string): void {
    this.out(s)
  }

  close(): void {
    this.clearProgress()
  }
}
