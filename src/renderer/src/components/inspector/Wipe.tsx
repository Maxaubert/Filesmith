import { useRef, useState, type JSX } from 'react'
import { wipeStep } from './infoModel'

/** Source left, result right, a 1px fg1 divider you can drag (spec 4.6, O9). */
export function Wipe({
  left,
  right,
  leftTag,
  rightTag
}: {
  left: string | null
  right: string | null
  leftTag: string
  rightTag?: string
}): JSX.Element {
  const [pos, setPos] = useState(50)
  const frame = useRef<HTMLDivElement>(null)
  function fromPointer(clientX: number): void {
    const r = frame.current?.getBoundingClientRect()
    if (r) setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }
  const split = right != null
  return (
    <div
      ref={frame}
      className="wipe"
      onPointerDown={(e) => {
        if (!split) return
        e.currentTarget.setPointerCapture(e.pointerId)
        fromPointer(e.clientX)
      }}
      onPointerMove={(e) => {
        if (split && e.buttons === 1) fromPointer(e.clientX)
      }}
    >
      {left ? (
        <img className="wimg" src={left} alt="" />
      ) : (
        <span className="wext mono">{leftTag.split(' ')[0]}</span>
      )}
      {split && right && (
        <img className="wimg" src={right} alt="" style={{ clipPath: `inset(0 0 0 ${pos}%)` }} />
      )}
      {split && (
        <div
          className="line"
          role="slider"
          tabIndex={0}
          aria-label="Compare source and result"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          style={{ left: `${pos}%` }}
          onKeyDown={(e) => {
            const n = wipeStep(e.key, pos)
            if (n == null) return
            e.preventDefault()
            setPos(n)
          }}
        />
      )}
      <span className="tag l">{leftTag}</span>
      {rightTag && <span className="tag r">{rightTag}</span>}
    </div>
  )
}
