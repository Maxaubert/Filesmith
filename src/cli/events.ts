import type { ErrorCode } from './exit'

export const SCHEMA_VERSION = 1

export type OutputKind = 'file' | 'dir'

/** Every event the CLI writes (spec 2.6), without the `v`/`ts` envelope. */
export type EventBody =
  | {
      event: 'run'
      command: string
      version: string
      dryRun: boolean
      inputs: number
      options: Record<string, unknown>
    }
  | {
      event: 'plan'
      id: string
      input: string | string[]
      inSize: number
      op: string
      output?: string
      outputKind?: OutputKind
      ready: boolean
      code?: ErrorCode
      message?: string
      hint?: string
    }
  | { event: 'start'; id: string; input: string; inSize: number; op: string }
  | { event: 'progress'; id: string; pct: number | null; etaSec?: number; message?: string }
  | {
      event: 'done'
      id: string
      input: string
      output: string
      outputKind: OutputKind
      inSize: number
      outSize?: number
      files?: number
      ms: number
      seed?: number
    }
  | { event: 'done'; tool: string; path?: string; alreadyDone: boolean }
  | { event: 'done'; path: string; updated: boolean; previousVersion?: string }
  | { event: 'skipped'; id?: string; input: string; code: ErrorCode; message: string }
  | { event: 'error'; id?: string; input?: string; code: ErrorCode; message: string; hint?: string }
  | { event: 'warning'; code: string; message: string; id?: string }
  | { event: 'canceled'; id: string; input: string }
  | {
      event: 'summary'
      ok: number
      failed: number
      skipped: number
      canceled: number
      inBytes: number
      outBytes: number
      ms: number
      exitCode: number
    }
  | { event: 'version'; version: string }
  | { event: 'formats'; data: Record<string, unknown> }
  | {
      event: 'check'
      id: string
      group: string
      status: 'ok' | 'warn' | 'fail' | 'skip'
      detail: string
      fix?: string
    }
  | {
      event: 'step'
      step: string
      pct: number | null
      bytes?: number
      totalBytes?: number
      etaSec?: number
      detail?: string
    }
  | { event: 'heartbeat'; step: string; elapsedSec: number }

export interface Out {
  write(s: string): void
}

/** Commands only ever emit events; a reporter decides what the user sees. */
export interface Reporter {
  emit(e: EventBody): void
  /** Free text for human mode (formats tables, help-like output); dropped in JSON. */
  text(s: string): void
  close(): void
}

/** NDJSON on stdout (spec 2.5): one line per event, flushed per write. */
export class JsonReporter implements Reporter {
  private last = new Map<string, { t: number; tenth: number }>()

  constructor(
    private readonly out: Out,
    private readonly clock: () => number = Date.now,
    private readonly now: () => Date = () => new Date()
  ) {}

  emit(e: EventBody): void {
    if (e.event === 'progress' && !this.allow(`p:${e.id}`, e.pct)) return
    if (e.event === 'step' && !this.allow(`s:${e.step}`, e.pct)) return
    const { event, ...rest } = e
    this.out.write(
      JSON.stringify({ v: SCHEMA_VERSION, event, ts: this.now().toISOString(), ...rest }) + '\n'
    )
  }

  text(s: string): void {
    void s // JSON mode carries only events
  }

  close(): void {}

  /** One progress line per job per 250 ms, plus every whole 10%. */
  private allow(key: string, pct: number | null): boolean {
    const t = this.clock()
    const tenth = pct == null ? -1 : Math.floor(pct / 10)
    const prev = this.last.get(key)
    if (!prev || tenth > prev.tenth || t - prev.t >= 250) {
      this.last.set(key, { t, tenth: Math.max(tenth, prev?.tenth ?? -1) })
      return true
    }
    return false
  }
}

/** Human output for the reader plus events for a program (the in-app console). */
export class TeeReporter implements Reporter {
  constructor(
    private readonly a: Reporter,
    private readonly b: Reporter
  ) {}

  emit(e: EventBody): void {
    this.a.emit(e)
    this.b.emit(e)
  }

  text(s: string): void {
    this.a.text(s)
    this.b.text(s)
  }

  close(): void {
    this.a.close()
    this.b.close()
  }
}
