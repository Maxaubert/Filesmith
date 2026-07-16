import { useEffect, useReducer, useRef, useState, type DragEvent, type JSX } from 'react'
import type { ToolId } from '@shared/types'
import { reducer, initialState, processable } from './state'
import { toolMeta } from './lib/tools'
import { TopBar } from './components/TopBar'
import { ToolRail } from './components/ToolRail'
import { DropZone } from './components/DropZone'
import { Queue } from './components/Queue'
import { OptionsPanel } from './components/OptionsPanel'

export default function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [dragging, setDragging] = useState(false)
  const requested = useRef<Set<string>>(new Set())

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

  // Lazy-load a real thumbnail for each image item, once.
  useEffect(() => {
    for (const item of state.items) {
      if (item.thumb !== null || requested.current.has(item.id)) continue
      requested.current.add(item.id)
      if (item.file.kind !== 'image') continue
      void window.filesmith
        .thumbnail(item.file.path, 128)
        .then((t) => dispatch({ type: 'setThumb', id: item.id, thumb: t }))
    }
  }, [state.items])

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
    const items = processable(state.items)
    if (!items.length) return
    const opts = state.options[state.tool]
    dispatch({ type: 'markQueued', ids: items.map((i) => i.id) })
    for (const item of items) {
      void window.filesmith.runJob({
        id: item.id,
        tool: state.tool,
        input: item.file.path,
        options: opts
      })
    }
  }

  const meta = toolMeta(state.tool)
  const runCount = processable(state.items).length

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
          <Queue
            items={state.items}
            tool={state.tool}
            options={state.options[state.tool]}
            onClear={() => dispatch({ type: 'clearFinished' })}
          />
        </section>

        <OptionsPanel
          tool={state.tool}
          options={state.options[state.tool]}
          runCount={runCount}
          onSet={(k, v) => dispatch({ type: 'setOption', tool: state.tool, key: k, value: v })}
          onRun={run}
        />
      </div>
    </div>
  )
}
