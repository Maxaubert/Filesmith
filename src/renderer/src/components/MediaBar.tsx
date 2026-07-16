import { useEffect, useRef, useState, type CSSProperties, type JSX, type MouseEvent } from 'react'
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

const vertical: CSSProperties = { writingMode: 'vertical-lr', direction: 'rtl', width: '20px', height: '90px' }

/**
 * Custom media controls: a muted track, an indigo (accent) elapsed fill, a
 * ringed accent playhead dot, and a vertical volume slider that pops above the
 * speaker on hover. `dark` styles it for a video overlay; otherwise it sits on
 * the light footer. Shared by audio and video; video also gets fullscreen.
 */
export function MediaBar({
  media,
  onFullscreen,
  dark = false
}: {
  media: HTMLMediaElement | null
  onFullscreen?: () => void
  dark?: boolean
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

  const btn = `grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${
    dark ? 'text-white/90 hover:bg-white/15 hover:text-white' : 'text-muted hover:bg-black/[.06] hover:text-ink'
  }`

  return (
    <div className="flex items-center gap-2.5">
      <button className={btn} title={playing ? 'Pause' : 'Play'} onClick={() => togglePlay(media)}>
        <Icon name={playing ? 'pause' : 'play'} className="h-[17px] w-[17px]" strokeWidth={0} />
      </button>
      <span
        className={`shrink-0 text-[12px] font-medium tabular-nums ${dark ? 'text-white/85' : 'text-muted'}`}
      >
        {fmt(cur)} / {fmt(dur)}
      </span>
      <div onMouseDown={onBarDown} className="relative flex-1 cursor-pointer py-2.5">
        <div ref={barRef} className={`relative h-1.5 rounded-full ${dark ? 'bg-white/25' : 'bg-black/10'}`}>
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${frac * 100}%` }}
          />
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow-[0_1px_3px_rgba(0,0,0,.3)]"
            style={{ left: `${frac * 100}%` }}
          />
        </div>
      </div>
      <div className="group/vol relative flex items-center">
        <div
          className={`pointer-events-none absolute bottom-full left-1/2 mb-1 grid -translate-x-1/2 place-items-center rounded-xl p-2.5 opacity-0 shadow-[0_6px_20px_rgba(0,0,0,.25)] transition group-hover/vol:pointer-events-auto group-hover/vol:opacity-100 ${
            dark ? 'bg-[#2c2c33]' : 'bg-white ring-1 ring-black/[.06]'
          }`}
        >
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : vol}
            onChange={(e) => applyVolume(media, Number(e.currentTarget.value))}
            aria-label="Volume"
            className="cursor-pointer accent-accent"
            style={vertical}
          />
        </div>
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
