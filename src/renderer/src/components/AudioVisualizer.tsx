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
    sourceCache.set(el, s)
  }
  return s
}

// Tuned preset (see memory: filesmith-visualizer-settings). A radial spectrum:
// frequency bars spike outward from a base ring, bass biggest at the bottom,
// mirrored and colored indigo -> violet -> coral around the circle.
const BAR_LEN = 0.26 // max bar length as fraction of min dimension
const BAR_WIDTH = 3 // bar thickness (px)
const BARS = 272 // total bars around the ring
const MIN_BAR = 0 // idle bar length (floor)
const LEVEL = 2.1 // overall level
const TILT = 2.1 // lift quieter high frequencies
const CONTRAST = 2.9 // >1 widens the gap between bars
const BOOM_GAIN = 0.18 // big-bass/drop -> base-ring pulse
const BOOM_THRESH = 0.84
const BOOM_RELEASE = 0.975
const RESPONSIVENESS = 0.1 // how MUCH bars move
const REACTION_SPEED = 0.1 // how FAST bars move (temporal smoothing)
const RADIUS = 0.2 // base ring radius as fraction of min dimension
const RING_WIDTH = 3.5 // base ring thickness (0 = off)
const GLOW = 0 // bar glow (shadowBlur)
const CORE_FRAC = 0.98 // aurora radius as fraction of the ring's inner radius (fills it)
const SPIN = 0 // ring rotation per frame
const MIRROR: boolean = true // symmetric (bass at bottom) vs sequential
const NORMAL_SCALE = 1.25 // overall size in the normal preview
const FS_SCALE = 1.9 // overall size in fullscreen (expand a lot)

