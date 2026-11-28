import { useCallback, useRef, useState } from 'react'

// The window-wide drop highlight. dragenter/dragleave fire on every child the
// pointer crosses, so a plain "leave clears it" check only worked when the
// target was the .app element itself, which children cover completely. A drag
// that left the window (or was cancelled with Esc) then kept the highlight on.
// Counting enters against leaves fixes that.

export type DropHighlightEvent =
  | { type: 'enter' }
  /** `leftWindow`: the leave had no relatedTarget, so the pointer left the window. */
  | { type: 'leave'; leftWindow: boolean }
  /** A drop, a cancelled drag (dragend) or the window losing focus. */
  | { type: 'reset' }

/** The enter/leave depth after one drag event. Never negative. */
export function nextDropDepth(depth: number, ev: DropHighlightEvent): number {
  switch (ev.type) {
    case 'enter':
      return depth + 1
    case 'leave':
      return ev.leftWindow ? 0 : Math.max(0, depth - 1)
    case 'reset':
      return 0
  }
}

/** The highlight shows while the drag is inside the window. */
export function dropHighlightOn(depth: number): boolean {
  return depth > 0
}

/**
 * The drop highlight as React state. `over(accepting)` keeps the existing rule
 * that only a view that takes drops lights up; enter/leave only track whether
 * the drag is still inside the window. The caller wires `reset` to drop,
 * window blur and document dragend (this file stays DOM-free so the node tests
 * can import it).
 */
export function useDropHighlight(): {
  dragging: boolean
  enter: () => void
  leave: (relatedTarget: EventTarget | null) => void
  over: (accepting: boolean) => void
  reset: () => void
} {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const apply = useCallback((ev: DropHighlightEvent): void => {
    depth.current = nextDropDepth(depth.current, ev)
    if (!dropHighlightOn(depth.current)) setDragging(false)
  }, [])

  const enter = useCallback(() => apply({ type: 'enter' }), [apply])
  const leave = useCallback(
    (relatedTarget: EventTarget | null) => apply({ type: 'leave', leftWindow: !relatedTarget }),
    [apply]
  )
  const reset = useCallback(() => apply({ type: 'reset' }), [apply])
  const over = useCallback((accepting: boolean) => {
    // dragover only fires inside the window, so a depth lost to a missed enter
    // is restored here.
    if (depth.current === 0) depth.current = 1
    if (accepting) setDragging(true)
  }, [])

  return { dragging, enter, leave, over, reset }
}
