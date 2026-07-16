import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type MouseEvent
} from 'react'
import type { FileKind, ToolId } from '@shared/types'
import {
  categoryFormats,
  defaultTargetExt,
  isSameFormat,
  normalizeExt,
  toolForKind
} from '@shared/convert'
import { reducer, initialState, inInput, inOutput, type QueueItem, type SelectMode } from './state'
import { toolMeta } from './lib/tools'
import { TopBar } from './components/TopBar'
import { ToolRail } from './components/ToolRail'
import { DropZone } from './components/DropZone'
import { Queues } from './components/Queue'
import { OptionsPanel } from './components/OptionsPanel'
import { ContextMenu, type MenuState } from './components/ContextMenu'
import { PreviewModal, type PreviewFile } from './components/PreviewModal'

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

export default function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [dragging, setDragging] = useState(false)
  const [outThumbs, setOutThumbs] = useState<Record<string, string | null>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [preview, setPreview] = useState<{ files: PreviewFile[]; index: number } | null>(null)
  const requested = useRef<Set<string>>(new Set())
  const outRequested = useRef<Set<string>>(new Set())

  // The active tool's queue drives the UI. Thumbnails, however, load for items
  // across every queue so switching tabs is instant.
  const cur = state.queues[state.tool]

  // Stream job progress/terminal events into state.
  useEffect(() => window.filesmith.onJobEvent((e) => dispatch({ type: 'jobEvent', event: e })), [])

  // Stop the browser from navigating when a file is dropped outside the zone.
  useEffect(() => {
    const prevent = (e: Event): void => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // Lazy-load a real thumbnail for each item, once. Works across kinds: images
  // (incl. exotic formats via magick), videos (ffmpeg frame), audio cover art.
  useEffect(() => {
    for (const q of Object.values(state.queues)) {
      for (const item of q.items) {
        if (item.thumb !== null || requested.current.has(item.id)) continue
        requested.current.add(item.id)
        void window.filesmith
          .thumbnail(item.file.path, 128, item.file.kind)
          .then((t) => dispatch({ type: 'setThumb', id: item.id, thumb: t }))
      }
    }
  }, [state.queues])

  // Lazy-load thumbnails for finished output files, once each (output keeps the
  // input's kind — convert never crosses categories).
  useEffect(() => {
    for (const q of Object.values(state.queues)) {
      for (const item of q.items) {
        const out = item.outputPath
        if (!out || item.status !== 'done' || outRequested.current.has(out)) continue
        outRequested.current.add(out)
        void window.filesmith
          .thumbnail(out, 128, item.file.kind)
          .then((t) => setOutThumbs((m) => ({ ...m, [out]: t })))
      }
    }
  }, [state.queues])

  // --- Selection-derived state (current tool's queue) --------------------------
  const selectedItems = cur.items.filter((i) => cur.selected.includes(i.id))
  const activeKind: FileKind | null = selectedItems.length ? selectedItems[0].file.kind : null
  const srcNorms = new Set(selectedItems.map((i) => normalizeExt(i.file.ext)))
  const sourceExt: string | null = srcNorms.size === 1 ? [...srcNorms][0] : null

  const canRun = (i: QueueItem): boolean =>
    i.status === 'ready' || i.status === 'failed' || i.status === 'canceled'

  // The files a run would actually process: selected, runnable, tool-compatible,
  // and (for convert) not already the target format.
  const runList: QueueItem[] = selectedItems.filter((i) => {
    if (!canRun(i)) return false
    if (state.tool === 'convert') {
      const fmt = String(state.options.convert.format ?? '')
      return toolForKind(i.file.kind) != null && !isSameFormat(i.file.ext, fmt)
    }
    return i.file.kind === 'image' // compress / resize are image-only for now
  })

  // Keep the convert target valid for the active kind (and never the source format).
  useEffect(() => {
    if (!activeKind) return
    const fmt = String(state.options.convert.format ?? '')
    const valid =
      categoryFormats(activeKind).some((f) => f.ext === fmt) &&
      !(sourceExt != null && isSameFormat(fmt, sourceExt))
    if (!valid) {
      const def = defaultTargetExt(activeKind, sourceExt ?? '')
      if (def) dispatch({ type: 'setOption', tool: 'convert', key: 'format', value: def })
    }
  }, [activeKind, sourceExt, state.options.convert.format])

  function onItemClick(id: string, e: MouseEvent): void {
    const item = cur.items.find((i) => i.id === id)
    if (!item) return
    const modified = e.shiftKey || e.ctrlKey || e.metaKey
    if (modified) {
      // Multi-select stays within one kind: ignore modified clicks on other kinds.
      const anchorKind = selectedItems.length ? selectedItems[0].file.kind : item.file.kind
      if (item.file.kind !== anchorKind) return
    }
    const mode: SelectMode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single'
    dispatch({ type: 'select', id, mode })
  }

  // Open the in-app preview for a clicked item, letting the user page through
  // the whole column it lives in (all inputs, or all finished outputs).
  function openPreview(side: 'input' | 'output', item: QueueItem): void {
    if (side === 'input') {
      const list = cur.items.filter(inInput)
      const files: PreviewFile[] = list.map((it) => ({
        path: it.file.path,
        name: it.file.name,
        kind: it.file.kind,
        size: it.file.size,
        thumb: it.thumb
      }))
      setPreview({ files, index: Math.max(0, list.findIndex((it) => it.id === item.id)) })
      return
    }
    const list = cur.items.filter(inOutput)
    const files: PreviewFile[] = list.map((it) => ({
      path: it.outputPath as string,
      name: baseName(it.outputPath as string),
      kind: it.file.kind,
      thumb: outThumbs[it.outputPath as string] ?? null
    }))
    setPreview({ files, index: Math.max(0, list.findIndex((it) => it.id === item.id)) })
  }

  // Dismiss a set of items from a column. For Output we also recycle-bin the
  // produced file before dropping the card.
  function dismiss(ids: string[], column: 'input' | 'output'): void {
    for (const id of ids) {
      if (column === 'output') {
        const it = cur.items.find((x) => x.id === id)
        if (it?.outputPath) void window.filesmith.trashFile(it.outputPath)
      }
      dispatch({ type: 'dismiss', id, column })
    }
  }

  // Build the right-click / ⋯ menu for a queue item. Destructive actions apply
  // to the whole selection when the clicked item is part of a multi-selection;
  // otherwise just to that one item.
  function openMenu(side: 'input' | 'output', item: QueueItem, x: number, y: number): void {
    const inSel = cur.selected.includes(item.id) && cur.selected.length > 1
    const visible = side === 'input' ? inInput : inOutput
    const targets = inSel
      ? cur.selected.filter((id) => {
          const it = cur.items.find((x) => x.id === id)
          return it != null && visible(it)
        })
      : [item.id]
    const n = targets.length

    if (side === 'input') {
      setMenu({
        x,
        y,
        items: [
          { label: 'Preview', icon: 'eye', onClick: () => openPreview('input', item) },
          {
            label: 'Reveal in Explorer',
            icon: 'folder',
            onClick: () => window.filesmith.reveal(item.file.path)
          },
          { sep: true },
          {
            label: n > 1 ? `Remove ${n} from list` : 'Remove from list',
            icon: 'trash',
            danger: true,
            onClick: () => dismiss(targets, 'input')
          }
        ]
      })
      return
    }
    const out = item.outputPath
    if (!out) return
    setMenu({
      x,
      y,
      items: [
        { label: 'Preview', icon: 'eye', onClick: () => openPreview('output', item) },
        { label: 'Reveal in Explorer', icon: 'folder', onClick: () => window.filesmith.reveal(out) },
        { sep: true },
        {
          label: n > 1 ? `Delete ${n} files` : 'Delete file',
          icon: 'trash',
          danger: true,
          onClick: () => dismiss(targets, 'output')
        }
      ]
    })
  }

  async function browse(): Promise<void> {
    const files = await window.filesmith.pickFiles()
    if (files.length) dispatch({ type: 'addItems', files })
  }

  async function onDrop(e: DragEvent<HTMLElement>): Promise<void> {
    e.preventDefault()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.filesmith.pathForFile(f))
      .filter(Boolean)
    if (!paths.length) return
    const files = await window.filesmith.classify(paths)
    if (files.length) dispatch({ type: 'addItems', files })
  }

  function run(): void {
    if (!runList.length) return
    const opts = state.options[state.tool]
    dispatch({ type: 'markQueued', ids: runList.map((i) => i.id) })
    for (const item of runList) {
      void window.filesmith.runJob({
        id: item.id,
        tool: state.tool,
        input: item.file.path,
        options: opts
      })
    }
  }

  const meta = toolMeta(state.tool)
  const runCount = runList.length

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ToolRail
          tool={state.tool}
          onSelect={(t: ToolId) => dispatch({ type: 'setTool', tool: t })}
        />

        <section
          className="flex min-w-0 flex-1 flex-col gap-4 px-7 pb-5 pt-1"
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragging(false)
          }}
          onDrop={onDrop}
        >
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">{meta.label}</h1>
            <p className="mt-0.5 text-[13px] text-muted">{meta.blurb}</p>
          </div>
          <DropZone dragging={dragging} onBrowse={() => void browse()} />
          <Queues
            items={cur.items}
            tool={state.tool}
            options={state.options[state.tool]}
            selected={cur.selected}
            activeKind={activeKind}
            outThumbs={outThumbs}
            onItemClick={onItemClick}
            onOpen={openPreview}
            onMenu={openMenu}
          />
        </section>

        <OptionsPanel
          tool={state.tool}
          options={state.options[state.tool]}
          activeKind={activeKind}
          sourceExt={sourceExt}
          runCount={runCount}
          onSet={(k, v) => dispatch({ type: 'setOption', tool: state.tool, key: k, value: v })}
          onRun={run}
        />
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {preview && (
        <PreviewModal
          files={preview.files}
          start={preview.index}
          onClose={() => setPreview(null)}
          onReveal={(p) => window.filesmith.reveal(p)}
        />
      )}
    </div>
  )
}
