import { cpus } from 'os'
import { statSync } from 'fs'
import type { JobEvent, JobRequest } from '@shared/types'
import { fileInfoFromPath } from './fileInfo'
import { getTool } from './tools/registry'

type Emit = (event: JobEvent) => void

/**
 * Batch queue: runs jobs with bounded concurrency, streams progress via `emit`,
 * and supports per-job cancellation. Each job spawns one tool run.
 */
export class JobQueue {
  private controllers = new Map<string, AbortController>()
  private queue: JobRequest[] = []
  private active = 0
  private readonly concurrency: number

  constructor(
    private emit: Emit,
    concurrency?: number
  ) {
    this.concurrency = concurrency ?? Math.max(1, Math.min(4, cpus().length - 1))
  }

  add(req: JobRequest): void {
    this.queue.push(req)
    this.emit({ id: req.id, status: 'queued' })
    this.pump()
  }

  cancel(id: string): void {
    const ctrl = this.controllers.get(id)
    if (ctrl) {
      // Active job: aborting makes execute()'s catch emit the terminal 'canceled'.
      ctrl.abort()
      return
    }
    // Queued but not yet started: drop it and emit the terminal event ourselves,
    // or the row stays stuck showing 'queued' forever.
    const before = this.queue.length
    this.queue = this.queue.filter((r) => r.id !== id)
    if (this.queue.length !== before) this.emit({ id, status: 'canceled' })
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const req = this.queue.shift()
      if (req) void this.execute(req)
    }
  }

  private async execute(req: JobRequest): Promise<void> {
    const tool = getTool(req.tool)
    if (!tool) {
      this.emit({ id: req.id, status: 'failed', error: `Unknown tool: ${req.tool}` })
      return
    }
    const ctrl = new AbortController()
    this.controllers.set(req.id, ctrl)
    this.active++
    this.emit({ id: req.id, status: 'running', percent: 0 })
    try {
      const file = fileInfoFromPath(req.input)
      const output = await tool.run(file, req.options, {
        signal: ctrl.signal,
        onProgress: (percent, message) =>
          this.emit({ id: req.id, status: 'running', percent, message })
      })
      // Report the produced size so the UI can show the result and how much it
      // shrank. Directory outputs (pages-to-images, split) have no single size.
      let outputSize: number | undefined
      try {
        const st = statSync(output)
        if (st.isFile()) outputSize = st.size
      } catch {
        /* best effort */
      }
      this.emit({ id: req.id, status: 'done', percent: 100, outputPath: output, outputSize })
    } catch (err) {
      const aborted = ctrl.signal.aborted
      this.emit({
        id: req.id,
        status: aborted ? 'canceled' : 'failed',
        error: aborted ? undefined : ((err as Error).message ?? String(err))
      })
    } finally {
      this.controllers.delete(req.id)
      this.active--
      this.pump()
    }
  }
}
