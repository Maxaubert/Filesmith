import { readdirSync, statSync } from 'fs'
import type { JobEvent, JobRequest } from '@shared/types'
import type { Reporter } from './events'
import type { ErrorCode } from './exit'
import type { PlannedJob } from './plan'

export interface QueueLike {
  add(req: JobRequest): void
  cancelAll(): void
}
export type QueueFactory = (emit: (e: JobEvent) => void) => QueueLike

export interface RunnerDeps {
  queue: QueueFactory
  clock: () => number
  statOutput(path: string): { outSize?: number; files?: number }
}

export interface RunTotals {
  ok: number
  failed: number
  skipped: number
  canceled: number
  inBytes: number
  outBytes: number
}

/** Engine error text -> a stable code and, when one exists, the exact command
 * that fixes it (spec 2.6). The engine's CLI wording ends in "Run: <cmd>." */
export function classifyError(message: string): { code: ErrorCode; hint?: string } {
  const hint = /Run: (filesmith [^\n]*?)\.?\s*$/m.exec(message)?.[1]
  if (hint) return { code: 'SETUP_REQUIRED', hint }
  if (/Output folder not found/i.test(message)) return { code: 'OUT_DIR_MISSING' }
  if (/password-protected/i.test(message)) return { code: 'PASSWORD' }
  if (/WinRAR not found/i.test(message)) return { code: 'RAR_MISSING', hint: 'filesmith doctor' }
  if (
    /missing from this installation|isn't installed|could not be started \(not found\)/i.test(
      message
    )
  )
    return { code: 'TOOL_MISSING', hint: 'filesmith doctor' }
  return { code: 'TOOL_FAILED' }
}

export function statOutput(path: string): { outSize?: number; files?: number } {
  try {
    const st = statSync(path)
    return st.isDirectory() ? { files: readdirSync(path).length } : { outSize: st.size }
  } catch {
    return {}
  }
}

export function emitNotReady(j: PlannedJob, reporter: Reporter): 'skipped' | 'failed' {
  if (j.state === 'skip') {
    reporter.emit({
      event: 'skipped',
      id: j.id,
      input: j.input,
      code: j.code ?? 'SAME_FORMAT',
      message: j.message ?? ''
    })
    return 'skipped'
  }
  reporter.emit({
    event: 'error',
    id: j.id,
    input: j.input,
    code: j.code ?? 'INTERNAL',
    message: j.message ?? 'failed',
    hint: j.hint
  })
  return 'failed'
}

/** Run the ready jobs on a JobQueue in this process (spec 4.4); never touches
 * the app's queue. Resolves when every job reached a terminal event. */
export function runPlanned(
  jobs: PlannedJob[],
  reporter: Reporter,
  deps: RunnerDeps,
  signal: AbortSignal
): Promise<RunTotals> {
  const totals: RunTotals = { ok: 0, failed: 0, skipped: 0, canceled: 0, inBytes: 0, outBytes: 0 }
  for (const j of jobs) if (j.state !== 'ready') totals[emitNotReady(j, reporter)]++
  const ready = jobs.filter((j) => j.state === 'ready')
  if (!ready.length) return Promise.resolve(totals)
  // Canceled before the run began (Ctrl+C or a closed stdout during input
  // expansion or readiness): start nothing, or the queue would spawn tools
  // only to kill them.
  if (signal.aborted) {
    for (const j of ready) {
      reporter.emit({ event: 'canceled', id: j.id, input: j.input })
      totals.canceled++
    }
    return Promise.resolve(totals)
  }

  return new Promise((resolve) => {
    const byId = new Map(ready.map((j) => [j.id, j]))
    const started = new Map<string, number>()
    const finished = new Set<string>()
    const finish = (id: string): void => {
      finished.add(id)
      if (finished.size === ready.length) {
        signal.removeEventListener('abort', onAbort)
        resolve(totals)
      }
    }
    const canceled = (j: PlannedJob): void => {
      reporter.emit({ event: 'canceled', id: j.id, input: j.input })
      totals.canceled++
      finish(j.id)
    }
    const queue = deps.queue((e) => {
      const job = byId.get(e.id)
      if (!job || finished.has(e.id)) return
      switch (e.status) {
        case 'running':
          if (!started.has(e.id)) {
            started.set(e.id, deps.clock())
            reporter.emit({
              event: 'start',
              id: job.id,
              input: job.input,
              inSize: job.inSize,
              op: job.op
            })
          }
          if (e.percent !== undefined || e.message)
            reporter.emit({
              event: 'progress',
              id: job.id,
              pct: e.percent ?? null,
              etaSec: e.etaSec,
              message: e.message
            })
          return
        case 'done': {
          const st = e.outputPath ? deps.statOutput(e.outputPath) : {}
          totals.ok++
          totals.inBytes += job.inSize
          if (st.outSize !== undefined) totals.outBytes += st.outSize
          reporter.emit({
            event: 'done',
            id: job.id,
            input: job.input,
            output: e.outputPath ?? '',
            outputKind: st.files !== undefined ? 'dir' : 'file',
            inSize: job.inSize,
            outSize: st.outSize,
            files: st.files,
            ms: deps.clock() - (started.get(e.id) ?? deps.clock())
          })
          finish(e.id)
          return
        }
        case 'failed': {
          const message = e.error ?? 'failed'
          const c = classifyError(message)
          reporter.emit({
            event: 'error',
            id: job.id,
            input: job.input,
            code: c.code,
            message,
            hint: c.hint
          })
          totals.failed++
          finish(e.id)
          return
        }
        case 'canceled':
          canceled(job)
          return
      }
    })
    const onAbort = (): void => {
      queue.cancelAll()
      // JobQueue.cancelAll drops QUEUED jobs without an event; they never
      // started, so they are reported here or the run would never end.
      for (const j of ready) if (!started.has(j.id) && !finished.has(j.id)) canceled(j)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    for (const j of ready) queue.add({ id: j.id, tool: j.tool, input: j.input, options: j.options })
    if (signal.aborted) onAbort()
  })
}
