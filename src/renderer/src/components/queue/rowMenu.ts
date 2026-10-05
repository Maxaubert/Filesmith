// src/renderer/src/components/queue/rowMenu.ts
import type { IconName } from '@shared/icons'
import { inInput, type QueueItem } from '../../state'

// Pure model for the files table's right-click menu: which rows it acts on and
// which entries apply. Kept apart from App.tsx so Vitest can cover it.

export type RowMenuAction = 'open' | 'reveal' | 'retry' | 'stop' | 'remove' | 'delete' | 'clear'

export type RowMenuEntry =
  | { sep: true }
  | {
      sep?: false
      action: RowMenuAction
      label: string
      icon: IconName
      disabled: boolean
      danger?: boolean
    }

/** Right-clicking a selected row acts on the whole selection; any other row
 * becomes the selection on its own (the caller selects it). */
export function menuTargets(clicked: string, selected: string[]): string[] {
  return selected.includes(clicked) ? selected : [clicked]
}

const inFlight = (i: QueueItem): boolean => i.status === 'queued' || i.status === 'running'
const retryable = (i: QueueItem): boolean => i.status === 'failed' || i.status === 'canceled'
const finished = (i: QueueItem): boolean =>
  inInput(i) && (i.status === 'done' || i.status === 'canceled')

/** The path Show in File Explorer points at: the result once a row is done,
 * otherwise the source. */
export function revealPath(i: QueueItem): string {
  return i.status === 'done' && i.outputPath ? i.outputPath : i.file.path
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

export function rowMenuModel(targets: QueueItem[], queue: QueueItem[]): RowMenuEntry[] {
  const n = targets.length
  const one = n === 1 ? targets[0] : null
  const stops = targets.filter(inFlight).length
  const retries = targets.filter(retryable).length
  const clearable = queue.filter(finished).length
  return [
    { action: 'open', label: 'Open in default app', icon: 'arrow', disabled: !one },
    {
      action: 'reveal',
      label: 'Show in File Explorer',
      icon: 'folder',
      disabled: !one
    },
    { sep: true },
    {
      action: 'retry',
      label: retries > 1 ? `Retry ${retries} files` : 'Retry',
      icon: 'retry',
      disabled: retries === 0
    },
    {
      action: 'stop',
      label: stops > 1 ? `Stop ${stops} jobs` : 'Stop',
      icon: 'stop',
      disabled: stops === 0
    },
    { sep: true },
    {
      action: 'clear',
      label: 'Clear finished',
      icon: 'cleardone',
      disabled: clearable === 0
    },
    { sep: true },
    {
      action: 'remove',
      label: n > 1 ? `Remove ${n} from list` : 'Remove from list',
      icon: 'close',
      disabled: n === 0
    },
    {
      action: 'delete',
      label: n > 1 ? `Delete ${n} files` : 'Delete file',
      icon: 'trash',
      danger: true,
      // A running job is still reading its source: stop it first.
      disabled: n === 0 || stops > 0
    }
  ]
}

/** Confirm copy for Remove from list and Delete, naming the count. */
export function removeConfirm(n: number): { title: string; body: string } {
  return {
    title: n === 1 ? 'Remove this file from the list?' : `Remove ${n} files from the list?`,
    body: 'Files on disk are not touched; running jobs are stopped.'
  }
}

export function deleteConfirm(n: number): { title: string; body: string } {
  return {
    title: n === 1 ? 'Delete this file?' : `Delete ${n} files?`,
    body: `${plural(n, 'The source file goes', `The ${n} source files go`)} to the Recycle Bin and ${plural(n, 'leaves', 'leave')} the list. Results already made are kept.`
  }
}
