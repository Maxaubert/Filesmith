import type { JSX } from 'react'

export type SizeRow = { name: string; from: string; to: string }

/** Input to output resolution list under the video scale, resize and upscale
 * settings (replaces three identical copies). */
export function OutputSizeList({ rows }: { rows: SizeRow[] }): JSX.Element | null {
  if (!rows.length) return null
  return (
    <ul className="sizes mono">
      {rows.map((r, i) => (
        <li key={`${i}-${r.name}`} title={r.name}>
          <span className="nm">{r.name}</span>
          <span>
            {r.from} to {r.to}
          </span>
        </li>
      ))}
    </ul>
  )
}
