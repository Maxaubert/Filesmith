import type { JSX, MouseEvent } from 'react'
import { Icon } from '../icons/Icon'
import { outputForLine, progressText, type Block } from './consoleModel'

/** The scrollback: notes and command blocks (spec 7). */
export function ConsoleOutput({
  blocks,
  onTerminal,
  onReveal,
  onRowMenu
}: {
  blocks: Block[]
  onTerminal: () => void
  onReveal: (path: string) => void
  onRowMenu: (e: MouseEvent, path: string) => void
}): JSX.Element {
  return (
    <div>
      {blocks.map((b) =>
        b.kind === 'note' ? (
          <div key={b.id} className="ln note">
            {b.text}
          </div>
        ) : (
          <div key={b.id} className="blk">
            <div className="ln cmd">
              <span className="pr">{`${b.cwd}> `}</span>
              <span className="fx">filesmith </span>
              <span className="tx">{b.line}</span>
              <span className={`dec${b.code ? ' bad' : ''}`}>
                {b.status === 'refused'
                  ? 'not run'
                  : b.status === 'running'
                    ? b.stopping
                      ? 'stopping'
                      : 'running'
                    : b.status === 'done' && (
                        <>
                          <Icon name={b.code ? 'warning' : 'check'} size={12} />
                          {`exit ${b.code}${b.ms != null ? `  ${(b.ms / 1000).toFixed(1)} s` : ''}`}
                        </>
                      )}
              </span>
            </div>
            {b.refusal && (
              <div className="ln refuse">
                <Icon name="info" />
                <span>{b.refusal}</span>
                <button type="button" className="sbtn mini" onClick={onTerminal}>
                  <Icon name="external" size={12} />
                  Open in terminal
                </button>
              </div>
            )}
            {b.lines.map((l, i) => {
              const out = outputForLine(l.text, b.outputs)
              const last = b.status === 'done' && l.style === 'sum' && b.outputs.length > 0
              return (
                <div
                  key={i}
                  className={`ln ${l.style}`}
                  onContextMenu={out ? (e) => onRowMenu(e, out) : undefined}
                >
                  {l.text}
                  {last && (
                    <span className="acts">
                      <button
                        type="button"
                        className="sbtn mini"
                        onClick={() => onReveal(b.outputs[0])}
                      >
                        <Icon name="folder" size={12} />
                        Show in File Explorer
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
            {b.progress && (
              <div className="ln prog" aria-live="off">
                {progressText(b.progress)}
                {b.progress.pct != null && (
                  <span className="bar">
                    <i style={{ width: `${b.progress.pct}%` }} />
                  </span>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
