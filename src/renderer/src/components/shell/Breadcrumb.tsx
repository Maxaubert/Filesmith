import { Fragment, type JSX } from 'react'
import type { Crumb, CrumbAction } from './crumbs'

export function Breadcrumb({
  crumbs,
  onCrumb
}: {
  crumbs: Crumb[]
  onCrumb: (a: CrumbAction) => void
}): JSX.Element {
  return (
    <nav className="crumb no-drag" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">/</span>}
          {i === crumbs.length - 1 ? (
            <b aria-current="page">{c.label}</b>
          ) : c.action ? (
            <button
              type="button"
              aria-label={c.ariaLabel}
              title={c.ariaLabel}
              onClick={() => onCrumb(c.action as CrumbAction)}
            >
              {c.label}
            </button>
          ) : (
            <span>{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
