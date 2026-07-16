import { useEffect, useRef, type JSX } from 'react'

// One shared AudioContext for the window; a MediaElementSource can only be made
// once per element, so cache it (and survive React StrictMode's double-invoke).
let audioCtx: AudioContext | null = null
function getAudioContext(): AudioContext {
  audioCtx ??= new AudioContext()
  return audioCtx
}
const sourceCache = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
function getSource(ctx: AudioContext, el: HTMLMediaElement): MediaElementAudioSourceNode {
  let s = sourceCache.get(el)
  if (!s) {
    s = ctx.createMediaElementSource(el)
    s.connect(ctx.destination) // audio path (analyser is only a tap)
    sourceCache.set(el, s)
  }
  return s
}

/**
 * Reactive-blob audio visualizer: a morphing indigo→pink gradient shape driven
 * by the track's low/mid/high energy via a Web Audio AnalyserNode. Falls back to
 * a gentle idle motion when paused/suspended.
 */
export function AudioVisualizer({ media }: { media: HTMLMediaElement | null }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  // Tap the element into an analyser once it exists.
  useEffect(() => {
    if (!media) return
    const ctx = getAudioContext()
    let source: MediaElementAudioSourceNode
    try {
      source = getSource(ctx, media)
    } catch {
      return // media not CORS-readable; leave the idle animation running
    }
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.82
    source.connect(analyser)
    analyserRef.current = analyser
    const resume = (): void => {
      if (ctx.state === 'suspended') void ctx.resume()
    }
    media.addEventListener('play', resume)
    if (!media.paused) resume()
    return () => {
      media.removeEventListener('play', resume)
      try {
        source.disconnect(analyser)
      } catch {
        /* already disconnected */
      }
      analyser.disconnect()
      analyserRef.current = null
    }
  }, [media])

  // Draw loop.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const data = new Uint8Array(128)
    let raf = 0
    let t = 0

    const fit = (): void => {
      const r = canvas.getBoundingClientRect()
      const w = Math.round(r.width * DPR)
      const h = Math.round(r.height * DPR)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }
    const band = (a: number, b: number): number => {
      let s = 0
      for (let i = a; i < b; i++) s += data[i]
      return s / (b - a) / 255
    }

    const draw = (): void => {
      t += 0.016
      fit()
      const W = canvas.width
      const H = canvas.height
      g.clearRect(0, 0, W, H)

      let lo: number
      let mid: number
      let hi: number
      const an = analyserRef.current
      if (an && audioCtx?.state === 'running') {
        an.getByteFrequencyData(data)
        lo = band(0, 6)
        mid = band(6, 24)
        hi = band(24, 64)
      } else {
        lo = 0.12 + 0.05 * Math.sin(t * 1.1)
        mid = 0.1 + 0.04 * Math.sin(t * 0.8 + 1)
        hi = 0.06 + 0.03 * Math.sin(t * 1.4 + 2)
      }

      const cx = W / 2
      const cy = H / 2
      const R = Math.min(W, H) * 0.26

      const glow = g.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.4)
      glow.addColorStop(0, `rgba(91,91,214,${0.28 + lo * 0.45})`)
      glow.addColorStop(1, 'rgba(91,91,214,0)')
      g.fillStyle = glow
      g.fillRect(0, 0, W, H)

      g.beginPath()
      const pts = 96
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2
        const wob =
          Math.sin(a * 3 + t * 2) * mid + Math.sin(a * 6 - t * 3) * hi + Math.sin(a * 2 + t) * lo
        const rr = R * (1 + 0.34 * wob)
        const x = cx + Math.cos(a) * rr
        const y = cy + Math.sin(a) * rr
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.closePath()
      const fill = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R)
      fill.addColorStop(0, '#7c6cff')
      fill.addColorStop(1, '#ff9a8b')
      g.fillStyle = fill
      g.shadowColor = 'rgba(91,91,214,.45)'
      g.shadowBlur = 40 * DPR
      g.fill()
      g.shadowBlur = 0

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} className="h-full w-full" />
}
