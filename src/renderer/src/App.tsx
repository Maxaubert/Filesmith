import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type MouseEvent
} from 'react'
import type { FileInfo, FileKind, JobOptions, ToolId } from '@shared/types'
import {
  canCompress,
  convertGroup,
  isSameFormat,
  normalizeExt,
  sharedTargets,
  toolForKind
} from '@shared/convert'
import {
  estimatedPngBytes,
  formatBytes,
  HUGE_OUTPUT_BYTES,
  scaleResolution,
  upscaledSize
} from '@shared/compress'
import { resizedSize } from '@shared/resize'
import { baseName, fileKind } from '@shared/fileKind'
import {
  reducer,
  initialState,
  optionsKey,
  queueKey,
  defaultOptionsFor,
  emptyQueue,
  inInput,
  groupOf,
  newId,
  parseSession,
  sessionSnapshot,
  sessionPaths,
  pruneMissing,
  type QueueItem,
  type SelectMode
} from './state'
import { engineFor, tabAccepts, tabById, toolCardById, type TabId } from '@shared/tabs'
import { TitleBar } from './components/shell/TitleBar'
import { Sidebar } from './components/shell/Sidebar'
import { crumbsFor } from './components/shell/crumbs'
import { useSidebar } from './components/shell/useSidebar'
import { useRailPrefs } from './components/shell/useRailPrefs'
import { sidebarVerbs } from './components/shell/railPrefs'
import { shortcutFor } from './components/shell/shortcuts'
import { activeGroupFor, headerCheck, toggleAllIds } from './components/queue/selectAll'
import { QueueTable } from './components/queue/QueueTable'
import { QueueToolbar } from './components/queue/QueueToolbar'
import { useViewSize } from './components/queue/useViewSize'
import { thumbPx, viewKeyFor } from './components/queue/viewSize'
import { doneSamples, queueTotals, type RowActionKind } from './components/queue/rowModel'
import {
  deleteConfirm,
  menuTargets,
  removeConfirm,
  revealPath,
  rowMenuModel,
  type RowMenuAction
} from './components/queue/rowMenu'
import { groupedRows, nextSort, visibleOrder, type SortState } from './components/queue/tableSort'
import { estimateBatch, estimateOutputBytes } from '@shared/sizeEstimate'
import { EmptyState } from './components/queue/EmptyState'
import { Inspector, type InspTab } from './components/inspector/Inspector'
import { InfoGrid, InfoPane } from './components/inspector/InfoPane'
import { genInfoRows } from './components/inspector/infoModel'
import { PreviewPane } from './components/inspector/PreviewPane'
import { OptionsPane } from './components/options/OptionsPane'
import { useOptionSetter } from './components/options/useOptionSetter'
import type { SizeRow } from './components/ui/OutputSizeList'
import { groupNoun } from './components/queueGroups'
import { collectCompleted } from './components/completed'
import { CompletedView } from './components/views/CompletedView'
import { GenerateView } from './components/views/GenerateView'
import { SettingsView } from './components/views/SettingsView'
import { ToolsView } from './components/views/ToolsView'
import type { GenerateOptions } from '@shared/generate'
import { ContextMenu, type MenuState } from './components/ContextMenu'
import { ConfirmDialog, type ConfirmState } from './components/ConfirmDialog'

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

