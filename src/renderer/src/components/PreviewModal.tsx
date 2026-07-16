import { useEffect, useRef, useState, type JSX } from 'react'
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

/**
 * In-app media viewer: a centered card over a dimmed backdrop. Steps through
 * the collection it was opened from (arrows / ←→), closes on Esc or a click
 * outside, and toggles play with Space for video/audio.
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
    // step/onClose are stable enough for this modal's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, files.length])

  const f = files[i]
  if (!f) return null
  const url = window.filesmith.mediaUrl(f.path)
  const meta = `${extOf(f.name)}${f.size ? ` · ${formatBytes(f.size)}` : ''}`

  return (
    <div
      className="backdrop-fade fixed inset-0 z-50 grid place-items-center bg-[rgba(22,22,40,.32)] p-9 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="modal-pop flex max-h-[88%] w-[min(920px,92%)] flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_30px_80px_rgba(10,10,30,.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
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
        <div className="relative flex min-h-[360px] flex-1 items-center justify-center overflow-hidden bg-[#f1f1f4] p-5">
          {f.kind === 'image' && (
            <img src={url} alt={f.name} className="max-h-full max-w-full object-contain" />
          )}
          {f.kind === 'video' && (
            <video
              key={url}
              ref={setMedia}
              src={url}
              poster={f.thumb ?? undefined}
              controls
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
          <div className="border-t border-line px-4 py-3">
            <audio key={url} ref={setMedia} src={url} controls autoPlay className="w-full" />
          </div>
        )}
      </div>
    </div>
  )
}
