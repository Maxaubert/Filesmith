import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from 'react'
import type { ConsoleCatalog } from '@shared/console'
import {
  applyCompletion,
  completionContext,
  fileItems,
  type CompletionItem
} from '@shared/consoleComplete'
import { classifyLine, cliVerbs, refusalText } from '@shared/consoleLine'
import type { MenuState } from '../ContextMenu'
import { Icon } from '../icons/Icon'
import { CompletionList } from './CompletionList'
import { ConsoleOutput } from './ConsoleOutput'
import { BUILTIN_ITEMS, HELP_LINES } from './consoleHelp'
import { clampConsoleHeight } from './consoleHeight'
import { folderChoices } from './consoleFolders'
import { HIST_IDLE, histStep, type HistNav } from './consoleHistory'
import { consoleReducer, fmtSize, INITIAL } from './consoleModel'

let seq = 0
const nextId = (p: string): string => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

interface Comp {
  title: string
  prefix: string
  items: CompletionItem[]
  active: number
}

/** The bottom panel (spec 2-8). Stays mounted while closed. */
export function ConsolePanel(p: {
  open: boolean
  height: number
  onHeight: (h: number) => void
  onClose: () => void
  cwd: string | null
  onCwd: (d: string) => void
  recent: string[]
  history: string[]
  onHistory: (l: string) => void
  queueDirs: string[]
  onMenu: (m: MenuState) => void
  onBusy: (pct: number | null | undefined) => void
}): JSX.Element {
  const [state, dispatch] = useReducer(consoleReducer, INITIAL)
  const [input, setInput] = useState('')
  const [nav, setNav] = useState<HistNav>(HIST_IDLE)
  const [comp, setComp] = useState<Comp | null>(null)
  const [catalog, setCatalog] = useState<ConsoleCatalog | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [cwd, setCwdLocal] = useState<string>(p.cwd ?? '')
  const [prevCwd, setPrevCwd] = useState<string | null>(null)
  const section = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const pin = useRef<HTMLInputElement>(null)
  const folderBtn = useRef<HTMLButtonElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)
  const stick = useRef(true)

  // Catalog once; the folder: stored one if it still exists, else the default.
  useEffect(() => {
    void window.filesmith.consoleCatalog().then(setCatalog)
    void (async () => {
      const ok = p.cwd ? await window.filesmith.consoleDir(p.cwd) : null
      const d = ok ?? (await window.filesmith.consoleDefaultDir())
      setCwdLocal(d)
      if (d !== p.cwd) p.onCwd(d)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Events of this panel's runs.
  useEffect(
    () =>
      window.filesmith.onConsoleEvent((e) => {
        if (e.kind === 'event') dispatch({ type: 'event', id: e.id, ev: e.ev })
        else if (e.kind === 'exit')
          dispatch({ type: 'exit', id: e.id, code: e.code, at: Date.now() })
        else dispatch({ type: 'out', id: e.id, text: e.text })
      }),
    []
  )

  // Busy percentage for the toolbar button (spec 3).
  const running = runId ? state.blocks.find((b) => b.id === runId) : undefined
  const pct = running && running.kind === 'cmd' ? (running.progress?.pct ?? null) : undefined
  const { onBusy } = p
  useEffect(() => onBusy(runId ? pct : undefined), [runId, pct, onBusy])

  // Follow the output while scrolled to the bottom.
  useEffect(() => {
    const el = body.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [state])

  // Focus on open; give it back on close (spec 3).
  useEffect(() => {
    if (p.open) {
      prevFocus.current = document.activeElement as HTMLElement | null
      ;(runId ? body.current : pin.current)?.focus()
    } else if (section.current?.contains(document.activeElement)) prevFocus.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open])

  // Ctrl+wheel over the console: no view-size step, no page zoom (spec 4).
  useEffect(() => {
    const el = section.current
    if (!el) return
    const on = (e: WheelEvent): void => {
      if (e.ctrlKey) e.preventDefault()
    }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [])

  const note = (text: string): void => dispatch({ type: 'note', id: nextId('n'), text })
  const changeDir = (d: string): void => {
    setPrevCwd(cwd)
    setCwdLocal(d)
    p.onCwd(d)
    note(`Folder is now ${d}.`)
  }
  const terminal = async (): Promise<void> => {
    const r = await window.filesmith.consoleOpenTerminal(cwd)
    note(
      r.ok
        ? `Opened a terminal in ${cwd}. filesmith is on its PATH.`
        : `Could not open a terminal: ${r.error ?? 'unknown error'}`
    )
  }

  async function submit(raw: string): Promise<void> {
    const line = raw.trim()
    if (!line || !catalog) return
    p.onHistory(line)
    setNav(HIST_IDLE)
    setInput('')
    stick.current = true
    const k = classifyLine(line, cliVerbs(catalog))
    const id = nextId('r')
    if (k.kind === 'empty') return
    if (k.kind === 'refuse')
      return dispatch({ type: 'refuse', id, cwd, line, text: refusalText(k) })
    if (k.kind === 'builtin') {
      if (k.name === 'clear') return dispatch({ type: 'clear' })
      if (k.name === 'help')
        return dispatch({ type: 'builtin', id, cwd, line, lines: HELP_LINES(cwd) })
      if (k.name === 'history')
        return dispatch({
          type: 'builtin',
          id,
          cwd,
          line,
          lines: [...p.history, line].map((h, i) => `${String(i + 1).padStart(4)}  ${h}`)
        })
      // cd
      if (!k.args.length) return dispatch({ type: 'builtin', id, cwd, line, lines: [cwd] })
      if (k.args[0] === '-') {
        if (!prevCwd)
          return dispatch({ type: 'builtin', id, cwd, line, lines: ['cd: no previous folder.'] })
        return changeDir(prevCwd)
      }
      const r = await window.filesmith.consoleCd(cwd, k.args.join(' '))
      return r.ok
        ? changeDir(r.dir)
        : dispatch({ type: 'builtin', id, cwd, line, lines: [r.error] })
    }
    dispatch({ type: 'start', id, cwd, line, at: Date.now() })
    setRunId(id)
    body.current?.focus()
    const r = await window.filesmith.consoleRun(id, line, cwd)
    if (!r.ok) {
      dispatch({ type: 'out', id, text: `filesmith: ${r.error}` })
      dispatch({ type: 'exit', id, code: 2, at: Date.now() })
    }
    setRunId(null)
    requestAnimationFrame(() => pin.current?.focus())
  }

  function stop(): void {
    if (!runId) return
    dispatch({ type: 'stopping', id: runId })
    window.filesmith.consoleCancel(runId)
  }

  /** `text` is the prompt's current value; onChange passes the new value
   *  because the `input` state in this closure is still the old one. A single
   *  match is inserted on Tab only (`auto`); while typing it stays listed. */
  async function openCompletion(text = input, auto = true): Promise<void> {
    if (!catalog || !pin.current) return
    const caret = pin.current.selectionStart ?? text.length
    const ctx = completionContext(text.slice(0, caret), catalog, BUILTIN_ITEMS)
    if (!ctx) return setComp(null)
    let next: Comp
    if (ctx.kind === 'files') {
      const r = await window.filesmith.consoleList(cwd, ctx.dir, ctx.name)
      const items = fileItems(r.entries, ctx.name, fmtSize).map((i) => ({
        ...i,
        value: ctx.dir + i.value
      }))
      next = { title: `FILES IN ${r.dir.toUpperCase()}`, prefix: ctx.prefix, items, active: 0 }
    } else next = { title: ctx.title, prefix: ctx.prefix, items: ctx.items, active: 0 }
    if (!next.items.length) return setComp(null)
    if (auto && next.items.length === 1) return insert(next, 0, text)
    setComp(next)
  }

  function insert(c: Comp, i: number, text = input): void {
    const caret = pin.current?.selectionStart ?? text.length
    const r = applyCompletion(text, caret, c.prefix, c.items[i].value)
    setInput(r.text)
    setComp(null)
    requestAnimationFrame(() => pin.current?.setSelectionRange(r.caret, r.caret))
  }

  function onPromptKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Tab' && !e.shiftKey && !comp) {
      e.preventDefault()
      void openCompletion()
      return
    }
    if (comp) {
      const n = Math.min(comp.items.length, 8)
      if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1
        setComp({ ...comp, active: (comp.active + d + n) % n })
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        insert(comp, comp.active)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setComp(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault()
      void submit(input)
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const r = histStep(p.history, nav, input, e.key === 'ArrowUp' ? -1 : 1)
      if (r) {
        setNav(r.nav)
        setInput(r.text)
      }
    }
  }

  function onPanelKey(e: KeyboardEvent<HTMLElement>): void {
    const k = e.key.toLowerCase()
    // window.getSelection() does not see a selection inside the <input>.
    const el = pin.current
    const inputSel = !!el && document.activeElement === el && el.selectionStart !== el.selectionEnd
    if (e.ctrlKey && k === 'c' && !inputSel && !window.getSelection()?.toString()) {
      e.preventDefault()
      if (runId) stop()
      else setInput('')
    } else if (e.ctrlKey && k === 'l') {
      e.preventDefault()
      dispatch({ type: 'clear' })
    } else if (e.ctrlKey && k === 'enter') {
      e.preventDefault()
    } else if (e.key === 'Escape' && !comp) {
      // Back to the files view; the panel stays open (spec 3).
      document.querySelector<HTMLElement>('.qtable [tabindex="0"]')?.focus()
    }
  }

  // Sash: pointer capture, --ch written directly, committed on pointer up (spec 3).
  const drag = useRef<{ y: number; h: number } | null>(null)
  const centerH = (): number => section.current?.parentElement?.clientHeight ?? 800
  const setCh = (h: number): void =>
    section.current?.parentElement?.style.setProperty('--ch', `${h}px`)
  function onSashDown(e: PointerEvent<HTMLDivElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.classList.add('drag')
    drag.current = { y: e.clientY, h: section.current?.offsetHeight ?? p.height }
  }
  function onSashMove(e: PointerEvent<HTMLDivElement>): void {
    if (drag.current)
      setCh(clampConsoleHeight(drag.current.h + (drag.current.y - e.clientY), centerH()))
  }
  function onSashUp(e: PointerEvent<HTMLDivElement>): void {
    if (!drag.current) return
    e.currentTarget.classList.remove('drag')
    p.onHeight(clampConsoleHeight(drag.current.h + (drag.current.y - e.clientY), centerH()))
    drag.current = null
  }
  function onSashKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    p.onHeight(clampConsoleHeight(p.height + (e.key === 'ArrowUp' ? 20 : -20), centerH()))
  }

  function folderMenu(): void {
    const r = folderBtn.current?.getBoundingClientRect()
    if (!r) return
    const choices = folderChoices(p.recent, p.queueDirs)
    p.onMenu({
      x: r.left,
      y: r.bottom,
      items: [
        ...choices.map((d) => ({
          label: d,
          icon: d === cwd ? ('check' as const) : ('folder' as const),
          onClick: () => changeDir(d)
        })),
        { sep: true as const },
        {
          label: 'Choose folder',
          icon: 'folder' as const,
          onClick: () => void window.filesmith.pickFolder().then((d) => d && changeDir(d))
        }
      ]
    })
  }

  function rowMenu(e: MouseEvent, path: string): void {
    e.preventDefault()
    p.onMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Show in File Explorer',
          icon: 'folder',
          onClick: () => window.filesmith.reveal(path)
        },
        {
          label: 'Open in default app',
          icon: 'eye',
          onClick: () => window.filesmith.openFile(path)
        }
      ]
    })
  }

  const pr = pin.current?.getBoundingClientRect()
  return (
    <section
      ref={section}
      className="console"
      id="console"
      aria-label="Console"
      hidden={!p.open}
      onKeyDown={onPanelKey}
    >
      <div
        className="sash"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize console"
        aria-valuenow={p.height}
        aria-valuemin={120}
        aria-valuemax={clampConsoleHeight(Infinity, centerH())}
        tabIndex={0}
        onPointerDown={onSashDown}
        onPointerMove={onSashMove}
        onPointerUp={onSashUp}
        onKeyDown={onSashKey}
      />
      <div className="chead">
        <span className="lbl">
          <Icon name="console" />
          Console
        </span>
        <button
          ref={folderBtn}
          type="button"
          className="cwd"
          aria-haspopup="menu"
          title="Folder the commands run in"
          onClick={folderMenu}
        >
          <Icon name="folder" />
          <span className="p">{cwd}</span>
          <Icon name="chev-d" size={12} />
        </button>
        <span className="note" title="Runs here do not join the queue">
          filesmith only, not in the queue
        </span>
        <div className="r">
          {runId && (
            <button type="button" className="stopbtn" title="Stop the run (Ctrl+C)" onClick={stop}>
              <Icon name="stop" />
              Stop<span className="k">Ctrl+C</span>
            </button>
          )}
          <button
            type="button"
            className="hbtn"
            title="Open a terminal in this folder, with filesmith on PATH"
            onClick={() => void terminal()}
          >
            <Icon name="external" />
            Open in terminal
          </button>
          <button
            type="button"
            className="hib"
            title="Clear (Ctrl+L)"
            aria-label="Clear console"
            onClick={() => dispatch({ type: 'clear' })}
          >
            <Icon name="clear" />
          </button>
          <button
            type="button"
            className="hib"
            title="Close console (Ctrl+`)"
            aria-label="Close console"
            onClick={p.onClose}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div
        ref={body}
        className="cbody scroll-thin select-text"
        tabIndex={-1}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4
        }}
        onMouseUp={() => {
          if (!window.getSelection()?.toString() && !runId) pin.current?.focus()
        }}
      >
        <ConsoleOutput
          blocks={state.blocks}
          onTerminal={() => void terminal()}
          onReveal={(x) => window.filesmith.reveal(x)}
          onRowMenu={rowMenu}
        />
        <div className="pline">
          {runId ? (
            <span className="waitmsg">
              Running. Ctrl+C or Stop cancels it; the app&apos;s queue keeps working.
            </span>
          ) : (
            <>
              <span className="pr" title={cwd}>
                <bdi>{`${cwd}>`}</bdi>
              </span>
              <span className="fx">{' filesmith '}</span>
              <input
                ref={pin}
                className="pin"
                spellCheck={false}
                autoComplete="off"
                aria-label="filesmith command"
                aria-autocomplete="list"
                aria-controls={comp ? 'console-comp' : undefined}
                aria-activedescendant={comp ? `console-comp-${comp.active}` : undefined}
                placeholder={state.blocks.length ? '' : 'convert *.heic --to webp'}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  if (comp) void openCompletion(e.target.value, false)
                }}
                onKeyDown={onPromptKey}
                onBlur={() => setTimeout(() => setComp(null), 120)}
              />
            </>
          )}
          {/* Shown while a run is busy too, as in the mockup's running state. */}
          <span className="keys">
            <span>
              <kbd>Tab</kbd>complete
            </span>
            <span>
              <kbd>Up</kbd>
              <kbd>Down</kbd>history
            </span>
          </span>
        </div>
      </div>
      {comp && pr && (
        <CompletionList
          title={comp.title}
          prefix={comp.prefix}
          items={comp.items}
          active={comp.active}
          anchor={{ left: pr.left - 12, bottom: window.innerHeight - pr.top + 4 }}
          onPick={(i) => insert(comp, i)}
        />
      )}
    </section>
  )
}
