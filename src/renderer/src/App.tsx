import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type MouseEvent
} from 'react'
import type { FileInfo, FileKind, PreviewItem } from '@shared/types'
import { canCompress, familyFormats, isSameFormat, normalizeExt, toolForKind } from '@shared/convert'
import {
  estimatedPngBytes,
  formatBytes,
  HUGE_OUTPUT_BYTES,
  scaleResolution,
  upscaledSize
} from '@shared/compress'
import { resizedSize } from '@shared/resize'
import { fileKind } from '@shared/fileKind'
import {
  reducer,
  initialState,
  optionsKey,
  emptyQueue,
  inInput,
  inOutput,
  groupOf,
  newId,
  type QueueItem,
  type SelectMode
} from './state'
import { acceptsKind, categoryOf, findOperation, operationsFor, type CategoryId } from '@shared/catalog'
import { TopBar } from './components/TopBar'
import { CategoryRail } from './components/CategoryRail'
import { OperationTitle } from './components/OperationTitle'
import { DropZone } from './components/DropZone'
import { Queues } from './components/Queue'
import { OptionsPanel, type VideoOutputRow } from './components/OptionsPanel'
import { ContextMenu, type MenuState } from './components/ContextMenu'
import { ConfirmDialog, type ConfirmState } from './components/ConfirmDialog'

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const extOfPath = (p: string): string => {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i) : ''
}

/** The file an operation acts on: a source's own file, or — for a produced
 * result — its OUTPUT file (real path/kind/ext), so operating on an output uses
 * the output's type, not the original source's. */
function effectiveFile(i: QueueItem): FileInfo {
  if (i.isResult && i.outputPath) {
    const p = i.outputPath
    const ext = extOfPath(p)
    return { path: p, name: baseName(p), ext, kind: fileKind(ext), size: 0 }
  }
  return i.file
}

/** Build the preview window's file list for a column of a queue. */
function toPreviewFiles(
  items: QueueItem[],
  side: 'input' | 'output',
  outThumbs: Record<string, string | null>
): PreviewItem[] {
  if (side === 'input') {
    return items
      .filter(inInput)
      .map((it) => ({
        path: it.file.path,
        name: it.file.name,
        kind: it.file.kind,
        size: it.file.size,
        thumb: it.thumb
      }))
  }
  return items.filter(inOutput).map((it) => {
    const out = it.outputPath as string
    // Classify the OUTPUT by its own extension — a PDF made from a .txt is a
    // pdf, not text (using the input's kind previewed it as raw bytes).
    return {
      path: out,
      name: baseName(out),
      kind: fileKind(extOfPath(out)),
      thumb: outThumbs[out] ?? null
    }
  })
}