// Palette sweep for the bars: indigo -> violet -> coral.
function lerpHex(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16)
  const bh = parseInt(b.slice(1), 16)
  const ar = ah >> 16
  const ag = (ah >> 8) & 255
  const ab = ah & 255
  const br = bh >> 16
  const bg = (bh >> 8) & 255
  const bb = bh & 255
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r},${g},${bl})`
}
function paletteAt(t: number): string {
  return t < 0.5
    ? lerpHex('#5b5bd6', '#9a6cff', t / 0.5)
    : lerpHex('#9a6cff', '#ff9a8b', (t - 0.5) / 0.5)
}

/**
 * Radial spectrum audio visualizer on a shared AnalyserNode. Silent -> a quiet
 * ring of short bars; playing -> bars spike per frequency band.
 */
export function AudioVisualizer({ media }: { media: HTMLMediaElement | null }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  useEffect(() => {
    if (!media) return
    const ctx = getAudioContext()
    let source: MediaElementAudioSourceNode
    try {
      source = getSource(ctx, media)
    } catch {
      return // media not CORS-readable; leave the idle ring
    }
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.5
    source.connect(analyser)
    analyser.connect(ctx.destination)
    analyserRef.current = analyser
    const resume = (): void => {
      if (ctx.state === 'suspended') void ctx.resume()
    }
    media.addEventListener('play', resume)
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const freq = new Uint8Array(1024)
    const barVals = new Float32Array(256)
    let raf = 0
    let boomHold = 0
    let spin = 0

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
      for (let i = a; i < b; i++) s += freq[i]
      return s / (b - a) / 255
    }

    const draw = (): void => {
      fit()
      const W = canvas.width
      const H = canvas.height
      g.clearRect(0, 0, W, H)

      const an = analyserRef.current
      const live = an != null && audioCtx?.state === 'running'
      if (live) an.getByteFrequencyData(freq)
      const bass = live ? band(1, 12) : 0

      const denom = Math.max(0.05, 1 - BOOM_THRESH)
      const boomRaw = Math.pow(Math.max(0, (bass - BOOM_THRESH) / denom), 1.5)
      boomHold = Math.max(boomRaw, boomHold * BOOM_RELEASE)
      const boom = boomHold
      spin += SPIN

      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      // Bigger in the normal preview, much bigger when the stage is fullscreen.
      const scale = document.fullscreenElement ? FS_SCALE : NORMAL_SCALE
      const half = MIRROR ? Math.max(1, Math.floor(BARS / 2)) : BARS
      const total = MIRROR ? half * 2 : BARS

      // Update smoothed bar heights from the spectrum. Log-ish bin spread (more
      // bars at low frequencies where the energy is), a contrast power curve to
      // widen the gap between bars, and a treble tilt to lift quiet highs.
      for (let m = 0; m < half; m++) {
        const frac = m / half
        const bin = 2 + Math.floor(Math.pow(frac, 1.5) * 430)
        const raw = live ? freq[Math.min(freq.length - 1, bin)] / 255 : 0
        const shaped = Math.pow(raw, CONTRAST)
        const tilted = shaped * (1 + frac * TILT)
        const target = tilted * LEVEL * RESPONSIVENESS
        barVals[m] += (target - barVals[m]) * REACTION_SPEED
      }

      const Rbase = minD * RADIUS * scale * (1 + boom * BOOM_GAIN)
      // Root the bars on the ring's centerline; the base ring is stroked AFTER
      // the bars (below) so it covers their inner roots and they read as grown
      // out of the ring rather than floating beside it.
      const rIn = Rbase
      const tipMax = minD * 0.48
      g.lineCap = 'round'
      g.lineWidth = BAR_WIDTH * DPR
      g.shadowColor = 'rgba(120,110,255,0.5)'
      g.shadowBlur = GLOW * DPR
      for (let j = 0; j < total; j++) {
        let m = MIRROR ? (j < half ? j : total - 1 - j) : j
        if (m >= half) m = half - 1
        const t = m / Math.max(1, half - 1)
        const a = Math.PI / 2 + spin + ((j + 0.5) / total) * Math.PI * 2 // bass seam at bottom
        let tip = rIn + minD * (MIN_BAR + barVals[m] * BAR_LEN) * scale
        if (tip > tipMax) tip = tipMax
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        g.strokeStyle = paletteAt(t)
        g.beginPath()
        g.moveTo(cx + ca * rIn, cy + sa * rIn)
        g.lineTo(cx + ca * tip, cy + sa * tip)
        g.stroke()
      }
      g.shadowBlur = 0

      // Base ring outline the bars grow from.
      if (RING_WIDTH > 0) {
        g.beginPath()
        g.arc(cx, cy, Rbase, 0, Math.PI * 2)
        g.strokeStyle = 'rgba(120,110,255,0.55)'
        g.lineWidth = RING_WIDTH * DPR
        g.stroke()
      }

      // Center "app tile" — a rounded gradient app-icon tile with a white music
      // note inside, sitting in the ring's hole. Gentle beat pulse only.
      const vr = Rbase * CORE_FRAC
      const side = vr * 1.08 * (1 + boom * 0.05)
      const rad = side * 0.24
      g.save()
      g.translate(cx, cy)
      const tileGrad = g.createLinearGradient(-side / 2, -side / 2, side / 2, side / 2)
      tileGrad.addColorStop(0, '#5b5bd6')
      tileGrad.addColorStop(0.55, '#9a6cff')
      tileGrad.addColorStop(1, '#ff9a8b')
      g.shadowColor = 'rgba(120,90,255,0.4)'
      g.shadowBlur = side * 0.16
      g.shadowOffsetY = side * 0.05
      g.beginPath()
      g.roundRect(-side / 2, -side / 2, side, side, rad)
      g.fillStyle = tileGrad
      g.fill()
      g.shadowBlur = 0
      g.shadowOffsetY = 0
      // white music note, centered on the tile
      const nsc = (side * 0.6) / 24
      g.save()
      g.scale(nsc, nsc)
      g.translate(-12, -12)
      g.strokeStyle = '#ffffff'
      g.fillStyle = '#ffffff'
      g.lineWidth = 2.2
      g.lineJoin = 'round'
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(9, 18)
      g.lineTo(9, 5)
      g.lineTo(21, 3)
      g.lineTo(21, 16)
      g.stroke()
      g.beginPath()
      g.arc(6, 18, 3, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.arc(18, 16, 3, 0, Math.PI * 2)
      g.fill()
      g.restore()
      g.restore()

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} className="h-full w-full" />
}