export default function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [dragging, setDragging] = useState(false)
  // Text-to-image generation is not file-driven, so it lives outside the queue:
  // a persistent list of produced images, plus the in-flight run's per-image
  // slots (each with live progress, filled in as it finishes).
  const [genResults, setGenResults] = useState<string[]>([])
  const [genRun, setGenRun] = useState<{
    running: boolean
    slots: { pct: number; path?: string }[]
    message?: string
  }>({ running: false, slots: [] })
  const genIdRef = useRef(0)
  const genActiveId = useRef<string | null>(null)
  // Model, size and seed of each image generated this session, for Info.
  // State, not a ref: Info reads it during render.
  const [genMeta, setGenMeta] = useState<
    Record<string, { model: string; width: number; height: number; seed: number }>
  >({})
  // The generated image the inspector's Preview and Info show.
  const [genFocus, setGenFocus] = useState<string | null>(null)
  const [outThumbs, setOutThumbs] = useState<Record<string, string | null>>({})
  // 256px thumbnails for Large / Extra large icons, by source path (spec 5).
  const [bigThumbs, setBigThumbs] = useState<Record<string, string | null>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  // Which column/tool the open preview window is showing, so we can push live
  // list updates to it when the queue changes.
  const requested = useRef<Set<string>>(new Set())
  const outRequested = useRef<Set<string>>(new Set())
  const bigRequested = useRef<Set<string>>(new Set())
  // Cached video dimensions (via ffprobe) for the compress resolution preview.
  const [vDims, setVDims] = useState<Record<string, { width: number; height: number } | null>>({})
  const vDimsRequested = useRef<Set<string>>(new Set())
  // Oversize-upscale confirmation, and the flag that lets the confirmed run through.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  // Stable close handlers: ContextMenu re-registers five window listeners
  // whenever its onClose identity changes, which an inline arrow made happen
  // on all ~20 progress renders a second.
  const closeMenu = useCallback(() => setMenu(null), [])
  const closeConfirm = useCallback(() => setConfirm(null), [])
  const confirmedHuge = useRef(false)
  // Session persistence: restore the last session (queues + produced files) on
  // launch, pruning anything whose file was deleted since; then save on change.
  const hydrated = useRef(false)
  const sidebar = useSidebar()
  const rail = useRailPrefs()
  // Files view size (spec 3): one per app, persisted like the sidebar.
  const view = useViewSize()
  // Ids of the last run per workspace, for "Converting 3 of 6" (spec 6.4).
  // Per-workspace column sort; null is insertion order (spec 4.2).
  const [sorts, setSorts] = useState<Record<string, SortState | null>>({})
  // Inspector tab: per-session view state, not persisted (spec 3.4).
  const [inspTab, setInspTab] = useState<InspTab>('options')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const parsed = parseSession(await window.filesmith.sessionLoad())
        if (!parsed || !alive) {
          hydrated.current = true
          return
        }
        const paths = sessionPaths(parsed.state, parsed.genResults)
        const flags = paths.length ? await window.filesmith.filesExist(paths) : []
        const existing = new Set(paths.filter((_, i) => flags[i]))
        const pruned = pruneMissing(parsed.state, parsed.genResults, existing)
        if (!alive) return
        dispatch({ type: 'hydrate', state: pruned.state })
        setGenResults(pruned.genResults)
      } finally {
        // Only the LIVE pass may enable saving: StrictMode's discarded first
        // run otherwise armed the save before the restore had landed, letting
        // an early change overwrite the persisted session.
        if (alive) hydrated.current = true
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Debounced save. Skipped until the initial hydrate lands so we never overwrite
  // a saved session with the empty initial state during the async load.
  useEffect(() => {
    if (!hydrated.current) return
    const t = setTimeout(
      () => window.filesmith.sessionSave(sessionSnapshot(state, genResults)),
      400
    )
    return () => clearTimeout(t)
  }, [state, genResults])

  // Flush synchronously on window close so work done in the last debounce window
  // (up to 400ms) isn't lost. A ref carries the latest state to the listener.
  const latest = useRef({ state, genResults })
  useEffect(() => {
    latest.current = { state, genResults }
  }, [state, genResults])
  useEffect(() => {
    const flush = (): void => {
      if (hydrated.current)
        window.filesmith.sessionSave(
          sessionSnapshot(latest.current.state, latest.current.genResults)
        )
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // The queue belongs to the VERB: one Convert queue can hold images and video
  // at once. Options are per (workspace, convert group), so the image target and
  // the video target live side by side inside that one tab.
  const tab = tabById(state.tab)
  const card = state.activeTool ? toolCardById(state.activeTool) : null
  const qKey = queueKey(state.tab, state.activeTool)
  const cur = state.queues[qKey] ?? emptyQueue()
  // The Tools grid is a chooser, not a workspace: no queue, no options panel.
  const onToolsGrid = state.tab === 'tools' && !card
  // Completed is a view of results, not a place you do work.
  const onCompleted = state.tab === 'completed'
  // Every item in every queue, for the output actions the Completed view drives.
  const allItems = Object.values(state.queues).flatMap((q) => q?.items ?? [])

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
      if (!q) continue
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
      if (!q) continue
      for (const item of q.items) {
        const out = item.outputPath
        if (!out || item.status !== 'done' || outRequested.current.has(out)) continue
        outRequested.current.add(out)
        // The OUTPUT's kind, not the source's: an MKV -> MP3 output wants
        // cover-art extraction, not a video frame grab.
        void window.filesmith
          .thumbnail(out, 128, fileKind(extOfPath(out)))
          .then((t) => setOutThumbs((m) => ({ ...m, [out]: t })))
      }
    }
  }, [state.queues])

  // Large / Extra large icons want 256px thumbnails (spec 5). Asked lazily, once
  // per path, only for the current queue while such a size is shown; the 128px
  // one stays on screen until it arrives, and a failure keeps it.
  useEffect(() => {
    const px = thumbPx(view.size)
    if (px <= 128) return
    for (const item of cur.items) {
      const p = item.file.path
      if (!inInput(item) || bigRequested.current.has(p)) continue
      bigRequested.current.add(p)
      void window.filesmith.thumbnail(p, px, item.file.kind).then((t) => {
        if (t) setBigThumbs((m) => ({ ...m, [p]: t }))
      })
    }
  }, [view.size, cur.items])

  // --- Selection-derived state (current tool's queue) --------------------------
  // Operations key off each item's EFFECTIVE file (a result's output file), so
  // selecting an output and running uses the output's type.
  const selectedItems = cur.items.filter((i) => cur.selected.includes(i.id))
  // With nothing selected, options and Run speak for the first group in the
  // queue (spec 4.1), not an empty panel.
  const firstGroup = activeGroupFor(cur.items, [])
  const scopeItems = selectedItems.length
    ? selectedItems
    : cur.items.filter((i) => inInput(i) && firstGroup != null && groupOf(i.file) === firstGroup)
  const selEff = scopeItems.map(effectiveFile)
  const activeKind: FileKind | null = selEff.length ? selEff[0].kind : null
  // Dimming and the breadcrumb follow the SELECTION only.
  const activeGroup: string | null = selectedItems.length
    ? groupOf(effectiveFile(selectedItems[0]))
    : null
  const scopeGroup: string | null = selEff.length ? groupOf(selEff[0]) : null
  // An empty queue: fall back to the first kind this verb accepts, so the
  // options panel can still show what it would do.
  const fallbackKind: FileKind = tab.kinds[0] ?? card?.kinds[0] ?? 'image'
  const optGroup = scopeGroup ?? convertGroup(fallbackKind, '')
  const srcNorms = new Set(selEff.map((f) => normalizeExt(f.ext)))
  const srcExts = [...srcNorms] // every selected source format (for greying targets)
  const sourceExt: string | null = srcNorms.size === 1 ? [...srcNorms][0] : null
  const optKey = optionsKey(state.tab, state.activeTool, optGroup)
  const curOptions =
    state.options[optKey] ?? defaultOptionsFor(state.tab, state.activeTool, optGroup)
  const onSet = useOptionSetter(dispatch, optGroup)
  // On Convert the engine depends on the TARGET as well as the source: a .cbz
  // to .cb7 is archive/repack, a .pdf to .cbz is archive/from-pdf, and a .png
  // to .webp is the plain convert tool.
  const engine = engineFor(
    state.tab,
    optGroup,
    card,
    activeKind && sourceExt ? { kind: activeKind, ext: sourceExt } : undefined,
    String(curOptions.format ?? '')
  )
  const tool = engine.tool

  // A source is runnable when idle (incl. already-done, so it can run again); a
  // result is always runnable — running it promotes its output back to input.
  const canRun = (i: QueueItem): boolean =>
    i.isResult ? !!i.outputPath : ['ready', 'failed', 'canceled', 'done'].includes(i.status)

  // The files a run would actually process: selected, runnable, tool-compatible,
  // and (for convert) not already the target format.
  const runList: QueueItem[] = scopeItems.filter((i) => {
    if (!canRun(i)) return false
    const f = effectiveFile(i)
    // The queue can hold several kinds, so check this file against the verb AND
    // against the selected group: Run only ever acts on one group.
    if (!accepts(f.kind)) return false
    if (activeGroup && groupOf(f) !== activeGroup) return false
    if (state.tab === 'convert') {
      const fmt = String(curOptions.format ?? '')
      if (isSameFormat(f.ext, fmt)) return false
      // Archive work routes to the archive tool, which has no toolForKind entry.
      return tool === 'archive' || toolForKind(f.kind) != null
    }
    if (tool === 'compress') return canCompress(f.kind, f.ext)
    return true
  })

  // Keep the convert target valid for the active kind, and never a format that
  // any selected source already is (those are greyed out).
  useEffect(() => {
    if (!activeKind || tool !== 'convert') return
    const fmt = String(curOptions.format ?? '')
    const opts = sharedTargets(activeKind, srcExts)
    const isSource = (ext: string): boolean => srcExts.some((e) => isSameFormat(ext, e))
    const valid = opts.some((f) => f.ext === fmt) && !isSource(fmt)
    if (!valid) {
      const def = opts.find((f) => !isSource(f.ext))?.ext
      if (def) dispatch({ type: 'setOption', group: optGroup, key: 'format', value: def })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKind, sourceExt, srcExts.join('|'), curOptions.format, tool])

  // The chosen target decides the verb (repack / to-pdf / from-pdf), so keep the
  // stored op in step with it. Without this a .cbz switched to .pdf would still
  // run 'repack' and write a .pdf that is really a zip.
  useEffect(() => {
    if (state.tab !== 'convert' || !engine.op) return
    if (curOptions.op === engine.op) return
    dispatch({ type: 'setOption', group: optGroup, key: 'op', value: engine.op })
  }, [engine.op, curOptions.op, optGroup, state.tab])

  // Row clicks follow the VISIBLE order, so a shift-range on a sorted table
  // covers the rows the user sees between the two clicks.
  const sort = sorts[qKey] ?? null
  const groups = groupedRows(cur.items, sort)
  const order = visibleOrder(groups)
  // The queue (files) view is on screen: not Completed, Settings, the Tools
  // grid or Generate. View-size keys only act here.
  const filesView = !onCompleted && state.tab !== 'settings' && !onToolsGrid && tool !== 'generate'

  function onItemClick(id: string, e: MouseEvent): void {
    // The one-group rule lives in the reducer, which MOVES the selection to a
    // file from another group rather than extending into it. Swallowing the
    // click here instead made ctrl+click on a dimmed row do nothing at all.
    const mode: SelectMode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single'
    dispatch({ type: 'select', id, mode, order })
  }

  // Hand the file to whatever the OS already uses for it. Filesmith used to
  // carry its own viewer window (image, video, audio, PDF and text renderers,
  // plus a media bar), which was a second app living inside this one for a job
  // the desktop already does well.
  function openExternally(side: 'input' | 'output', item: QueueItem): void {
    const path = side === 'output' ? item.outputPath : item.file.path
    if (path) window.filesmith.openFile(path)
  }

  // Dismiss a set of items from a column. For Output we also recycle-bin the
  // produced file before dropping the card.
  function dismiss(ids: string[], column: 'input' | 'output'): void {
    if (column === 'output') {
      void trashOutputs(ids)
      return
    }
    for (const id of ids) {
      const it = cur.items.find((x) => x.id === id)
      // Removing an in-flight row must not orphan its process: cancel the job
      // first, or ffmpeg keeps encoding headless and writes an untracked file.
      if (it && (it.status === 'queued' || it.status === 'running')) {
        void window.filesmith.cancelJob(id)
      }
      if (it) evictProbe(it.file.path)
      dispatch({ type: 'dismiss', id, column })
    }
  }

  /** Trash output files, honouring the result: a locked/network file that
   * could NOT be recycled keeps its row instead of silently staying on disk
   * while the card disappears. */
  async function trashOutputs(ids: string[]): Promise<void> {
    const failed: string[] = []
    for (const id of ids) {
      // Across every queue: on the Completed tab `cur` is the empty completed
      // queue, so a lookup there found nothing and Delete silently did nothing.
      const it = allItems.find((x) => x.id === id)
      const out = it?.outputPath
      if (!out) continue
      const ok = await window.filesmith.trashFile(out)
      if (!ok) {
        failed.push(baseName(out))
        continue
      }
      // Evict the caches keyed by this path: output names are reusable after a
      // delete, and a re-run must not show the previous run's thumbnail.
      outRequested.current.delete(out)
      setOutThumbs((m) => {
        const rest = { ...m }
        delete rest[out]
        return rest
      })
      evictProbe(out)
      dispatch({ type: 'dismissAny', ids: [id], column: 'output' })
    }
    if (failed.length)
      setConfirm({
        title:
          failed.length === 1 ? 'Could not delete file' : `Could not delete ${failed.length} files`,
        body: `${failed.join(', ')} could not be moved to the Recycle Bin, the file may be open in another app.`,
        confirmLabel: 'OK',
        hideCancel: true,
        onConfirm: () => {}
      })
  }

  /** Drop a path from the probe caches so a changed file gets re-probed. */
  function evictProbe(path: string): void {
    vDimsRequested.current.delete(path)
    setVDims((m) => {
      if (!(path in m)) return m
      const rest = { ...m }
      delete rest[path]
      return rest
    })
  }

  /** Stop a queued or running job; the engine emits the terminal 'canceled'. */
  function cancelJob(id: string): void {
    void window.filesmith.cancelJob(id)
  }

  function toolFor(it: QueueItem, opts: JobOptions): ToolId {
    return engineFor(
      state.tab,
      groupOf(it.file),
      card,
      { kind: it.file.kind, ext: it.file.ext },
      typeof opts.format === 'string' ? opts.format : undefined
    ).tool
  }

  /** Same path as run() for one in-place item, with the options it last ran
   * with (spec 4.3). A merge row retries with the same input list, because
   * run() stores `mergeInputs` in its `runOptions`. */
  function retry(ids: string[]): void {
    for (const id of ids) {
      const it = cur.items.find((i) => i.id === id)
      if (!it || (it.status !== 'failed' && it.status !== 'canceled')) continue
      const opts = it.runOptions ?? curOptions
      dispatch({ type: 'markQueued', ids: [id], options: opts })
      void window.filesmith.runJob({
        id,
        tool: toolFor(it, opts),
        input: it.file.path,
        options: opts
      })
    }
  }

  function onRowAction(id: string, kind: RowActionKind): void {
    const it = cur.items.find((i) => i.id === id)
    if (!it) return
    if (kind === 'reveal') {
      if (it.outputPath) window.filesmith.reveal(it.outputPath)
    } else if (kind === 'cancel') cancelJob(id)
    else if (kind === 'remove') dismiss([id], 'input')
    else retry([id])
  }

  /** "Are you sure" before rows leave the list; files on disk stay put. */
  function confirmRemove(ids: string[]): void {
    if (!ids.length) return
    setConfirm({
      ...removeConfirm(ids.length),
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => dismiss(ids, 'input')
    })
  }

  /** Move the rows' SOURCE files to the Recycle Bin (reversible, never a hard
   * delete), then drop those rows. A file that could not be recycled keeps its
   * row and is named in an alert. */
  async function trashSources(ids: string[]): Promise<void> {
    const rows = cur.items.filter((i) => ids.includes(i.id) && inInput(i))
    const failed: string[] = []
    // One source can sit in several rows (a re-run clone): recycle it once.
    for (const path of [...new Set(rows.map((r) => r.file.path))]) {
      const ok = await window.filesmith.trashFile(path)
      if (!ok) {
        failed.push(baseName(path))
        continue
      }
      evictProbe(path)
      for (const r of rows)
        if (r.file.path === path) dispatch({ type: 'dismiss', id: r.id, column: 'input' })
    }
    if (failed.length)
      setConfirm({
        title:
          failed.length === 1 ? 'Could not delete file' : `Could not delete ${failed.length} files`,
        body: `${failed.join(', ')} could not be moved to the Recycle Bin, the file may be open in another app.`,
        confirmLabel: 'OK',
        hideCancel: true,
        onConfirm: () => {}
      })
  }

  /** The files table's right-click menu. A selected row acts on the whole
   * selection; any other row becomes the selection first (the reducer keeps it
   * inside one convert group). */
  function openRowMenu(id: string, x: number, y: number): void {
    const ids = menuTargets(id, cur.selected)
    if (!cur.selected.includes(id)) dispatch({ type: 'select', id, mode: 'single', order })
    const rows = cur.items.filter((i) => ids.includes(i.id))
    const act = (a: RowMenuAction): void => {
      const one = rows.length === 1 ? rows[0] : null
      if (a === 'open') {
        if (one) openExternally('input', one)
      } else if (a === 'reveal') {
        if (one) window.filesmith.reveal(revealPath(one))
      } else if (a === 'retry') retry(rows.map((r) => r.id))
      else if (a === 'stop')
        rows
          .filter((r) => r.status === 'queued' || r.status === 'running')
          .forEach((r) => cancelJob(r.id))
      else if (a === 'clear') dispatch({ type: 'hideFinished' })
      else if (a === 'remove') confirmRemove(rows.map((r) => r.id))
      else
        setConfirm({
          ...deleteConfirm(rows.length),
          confirmLabel: rows.length > 1 ? `Delete ${rows.length} files` : 'Delete',
          danger: true,
          onConfirm: () => void trashSources(rows.map((r) => r.id))
        })
    }
    setMenu({
      x,
      y,
      items: rowMenuModel(rows, cur.items).map((e) =>
        e.sep
          ? e
          : {
              label: e.label,
              icon: e.icon,
              danger: e.danger,
              disabled: e.disabled,
              onClick: () => act(e.action)
            }
      )
    })
  }

  // The Completed view's right-click menu: acts on that view's own selection,
  // which spans every queue's results.
  function openOutputMenu(item: QueueItem, x: number, y: number, targetIds?: string[]): void {
    const targets = targetIds ?? [item.id]
    const n = targets.length
    const out = item.outputPath
    if (!out) return
    setMenu({
      x,
      y,
      items: [
        { label: 'Open', icon: 'eye', onClick: () => openExternally('output', item) },
        {
          label: 'Show in File Explorer',
          icon: 'folder',
          onClick: () => window.filesmith.reveal(out)
        },
        { sep: true },
        {
          label: n > 1 ? `Delete ${n} files` : 'Delete file',
          icon: 'trash',
          danger: true,
          onClick: () =>
            n > 1
              ? setConfirm({
                  title: `Delete ${n} files?`,
                  body: 'They will be moved to the Recycle Bin.',
                  confirmLabel: 'Delete',
                  danger: true,
                  onConfirm: () => dismiss(targets, 'output')
                })
              : dismiss(targets, 'output')
        }
      ]
    })
  }

  /** Whether this workspace can act on a kind at all. A tool card names its own
   * kinds; every other tab uses the verb's. */
  function accepts(kind: FileKind): boolean {
    return card ? card.kinds.includes(kind) : tabAccepts(state.tab, kind)
  }

  /** Keep only what this workspace can actually do. Upscale silently swallowing
   * an MP4 would promise work it cannot perform. */
  function ofTab(files: FileInfo[]): FileInfo[] {
    return files.filter((f) => accepts(f.kind))
  }

  async function browse(): Promise<void> {
    const key = qKey
    const files = ofTab(await window.filesmith.pickFiles())
    if (files.length) dispatch({ type: 'addItems', files, key })
  }

  async function onDrop(e: DragEvent<HTMLElement>): Promise<void> {
    e.preventDefault()
    setDragging(false)
    // Generate has no queue on screen: a file accepted here would land in an
    // invisible list with no feedback at all.
    if (tool === 'generate' || onToolsGrid || onCompleted) return
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.filesmith.pathForFile(f))
      .filter(Boolean)
    if (!paths.length) return
    const key = qKey
    const files = ofTab(await window.filesmith.classify(paths))
    if (files.length) dispatch({ type: 'addItems', files, key })
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

  /** Show a generated image in the inspector's Preview. */
  function previewGen(path: string): void {
    setGenFocus(path)
    setInspTab('preview')
  }

  function openGenMenu(path: string, x: number, y: number): void {
    setMenu({
      x,
      y,
      items: [
        { label: 'Open', icon: 'eye', onClick: () => previewGen(path) },
        {
          label: 'Open in default app',
          icon: 'arrow',
          onClick: () => window.filesmith.openFile(path)
        },
        {
          label: 'Show in File Explorer',
          icon: 'folder',
          onClick: () => window.filesmith.reveal(path)
        },
        { sep: true },
        {
          label: 'Delete file',
          icon: 'trash',
          danger: true,
          onClick: () => {
            void window.filesmith.trashFile(path)
            setGenResults((prev) => prev.filter((p) => p !== path))
            setGenFocus((f) => (f === path ? null : f))
          }
        }
      ]
    })
  }

  async function generate(): Promise<void> {
    const opts = curOptions
    if (!String(opts.prompt ?? '').trim() || genRun.running) return
    const id = `gen-${(genIdRef.current += 1)}`
    genActiveId.current = id
    const count = Math.max(1, Math.min(8, Number(opts.count ?? 1)))
    setGenRun({
      running: true,
      slots: Array.from({ length: count }, () => ({ pct: 0 })),
      message: 'Starting…'
    })
    const finished: (string | undefined)[] = []
    const unsubP = window.filesmith.onGenerateProgress((p) => {
      if (p.id !== id) return
      if (p.index < 0) {
        setGenRun((r) => ({ ...r, message: p.message }))
        return
      }
      const pct = p.pct ?? 0
      setGenRun((r) => ({
        ...r,
        slots: r.slots.map((s, i) => (i === p.index ? { ...s, pct } : s))
      }))
    })
    const unsubI = window.filesmith.onGenerateImage((p) => {
      if (p.id !== id) return
      setGenMeta((m) => ({
        ...m,
        [p.path]: {
          model: String(opts.model ?? ''),
          width: Number(opts.width ?? 1024),
          height: Number(opts.height ?? 1024),
          seed: Number(opts.seed ?? -1)
        }
      }))
      finished[p.index] = p.path
      setGenRun((r) => ({
        ...r,
        slots: r.slots.map((s, i) => (i === p.index ? { pct: 100, path: p.path } : s))
      }))
    })
    try {
      const r = await window.filesmith.generateRun(id, opts as unknown as GenerateOptions)
      // Keep whatever finished, even on a mid-run cancel/error.
      if (finished.some(Boolean))
        setGenResults((prev) => [...finished.filter((x): x is string => !!x), ...prev])
      if (!r.ok && !/cancel/i.test(r.error ?? ''))
        setConfirm({
          title: 'Generation failed',
          body: r.error ?? 'Unknown error',
          confirmLabel: 'OK',
          hideCancel: true,
          onConfirm: () => {}
        })
    } finally {
      unsubP()
      unsubI()
      genActiveId.current = null
      setGenRun({ running: false, slots: [] })
    }
  }

  async function run(): Promise<void> {
    if (tool === 'generate') return generate()
    if (!runList.length) return
    const opts = curOptions

    const warning = hugeUpscaleWarning()
    if (warning && !confirmedHuge.current) {
      setConfirm({
        title: 'That is a very large image',
        body: warning,
        confirmLabel: 'Upscale anyway',
        danger: true,
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
    if (tool === 'pdf' && opts.op === 'merge') {
      if (runList.length < 2) return
      const paths = runList.map((i) => effectiveFile(i).path)
      const anchor = runList[0]
      let anchorId = anchor.id
      if (anchor.isResult) {
        const src = await makeSource(anchor)
        if (!src) return
        dispatch({ type: 'addSources', items: [src], key: qKey })
        anchorId = src.id
      }
      dispatch({ type: 'markQueued', ids: [anchorId], options: { ...opts, mergeInputs: paths } })
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
    if (newSources.length) dispatch({ type: 'addSources', items: newSources, key: qKey })
    if (!targets.length) return
    dispatch({ type: 'markQueued', ids: targets.map((t) => t.id), options: opts })
    for (const t of targets) {
      void window.filesmith.runJob({ id: t.id, tool, input: t.path, options: opts })
    }
  }

  // Merge needs 2+ PDFs before it can run; every other op runs per selected file.
  const isMerge = tool === 'pdf' && String(curOptions.op) === 'merge'
  const promptFilled = String(curOptions.prompt ?? '').trim().length > 0
  const genAspect = `${Number(curOptions.width ?? 1024)} / ${Number(curOptions.height ?? 1024)}`
  const runCount =
    tool === 'generate'
      ? promptFilled && !genRun.running
        ? 1
        : 0
      : isMerge && runList.length < 2
        ? 0
        : runList.length

  // Global shortcuts (spec 4.1). `run` and `browse` are re-created each render,
  // so the window listener reads the latest ones through a ref, refreshed after
  // every render like `latest` above (assigning it during render breaks the
  // react-hooks/refs rule).
  const actions = useRef({ run, browse, runCount, toggle: sidebar.toggle, filesView, view })
  useEffect(() => {
    actions.current = { run, browse, runCount, toggle: sidebar.toggle, filesView, view }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const a = actions.current
      const s = shortcutFor(e)
      if (s) {
        e.preventDefault()
        if (s === 'toggleSidebar') a.toggle()
        else if (s === 'addFiles') void a.browse()
        else if (s === 'run' && a.runCount > 0) void a.run()
        return
      }
      // View sizes (spec 2). preventDefault also keeps Electron's default menu
      // zoom accelerators (Ctrl+= / Ctrl+- / Ctrl+0) from zooming the page.
      // Not behind a modal: a size change under an open confirm dialog is invisible.
      const modal = document.querySelector('dialog[open]')
      const v = a.filesView && !modal ? viewKeyFor(e) : null
      if (!v) return
      e.preventDefault()
      if (v.kind === 'step') a.view.step(v.delta)
      else a.view.setSize(v.size, { flash: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
      ? runList
          .map(effectiveFile)
          .filter((f) => f.kind === 'video')
          .map((f) => f.path)
      : tool === 'upscale' || tool === 'resize'
        ? runList
            .map(effectiveFile)
            .filter((f) => f.kind === 'image')
            .map((f) => f.path)
        : []
  const compressVideoPaths = tool === 'compress' ? probePaths : []
  // The focused file, shown by the Preview and Info panes (spec 4.6). Both
  // describe ONE file, so a multi-selection shows neither rather than quietly
  // picking one of the files.
  const multiSelected = cur.selected.length > 1
  const focused = multiSelected ? undefined : cur.items.find((i) => i.id === cur.selected[0])
  // Preview and Info show the focused file's pixels, so probe it too.
  const focusedProbe =
    inspTab !== 'options' &&
    focused &&
    (focused.file.kind === 'image' || focused.file.kind === 'video')
      ? focused.file
      : null
  const probeKinds: Record<string, 'image' | 'video'> = {}
  for (const p of probePaths)
    probeKinds[p] = tool === 'upscale' || tool === 'resize' ? 'image' : 'video'
  if (focusedProbe && !(focusedProbe.path in probeKinds))
    probeKinds[focusedProbe.path] = focusedProbe.kind === 'image' ? 'image' : 'video'
  const probeKey = Object.keys(probeKinds)
    .map((p) => `${probeKinds[p]}:${p}`)
    .join('|')
  useEffect(() => {
    for (const [p, kind] of Object.entries(probeKinds)) {
      if (p in vDims || vDimsRequested.current.has(p)) continue
      vDimsRequested.current.add(p)
      // Images resolve via ImageMagick, video via ffprobe (rotation-aware).
      const probe =
        kind === 'image' ? window.filesmith.imageDimensions(p) : window.filesmith.videoDimensions(p)
      void probe.then((d) => {
        // A failed probe returns null; don't cache it — drop the request marker
        // so it can be re-probed (transient errors, a file still being written).
        if (d) setVDims((m) => ({ ...m, [p]: d }))
        else vDimsRequested.current.delete(p)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeKey])
  const compressScale = Number(curOptions.scale ?? 100)
  const videoOutputs: SizeRow[] = compressVideoPaths.map((p) => {
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
  const resizeOutputs: SizeRow[] =
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
  const upscaleOutputs: SizeRow[] =
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

  // Per-row size estimates for running rows (spec 4.3), from the options each
  // row actually runs with and the done rows of the same group and options.
  function estimateFor(
    it: QueueItem,
    opts: JobOptions = it.runOptions ?? curOptions
  ): number | null {
    const t = toolFor(it, opts)
    const d = vDims[it.file.path]
    let pixelRatio: number | null = null
    let outPixels: number | null = null
    if (t === 'resize') {
      if (String(opts.mode ?? 'percent') === 'percent')
        pixelRatio = (Number(opts.percent ?? 50) / 100) ** 2
      else if (d) {
        const o = resizedSize(
          d.width,
          d.height,
          numOrNull(opts.width),
          numOrNull(opts.height),
          opts.fit === 'stretch' ? 'stretch' : 'contain'
        )
        if (o) pixelRatio = (o.w * o.h) / (d.width * d.height)
      }
    } else if (t === 'upscale' && d) {
      const f = Number(opts.upscaleFactor ?? 4)
      outPixels = d.width * f * d.height * f
    }
    return estimateOutputBytes(it.file, t, opts, {
      samples: doneSamples(cur.items, groupOf(it.file), opts),
      pixelRatio,
      outPixels
    })
  }
  const estimates: Record<string, number | null> = {}
  for (const i of cur.items)
    if (inInput(i) && i.status === 'running') estimates[i.id] = estimateFor(i)
  // The batch card under the options speaks for the CURRENT options (spec 4.5).
  const batchEstimate =
    tool === 'generate' || runList.length === 0
      ? null
      : estimateBatch(
          runList.map((i) => ({ size: i.file.size, estimate: estimateFor(i, curOptions) }))
        )

  // Toolbar and Stop flags.
  const inputs = cur.items.filter(inInput)
  const inFlight = inputs.filter((i) => i.status === 'queued' || i.status === 'running')

  // Everything produced, across every workspace, for the Completed tab.
  const completed = collectCompleted(state.queues, (key) => {
    if (key.startsWith('tools:')) return toolCardById(key.slice(6))?.label ?? 'PDF Tools'
    return tabById(key as TabId).label
  })

  // Files waiting in each verb, so the rail shows where work is sitting even
  // while you're looking elsewhere. Every Tools workspace rolls up into Tools.
  const counts: Record<string, number> = {}
  for (const [k, q] of Object.entries(state.queues)) {
    if (!q) continue
    const n = q.items.filter(inInput).length
    const bucket = k.startsWith('tools:') ? 'tools' : k
    counts[bucket] = (counts[bucket] ?? 0) + n
  }

  const crumbs = crumbsFor(state.tab, card ?? null, activeGroup)
  const verbLabel = card ? card.label : tab.label
  const showInspector = !onToolsGrid && !onCompleted && state.tab !== 'settings'

  // Inspector head and Run label (spec 3.4, 4.1).
  const scopeCount = scopeItems.length
  const inspSub =
    tool === 'generate'
      ? ''
      : inspTab !== 'options'
        ? focused
          ? 'selected'
          : multiSelected
            ? `${cur.selected.length} selected`
            : ''
        : cur.selected.length
          ? `${cur.selected.length} selected`
          : scopeCount
            ? `all ${scopeCount} file${scopeCount === 1 ? '' : 's'}`
            : 'no files'
  const inspTitle =
    tool === 'generate'
      ? inspTab !== 'options' && genFocus
        ? baseName(genFocus)
        : verbLabel
      : inspTab === 'options' || !focused
        ? verbLabel
        : focused.file.name
  const genCount = Number(curOptions.count ?? 1)
  // Name the GROUP, not "files": in a mixed queue "Convert 2 files" hides which two.
  const runLabel =
    tool === 'generate'
      ? genCount > 1
        ? `Generate ${genCount} images`
        : 'Generate'
      : runCount > 0
        ? `${verbLabel} ${groupNoun(optGroup, runCount)}`
        : verbLabel

  return (
    // The whole window accepts drops (spec 4.9).
    <div
      className="app"
      data-sidebar={sidebar.collapsed ? 'collapsed' : 'expanded'}
      onDragOver={(e) => {
        e.preventDefault()
        if (tool !== 'generate' && !onToolsGrid && !onCompleted && state.tab !== 'settings')
          setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <TitleBar
        crumbs={crumbs}
        onCrumb={(a) =>
          a === 'tools'
            ? dispatch({ type: 'setActiveTool', tool: null })
            : dispatch({ type: 'clearSelection' })
        }
      />
      <div className={`wb${showInspector ? '' : ' no-insp'}`}>
        <Sidebar
          tab={state.tab}
          verbs={sidebarVerbs(rail.order, rail.hidden)}
          showTools={!rail.hidden.includes('tools')}
          counts={counts}
          completedCount={completed.length}
          collapsed={sidebar.collapsed}
          onToggle={sidebar.toggle}
          onSelect={(t) => {
            setInspTab('options')
            dispatch({ type: 'setTab', tab: t })
          }}
        />

        <>
          <main className={`center${dragging ? ' dropping' : ''}`} aria-label="Workspace">
            {onCompleted ? (
              <CompletedView
                entries={completed}
                thumbs={outThumbs}
                onOpen={(item) => openExternally('output', item)}
                onReveal={(p) => window.filesmith.reveal(p)}
                onMenu={openOutputMenu}
                onDelete={(ids) =>
                  setConfirm({
                    title: ids.length === 1 ? 'Delete this file?' : `Delete ${ids.length} files?`,
                    body: 'They will be moved to the Recycle Bin.',
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => void trashOutputs(ids)
                  })
                }
                onClear={(ids) => dispatch({ type: 'dismissAny', ids, column: 'output' })}
              />
            ) : state.tab === 'settings' ? (
              <SettingsView rail={rail} />
            ) : onToolsGrid ? (
              <ToolsView onPick={(id) => dispatch({ type: 'setActiveTool', tool: id })} />
            ) : tool === 'generate' ? (
              <GenerateView
                prompt={String(curOptions.prompt ?? '')}
                onPrompt={(v) => onSet('prompt', v)}
                running={genRun.running}
                slots={genRun.slots}
                results={genResults}
                aspect={genAspect}
                canRun={runCount > 0}
                focused={genFocus}
                onRun={() => void run()}
                onCancel={() => {
                  if (genActiveId.current) window.filesmith.generateCancel(genActiveId.current)
                }}
                onFocus={previewGen}
                onOpen={(p) => window.filesmith.openFile(p)}
                onMenu={openGenMenu}
              />
            ) : (
              <>
                <QueueToolbar
                  files={inputs.length}
                  selected={cur.selected.length}
                  dropping={dragging}
                  size={view.size}
                  flash={view.flash}
                  onAdd={() => void browse()}
                  onView={(s) => view.setSize(s)}
                />
                <QueueTable
                  groups={groups}
                  totals={queueTotals(cur.items)}
                  selected={cur.selected}
                  activeGroup={activeGroup}
                  sort={sort}
                  check={headerCheck(cur.items, cur.selected)}
                  estimates={estimates}
                  size={view.size}
                  thumbs={bigThumbs}
                  onSort={(k) => setSorts((s) => ({ ...s, [qKey]: nextSort(sort, k) }))}
                  onToggleAll={() =>
                    dispatch({ type: 'selectIds', ids: toggleAllIds(cur.items, cur.selected) })
                  }
                  onSelectAll={() => {
                    const ids = toggleAllIds(cur.items, cur.selected)
                    if (ids.length) dispatch({ type: 'selectIds', ids })
                  }}
                  onRowClick={onItemClick}
                  onToggleRow={(id) => dispatch({ type: 'select', id, mode: 'toggle', order })}
                  onExtend={(id) => dispatch({ type: 'select', id, mode: 'range', order })}
                  onOpen={(id) => {
                    const it = cur.items.find((i) => i.id === id)
                    if (it) openExternally('input', it)
                  }}
                  onMenu={openRowMenu}
                  onAction={onRowAction}
                  onRemove={(id) => confirmRemove(menuTargets(id, cur.selected))}
                  onSelectGroup={(g) =>
                    dispatch({
                      type: 'selectIds',
                      ids: inputs.filter((i) => groupOf(i.file) === g).map((i) => i.id)
                    })
                  }
                  onAdd={() => void browse()}
                  onWheelStep={(d) => view.step(d)}
                />
              </>
            )}
          </main>

          {showInspector && (
            <Inspector
              tab={inspTab}
              onTab={setInspTab}
              title={inspTitle}
              sub={inspSub}
              runLabel={runLabel}
              runDisabled={runCount === 0}
              onRun={() => void run()}
              stopping={tool === 'generate' ? genRun.running : inFlight.length > 0}
              onStop={() => {
                if (tool === 'generate') {
                  if (genActiveId.current) window.filesmith.generateCancel(genActiveId.current)
                } else inFlight.forEach((i) => cancelJob(i.id))
              }}
            >
              {inspTab === 'options' ? (
                <OptionsPane
                  tab={state.tab}
                  tool={tool}
                  options={curOptions}
                  kind={
                    tool === 'compress' ? (runKind ?? fallbackKind) : (activeKind ?? fallbackKind)
                  }
                  srcExts={srcExts}
                  sourceExt={sourceExt}
                  runCount={runCount}
                  videoOutputs={videoOutputs}
                  resizeOutputs={resizeOutputs}
                  upscaleOutputs={upscaleOutputs}
                  estimate={batchEstimate}
                  set={onSet}
                />
              ) : tool === 'generate' ? (
                genFocus ? (
                  inspTab === 'preview' ? (
                    <div className="wipe">
                      <img
                        className="wimg"
                        src={`fsmedia://local/${encodeURIComponent(genFocus)}`}
                        alt=""
                      />
                      <span className="tag l">
                        {extOfPath(genFocus).replace(/^\./, '').toLowerCase() || 'png'}
                      </span>
                    </div>
                  ) : (
                    <InfoGrid rows={genInfoRows(genFocus, genMeta[genFocus] ?? null)} />
                  )
                ) : (
                  <EmptyState
                    icon={inspTab === 'preview' ? 'eye' : 'info'}
                    title="Nothing selected"
                    line="Select an image to see it here"
                  />
                )
              ) : focused ? (
                inspTab === 'preview' ? (
                  <PreviewPane
                    key={focused.id}
                    item={focused}
                    outKind={focused.outputPath ? fileKind(extOfPath(focused.outputPath)) : null}
                    dims={vDims[focused.file.path] ?? null}
                  />
                ) : (
                  <InfoPane
                    item={focused}
                    dims={vDims[focused.file.path] ?? null}
                    target={typeof curOptions.format === 'string' ? curOptions.format : null}
                  />
                )
              ) : multiSelected ? (
                <EmptyState
                  icon={inspTab === 'preview' ? 'eye' : 'info'}
                  title={`${cur.selected.length} files selected`}
                  line={
                    inspTab === 'preview'
                      ? 'Select one file to preview'
                      : 'Select one file to see its info'
                  }
                />
              ) : (
                <EmptyState
                  icon={inspTab === 'preview' ? 'eye' : 'info'}
                  title="Nothing selected"
                  line="Select a file in the table to see it here"
                />
              )}
            </Inspector>
          )}
        </>
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
      <ConfirmDialog state={confirm} onClose={closeConfirm} />
    </div>
  )
}
