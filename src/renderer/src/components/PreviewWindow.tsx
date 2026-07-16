import { useEffect, useRef, useState, type JSX, type MouseEvent, type WheelEvent } from 'react'
import type { PreviewItem, PreviewPayload } from '@shared/types'
import { formatBytes } from '../state'
import { Icon } from './Icon'

const extOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toUpperCase() : ''
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const MAX_ZOOM = 8

/**
 * Root of the standalone preview window. Fetches its file list on load and when
 * the window is reused, remounting the view (via `ver`) so index/zoom reset.
 */
export function PreviewWindow(): JSX.Element | null {
  const [state, setState] = useState<{ p: PreviewPayload; ver: number } | null>(null)
  useEffect(() => {
    void window.filesmith.getPreviewData().then((p) => setState((s) => ({ p, ver: (s?.ver ?? 0) + 1 })))
    return window.filesmith.onPreviewUpdate((p) => setState((s) => ({ p, ver: (s?.ver ?? 0) + 1 })))
  }, [])
  if (!state || state.p.files.length === 0) return <div className="h-screen bg-white" />
  return <PreviewView key={state.ver} files={state.p.files} start={state.p.index} />
}

function PreviewView({ files, start }: { files: PreviewItem[]; start: number }): JSX.Element | null {
  const [i, setI] = useState(start)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const setMedia = (el: HTMLMediaElement | null): void => {
    mediaRef.current = el
  }
  const many = files.length > 1
  const step = (d: number): void => setI((n) => (n + d + files.length) % files.length)
  const close = (): void => window.filesmith.close()

  const [zoom, setZoom] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [panning, setPanning] = useState(false)
  const [zoomIndex, setZoomIndex] = useState(i)
  const stageRef = useRef<HTMLDivElement>(null)
  if (zoomIndex !== i) {
    setZoomIndex(i)
    setZoom(1)
    setTx(0)
    setTy(0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft' && many) step(-1)
      else if (e.key === 'ArrowRight' && many) step(1)
      else if (e.key === ' ' && mediaRef.current) {
        e.preventDefault()
        const m = mediaRef.current
        if (m.paused) void m.play()
        else m.pause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, files.length])

  const f = files[i]
  if (!f) return null
  const url = window.filesmith.mediaUrl(f.path)
  const meta = `${extOf(f.name)}${f.size ? ` · ${formatBytes(f.size)}` : ''}`

  const cursorFromCentre = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return [0, 0]
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]
  }

  function zoomAt(e: { clientX: number; clientY: number }, next: number): void {
    const ns = clamp(next, 1, MAX_ZOOM)
    if (ns === 1) {
      setZoom(1)
      setTx(0)
      setTy(0)
      return
    }
    const [cx, cy] = cursorFromCentre(e)
    const k = ns / zoom
    setTx(cx - k * (cx - tx))
    setTy(cy - k * (cy - ty))
    setZoom(ns)
  }

  function onWheel(e: WheelEvent): void {
    if (f.kind !== 'image') return
    zoomAt(e, zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18))
  }

  function onImgDown(e: MouseEvent): void {
    if (f.kind !== 'image' || zoom <= 1) return
    e.preventDefault()
    const orig = { x: e.clientX, y: e.clientY, tx, ty }
    setPanning(true)
    const move = (ev: globalThis.MouseEvent): void => {
      setTx(orig.tx + (ev.clientX - orig.x))
      setTy(orig.ty + (ev.clientY - orig.y))
    }
    const up = (): void => {
      setPanning(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const imgCursor = f.kind === 'image' && zoom > 1 ? (panning ? 'grabbing' : 'grab') : 'default'

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* header doubles as the window's drag region */}
      <div className="drag flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-bold">{f.name}</div>
          <div className="mt-0.5 text-[11.5px] text-dim">{meta}</div>
        </div>
        <div className="flex-1" />
        {many && <span className="mr-1 text-[11.5px] text-dim">{`${i + 1} / ${files.length}`}</span>}
        <button
          title="Reveal in Explorer"
          onClick={() => window.filesmith.reveal(f.path)}
          className="no-drag grid h-[34px] w-[34px] place-items-center rounded-[9px] text-muted transition hover:bg-[#f0f0f5] hover:text-ink"
        >
          <Icon name="folder" className="h-[18px] w-[18px]" />
        </button>
        <button
          title="Maximize"
          onClick={() => window.filesmith.toggleMaximize()}
          className="no-drag grid h-[34px] w-[34px] place-items-center rounded-[9px] text-muted transition hover:bg-[#f0f0f5] hover:text-ink"
        >
          <Icon name="max" className="h-[15px] w-[15px]" />
        </button>
        <button
          title="Close"
          onClick={close}
          className="no-drag grid h-[34px] w-[34px] place-items-center rounded-[9px] text-muted transition hover:bg-[#e0483d] hover:text-white"
        >
          <Icon name="close" className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* media — one light, opaque backdrop for every kind */}
      <div
        ref={stageRef}
        onWheel={onWheel}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#f1f1f4] p-5"
      >
        {f.kind === 'image' && (
          <img
            src={url}
            alt={f.name}
            draggable={false}
            onMouseDown={onImgDown}
            onDoubleClick={(e) => zoomAt(e, zoom > 1 ? 1 : 2)}
            style={{
              transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
              cursor: imgCursor,
              transition: panning ? 'none' : 'transform .12s ease-out'
            }}
            className="max-h-full max-w-full object-contain"
          />
        )}
        {f.kind === 'video' && (
          <video
            key={url}
            ref={setMedia}
            src={url}
            controls
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              if (v.currentTime < 0.02) {
                try {
                  v.currentTime = 0.04
                } catch {
                  /* seek not ready yet; ignore */
                }
              }
            }}
            className="h-full w-full rounded-lg object-contain"
          />
        )}
        {f.kind === 'audio' && (
          <div className="grid h-[220px] w-[220px] place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#8a7bff] to-[#ff9a8b] shadow-[0_12px_40px_rgba(0,0,0,.18)]">
            {f.thumb ? (
              <img src={f.thumb} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon name="music" className="h-16 w-16 text-white/90" strokeWidth={1.5} />
            )}
          </div>
        )}

        {f.kind === 'image' && zoom > 1 && (
          <button
            onClick={() => {
              setZoom(1)
              setTx(0)
              setTy(0)
            }}
            title="Reset zoom"
            className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11.5px] font-semibold text-ink shadow-[0_2px_8px_rgba(0,0,0,.14)] backdrop-blur transition hover:bg-white"
          >
            {Math.round(zoom * 100)}% · Reset
          </button>
        )}

        {many && (
          <>
            <button
              onClick={() => step(-1)}
              title="Previous"
              className="absolute left-3.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-[0_3px_12px_rgba(0,0,0,.16)] transition hover:scale-105"
            >
              <Icon name="chevron-left" className="h-5 w-5" />
            </button>
            <button
              onClick={() => step(1)}
              title="Next"
              className="absolute right-3.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-[0_3px_12px_rgba(0,0,0,.16)] transition hover:scale-105"
            >
              <Icon name="chevron-right" className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {f.kind === 'audio' && (
        <div className="shrink-0 border-t border-line px-4 py-3">
          <audio key={url} ref={setMedia} src={url} controls autoPlay className="w-full" />
        </div>
      )}
    </div>
  )
}
