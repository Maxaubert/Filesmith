import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import { Icon } from './Icon'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const fmt = (s: number): string => {
  const t = !Number.isFinite(s) || s < 0 ? 0 : s
  const m = Math.floor(t / 60)
  const sec = Math.floor(t % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Element mutations in plain helpers so hooks/immutability doesn't flag them.
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
function applyVolume(m: HTMLMediaElement, v: number): void {
  m.volume = v
  m.muted = v <= 0
}

/**
 * Custom media controls, sized to sit directly on the light footer (no pill
 * background): a muted track, an indigo (accent) elapsed fill, and a ringed
 * accent playhead dot. Shared by audio and video so both match; video also gets
 * a fullscreen button.
 */
export function MediaBar({
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
  const [vol, setVol] = useState(1)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!media) return
    const onTime = (): void => setCur(media.currentTime)
    const sync = (): void => {
      setPlaying(!media.paused)
      setMuted(media.muted)
      setVol(media.volume)
      setDur(Number.isFinite(media.duration) ? media.duration : 0)
    }
    const evs = ['durationchange', 'loadedmetadata', 'play', 'pause', 'volumechange']
    media.addEventListener('timeupdate', onTime)
    evs.forEach((e) => media.addEventListener(e, sync))
    sync()
    onTime()
    return () => {
      media.removeEventListener('timeupdate', onTime)
      evs.forEach((e) => media.removeEventListener(e, sync))
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
  const onBarDown = (e: MouseEvent): void => {
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
    'grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-black/[.06] hover:text-ink'

  return (
    <div className="flex items-center gap-2.5">
      <button className={btn} title={playing ? 'Pause' : 'Play'} onClick={() => togglePlay(media)}>
        <Icon name={playing ? 'pause' : 'play'} className="h-[17px] w-[17px]" strokeWidth={0} />
      </button>
      <span className="shrink-0 text-[12px] font-medium tabular-nums text-muted">
        {fmt(cur)} / {fmt(dur)}
      </span>
      <div onMouseDown={onBarDown} className="relative flex-1 cursor-pointer py-2.5">
        <div ref={barRef} className="relative h-1.5 rounded-full bg-black/10">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${frac * 100}%` }}
          />
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow-[0_1px_3px_rgba(0,0,0,.25)]"
            style={{ left: `${frac * 100}%` }}
          />
        </div>
      </div>
      <div className="group/vol flex items-center">
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={muted ? 0 : vol}
          onChange={(e) => applyVolume(media, Number(e.currentTarget.value))}
          aria-label="Volume"
          className="h-1 w-0 cursor-pointer opacity-0 accent-accent transition-all duration-200 group-hover/vol:mr-2 group-hover/vol:w-16 group-hover/vol:opacity-100"
        />
        <button className={btn} title={muted ? 'Unmute' : 'Mute'} onClick={() => toggleMute(media)}>
          <Icon name={muted || vol <= 0 ? 'volume-mute' : 'volume'} className="h-[18px] w-[18px]" />
        </button>
      </div>
      {onFullscreen && (
        <button className={btn} title="Fullscreen" onClick={onFullscreen}>
          <Icon name="fullscreen" className="h-[17px] w-[17px]" />
        </button>
      )}
    </div>
  )
}
