import { useEffect, useRef, type JSX } from 'react'
import { Icon } from './icons/Icon'
import { SmallButton } from './ui/Button'

export interface ConfirmState {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  /** An alert has one button; rendering Cancel + OK (both closing) implied a
   * choice that did not exist. */
  hideCancel?: boolean
  /** Destructive/expensive confirms focus Cancel, so a stray Enter cannot
   * approve a 40 GB upscale or a multi-file delete. */
  danger?: boolean
}

/**
 * A modal confirmation for actions that are legitimate but expensive enough that
 * the user should see the cost first (a 40 GB upscale). Native <dialog> so focus
 * trapping, Escape, and the backdrop come from the platform rather than
 * hand-rolled z-index and key handlers.
 *
 * `margin: auto` on `.dlg` is load-bearing: centring a modal <dialog> in the top
 * layer relies on the UA's `margin: auto`, and Tailwind's preflight zeroes every
 * element's margin, which pins it to the top-left corner instead.
 */
export function ConfirmDialog({
  state,
  onClose
}: {
  state: ConfirmState | null
  onClose: () => void
}): JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (state && !el.open) el.showModal()
    if (!state && el.open) el.close()
  }, [state])

  if (!state) return null
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself, outside the card).
        if (e.target === ref.current) onClose()
      }}
      className="modal-pop dlg"
    >
      <div className="dlg-body">
        <h2>
          {state.danger && <Icon name="warning" />}
          {state.title}
        </h2>
        <p className="select-text">{state.body}</p>
      </div>
      <div className="dlg-foot">
        {!state.hideCancel && (
          <SmallButton autoFocus={state.danger} onClick={onClose}>
            Cancel
          </SmallButton>
        )}
        <button
          type="button"
          className="dlg-ok"
          autoFocus={!state.danger}
          onClick={() => {
            state.onConfirm()
            onClose()
          }}
        >
          {state.confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
