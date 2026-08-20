import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react'

// The window is frameless: a render throw used to blank it entirely, with no
// menu bar and no way to recover — and a throw caused by a bad persisted item
// reproduced on every launch. This boundary keeps the failure visible and
// offers the two exits that actually help: reload, or reset the saved session
// and reload.

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] render error:', error, info.componentStack)
  }

  private reset = (): void => {
    // Clear the persisted session first: if a restored item caused the throw,
    // a plain reload would just crash again.
    try {
      window.filesmith.sessionSave(null)
    } catch {
      /* reload regardless */
    }
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-screen place-items-center bg-[#f4f4f6] p-8">
        <div className="w-full max-w-md rounded-2xl border border-black/[.08] bg-white p-6 shadow-[0_8px_30px_rgba(20,20,40,.08)]">
          <h1 className="text-[15px] font-semibold text-ink">Something went wrong</h1>
          <p className="mt-2 select-text break-words text-[12.5px] leading-relaxed text-dim">
            {this.state.error.message}
          </p>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 rounded-xl bg-black py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#242424]"
            >
              Reload
            </button>
            <button
              onClick={this.reset}
              title="Clears the saved queues and options, then reloads"
              className="flex-1 rounded-xl border border-black/[.12] bg-white py-2.5 text-[13px] font-semibold text-ink transition hover:border-[#b9b9c8]"
            >
              Reset session
            </button>
          </div>
        </div>
      </div>
    )
  }
}

/** One JSX Element wrapper so main.tsx stays a single expression. */
export function Boundary({ children }: { children: ReactNode }): JSX.Element {
  return <ErrorBoundary>{children}</ErrorBoundary>
}
