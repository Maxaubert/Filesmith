import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
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
  canRun,
  focused,
  onRun,
  onCancel,
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
  canRun: boolean
  focused: string | null
  onRun: () => void
  onCancel: () => void
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
      <div className="toolbar" role="toolbar" aria-label="Generate actions">
        <button
          type="button"
          className="tbtn add"
          disabled={!canRun}
          onClick={onRun}
          title="Generate (Ctrl+Enter)"
        >
          <Icon name="play" />
          Generate
        </button>
        {running && (
          <button type="button" className="tbtn" onClick={onCancel}>
            <Icon name="close" />
            Cancel
          </button>
        )}
      </div>
      <div className="vbody scroll-thin">
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
            title="Nothing generated yet"
            line="Write a prompt, then press Generate"
          />
        )}
      </div>
    </>
  )
}
