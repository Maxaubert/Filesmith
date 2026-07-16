import type { JSX } from 'react'
import type { JobOptions, ToolId } from '@shared/types'
import { formatBytes, type QueueItem } from '../state'
import { Icon } from './Icon'

function subline(item: QueueItem, tool: ToolId, options: JobOptions): string {
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
  return 'Compress'
}

function StatusCell({ item }: { item: QueueItem }): JSX.Element {
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
  // ready / queued
  return <Icon name="clock" className="h-5 w-5 text-[#b7b7c1]" strokeWidth={1.8} />
}

function FileCard({
  item,
  tool,
  options
}: {
  item: QueueItem
  tool: ToolId
  options: JobOptions
}): JSX.Element {
  const indeterminate = item.status === 'running' && !item.percent
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-black/[.07] bg-white p-[11px] shadow-[0_1px_3px_rgba(0,0,0,.05),0_10px_30px_rgba(20,20,40,.06)]">
      <div className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[11px] bg-[#ececf1] shadow-[inset_0_0_0_1px_rgba(0,0,0,.05)]">
        {item.thumb ? (
          <img src={item.thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[10px] font-semibold uppercase text-dim">
            {item.file.ext.replace('.', '')}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{item.file.name}</div>
        <div className="mt-0.5 text-xs text-dim">
          {formatBytes(item.file.size)} <span className="mx-1 text-[#c3c3cc]">·</span>{' '}
          {subline(item, tool, options)}
        </div>
        {item.status === 'running' && (
          <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-[#ececf2]">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-accent-hi to-accent ${indeterminate ? 'w-1/3 animate-pulse' : ''}`}
              style={indeterminate ? undefined : { width: `${item.percent}%` }}
            />
          </div>
        )}
        {item.status === 'failed' && item.error && (
          <div className="mt-1 truncate text-xs text-[#e0483d]">{item.error}</div>
        )}
      </div>
      <div className="shrink-0 pr-1">
        <StatusCell item={item} />
      </div>
    </div>
  )
}

export function Queue({
  items,
  tool,
  options,
  onClear
}: {
  items: QueueItem[]
  tool: ToolId
  options: JobOptions
  onClear: () => void
}): JSX.Element {
  const active = items.filter((i) => i.status === 'running' || i.status === 'queued').length
  const done = items.filter((i) => i.status === 'done').length
  const counts =
    items.length === 0 ? '0 items' : `${active} in progress · ${done} done · ${items.length} total`
  const hasFinished = items.some((i) => i.status === 'done')

  return (
    <>
      <div className="flex shrink-0 items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">Queue</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">{counts}</span>
          {hasFinished && (
            <button onClick={onClear} className="text-xs text-muted transition hover:text-accent">
              Clear finished
            </button>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="grid flex-1 place-items-center">
          <div className="text-[14.5px] font-medium text-[#a2a2ac]">No items in the queue</div>
        </div>
      ) : (
        <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto pr-0.5">
          {items.map((i) => (
            <FileCard key={i.id} item={i} tool={tool} options={options} />
          ))}
        </div>
      )}
    </>
  )
}
