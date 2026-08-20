import type { JSX, MouseEvent } from 'react'
import type { JobOptions, ToolId } from '@shared/types'
import { formatBytes, formatEta, groupOf, inInput, inOutput, type QueueItem } from '../state'
import { Icon } from './Icon'

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const extOf = (p: string): string => {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toUpperCase() : ''
}

function inputSub(item: QueueItem, tool: ToolId, panelOptions: JobOptions): string {
  const src = item.file.ext.replace('.', '').toUpperCase()
  // Once a row has run, describe what IT did; only a not-yet-run row previews
  // the current panel settings.
  const options = item.runOptions ?? panelOptions
  if (tool === 'convert') {
    const to = String(options.format ?? '.webp')
      .replace('.', '')
      .toUpperCase()
    return `${src} → ${to}`
  }
  if (tool === 'resize') {
    if (options.mode === 'percent') return `Resize ${options.percent}%`
    const w = options.width === '' || options.width == null ? 'auto' : options.width
    const h = options.height === '' || options.height == null ? 'auto' : options.height
    return `Resize ${w}×${h}${options.fit === 'stretch' ? ' stretched' : ''}`
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
        {/* One decimal below 10% so a long encode visibly MOVES instead of
            sitting on "0%" for minutes. */}
        {item.hasProgress
          ? `${item.percent < 10 ? item.percent.toFixed(1) : Math.round(item.percent)}%`
          : ''}
      </span>
    )
  return <Icon name="clock" className="h-5 w-5 text-[#b7b7c1]" strokeWidth={1.8} />
}

function ColumnHead({ title }: { title: string }): JSX.Element {
  // shrink-0, never flex-1: inside a vertical Column a growing header would push
  // the cards to the bottom of the column instead of stacking them at the top.
  return (
    <div className="mb-2 min-w-0 shrink-0 px-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">{title}</span>
    </div>
  )
}

function Column({
  title,
  children
}: {
  title: string
  children: JSX.Element[] | JSX.Element
}): JSX.Element {
  // Each column keeps its header so the area below the drop zone reads as
  // "inputs here, outputs there". That header is the only label: no item count.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ColumnHead title={title} />
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-0.5">
        {children}
      </div>
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
  onOpen,
  onMenu
}: {
  item: QueueItem
  tool: ToolId
  options: JobOptions
  selected: boolean
  compatible: boolean
  onClick: (e: MouseEvent) => void
  onOpen: () => void
  onMenu: (x: number, y: number) => void
}): JSX.Element {
  // Determinate only once the job reports a real percentage — a long encode
  // legitimately sits at 0-1% for a while and must NOT fall back to the fake fill.
  const indeterminate = item.status === 'running' && !item.hasProgress
  return (
    <div
      onClick={onClick}
      onDoubleClick={onOpen}
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
        <div className="mt-0.5 truncate text-[11.5px] text-dim" title={item.error ?? undefined}>
          {item.status === 'failed' && item.error ? (
            // Say WHY it failed. "Failed" alone leaves the user guessing.
            <span className="text-[#e0483d]">{item.error}</span>
          ) : (
            <>
              {formatBytes(item.file.size)} <span className="mx-0.5 text-[#c3c3cc]">·</span>{' '}
              {item.status === 'running' && item.etaSec != null && formatEta(item.etaSec)
                ? formatEta(item.etaSec)
                : inputSub(item, tool, options)}
            </>
          )}
        </div>
        {item.status === 'running' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#ececf2]">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-accent-hi to-accent ${
                indeterminate ? 'fs-fill' : 'transition-[width] duration-300 ease-out'
              }`}
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
  selected,
  onClick,
  onOpen,
  onMenu
}: {
  item: QueueItem
  thumb: string | null
  selected: boolean
  onClick: (e: MouseEvent) => void
  onOpen: () => void
  onMenu: (x: number, y: number) => void
}): JSX.Element {
  const out = item.outputPath ?? ''
  return (
    <div
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      className={`group flex cursor-pointer items-center gap-3 rounded-2xl border bg-white p-2.5 shadow-[0_1px_3px_rgba(0,0,0,.05),0_8px_22px_rgba(20,20,40,.05)] transition ${
        selected
          ? 'border-accent ring-2 ring-accent/60'
          : 'border-black/[.07] hover:border-black/[.14]'
      }`}
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
        <div className="mt-0.5 truncate text-[11.5px] text-dim">
          {extOf(out)}
          {item.outputSize != null && (
            <>
              <span className="mx-0.5 text-[#c3c3cc]">·</span>
              {formatBytes(item.outputSize)}
              {/* Change vs the source. Green when it shrank; amber when it grew
                  (re-encoding an already-optimised file can do that) — hiding
                  that just makes compression look broken. */}
              {item.file.size > 0 &&
                (item.outputSize < item.file.size ? (
                  <span className="ml-1 font-semibold text-[#12a150]">
                    −{Math.round((1 - item.outputSize / item.file.size) * 100)}%
                  </span>
                ) : (
                  <span
                    className="ml-1 font-semibold text-[#b7791f]"
                    title="Bigger than the original — this file was already well compressed"
                  >
                    +{Math.round((item.outputSize / item.file.size - 1) * 100)}%
                  </span>
                ))}
            </>
          )}
        </div>
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
  activeGroup,
  outThumbs,
  onItemClick,
  onOpen,
  onMenu
}: {
  items: QueueItem[]
  tool: ToolId
  options: JobOptions
  selected: string[]
  activeGroup: string | null
  outThumbs: Record<string, string | null>
  onItemClick: (id: string, e: MouseEvent) => void
  onOpen: (side: 'input' | 'output', item: QueueItem) => void
  onMenu: (side: 'input' | 'output', item: QueueItem, x: number, y: number) => void
}): JSX.Element {
  const inputs = items.filter(inInput)
  const done = items.filter(inOutput)
  // A single "No items in queue" centred under the two headers, rather than a
  // separate placeholder per column, so the empty state reads as one message.
  if (items.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex gap-5">
          <div className="flex-1">
            <ColumnHead title="Input" />
          </div>
          <div className="flex-1">
            <ColumnHead title="Output" />
          </div>
        </div>
        <div className="grid flex-1 place-items-center">
          <span className="text-[13.5px] font-medium text-[#a2a2ac]">No items in queue</span>
        </div>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 gap-5">
      <Column title="Input">
        {inputs.map((i) => (
          <InputCard
            key={i.id}
            item={i}
            tool={tool}
            options={options}
            selected={selected.includes(i.id)}
            compatible={activeGroup === null || groupOf(i.file) === activeGroup}
            onClick={(e) => onItemClick(i.id, e)}
            onOpen={() => onOpen('input', i)}
            onMenu={(x, y) => onMenu('input', i, x, y)}
          />
        ))}
      </Column>
      <Column title="Output">
        {done.map((i) => (
          <OutputCard
            key={i.id}
            item={i}
            thumb={i.outputPath ? (outThumbs[i.outputPath] ?? null) : null}
            selected={selected.includes(i.id)}
            onClick={(e) => onItemClick(i.id, e)}
            onOpen={() => onOpen('output', i)}
            onMenu={(x, y) => onMenu('output', i, x, y)}
          />
        ))}
      </Column>
    </div>
  )
}
