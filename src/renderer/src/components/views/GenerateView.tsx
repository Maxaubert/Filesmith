import type { JSX } from 'react'
import { EmptyState } from '../queue/EmptyState'
import { ProgressBar } from '../ui/ProgressBar'

const mediaUrl = (p: string): string => `fsmedia://local/${encodeURIComponent(p)}`

export function GenerateView({
  prompt,
  onPrompt,
  running,
  slots,
  results,
  aspect,
  blocked,
  focused,
  onFocus,
  onOpen,
  onMenu
}: {
  prompt: string
  onPrompt: (v: string) => void
  running: boolean
  slots: { pct: number; path?: string }[]
  results: string[]
  aspect: string
  /** Why Generate cannot run yet (no model), shown in the empty state. */
  blocked: string | null
  focused: string | null
  onFocus: (path: string) => void
  onOpen: (path: string) => void
  onMenu: (path: string, x: number, y: number) => void
}): JSX.Element {
  const tile = (path: string, key: string): JSX.Element => (
    <button
      key={key}
      type="button"
      className={`gtile${focused === path ? ' sel' : ''}`}
      style={{ aspectRatio: aspect }}
      title={path}
      onClick={() => onFocus(path)}
      onDoubleClick={() => onOpen(path)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(path, e.clientX, e.clientY)
      }}
    >
      <img src={mediaUrl(path)} alt="" />
    </button>
  )
  return (
    <>
      {/* No toolbar row: the prompt sits flush under the title bar, and Run and
          Stop live in the inspector footer only (owner, 2026-10-05). */}
      <div className="vbody full scroll-thin">
        <textarea
          className="prompt"
          aria-label="Prompt"
          placeholder="Describe the image you want"
          rows={6}
          spellCheck={false}
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
        />
        {running || results.length > 0 ? (
          <div className="gen-grid">
            {running &&
              slots.map((s, i) =>
                s.path ? (
                  tile(s.path, `slot-${i}`)
                ) : (
                  <div key={`slot-${i}`} className="gtile pending" style={{ aspectRatio: aspect }}>
                    <span className="mono">{s.pct > 0 ? `${s.pct}%` : '…'}</span>
                    <ProgressBar wide value={s.pct > 0 ? s.pct : null} label="Generating" />
                  </div>
                )
              )}
            {results.map((p) => tile(p, p))}
          </div>
        ) : (
          <EmptyState
            icon="generate"
            title={blocked ? 'No image model yet' : 'Nothing generated yet'}
            line={
              blocked
                ? blocked.startsWith('Choose')
                  ? 'Choose your ComfyUI folder in Options, then write a prompt'
                  : 'Add an image model in Options, then write a prompt'
                : 'Write a prompt, then press Generate'
            }
          />
        )}
      </div>
    </>
  )
}
