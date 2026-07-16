import type { JSX, MouseEvent } from 'react'
import type { FileKind, JobOptions, ToolId } from '@shared/types'
import { formatBytes, type QueueItem } from '../state'
import { Icon } from './Icon'

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const extOf = (p: string): string => {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toUpperCase() : ''
}

function inputSub(item: QueueItem, tool: ToolId, options: JobOptions): string {
  const src = item.file.ext.replace('.', '').toUpperCase()
  if (tool === 'convert') {
    const to = String(options.format ?? '.webp')
      .replace('.', '')
      .toUpperCase()
    return `${src} → ${to}`
  }
  if (tool === 'resize') {
    return options.mode === 'percent'
      ? `Resize ${options.percent}%`
      : `Resize ${options.width ?? ''}×${options.height ?? ''}`
  }
  return `Compress ${src}`
}

function StatusCell({ item }: { item: QueueItem }): JSX.Element | null {
  if (item.status === 'done')
    return (
      <span className="grid h-5 w-5 place-items-center rounded-full bg-[#12a150]">
        <Icon name="check" className="h-3 w-3 text-white" strokeWidth={3} />
      </span>
    )
  if (item.status === 'failed')
    return <span className="text-xs font-semibold text-[#e0483d]">Failed</span>
  if (item.status === 'canceled')
    return <span className="text-xs font-semibold text-dim">Canceled</span>
  if (item.status === 'running')
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-accent">
        <span className="h-[7px] w-[7px] rounded-full bg-accent" />
        {item.percent ? `${Math.round(item.percent)}%` : ''}
      </span>
    )
  return <Icon name="clock" className="h-5 w-5 text-[#b7b7c1]" strokeWidth={1.8} />
}

function Column({
  title,
  count,
  children,
  empty
}: {
  title: string
  count: number
  children: JSX.Element[] | JSX.Element
  empty: string
}): JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">{title}</span>
        <span className="text-xs text-muted">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      </div>
      {count === 0 ? (
        <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-black/[.06]">
          <div className="text-[13.5px] font-medium text-[#a2a2ac]">{empty}</div>
        </div>
      ) : (
        <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-0.5">
          {children}
        </div>
      )}
    </div>
  )
}

function Kebab({ onOpen }: { onOpen: (x: number, y: number) => void }): JSX.Element {
  return (
    <button
      title="More actions"
      onClick={(e) => {
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        onOpen(r.right, r.bottom + 6)
      }}
      className="no-drag grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg text-[#9a9aa6] opacity-0 transition hover:bg-[#f0f0f5] hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Icon name="dots" className="h-[18px] w-[18px]" strokeWidth={0} />
    </button>
  )
}

function InputCard({
  item,
  tool,
  options,
  selected,
  compatible,
  onClick,
  onMenu
}: {
  item: QueueItem
  tool: ToolId
  options: JobOptions
  selected: boolean
  compatible: boolean
  onClick: (e: MouseEvent) => void
  onMenu: (x: number, y: number) => void
}): JSX.Element {
  const indeterminate = item.status === 'running' && !item.percent
  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      title={compatible ? undefined : 'A different file type than the current selection'}
      className={`group flex cursor-pointer items-center gap-3 rounded-2xl border bg-white p-2.5 shadow-[0_1px_3px_rgba(0,0,0,.05),0_8px_22px_rgba(20,20,40,.05)] transition ${
        selected
          ? 'border-accent ring-2 ring-accent/60'
          : 'border-black/[.07] hover:border-black/[.14]'
      } ${compatible ? '' : 'opacity-40'}`}
    >
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[9px] bg-[#ececf1] shadow-[inset_0_0_0_1px_rgba(0,0,0,.05)]">
        {item.thumb ? (
          <img src={item.thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[9px] font-semibold uppercase text-dim">
            {item.file.ext.replace('.', '')}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{item.file.name}</div>
        <div className="mt-0.5 truncate text-[11.5px] text-dim">
          {formatBytes(item.file.size)} <span className="mx-0.5 text-[#c3c3cc]">·</span>{' '}
          {inputSub(item, tool, options)}
        </div>
        {item.status === 'running' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#ececf2]">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-accent-hi to-accent ${indeterminate ? 'w-1/3 animate-pulse' : ''}`}
              style={indeterminate ? undefined : { width: `${item.percent}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 pr-0.5">
        <Kebab onOpen={onMenu} />
        <StatusCell item={item} />
      </div>
    </div>
  )
}

function OutputCard({
  item,
  thumb,
  onReveal,
  onMenu
}: {
  item: QueueItem
  thumb: string | null
  onReveal: () => void
  onMenu: (x: number, y: number) => void
}): JSX.Element {
  const out = item.outputPath ?? ''
  return (
    <div
      onClick={onReveal}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      title="Reveal in folder"
      className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-black/[.07] bg-white p-2.5 shadow-[0_1px_3px_rgba(0,0,0,.05),0_8px_22px_rgba(20,20,40,.05)] transition hover:border-accent"
    >
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[9px] bg-[#ececf1] shadow-[inset_0_0_0_1px_rgba(0,0,0,.05)]">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[9px] font-semibold uppercase text-dim">
            {extOf(out)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{baseName(out)}</div>
        <div className="mt-0.5 text-[11.5px] text-dim">{extOf(out)} · saved</div>
      </div>
      <div className="shrink-0 pr-0.5">
        <Kebab onOpen={onMenu} />
      </div>
    </div>
  )
}

export function Queues({
  items,
  tool,
  options,
  selected,
  activeKind,
  outThumbs,
  onItemClick,
  onReveal,
  onMenu
}: {
  items: QueueItem[]
  tool: ToolId
  options: JobOptions
  selected: string[]
  activeKind: FileKind | null
  outThumbs: Record<string, string | null>
  onItemClick: (id: string, e: MouseEvent) => void
  onReveal: (path: string) => void
  onMenu: (side: 'input' | 'output', item: QueueItem, x: number, y: number) => void
}): JSX.Element {
  const done = items.filter((i) => i.status === 'done' && i.outputPath)
  return (
    <div className="flex min-h-0 flex-1 gap-5">
      <Column title="Input" count={items.length} empty="No files yet">
        {items.map((i) => (
          <InputCard
            key={i.id}
            item={i}
            tool={tool}
            options={options}
            selected={selected.includes(i.id)}
            compatible={activeKind === null || i.file.kind === activeKind}
            onClick={(e) => onItemClick(i.id, e)}
            onMenu={(x, y) => onMenu('input', i, x, y)}
          />
        ))}
      </Column>
      <Column title="Output" count={done.length} empty="No results yet">
        {done.map((i) => (
          <OutputCard
            key={i.id}
            item={i}
            thumb={i.outputPath ? (outThumbs[i.outputPath] ?? null) : null}
            onReveal={() => i.outputPath && onReveal(i.outputPath)}
            onMenu={(x, y) => onMenu('output', i, x, y)}
          />
        ))}
      </Column>
    </div>
  )
}
