import type { JSX, ReactNode } from 'react'
import { Icon } from './Icon'

function WinBtn({
  children,
  onClick,
  close
}: {
  children: ReactNode
  onClick: () => void
  close?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`grid h-7 w-8 place-items-center rounded-md text-dim transition hover:text-ink ${
        close ? 'hover:bg-[#ff5f57] hover:text-white' : 'hover:bg-black/[.06]'
      }`}
    >
      {children}
    </button>
  )
}

/** Frameless top strip: the drag handle plus the custom window controls. */
export function TopBar(): JSX.Element {
  const w = window.filesmith
  return (
    <div className="drag flex h-10 shrink-0 items-center gap-2 px-3">
      <div className="flex items-center gap-2.5 pl-0.5">
        <div className="grid h-6 w-6 place-items-center rounded-[7px] bg-accent text-white shadow-[0_3px_8px_rgba(91,91,214,.35)]">
          <Icon name="logo" className="h-3.5 w-3.5" />
        </div>
        <span className="text-[13px] font-bold tracking-tight">Filesmith</span>
      </div>
      <div className="flex-1" />
      <div className="no-drag flex items-center gap-0.5">
        <WinBtn onClick={() => w.minimize()}>
          <Icon name="min" className="h-3.5 w-3.5" strokeWidth={1.6} />
        </WinBtn>
        <WinBtn onClick={() => w.toggleMaximize()}>
          <Icon name="max" className="h-3 w-3" strokeWidth={1.6} />
        </WinBtn>
        <WinBtn close onClick={() => w.close()}>
          <Icon name="close" className="h-3.5 w-3.5" strokeWidth={1.6} />
        </WinBtn>
      </div>
    </div>
  )
}
