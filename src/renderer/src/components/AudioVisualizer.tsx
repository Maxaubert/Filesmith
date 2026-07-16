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
    s = ctx.createMediaElementSource(el) // can only be created once per element
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
    analyser.smoothingTimeConstant = 0.7
    // Route audio THROUGH the analyser so it always sees the live signal.
    source.connect(analyser)
    analyser.connect(ctx.destination)
    analyserRef.current = analyser
    const resume = (): void => {
      if (ctx.state === 'suspended') void ctx.resume()
    }
    media.addEventListener('play', resume)
    // Any click is a user gesture that can resume a suspended context.
    window.addEventListener('pointerdown', resume)
    if (!media.paused) resume()
    return () => {
      media.removeEventListener('play', resume)
      window.removeEventListener('pointerdown', resume)
      try {
        source.disconnect()
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
      fit()
      const W = canvas.width
      const H = canvas.height
      g.clearRect(0, 0, W, H)

      // Silent/paused -> zeros -> a still circle. Deformation is purely the audio.
      const an = analyserRef.current
      if (an && audioCtx?.state === 'running') an.getByteFrequencyData(data)
      else data.fill(0)

      const bass = band(1, 6)
      const overall = band(1, 40)
      const cx = W / 2
      const cy = H / 2
      // Small resting circle leaves room for spikes; bass adds a gentle pulse.
      const R = Math.min(W, H) * 0.14 * (1 + bass * 0.3)

      // Glow fades fully within the canvas so there's no square haze / clipping.
      const glow = g.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 2.2)
      glow.addColorStop(0, `rgba(91,91,214,${0.08 + overall * 0.5})`)
      glow.addColorStop(1, 'rgba(91,91,214,0)')
      g.fillStyle = glow
      g.fillRect(0, 0, W, H)

      // Fewer, bigger lobes; a power curve makes loud bands spike out sharply
      // while quiet ones stay near the resting circle.
      const pts = 160
      const bins = 16
      g.beginPath()
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2
        const m = Math.abs((((i / pts) * 2) % 2) - 1)
        const idx = 2 + m * (bins - 1)
        const b0 = Math.floor(idx)
        const frac = idx - b0
        const raw = (data[b0] * (1 - frac) + data[b0 + 1] * frac) / 255
        const spike = Math.pow(raw, 1.4)
        const rr = R * (1 + spike * 1.5)
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
