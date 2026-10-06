import { useLayoutEffect, useRef, type JSX } from 'react'
import type { CompletionItem } from '@shared/consoleComplete'

/** The Tab list above the prompt (spec 8): at most eight rows. */
export function CompletionList({
  title,
  prefix,
  items,
  active,
  anchor,
  onPick
}: {
  title: string
  prefix: string
  items: CompletionItem[]
  active: number
  anchor: { left: number; bottom: number }
  onPick: (i: number) => void
}): JSX.Element {
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const d = el.current
    if (!d) return
    d.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - d.offsetWidth - 8))}px`
    d.style.bottom = `${anchor.bottom}px`
  }, [anchor, items])
  return (
    <div ref={el} className="comp" role="listbox" aria-label="Completions" id="console-comp">
      <div className="gh">{title}</div>
      <ul>
        {items.slice(0, 8).map((it, i) => (
          <li
            key={it.value}
            id={`console-comp-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(i)
            }}
          >
            <span className="v">
              <b>{it.value.slice(0, prefix.length)}</b>
              {it.value.slice(prefix.length)}
            </span>
            <span className="d">{it.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
