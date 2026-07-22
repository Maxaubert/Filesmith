import { useEffect, useRef, type JSX } from 'react'

export interface ConfirmState {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
}

/**
 * A modal confirmation for actions that are legitimate but expensive enough that
 * the user should see the cost first (a 40 GB upscale). Native <dialog> so focus
 * trapping, Escape, and the backdrop come from the platform rather than
 * hand-rolled z-index and key handlers.
 *
 * `m-auto` on the dialog is load-bearing: centring a modal <dialog> in the top
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
      className="m-auto max-w-[420px] rounded-[18px] border border-black/[.08] bg-white p-0 text-ink shadow-[0_24px_60px_rgba(0,0,0,.22)] backdrop:bg-black/25"
    >
      <div className="px-6 pb-5 pt-6">
        <h2 className="text-[17px] font-bold">{state.title}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{state.body}</p>
        <div className="mt-6 flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="rounded-xl border border-black/[.10] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#33333a] transition hover:border-[#b9b9c8]"
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={() => {
              state.onConfirm()
              onClose()
            }}
            className="rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-accent-hi"
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
