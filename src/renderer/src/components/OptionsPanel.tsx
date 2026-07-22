import { useEffect, type CSSProperties, type JSX } from 'react'
import type { FileKind, JobOptions } from '@shared/types'
import { familyFormats, isSameFormat } from '@shared/convert'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  IMAGE_FORMATS,
  PDF_LEVELS,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  UPSCALE_COMFY,
  UPSCALE_FACTORS,
  UPSCALE_GPU_MODES,
  UPSCALE_MODELS,
  VIDEO_CODECS,
  type Choice
} from '@shared/compress'
import { RESIZE_FITS, type ResizeFit } from '@shared/resize'
import { BG_DEFAULTS, BG_FILLS, type BgFill } from '@shared/removebg'
import type { Operation } from '@shared/catalog'
import { Icon } from './Icon'
import { OperationSwitcher } from './OperationSwitcher'
import { PidInstallCard } from './PidUpscale'
import { usePidStatus } from './usePidStatus'
import { ComfyImportCard } from './ComfyImport'
import { useComfyModels } from './useComfyModels'

/** A live "input → output" resolution row for the video resolution preview. */
export interface VideoOutputRow {
  path: string
  name: string
  from: string
  to: string
}

function Label({ children }: { children: string }): JSX.Element {
  return (
    <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="flex rounded-xl bg-[#ececf2] p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg py-1.5 text-[12.5px] font-semibold transition ${
            value === o.value
              ? 'bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,.06)]'
              : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ConvertOptions({
  options,
  activeKind,
  sourceExt,
  srcExts,
  set
}: {
  options: JobOptions
  activeKind: FileKind | null
  sourceExt: string | null
  srcExts: string[]
  set: (k: string, v: string | number) => void
}): JSX.Element {
  const kind = activeKind ?? 'image'
  const formats = familyFormats(kind, sourceExt ?? '')
  return (
    <>
      <div>
        <Label>Target format</Label>
        <div className="grid grid-cols-2 gap-2">
          {formats.map((f) => {
            // Grey out (and block) any format a selected source already is: with
            // a PNG + JPEG selection, neither PNG nor JPEG is a valid target.
            const disabled = srcExts.some((e) => isSameFormat(f.ext, e))
            const sel = options.format === f.ext && !disabled
            return (
              <button
                key={f.ext}
                disabled={disabled}
                title={disabled ? 'Files are already this format' : undefined}
                onClick={() => set('format', f.ext)}
                className={`rounded-xl border py-2.5 text-[13px] font-semibold transition ${
                  sel
                    ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_rgba(0,0,0,.06)]'
                    : disabled
                      ? 'cursor-not-allowed border-black/[.06] bg-white text-[#c4c4cc]'
                      : 'border-black/[.10] bg-white text-[#33333a] hover:border-[#b9b9c8]'
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      </div>
      {kind === 'image' && (
        <div>
          <Label>Quality</Label>
          <Segmented
            value={String(options.quality ?? 'balanced')}
            onChange={(v) => set('quality', v)}
            options={[
              { value: 'smaller', label: 'Smaller' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'best', label: 'Best' }
            ]}
          />
        </div>
      )}
    </>
  )
}

/** A styled single-select dropdown. */
function ChoiceSelect<T extends string>({
  value,
  choices,
  onChange
}: {
  value: T
  choices: Choice<T>[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full cursor-pointer appearance-none rounded-xl border border-black/[.10] bg-white py-2.5 pl-3.5 pr-9 text-[13px] font-semibold text-ink outline-none transition hover:border-[#b9b9c8] focus:border-accent"
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  )
}

function QualitySlider({
  options,
  set
}: {
  options: JobOptions
  set: (k: string, v: string | number | boolean) => void
}): JSX.Element {
  const q = Number(options.quality ?? 80)
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">Quality</span>
        <span className="text-sm font-semibold text-accent">{q}</span>
      </div>
      <input
        type="range"
        min={10}
        max={100}
        value={q}
        onChange={(e) => set('quality', Number(e.target.value))}
        className="w-full accent-accent"
      />
      <div className="mt-1.5 flex justify-between text-[11px] text-dim">
        <span>Smaller file</span>
        <span>Higher quality</span>
      </div>
    </div>
  )
}

function CompressOptions({
  options,
  activeKind,
  videoOutputs,
  set
}: {
  options: JobOptions
  activeKind: FileKind | null
  videoOutputs?: VideoOutputRow[]
  set: (k: string, v: string | number | boolean) => void
}): JSX.Element {
  if (activeKind === 'pdf') {
    const gray = Boolean(options.pdfGray)
    return (
      <>
        <div>
          <Label>Level</Label>
          <ChoiceSelect
            value={String(options.pdfLevel ?? 'balanced')}
            choices={PDF_LEVELS}
            onChange={(v) => set('pdfLevel', v)}
          />
        </div>
        <button
          onClick={() => set('pdfGray', !gray)}
          className="flex items-center justify-between rounded-xl border border-black/[.10] bg-white px-3.5 py-2.5 text-left transition hover:border-[#b9b9c8]"
        >
          <span className="text-[12.5px] font-semibold text-ink">Convert to grayscale</span>
          <span
            className={`relative h-[22px] w-[38px] rounded-full transition ${gray ? 'bg-accent' : 'bg-[#d4d4dc]'}`}
          >
            <span
              className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${gray ? 'left-[19px]' : 'left-[3px]'}`}
            />
          </span>
        </button>
      </>
    )
  }

  if (activeKind === 'video') {
    return (
      <>
        <div>
          <Label>Codec</Label>
          <ChoiceSelect
            value={String(options.videoCodec ?? 'h264')}
            choices={VIDEO_CODECS}
            onChange={(v) => set('videoCodec', v)}
          />
        </div>
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">Scale</span>
            <span className="text-sm font-semibold text-accent">
              {Number(options.scale ?? 100) === 100 ? 'Original' : `${Number(options.scale)}%`}
            </span>
          </div>
          <input
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={Number(options.scale ?? 100)}
            onChange={(e) => set('scale', Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="mt-1.5 flex justify-between text-[11px] text-dim">
            <span>{SCALE_MIN}%</span>
            <span>Original</span>
          </div>
        </div>
        {Number(options.scale ?? 100) < 100 &&
          videoOutputs &&
          videoOutputs.length > 0 && (
          <div>
            <Label>Output</Label>
            <div className="scroll-thin max-h-32 space-y-1 overflow-auto rounded-xl border border-black/[.08] bg-white p-2.5">
              {videoOutputs.map((r) => (
                <div key={r.path} className="flex items-center gap-1.5 text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-dim" title={r.name}>
                    {r.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted">
                    {r.from}
                    {r.to !== r.from && <span className="text-accent"> → {r.to}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <QualitySlider options={options} set={set} />
      </>
    )
  }

  if (activeKind === 'audio') {
    const br = Number(options.audioBitrate ?? 192)
    return (
      <>
        <div>
          <Label>Format</Label>
          <ChoiceSelect
            value={String(options.audioCodec ?? 'keep')}
            choices={AUDIO_CODECS}
            onChange={(v) => set('audioCodec', v)}
          />
        </div>
        <div>
          <Label>Bitrate</Label>
          <div className="grid grid-cols-3 gap-2">
            {AUDIO_BITRATES.map((b) => {
              const sel = br === b
              return (
                <button
                  key={b}
                  onClick={() => set('audioBitrate', b)}
                  className={`rounded-xl border py-2 text-[12.5px] font-semibold transition ${
                    sel
                      ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_rgba(0,0,0,.06)]'
                      : 'border-black/[.10] bg-white text-[#33333a] hover:border-[#b9b9c8]'
                  }`}
                >
                  {b}k
                </button>
              )
            })}
          </div>
        </div>
      </>
    )
  }

  // Image
  return (
    <>
      <div>
        <Label>Format</Label>
        <ChoiceSelect
          value={String(options.imageFormat ?? 'keep')}
          choices={IMAGE_FORMATS}
          onChange={(v) => set('imageFormat', v)}
        />
      </div>
      <QualitySlider options={options} set={set} />
    </>
  )
}

/**
 * Image Upscale (Real-ESRGAN). Deliberately a separate tool from Resize: this
 * reconstructs detail with a neural net rather than interpolating, so the only
 * choices that matter are how much bigger and which model. The output list is
 * the whole explanation the panel needs — no prose about GPUs or file formats.
 */
function UpscaleOptions({
  options,
  outputs,
  set
}: {
  options: JobOptions
  outputs?: VideoOutputRow[]
  set: (k: string, v: string | number) => void
}): JSX.Element {
  const factor = Number(options.upscaleFactor ?? 4)
  const comfy = useComfyModels()
  const { status: pid, refresh: refreshPid } = usePidStatus()

  // Two-level picker: Photo / Anime / "AI models" (NVIDIA-only). The AI-models
  // category holds a SECOND picker of every AI upscaler — the user's imported
  // ComfyUI ESRGAN models AND PiD (diffusion). Stored value is 'photo' | 'anime'
  // | 'pid' | 'comfy' (category placeholder) | 'comfy:<path>'.
  const rawModel = String(options.upscaleModel ?? 'photo')
  const hasNvidia = Boolean(comfy.status?.nvidia || pid?.nvidia)
  const comfyModels = comfy.status?.models ?? []
  const comfyChoices = comfyModels.map((m) => ({
    value: `comfy:${m.path}`,
    // Verified models read clean; only flag the unvetted ones, so the marker
    // isn't mistaken for a "selected" checkmark.
    label: `${m.name} · ${m.scale}×${m.badge === 'experimental' ? ' · experimental' : ''}`
  }))
  const isPid = rawModel === 'pid'
  const isComfyPath = rawModel.startsWith('comfy:')
  const inAi = isPid || isComfyPath || rawModel === 'comfy'
  const category = inAi ? 'comfy' : rawModel === 'anime' ? 'anime' : 'photo'
  const categoryChoices = [...UPSCALE_MODELS, ...(hasNvidia ? [UPSCALE_COMFY] : [])]
  // PiD is only offered when it's actually attainable: already installed, or its
  // weights are reusable from the user's ComfyUI (so setup is quick). Otherwise
  // it isn't listed — it shouldn't look available when it isn't.
  const showPid = hasNvidia && Boolean(pid?.installed || comfy.status?.pidReusable)
  // The AI-models sub-picker: imported ESRGAN models first, then PiD.
  const subChoices = [
    ...comfyChoices,
    ...(showPid ? [{ value: 'pid', label: 'PiD (diffusion) · 4×' }] : [])
  ]
  const subDefault = comfyChoices[0]?.value ?? (showPid ? 'pid' : 'comfy')
  const subValue = isPid ? 'pid' : isComfyPath ? rawModel : subDefault
  const pidNeedsInstall = isPid && pid != null && !pid.installed
  const vramMb = pid?.nvidia?.vramMb ?? null
  const lowVram = isPid && vramMb != null && vramMb < 12_000

  const pickCategory = (v: string): void => {
    // "AI models" jumps to the first available upscaler (an imported model, else
    // PiD); the sub-picker then swaps between them.
    if (v === 'comfy') set('upscaleModel', subDefault)
    else set('upscaleModel', v)
  }

  // Keep the stored value valid once both statuses have loaded: an AI choice with
  // no GPU falls back to Photo; a comfy:<path> that's gone, or PiD that isn't
  // showable, falls back to the first available AI model (or the empty category).
  useEffect(() => {
    if (pid == null || comfy.status == null) return
    if (inAi && !hasNvidia) set('upscaleModel', 'photo')
    else if (isComfyPath && !comfyChoices.some((c) => c.value === rawModel))
      set('upscaleModel', subDefault)
    else if (isPid && !showPid) set('upscaleModel', subDefault)
  }, [pid, comfy.status, hasNvidia, inAi, isComfyPath, isPid, showPid, rawModel, comfyChoices, subDefault, set])

  return (
    <>
      <div>
        <Label>Scale</Label>
        <div className="grid grid-cols-3 gap-2">
          {UPSCALE_FACTORS.map((f) => {
            const sel = factor === f
            return (
              <button
                key={f}
                onClick={() => set('upscaleFactor', f)}
                className={`rounded-xl border py-2.5 text-[13px] font-semibold transition ${
                  sel
                    ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_rgba(0,0,0,.06)]'
                    : 'border-black/[.10] bg-white text-[#33333a] hover:border-[#b9b9c8]'
                }`}
              >
                {f}×
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <Label>Model</Label>
        <ChoiceSelect value={category} choices={categoryChoices} onChange={pickCategory} />
        {category === 'comfy' && (
          <>
            {/* Second picker: which AI upscaler (imported ESRGAN models + PiD). */}
            {subChoices.length > 0 && (
              <div className="mt-2.5">
                <ChoiceSelect
                  value={subValue}
                  choices={subChoices}
                  onChange={(v) => set('upscaleModel', v)}
                />
              </div>
            )}
            {pidNeedsInstall && (
              <div className="mt-3">
                <PidInstallCard onInstalled={refreshPid} />
              </div>
            )}
            {comfy.status && (
              <div className="mt-3">
                <ComfyImportCard status={comfy.status} refresh={comfy.refresh} />
              </div>
            )}
          </>
        )}
      </div>
      {/* GPU usage: the tiled engines (Real-ESRGAN / ComfyUI) can leave headroom;
          PiD's diffusion runs in one pass, so it's shown but explained there. */}
      <div>
        <Label>GPU usage</Label>
        {isPid ? (
          <>
            <p className="text-[12px] text-dim">
              PiD runs at full GPU — its diffusion can&apos;t be paced. Use a ComfyUI, Photo, or
              Anime model for a Background option.
            </p>
            {lowVram && (
              <p className="mt-1.5 text-[11px] text-dim">
                Your GPU reports ~{Math.round((vramMb as number) / 1024)} GB — PiD will
                auto-reduce resolution on large images to fit.
              </p>
            )}
          </>
        ) : (
          <>
            <Segmented
              value={String(options.gpuMode ?? 'full')}
              onChange={(v) => set('gpuMode', v)}
              options={UPSCALE_GPU_MODES.map((o) => ({ value: o.value, label: o.label }))}
            />
            {String(options.gpuMode ?? 'full') === 'background' && (
              <p className="mt-1.5 text-[11px] text-dim">
                Slower, but caps VRAM and paces the work so the GPU stays free for other apps.
              </p>
            )}
          </>
        )}
      </div>
      {outputs && outputs.length > 0 && (
        <div>
          <Label>Output</Label>
          <div className="scroll-thin max-h-32 space-y-1 overflow-auto rounded-xl border border-black/[.08] bg-white p-2.5">
            {outputs.map((r) => (
              <div key={r.path} className="flex items-center gap-1.5 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-dim" title={r.name}>
                  {r.name}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted">
                  {r.from}
                  {r.to !== r.from && <span className="text-accent"> → {r.to}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function ResizeOptions({
  options,
  outputs,
  set
}: {
  options: JobOptions
  outputs?: VideoOutputRow[]
  set: (k: string, v: string | number) => void
}): JSX.Element {
  const mode = String(options.mode ?? 'percent')
  const fit = (options.fit === 'stretch' ? 'stretch' : 'contain') as ResizeFit
  return (
    <>
      <div>
        <Label>Mode</Label>
        <Segmented
          value={mode}
          onChange={(v) => set('mode', v)}
          options={[
            { value: 'percent', label: 'Percent' },
            { value: 'dimensions', label: 'Dimensions' }
          ]}
        />
      </div>
      {mode === 'percent' ? (
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">
              Scale
            </span>
            <span className="text-sm font-semibold text-accent">
              {Number(options.percent ?? 50)}%
            </span>
          </div>
          <input
            type="range"
            min={5}
            max={200}
            value={Number(options.percent ?? 50)}
            onChange={(e) => set('percent', Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Width</Label>
            <input
              type="number"
              placeholder="auto"
              value={options.width != null ? String(options.width) : ''}
              onChange={(e) => set('width', e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full rounded-xl border border-black/[.10] bg-white px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <Label>Height</Label>
            <input
              type="number"
              placeholder="auto"
              value={options.height != null ? String(options.height) : ''}
              onChange={(e) => set('height', e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full rounded-xl border border-black/[.10] bg-white px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
      )}
      {mode === 'dimensions' && (
        <div>
          <Label>Fit</Label>
          <Segmented
            value={fit}
            onChange={(v) => set('fit', v)}
            options={RESIZE_FITS.map((f) => ({ value: f.value, label: f.label }))}
          />
        </div>
      )}
      {/* The resulting size, per file. Without it, "Keep aspect" silently
          discards whichever of width/height isn't the limiting one, and the
          resize looks broken when a changed number does nothing. */}
      {outputs && outputs.length > 0 && (
        <div>
          <Label>Output</Label>
          <div className="scroll-thin max-h-32 space-y-1 overflow-auto rounded-xl border border-black/[.08] bg-white p-2.5">
            {outputs.map((r) => (
              <div key={r.path} className="flex items-center gap-1.5 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-dim" title={r.name}>
                  {r.name}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted">
                  {r.from}
                  {r.to !== r.from && <span className="text-accent"> → {r.to}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Remove Background (rembg): one dropdown and three toggles.
 *
 * There is no model picker. The engine supports four licence-vetted models, but
 * birefnet-general beats the others by a wide margin (IoU 0.87 vs 0.82 isnet and
 * 0.39 u2net on the one independent benchmark), so offering the weaker ones is
 * offering a worse cutout. Same reasoning for the alpha-matting trimap
 * thresholds: tuning knobs, not decisions, left at rembg's defaults.
 */
function RemoveBgOptions({
  options,
  set
}: {
  options: JobOptions
  set: (k: string, v: string | number | boolean) => void
}): JSX.Element {
  const fill = String(options.bgFill ?? BG_DEFAULTS.bgFill) as BgFill
  const bgImage = String(options.bgImagePath ?? '')
  return (
    <div>
      <Label>Background</Label>
      <ChoiceSelect value={fill} choices={BG_FILLS} onChange={(v) => set('bgFill', v)} />
      {fill === 'custom' && (
        <input
          type="color"
          value={String(options.bgCustomColor ?? BG_DEFAULTS.bgCustomColor)}
          onChange={(e) => set('bgCustomColor', e.target.value)}
          className="mt-2 h-9 w-full cursor-pointer rounded-xl border border-black/[.10] bg-white p-1"
        />
      )}
      {fill === 'image' && (
        <button
          onClick={() =>
            void window.filesmith.pickImage().then((p) => {
              if (p) set('bgImagePath', p)
            })
          }
          className="mt-2 flex w-full items-center gap-2 rounded-xl border border-black/[.10] bg-white px-3 py-2.5 text-left text-[12.5px] font-semibold transition hover:border-[#b9b9c8]"
        >
          <Icon name="upload" className="h-4 w-4 shrink-0 text-accent" />
          <span className={`min-w-0 flex-1 truncate ${bgImage ? 'text-ink' : 'text-dim'}`}>
            {bgImage ? bgImage.split(/[\\/]/).pop() : 'Choose image…'}
          </span>
        </button>
      )}
    </div>
  )
}

// Every PDF operation. The explanation lives in the hover tooltip, not on the
// panel: "Burst" and "Extract imgs" need a gloss, but not one taking up space
// permanently for the users who already know what they mean.
const PDF_OPS: { value: string; label: string; title: string }[] = [
  { value: 'extract-text', label: 'Text', title: 'Extract the text layer to a .txt file' },
  { value: 'pages-to-images', label: 'Pages → PNG', title: 'Render each page to a PNG' },
  { value: 'merge', label: 'Merge', title: 'Combine the selected PDFs, in queue order, into one' },
  { value: 'split-range', label: 'Split', title: 'Keep only the pages you list' },
  { value: 'split-pages', label: 'Burst', title: 'Save every page as its own PDF' },
  { value: 'extract-images', label: 'Extract imgs', title: 'Pull out every embedded image' }
]

function PdfOptions({
  options,
  runCount,
  set
}: {
  options: JobOptions
  runCount: number
  set: (k: string, v: string | number) => void
}): JSX.Element {
  const op = String(options.op ?? 'extract-text')
  return (
    <>
      <div>
        <Label>Operation</Label>
        <div className="grid grid-cols-2 gap-2">
          {PDF_OPS.map((o) => {
            const sel = op === o.value
            return (
              <button
                key={o.value}
                title={o.title}
                onClick={() => set('op', o.value)}
                className={`rounded-xl border py-2.5 text-[12.5px] font-semibold transition ${
                  sel
                    ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_rgba(0,0,0,.06)]'
                    : 'border-black/[.10] bg-white text-[#33333a] hover:border-[#b9b9c8]'
                }`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>
      {op === 'pages-to-images' && (
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">
              Resolution
            </span>
            <span className="text-sm font-semibold text-accent">{Number(options.dpi ?? 150)} DPI</span>
          </div>
          <input
            type="range"
            min={72}
            max={400}
            step={2}
            value={Number(options.dpi ?? 150)}
            onChange={(e) => set('dpi', Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>
      )}
      {op === 'split-range' && (
        <div>
          <Label>Pages to keep</Label>
          <input
            type="text"
            placeholder="e.g. 1-3,5,8-10"
            value={String(options.range ?? '')}
            onChange={(e) => set('range', e.target.value)}
            className="w-full rounded-xl border border-black/[.10] bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      )}
      {/* Merge is the one op whose requirement isn't visible in the UI (it needs
          2+ files), so it keeps a line. Every other op's name says enough. */}
      {op === 'merge' && runCount < 2 && (
        <p className="text-[12.5px] text-muted">Select 2 or more PDFs.</p>
      )}
    </>
  )
}

export function OptionsPanel({
  operation,
  operations,
  onPickOperation,
  options,
  activeKind,
  runKind,
  fallbackKind,
  videoOutputs,
  upscaleOutputs,
  resizeOutputs,
  sourceExt,
  srcExts,
  runCount,
  onSet,
  onRun
}: {
  /** The operation this workspace performs, plus its siblings for the switcher. */
  operation: Operation
  operations: Operation[]
  onPickOperation: (id: string) => void
  options: JobOptions
  activeKind: FileKind | null
  runKind: FileKind | null
  /** The kind to show options for when nothing is selected: the category's own. */
  fallbackKind: FileKind
  videoOutputs?: VideoOutputRow[]
  upscaleOutputs?: VideoOutputRow[]
  resizeOutputs?: VideoOutputRow[]
  sourceExt: string | null
  srcExts: string[]
  runCount: number
  onSet: (k: string, v: string | number | boolean) => void
  onRun: () => void
}): JSX.Element {
  return (
    // Every option control (slider, toggle, run button, selected chip) reads the
    // accent variables, so overriding them here themes the whole panel black in
    // one place, without touching the rail or the coloured switcher above.
    <aside
      className="scroll-thin flex w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-black/[.06] bg-white/40 px-[22px] py-6"
      style={
        {
          '--color-accent': '#000000',
          '--color-accent-hi': '#242424',
          '--color-accent-soft': '#efeff1'
        } as CSSProperties
      }
    >
      {/* The one coloured control: the primary choice. No "Options" header below
          it: the option groups (Target format, Quality) are their own headers. */}
      <OperationSwitcher operation={operation} operations={operations} onPick={onPickOperation} />
      <div className="-my-1 h-px bg-black/[.07]" />

      {/* The options are always shown: every file in this category takes the
          same operation, so its options are known before anything is selected.
          Falls back to the category's kind when there's no selection to read
          one from. Only the run button reflects whether files are ready. */}
      <>
        {operation.tool === 'convert' && (
          <ConvertOptions
            options={options}
            activeKind={activeKind ?? fallbackKind}
            sourceExt={sourceExt}
            srcExts={srcExts}
            set={onSet}
          />
        )}
        {operation.tool === 'compress' && (
          <CompressOptions
            options={options}
            activeKind={runKind ?? fallbackKind}
            videoOutputs={videoOutputs}
            set={onSet}
          />
        )}
        {operation.tool === 'resize' && (
          <ResizeOptions options={options} outputs={resizeOutputs} set={onSet} />
        )}
        {operation.tool === 'upscale' && (
          <UpscaleOptions options={options} outputs={upscaleOutputs} set={onSet} />
        )}
        {operation.tool === 'removebg' && <RemoveBgOptions options={options} set={onSet} />}
        {operation.tool === 'pdf' && <PdfOptions options={options} runCount={runCount} set={onSet} />}
      </>
      <div className="flex-1" />

      <button
        onClick={onRun}
        disabled={runCount === 0}
        className="mt-auto rounded-[13px] bg-accent py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(0,0,0,.20)] transition hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
      >
        {operation.label}
        {runCount > 0 ? ` ${runCount} file${runCount === 1 ? '' : 's'}` : ''}
      </button>
    </aside>
  )
}
