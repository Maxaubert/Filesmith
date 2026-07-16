import { useEffect, useRef, useState, type JSX, type MouseEvent, type WheelEvent } from 'react'
import type { FileKind } from '@shared/types'
import { formatBytes } from '../state'
import { Icon } from './Icon'

export interface PreviewFile {
  path: string
  name: string
  kind: FileKind
  size?: number
  thumb?: string | null
}

const extOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toUpperCase() : ''
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const MAX_ZOOM = 8

/**
 * In-app media viewer: a fixed-size card (drag its corner to resize) over a
 * dimmed backdrop. Steps through the collection it was opened from (arrows /
 * ←→), closes on Esc or a click outside, toggles play with Space for
 * video/audio, and supports wheel-zoom + drag-pan for images.
 */
export function PreviewModal({
  files,
  start,
  onClose,
  onReveal
}: {
  files: PreviewFile[]
  start: number
  onClose: () => void
  onReveal: (path: string) => void
}): JSX.Element | null {
  const [i, setI] = useState(start)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const setMedia = (el: HTMLMediaElement | null): void => {
    mediaRef.current = el
  }
  const many = files.length > 1
  const step = (d: number): void => setI((n) => (n + d + files.length) % files.length)

  // Fixed default size + centered position, computed once. Native `resize`
  // takes over from here; React never re-sets width/height, so the user's
  // dragged size survives prev/next re-renders.
  const [box] = useState(() => {
    const w = Math.min(1040, window.innerWidth - 80)
    const h = Math.min(700, window.innerHeight - 80)
    return {
      w,
      h,
      left: Math.max(16, (window.innerWidth - w) / 2),
      top: Math.max(16, (window.innerHeight - h) / 2)
    }
  })

  // Image zoom/pan.
  const [zoom, setZoom] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [panning, setPanning] = useState(false)
  const [zoomIndex, setZoomIndex] = useState(i)
  const stageRef = useRef<HTMLDivElement>(null)
  // Reset zoom/pan when the shown file changes (state-from-props, done in render).
  if (zoomIndex !== i) {
    setZoomIndex(i)
    setZoom(1)
    setTx(0)
    setTy(0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
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

  // Cursor position relative to the stage centre (transform-origin is centre).
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
    // No preventDefault: React's onWheel is passive, and nothing here scrolls.
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

  function onImgDouble(e: MouseEvent): void {
    zoomAt(e, zoom > 1 ? 1 : 2)
  }

  const imgCursor = f.kind === 'image' && zoom > 1 ? (panning ? 'grabbing' : 'grab') : 'default'

  return (
    <div className="backdrop-fade fixed inset-0 z-50 bg-[rgba(22,22,40,.32)] backdrop-blur-[3px]" onMouseDown={onClose}>
      <div
        style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
        className="modal-pop absolute flex min-h-[340px] min-w-[440px] max-h-[94vh] max-w-[96vw] resize flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_30px_80px_rgba(10,10,30,.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-bold">{f.name}</div>
            <div className="mt-0.5 text-[11.5px] text-dim">{meta}</div>
          </div>
          <div className="flex-1" />
          {many && <span className="mr-1 text-[11.5px] text-dim">{`${i + 1} / ${files.length}`}</span>}
          <button
            title="Reveal in Explorer"
            onClick={() => onReveal(f.path)}
            className="grid h-[34px] w-[34px] place-items-center rounded-[9px] text-muted transition hover:bg-[#f0f0f5] hover:text-ink"
          >
            <Icon name="folder" className="h-[18px] w-[18px]" />
          </button>
          <button
            title="Close"
            onClick={onClose}
            className="grid h-[34px] w-[34px] place-items-center rounded-[9px] text-muted transition hover:bg-[#f0f0f5] hover:text-ink"
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
              onDoubleClick={onImgDouble}
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
                // Show a real, full-res frame instead of the low-res thumbnail:
                // nudge just past 0 so a frame decodes (avoids a black start).
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

          {/* zoom indicator / reset (images only, when zoomed) */}
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

        {/* audio transport lives in a footer bar */}
        {f.kind === 'audio' && (
          <div className="shrink-0 border-t border-line px-4 py-3">
            <audio key={url} ref={setMedia} src={url} controls autoPlay className="w-full" />
          </div>
        )}

        {/* resize hint (native `resize` handles the drag) */}
        <div className="pointer-events-none absolute bottom-[3px] right-[3px] text-[#c9c9d2]">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M11 4 4 11M11 8l-3 3" />
          </svg>
        </div>
      </div>
    </div>
  )
}
