import { inOutput, type QueueItem } from '../state'

// Kept apart from CompletedView.tsx so that file exports only components
// (React Fast Refresh requires that), matching queueGroups.ts.

/** A produced file, plus which workspace made it (so the list can say). */
export interface CompletedItem {
  item: QueueItem
  from: string
}

/** Every finished output across every workspace, newest last in each queue. */
export function collectCompleted(
  queues: Partial<Record<string, { items: QueueItem[] }>>,
  labelFor: (key: string) => string
): CompletedItem[] {
  const out: CompletedItem[] = []
  for (const [key, q] of Object.entries(queues)) {
    if (!q) continue
    for (const item of q.items.filter(inOutput)) out.push({ item, from: labelFor(key) })
  }
  // Newest first: the thing you just made is the thing you want.
  return out.reverse()
}
