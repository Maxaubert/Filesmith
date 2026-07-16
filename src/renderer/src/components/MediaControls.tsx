import { useEffect, useRef, useState, type JSX } from 'react'
import { Icon } from './Icon'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const fmt = (s: number): string => {
  const t = !Number.isFinite(s) || s < 0 ? 0 : s
  const m = Math.floor(t / 60)
  const sec = Math.floor(t % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Element mutations live in plain helpers (taking the element as a param) so the
// hooks/immutability lint doesn't treat them as mutating the `media` prop.
function seekMedia(m: HTMLMediaElement, t: number): void {
  m.currentTime = t
}
function togglePlay(m: HTMLMediaElement): void {
  if (m.paused) void m.play()
  else m.pause()
}
function toggleMute(m: HTMLMediaElement): void {
  m.muted = !m.muted
}

/**
 * Custom media controls (replacing the native player) so the timeline reads
 * clearly against the video: an indigo progress fill with an always-visible
 * scrubber dot, plus play/pause, time, mute, and (video) fullscreen.
 */
export function MediaControls({
  media,
  onFullscreen
}: {
  media: HTMLMediaElement | null
  onFullscreen?: () => void
}): JSX.Element | null {
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!media) return
    const onTime = (): void => setCur(media.currentTime)
    const sync = (): void => {
      setPlaying(!media.paused)
      setMuted(media.muted)
      setDur(Number.isFinite(media.duration) ? media.duration : 0)
    }
    const syncEvents = ['durationchange', 'loadedmetadata', 'play', 'pause', 'volumechange']
    media.addEventListener('timeupdate', onTime)
    syncEvents.forEach((ev) => media.addEventListener(ev, sync))
    sync()
    onTime()
    return () => {
      media.removeEventListener('timeupdate', onTime)
      syncEvents.forEach((ev) => media.removeEventListener(ev, sync))
    }
  }, [media])

  if (!media) return null
  const frac = dur > 0 ? clamp(cur / dur, 0, 1) : 0

  const seekTo = (clientX: number): void => {
    const r = barRef.current?.getBoundingClientRect()
    if (!r || dur <= 0) return
    const t = clamp((clientX - r.left) / r.width, 0, 1) * dur
    seekMedia(media, t)
    setCur(t)
  }
  const onBarDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    seekTo(e.clientX)
    const move = (ev: globalThis.MouseEvent): void => seekTo(ev.clientX)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const btn =
    'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/90 transition hover:bg-white/15 hover:text-white'

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2.5 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-4 pb-3 pt-8 text-white">
      <button className={btn} title={playing ? 'Pause' : 'Play'} onClick={() => togglePlay(media)}>
        <Icon name={playing ? 'pause' : 'play'} className="h-[18px] w-[18px]" strokeWidth={0} />
      </button>
      <span className="w-[42px] shrink-0 text-center text-[11.5px] tabular-nums text-white/90">
        {fmt(cur)}
      </span>
      <div onMouseDown={onBarDown} className="group flex-1 cursor-pointer py-2">
        <div ref={barRef} className="relative h-1.5 rounded-full bg-white/25">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${frac * 100}%` }}
          />
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,.45)]"
            style={{ left: `${frac * 100}%` }}
          />
        </div>
      </div>
      <span className="w-[42px] shrink-0 text-center text-[11.5px] tabular-nums text-white/70">
        {fmt(dur)}
      </span>
      <button className={btn} title={muted ? 'Unmute' : 'Mute'} onClick={() => toggleMute(media)}>
        <Icon name={muted ? 'volume-mute' : 'volume'} className="h-[18px] w-[18px]" />
      </button>
      {onFullscreen && (
        <button className={btn} title="Fullscreen" onClick={onFullscreen}>
          <Icon name="fullscreen" className="h-[17px] w-[17px]" />
        </button>
      )}
    </div>
  )
}
