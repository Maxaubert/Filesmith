import type { JSX, ReactNode } from 'react'
import { Icon } from './Icon'

function WinBtn({ children, onClick }: { children: ReactNode; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="grid w-11 place-items-center text-dim transition hover:bg-black/[.06] hover:text-ink"
    >
      {children}
    </button>
  )
}

/** Frameless top strip: the drag handle plus the custom window controls, which
    run full-height flush into the top-right corner (the OS rounds the corner). */
export function TopBar(): JSX.Element {
  const w = window.filesmith
  return (
    <div className="drag flex h-10 shrink-0 items-stretch">
      <div className="flex flex-1 items-center gap-2.5 pl-3.5">
        <div className="grid h-6 w-6 place-items-center rounded-[7px] bg-accent text-white shadow-[0_3px_8px_rgba(91,91,214,.35)]">
          <Icon name="logo" className="h-3.5 w-3.5" />
        </div>
        <span className="text-[13px] font-bold tracking-tight">Filesmith</span>
      </div>
      <div className="no-drag flex items-stretch">
        <WinBtn onClick={() => w.minimize()}>
          <Icon name="min" className="h-3.5 w-3.5" strokeWidth={1.6} />
        </WinBtn>
        <WinBtn onClick={() => w.toggleMaximize()}>
          <Icon name="max" className="h-3 w-3" strokeWidth={1.6} />
        </WinBtn>
        <WinBtn onClick={() => w.close()}>
          <Icon name="close" className="h-3.5 w-3.5" strokeWidth={1.6} />
        </WinBtn>
      </div>
    </div>
  )
}
