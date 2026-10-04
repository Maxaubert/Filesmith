import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './icons/Icon'
import { SmallButton } from './ui/Button'

// The window is frameless: a render throw used to blank it entirely, with no
// menu bar and no way to recover, and a throw caused by a bad persisted item
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
      <div className="crash" role="alert">
        <Icon name="warning" />
        <h1>Something went wrong</h1>
        <p className="mono select-text">{this.state.error.message}</p>
        <div className="crash-actions">
          <SmallButton icon="retry" onClick={() => window.location.reload()}>
            Reload
          </SmallButton>
          <SmallButton
            icon="trash"
            onClick={this.reset}
            title="Clears the saved queues and options, then reloads"
          >
            Reset session
          </SmallButton>
        </div>
      </div>
    )
  }
}
