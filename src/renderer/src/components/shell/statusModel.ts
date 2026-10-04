import { inInput, type QueueItem } from '../../state'

export interface StatusSummary {
  running: { label: string; pct: number } | null
  /** Generate's startup line ("Starting ComfyUI"), shown with an indeterminate bar. */
  message: string | null
  done: string | null
  failed: number
}

const GERUND: Record<string, string> = {
  Convert: 'Converting',
  Compress: 'Compressing',
  Resize: 'Resizing',
  Upscale: 'Upscaling',
  'Remove BG': 'Removing backgrounds',
  Generate: 'Generating'
}

export function verbGerund(label: string): string {
  return GERUND[label] ?? 'Processing'
}

/** Status bar content (spec 3.5 and 6.4). `batch` is the ids of the last run in
 * this workspace; it is renderer-only and not persisted. */
export function statusSummary(
  items: QueueItem[],
  batch: string[] | null,
  verb: string,
  message?: string | null
): StatusSummary {
  const inputs = items.filter(inInput)
  let running: StatusSummary['running'] = null
  if (batch?.length) {
    const ids = new Set(batch)
    const rows = inputs.filter((i) => ids.has(i.id))
    const live = rows.filter((i) => i.status === 'queued' || i.status === 'running')
    if (live.length) {
      const done = rows.filter((i) => i.status === 'done').length
      const run = rows.filter((i) => i.status === 'running')
      const settled = rows.filter((i) => ['done', 'failed', 'canceled'].includes(i.status)).length
      const partial = run.reduce((s, i) => s + (i.hasProgress ? i.percent / 100 : 0), 0)
      running = {
        label: `${verbGerund(verb)} ${done + run.length} of ${rows.length}`,
        pct: Math.round(((settled + partial) / rows.length) * 100)
      }
    }
  }
  const doneN = inputs.filter((i) => i.status === 'done').length
  return {
    running,
    message: message || null,
    done: doneN ? `${doneN} of ${inputs.length} done` : null,
    failed: inputs.filter((i) => i.status === 'failed').length
  }
}
