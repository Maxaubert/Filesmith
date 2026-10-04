import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { Breadcrumb } from './Breadcrumb'
import type { Crumb, CrumbAction } from './crumbs'

export function TitleBar({
  crumbs,
  onCrumb
}: {
  crumbs: Crumb[]
  onCrumb: (a: CrumbAction) => void
}): JSX.Element {
  return (
    <header className="titlebar drag">
      <div className="brand">
        <Icon name="anvil" />
        <span>Filesmith</span>
      </div>
      <div className="tsep" />
      <Breadcrumb crumbs={crumbs} onCrumb={onCrumb} />
      {/* Window controls: 10x10 glyphs at stroke 1; close is not red (spec 2.5). */}
      <div className="winctl no-drag">
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => window.filesmith.minimize()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Maximize"
          title="Maximize"
          onClick={() => window.filesmith.toggleMaximize()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x=".5" y=".5" width="9" height="9" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={() => window.filesmith.close()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </button>
      </div>
    </header>
  )
}
