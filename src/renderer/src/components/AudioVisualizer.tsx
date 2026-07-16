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
    let boomHold = 0
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
      fit()
      const W = canvas.width
      const H = canvas.height
      g.clearRect(0, 0, W, H)

      // Silent/paused -> zeros -> a still circle. Deformation is purely the audio.
      const an = analyserRef.current
      if (an && audioCtx?.state === 'running') an.getByteFrequencyData(data)
      else data.fill(0)

      const bass = band(1, 5)
      const overall = band(2, 50)
      // Big-hit response: threshold + compress, fast attack / slow release.
      const boomRaw = Math.pow(Math.max(0, (bass - 0.3) / 0.7), 1.5)
      boomHold = Math.max(boomRaw, boomHold * 0.93)
      const boom = boomHold
      // Gentle flow at rest, quicker with audio.
      t += 0.003 + overall * 0.014

      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const R = minD * 0.3
      // Wave depth: a base ribbon that deepens with audio and swells on a boom.
      const ampFrac = 0.2 + overall * 0.1 + boom * 0.14

      const grad = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R)
      grad.addColorStop(0, '#5b5bd6')
      grad.addColorStop(0.55, '#9a6cff')
      grad.addColorStop(1, '#ff9a8b')
      g.strokeStyle = grad
      g.lineWidth = DPR
      g.globalAlpha = 0.1

      // Many phase-shifted wavy loops form a flowing silk ribbon (guilloche).
      const lines = 90
      const pts = 260
      const petals = 8
      const petals2 = 3
      for (let l = 0; l < lines; l++) {
        const ph = (l / lines) * Math.PI * 2 * 1.3 + t
        g.beginPath()
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2
          const env = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(a * 3 + ph * 0.4))
          const w = (Math.sin(a * petals + ph) + 0.2 * Math.sin(a * petals2 - ph * 0.6)) * env
          const r = R * (1 + ampFrac * w)
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          if (i === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
      }
      g.globalAlpha = 1

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} className="h-full w-full" />
}
