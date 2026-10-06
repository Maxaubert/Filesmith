/** The next menu state when `next` is asked for: a second click on the trigger
 *  of the open menu closes it instead of reopening it (open, close, open...). */
export function toggleMenu<T extends { trigger?: unknown }>(cur: T | null, next: T): T | null {
  return cur && next.trigger != null && cur.trigger === next.trigger ? null : next
}