export default function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [dragging, setDragging] = useState(false)
  const [outThumbs, setOutThumbs] = useState<Record<string, string | null>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  // Which column/tool the open preview window is showing, so we can push live
  // list updates to it when the queue changes.
  const [previewCtx, setPreviewCtx] = useState<{ side: 'input' | 'output'; key: string } | null>(
    null
  )
  const requested = useRef<Set<string>>(new Set())
  const outRequested = useRef<Set<string>>(new Set())
  // Cached video dimensions (via ffprobe) for the compress resolution preview.
  const [vDims, setVDims] = useState<Record<string, { width: number; height: number } | null>>({})
  const vDimsRequested = useRef<Set<string>>(new Set())
  // Oversize-upscale confirmation, and the flag that lets the confirmed run through.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const confirmedHuge = useRef(false)

  // The queue belongs to the file type and is shared across its operations, so
  // switching Convert -> Compress keeps the same files. Options are per
  // operation, keyed by (category, operation).
  const op = findOperation(state.category, state.operation) ?? operationsFor(state.category)[0]
  const tool = op.tool
  const category = categoryOf(state.category)
  const cur = state.queues[state.category] ?? emptyQueue()
  const curOptions = state.options[optionsKey(state)] ?? {}

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
  // Operations key off each item's EFFECTIVE file (a result's output file), so
  // selecting an output and running uses the output's type.
  const selectedItems = cur.items.filter((i) => cur.selected.includes(i.id))
  const selEff = selectedItems.map(effectiveFile)
  const activeKind: FileKind | null = selEff.length ? selEff[0].kind : null
  const activeGroup: string | null = selEff.length ? groupOf(selEff[0]) : null
  const srcNorms = new Set(selEff.map((f) => normalizeExt(f.ext)))
  const srcExts = [...srcNorms] // every selected source format (for greying targets)
  const sourceExt: string | null = srcNorms.size === 1 ? [...srcNorms][0] : null

  // A source is runnable when idle (incl. already-done, so it can run again); a
  // result is always runnable — running it promotes its output back to input.
  const canRun = (i: QueueItem): boolean =>
    i.isResult
      ? !!i.outputPath
      : ['ready', 'failed', 'canceled', 'done'].includes(i.status)

  // The files a run would actually process: selected, runnable, tool-compatible,
  // and (for convert) not already the target format.
  const runList: QueueItem[] = selectedItems.filter((i) => {
    if (!canRun(i)) return false
    const f = effectiveFile(i)
    // The workspace is type-locked, so the category already guarantees the kind.
    // What is left to check is whether this specific file can take this operation.
    if (!acceptsKind(state.category, f.kind)) return false
    if (op.tool === 'convert') {
      const fmt = String(curOptions.format ?? '')
      return toolForKind(f.kind) != null && !isSameFormat(f.ext, fmt)
    }
    if (op.tool === 'compress') return canCompress(f.kind, f.ext)
    return true
  })

  // Keep the convert target valid for the active kind, and never a format that
  // any selected source already is (those are greyed out).
  useEffect(() => {
    if (!activeKind || tool !== 'convert') return
    const fmt = String(curOptions.format ?? '')
    const opts = familyFormats(activeKind, sourceExt ?? '')
    const isSource = (ext: string): boolean => srcExts.some((e) => isSameFormat(ext, e))
    const valid = opts.some((f) => f.ext === fmt) && !isSource(fmt)
    if (!valid) {
      const def = opts.find((f) => !isSource(f.ext))?.ext
      if (def) dispatch({ type: 'setOption', key: 'format', value: def })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKind, sourceExt, srcExts.join('|'), curOptions.format, tool])

  function onItemClick(id: string, e: MouseEvent): void {
    const item = cur.items.find((i) => i.id === id)
    if (!item) return
    const modified = e.shiftKey || e.ctrlKey || e.metaKey
    if (modified) {
      // Multi-select stays within one convert group (docs/text/pdf batch
      // together): ignore modified clicks on files from another group.
      const anchor = selectedItems.length ? effectiveFile(selectedItems[0]) : effectiveFile(item)
      if (groupOf(effectiveFile(item)) !== groupOf(anchor)) return
    }
    const mode: SelectMode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single'
    dispatch({ type: 'select', id, mode })
  }

  // Open the standalone preview window for a clicked item, letting the user page
  // through the whole column it lives in (all inputs, or all finished outputs).
  function openPreview(side: 'input' | 'output', item: QueueItem): void {
    const list = cur.items.filter(side === 'input' ? inInput : inOutput)
    const index = Math.max(
      0,
      list.findIndex((it) => it.id === item.id)
    )
    void window.filesmith.openPreviewWindow(toPreviewFiles(cur.items, side, outThumbs), index)
    setPreviewCtx({ side, key: state.category })
  }

  // Keep an open preview window's list in sync with the queue (it manages its
  // own position; a no-op in main if the window is closed).
  useEffect(() => {
    if (!previewCtx) return
    const items = state.queues[previewCtx.key as CategoryId]?.items ?? []
    window.filesmith.updatePreviewList(toPreviewFiles(items, previewCtx.side, outThumbs))
  }, [state.queues, outThumbs, previewCtx])

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

  /** Keep only what this workspace accepts. The screen promises one file type,
   * so silently taking a video into the Images queue would break that promise. */
  function ofCategory(files: FileInfo[]): FileInfo[] {
    return files.filter((f) => acceptsKind(state.category, f.kind))
  }

  async function browse(): Promise<void> {
    const files = ofCategory(await window.filesmith.pickFiles())
    if (files.length) dispatch({ type: 'addItems', files })
  }

  async function onDrop(e: DragEvent<HTMLElement>): Promise<void> {
    e.preventDefault()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.filesmith.pathForFile(f))
      .filter(Boolean)
    if (!paths.length) return
    const files = ofCategory(await window.filesmith.classify(paths))
    if (files.length) dispatch({ type: 'addItems', files })
  }

  // Build a fresh Input-column source item for a path (a promoted output, or a
  // clone of an already-run source), so each operation gets its own input row.
  async function makeSource(i: QueueItem): Promise<QueueItem | null> {
    if (i.isResult) {
      const [fi] = await window.filesmith.classify([effectiveFile(i).path])
      return fi ? { id: newId(), file: fi, thumb: null, status: 'ready', percent: 0 } : null
    }
    return { id: newId(), file: i.file, thumb: null, status: 'ready', percent: 0 }
  }

  /**
   * Upscaling has no size ceiling, but a big source at 4x can run to many
   * gigabytes. Warn once with the estimate and let the user decide, rather than
   * refusing outright or letting them discover it after the disk fills.
   */
  function hugeUpscaleWarning(): string | null {
    if (tool !== 'upscale') return null
    const rows = upscaleOutputs
      .map((r) => /^(\d+)×(\d+)$/.exec(r.to))
      .filter((m): m is RegExpExecArray => m != null)
      .map((m) => estimatedPngBytes(Number(m[1]), Number(m[2])))
    const worst = Math.max(0, ...rows)
    if (worst <= HUGE_OUTPUT_BYTES) return null
    const total = rows.reduce((a, b) => a + b, 0)
    return rows.length === 1
      ? `The result will be roughly ${formatBytes(worst)}, and may take a long time.`
      : `The largest result will be roughly ${formatBytes(worst)} (about ${formatBytes(total)} in total), and may take a long time.`
  }

  async function run(): Promise<void> {
    if (!runList.length) return
    const opts = curOptions

    const warning = hugeUpscaleWarning()
    if (warning && !confirmedHuge.current) {
      setConfirm({
        title: 'That is a very large image',
        body: warning,
        confirmLabel: 'Upscale anyway',
        onConfirm: () => {
          // One confirmation covers this run only.
          confirmedHuge.current = true
          void run().finally(() => {
            confirmedHuge.current = false
          })
        }
      })
      return
    }

    // Merge is N-in/1-out, so it doesn't follow the 1:1 rule: run the anchor in
    // place (promoting it first if it's an output) with all paths as inputs.
    if (op.tool === 'pdf' && opts.op === 'merge') {
      if (runList.length < 2) return
      const paths = runList.map((i) => effectiveFile(i).path)
      const anchor = runList[0]
      let anchorId = anchor.id
      if (anchor.isResult) {
        const src = await makeSource(anchor)
        if (!src) return
        dispatch({ type: 'addSources', items: [src] })
        anchorId = src.id
      }
      dispatch({ type: 'markQueued', ids: [anchorId], options: opts })
      void window.filesmith.runJob({
        id: anchorId,
        tool: 'pdf',
        input: paths[0],
        options: { ...opts, mergeInputs: paths }
      })
      return
    }

    // One job per selected item, keeping Input/Output counts in step. A source
    // that hasn't produced an output yet (ready/failed/canceled) runs IN PLACE —
    // it's the input row that will pair with this output. A done source or a
    // selected output produces a NEW input row (a clone / promoted origin), so
    // running the same thing twice yields two input rows and two outputs.
    const targets: { id: string; path: string }[] = []
    const newSources: QueueItem[] = []
    for (const i of runList) {
      if (!i.isResult && i.status !== 'done') {
        targets.push({ id: i.id, path: i.file.path })
        continue
      }
      const src = await makeSource(i)
      if (!src) continue
      newSources.push(src)
      targets.push({ id: src.id, path: src.file.path })
    }
    if (newSources.length) dispatch({ type: 'addSources', items: newSources })
    if (!targets.length) return
    dispatch({ type: 'markQueued', ids: targets.map((t) => t.id), options: opts })
    for (const t of targets) {
      void window.filesmith.runJob({ id: t.id, tool: op.tool, input: t.path, options: opts })
    }
  }

  // Merge needs 2+ PDFs before it can run; every other op runs per selected file.
  const isMerge = op.tool === 'pdf' && String(curOptions.op) === 'merge'
  const runCount = isMerge && runList.length < 2 ? 0 : runList.length
  // The kind the options panel should key off is what will actually RUN, not the
  // anchor item: a PDF co-selected with a non-compressible doc (same group)
  // leaves the anchor 'document' while only the PDF runs. All-same-kind -> that
  // kind; mixed -> 'image' (the quality slider applies to the non-PDF members).
  const runKind: FileKind | null = runList.length
    ? runList.every((i) => effectiveFile(i).kind === effectiveFile(runList[0]).kind)
      ? effectiveFile(runList[0]).kind
      : 'image'
    : activeKind

  // Live "input → output" resolution list for the video Compress options. Probe
  // each selected video's dimensions once (via ffprobe) and recompute the output
  // size for the chosen preset.
  // Upscale reuses the same probe cache to preview the (much larger) result size.
  const probePaths =
    tool === 'compress'
      ? runList.map(effectiveFile).filter((f) => f.kind === 'video').map((f) => f.path)
      : tool === 'upscale' || tool === 'resize'
        ? runList.map(effectiveFile).filter((f) => f.kind === 'image').map((f) => f.path)
        : []
  const compressVideoPaths = tool === 'compress' ? probePaths : []
  useEffect(() => {
    for (const p of probePaths) {
      if (p in vDims || vDimsRequested.current.has(p)) continue
      vDimsRequested.current.add(p)
      // Images resolve via ImageMagick, video via ffprobe (rotation-aware).
      const probe =
        tool === 'upscale' || tool === 'resize'
          ? window.filesmith.imageDimensions(p)
          : window.filesmith.videoDimensions(p)
      void probe.then((d) => {
        // A failed probe returns null; don't cache it — drop the request marker
        // so it can be re-probed (transient errors, a file still being written).
        if (d) setVDims((m) => ({ ...m, [p]: d }))
        else vDimsRequested.current.delete(p)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probePaths.join('|')])
  const compressScale = Number(curOptions.scale ?? 100)
  const videoOutputs: VideoOutputRow[] = compressVideoPaths.map((p) => {
    const d = vDims[p]
    const name = baseName(p)
    if (!d) return { path: p, name, from: '…', to: '…' }
    const o = scaleResolution(d.width, d.height, compressScale)
    return { path: p, name, from: `${d.width}×${d.height}`, to: `${o.w}×${o.h}` }
  })

  // Resize's output list. This is the fix for "I changed the width and got the
  // same file": in Keep-aspect mode the non-limiting field is discarded by
  // ImageMagick, and only the resulting size makes that visible.
  const resizeOpts = curOptions
  const numOrNull = (v: unknown): number | null =>
    v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  const resizeOutputs: VideoOutputRow[] =
    tool === 'resize' && String(resizeOpts.mode ?? 'percent') === 'dimensions'
      ? probePaths.map((p) => {
          const d = vDims[p]
          const name = baseName(p)
          if (!d) return { path: p, name, from: '…', to: '…' }
          const out = resizedSize(
            d.width,
            d.height,
            numOrNull(resizeOpts.width),
            numOrNull(resizeOpts.height),
            resizeOpts.fit === 'stretch' ? 'stretch' : 'contain'
          )
          const from = `${d.width}×${d.height}`
          return { path: p, name, from, to: out ? `${out.w}×${out.h}` : from }
        })
      : []

  const upscaleFactor = Number(curOptions.upscaleFactor ?? 4)
  const upscaleOutputs: VideoOutputRow[] =
    tool === 'upscale'
      ? probePaths.map((p) => {
          const d = vDims[p]
          const name = baseName(p)
          // A null probe means ffprobe can't read it (heic, svg…). It still
          // upscales (magick pre-converts), we just can't predict the size.
          if (!d) return { path: p, name, from: '…', to: '…' }
          const o = upscaledSize(d.width, d.height, upscaleFactor)
          return { path: p, name, from: `${d.width}×${d.height}`, to: `${o.w}×${o.h}` }
        })
      : []

  // Files waiting in each category, summed across that category's workspaces, so
  // the rail shows where work is sitting even while you're looking elsewhere.
  const counts: Record<string, number> = {}
  for (const [cat, q] of Object.entries(state.queues)) {
    counts[cat] = q.items.filter(inInput).length
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <CategoryRail
          category={state.category}
          counts={counts}
          onSelect={(c) => dispatch({ type: 'setCategory', category: c })}
        />

        <>
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
              {/* The rail names the file type; the sidebar switcher names (and
                  colours) the operation. This heading is just a heading. */}
              <OperationTitle category={category} fileCount={cur.items.filter(inInput).length} />
              <DropZone
                dragging={dragging}
                label={`Drop ${category.label.toLowerCase()} here`}
                onBrowse={() => void browse()}
              />
              <Queues
                items={cur.items}
                tool={op.tool}
                options={curOptions}
                selected={cur.selected}
                activeGroup={activeGroup}
                outThumbs={outThumbs}
                onItemClick={onItemClick}
                onOpen={openPreview}
                onMenu={openMenu}
              />
            </section>

            <OptionsPanel
              operation={op}
              operations={operationsFor(state.category)}
              onPickOperation={(id) => dispatch({ type: 'setOperation', operation: id })}
              options={curOptions}
              activeKind={activeKind}
              runKind={runKind}
              fallbackKind={category.kinds[0]}
              videoOutputs={videoOutputs}
              upscaleOutputs={upscaleOutputs}
              resizeOutputs={resizeOutputs}
              sourceExt={sourceExt}
              srcExts={srcExts}
              runCount={runCount}
              onSet={(k, v) => dispatch({ type: 'setOption', key: k, value: v })}
              onRun={() => void run()}
            />
        </>
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
