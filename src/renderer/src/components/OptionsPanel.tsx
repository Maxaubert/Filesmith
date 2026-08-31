import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { FileKind, JobOptions } from '@shared/types'
import { familyFormats, isSameFormat, type FormatOption } from '@shared/convert'
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
  type Choice,
  type UpscaleModel
} from '@shared/compress'
import { ARCHIVE_FORMATS, COMIC_FORMATS, needsRar } from '@shared/archive'
import { RESIZE_FITS, type ResizeFit } from '@shared/resize'
import { BG_DEFAULTS, BG_FILLS, type BgFill } from '@shared/removebg'
import { GEN_SIZES, GEN_STYLES, GEN_MAX_COUNT, clampDim } from '@shared/generate'
import { archInfoFor, type GenArch, type GenModel } from '@shared/genArch'
import { Icon } from './Icon'
import type { ToolId } from '@shared/types'
import { GROUP_COLOR, groupNoun } from './queueGroups'
import { PidInstallCard } from './PidUpscale'
import { usePidStatus } from './usePidStatus'
import { ComfyImportCard } from './ComfyImport'
import { useComfyModels } from './useComfyModels'
import { useGenerateStatus } from './useGenerateStatus'
import { useArchiveStatus } from './useArchiveStatus'

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

/** A small "?" badge whose hover tooltip explains an option. */
function HelpTip({ text }: { text: string }): JSX.Element {
  return (
    <span
      title={text}
      className="grid h-[15px] w-[15px] cursor-help place-items-center rounded-full border border-black/25 text-[9px] font-bold leading-none text-dim"
    >
      ?
    </span>
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
            <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">
              Scale
            </span>
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
        {Number(options.scale ?? 100) < 100 && videoOutputs && videoOutputs.length > 0 && (
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
  // Which Real-ESRGAN models exist is read from disk, not frozen at build time.
  // This is the only AI upscaler an AMD/Intel user has, and it used to be locked
  // to the two names the build script happened to copy.
  const [ncnn, setNcnn] = useState<{ value: string; label: string; user: boolean }[] | null>(null)
  useEffect(() => {
    void window.filesmith.upscaleModels().then(setNcnn)
  }, [])
  const comfyModels = comfy.status?.models
  // Memoized: the validity effect below depends on this list and calls set()
  // from inside itself — with a freshly-mapped array every render it escaped
  // looping only by convergence.
  const comfyChoices = useMemo(
    () =>
      (comfyModels ?? []).map((m) => ({
        value: `comfy:${m.path}`,
        // Verified models read clean; only flag the unvetted ones, so the
        // marker isn't mistaken for a "selected" checkmark.
        label: `${m.name} · ${m.scale}×${m.badge === 'experimental' ? ' · experimental' : ''}`
      })),
    [comfyModels]
  )
  // Fall back to the legacy Photo/Anime aliases until the disk scan returns, so
  // the picker is never empty for a frame.
  const ncnnChoices: Choice<UpscaleModel>[] = ncnn?.length
    ? ncnn.map((m) => ({
        value: m.value as UpscaleModel,
        label: m.user ? `${m.label} · added by you` : m.label
      }))
    : UPSCALE_MODELS
  const isPid = rawModel === 'pid'
  const isComfyPath = rawModel.startsWith('comfy:')
  const inAi = isPid || isComfyPath || rawModel === 'comfy'
  const category = inAi
    ? 'comfy'
    : ncnnChoices.some((c) => c.value === rawModel)
      ? rawModel
      : (ncnnChoices[0]?.value ?? 'photo')
  const categoryChoices = [...ncnnChoices, ...(hasNvidia ? [UPSCALE_COMFY] : [])]
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
  }, [
    pid,
    comfy.status,
    hasNvidia,
    inAi,
    isComfyPath,
    isPid,
    showPid,
    rawModel,
    comfyChoices,
    subDefault,
    set
  ])

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
        {/* The drop-in models folder that upscale:models reads was reachable
            only by knowing the %APPDATA% path by heart. */}
        {!inAi && (
          <button
            onClick={() => void window.filesmith.upscaleOpenModelsFolder()}
            className="mt-2 text-[11.5px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Add your own model… (opens the models folder)
          </button>
        )}
        {/* Why the AI tier is missing, instead of silently hiding it: the
            verdict was computed in main and thrown away before any UI. */}
        {!hasNvidia && (pid?.cudaReason || comfy.status?.cudaReason) && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            {pid?.cudaReason ?? comfy.status?.cudaReason}
          </p>
        )}
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
            {/* The way OUT of a poisoned install: pidInstalled() is a bare
                existsSync, so a corrupt multi-GB weight was otherwise
                unrecoverable from the UI. Two-step to avoid an accidental
                6 GB re-download. */}
            {isPid && pid?.installed && <PidRemoveButton onRemoved={refreshPid} />}
            {comfy.status && (
              <div className="mt-3">
                <ComfyImportCard status={comfy.status} refresh={comfy.refresh} />
              </div>
            )}
          </>
        )}
      </div>
      {/* GPU usage. The option names carry their own meaning, so there is no
          explanatory line under them. PiD's diffusion runs in one pass and can't
          be paced, so it gets no control at all rather than a disabled one. */}
      {!isPid && (
        <div>
          <Label>GPU usage</Label>
          <Segmented
            value={String(options.gpuMode ?? 'full')}
            onChange={(v) => set('gpuMode', v)}
            options={UPSCALE_GPU_MODES.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
      )}
      {/* Not option help: a capability warning the user can't infer from the UI. */}
      {isPid && lowVram && (
        <p className="text-[11.5px] leading-relaxed text-dim">
          Your GPU reports ~{Math.round((vramMb as number) / 1024)} GB — PiD will auto-reduce
          resolution on large images to fit.
        </p>
      )}
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
              min={1}
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
              min={1}
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
  // Disclose up front that background removal is AI-powered and, on first use,
  // downloads a model — so a user who doesn't want AI can simply not use it,
  // and one who does knows what to expect instead of hitting a mid-run error.
  const [rembg, setRembg] = useState<{ ready: boolean; uvAvailable: boolean } | null>(null)
  useEffect(() => {
    void window.filesmith.removebgStatus().then(setRembg)
  }, [])
  return (
    <div>
      {rembg && !rembg.ready && (
        <div className="mb-3 rounded-xl border border-black/[.10] bg-white p-3 text-[12px] leading-relaxed text-muted">
          {rembg.uvAvailable ? (
            <>First run downloads the AI model once (a few hundred MB), then works offline.</>
          ) : (
            <>
              Needs the free <span className="font-semibold text-ink">uv</span> tool:{' '}
              <span className="font-mono text-ink">winget install astral-sh.uv</span>, then reopen
              Filesmith.
            </>
          )}
        </div>
      )}
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
            <span className="text-sm font-semibold text-accent">
              {Number(options.dpi ?? 150)} DPI
            </span>
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

/** Target-format chips shared by the two archive operations that write one.
 * A format is greyed rather than hidden when it needs WinRAR: a user looking
 * for CBR gets an answer on hover instead of a missing option. */
function ArchiveTargets({
  formats,
  value,
  srcExts,
  hasRar,
  set
}: {
  formats: FormatOption[]
  value: string
  srcExts: string[]
  hasRar: boolean
  set: (k: string, v: string | number | boolean) => void
}): JSX.Element {
  return (
    <div>
      <Label>Target format</Label>
      <div className="grid grid-cols-2 gap-2">
        {formats.map((f) => {
          // .zip and .cbz are the same container but not the same file, so the
          // comparison is by extension, not by container: repacking a .zip as
          // a .cbz is exactly what a comic reader needs.
          const isSource = srcExts.includes(f.ext)
          const noRar = needsRar(f.ext) && !hasRar
          const disabled = isSource || noRar
          const sel = value === f.ext && !disabled
          return (
            <button
              key={f.ext}
              disabled={disabled}
              title={
                noRar ? 'WinRAR not found' : isSource ? 'Files are already this format' : undefined
              }
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
  )
}

function ArchiveOptions({
  options,
  srcExts,
  set
}: {
  options: JobOptions
  srcExts: string[]
  set: (k: string, v: string | number | boolean) => void
}): JSX.Element {
  const op = String(options.op ?? 'repack')
  const { rar } = useArchiveStatus()
  const format = String(options.format ?? '.cbz')

  if (op === 'extract') {
    return (
      <p className="text-[12.5px] text-muted">
        Each archive is unpacked into its own folder next to it.
      </p>
    )
  }

  if (op === 'to-pdf') {
    return (
      <p className="text-[12.5px] text-muted">
        Pages are ordered by filename, the way a reader shows them.
      </p>
    )
  }

  if (op === 'from-pdf') {
    const pageFormat = String(options.pageFormat ?? 'jpg')
    return (
      <>
        <ArchiveTargets
          formats={COMIC_FORMATS}
          value={format}
          srcExts={[]}
          hasRar={rar}
          set={set}
        />
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">
              Resolution
            </span>
            <span className="text-sm font-semibold text-accent">
              {Number(options.dpi ?? 150)} DPI
            </span>
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
        <div>
          <Label>Page format</Label>
          <Segmented
            value={pageFormat}
            onChange={(v) => set('pageFormat', v)}
            options={[
              { value: 'jpg', label: 'JPEG' },
              { value: 'png', label: 'PNG' }
            ]}
          />
          <p className="mt-2 text-[12px] text-dim">
            {pageFormat === 'jpg'
              ? 'Much smaller files, the usual choice for comics.'
              : 'Lossless, but a long comic runs to hundreds of megabytes.'}
          </p>
        </div>
        {pageFormat === 'jpg' && <QualitySlider options={options} set={set} />}
      </>
    )
  }

  // repack
  return (
    <>
      <ArchiveTargets
        formats={ARCHIVE_FORMATS}
        value={format}
        srcExts={srcExts}
        hasRar={rar}
        set={set}
      />
      <div>
        <Label>Compression</Label>
        <Segmented
          value={options.store === false ? 'normal' : 'store'}
          onChange={(v) => set('store', v === 'store')}
          options={[
            { value: 'store', label: 'Store' },
            { value: 'normal', label: 'Normal' }
          ]}
        />
        <p className="mt-2 text-[12px] text-dim">
          Comic pages are already compressed images, so Store is faster at the same size.
        </p>
      </div>
    </>
  )
}

/** A checkpoint whose name marks it as restoration/refiner/inpaint — a valid
 * model but not text-to-image, so we never auto-select it as the default. */
function isRestoreName(name: string): boolean {
  return /supir|refiner|inpaint|upscal|controlnet/i.test(name)
}

/** Model dropdown grouped by architecture (Checkpoints / Flux / Z-Image / …).
 * Non-runnable models stay selectable and are annotated, so picking one reveals
 * the download card rather than being a dead, greyed-out row. */
function ModelPicker({
  models,
  value,
  onChange
}: {
  models: GenModel[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const groups: string[] = []
  for (const m of models) if (!groups.includes(m.group)) groups.push(m.group)
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer appearance-none rounded-xl border border-black/[.10] bg-white py-2.5 pl-3.5 pr-9 text-[13px] font-semibold text-ink outline-none transition hover:border-[#b9b9c8] focus:border-accent"
      >
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {models
              .filter((m) => m.group === g)
              .map((m) => (
                <option key={m.name} value={m.name}>
                  {m.label}
                  {m.runnable ? '' : ' — needs download'}
                </option>
              ))}
          </optgroup>
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

/** Shown when the selected model is missing its text-encoder / VAE files. Fetches
 * them into the user's ComfyUI folders, then refreshes so the model goes runnable
 * — the "works for anyone" path, not just a machine that already has the files. */
function CompanionDownload({
  model,
  onDone
}: {
  model: GenModel
  onDone: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const missing = model.missing ?? []

  const start = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    const id = `dl-${model.name}`
    const off = window.filesmith.onGenerateDownloadProgress((p) => {
      if (p.id !== id) return
      setMsg(`${p.label} (${p.index}/${p.total})`)
      setPct(p.pct)
    })
    try {
      const r = await window.filesmith.generateDownload(id, model.name)
      if (!r.ok) setErr(r.error ?? 'Download failed.')
      else onDone()
    } finally {
      off()
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-accent/40 bg-accent-soft/40 p-3 text-[12px] leading-relaxed">
      <p className="font-semibold text-ink">
        This model needs {missing.length} file{missing.length === 1 ? '' : 's'} you don&apos;t have
        yet:
      </p>
      <ul className="mt-1.5 space-y-0.5 text-muted">
        {missing.map((m) => (
          <li key={m.filename}>
            • {m.label} <span className="text-dim">({m.approxSize})</span>
          </li>
        ))}
      </ul>
      {busy ? (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px] text-dim">
            <span>{msg ?? 'Starting…'}</span>
            <span>{pct == null ? '' : `${pct}%`}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[.08]">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${pct ?? 8}%` }}
            />
          </div>
        </div>
      ) : (
        <button
          onClick={start}
          className="mt-2.5 w-full rounded-xl bg-accent px-3 py-2 text-[12.5px] font-semibold text-white transition hover:brightness-110"
        >
          Download required files
        </button>
      )}
      {err && <p className="mt-2 text-[11.5px] font-medium text-red-600">{err}</p>}
    </div>
  )
}

/**
 * "ComfyUI wasn't found" — with a way out. This used to be a dead end: static
 * text telling the user to "open ComfyUI once so Filesmith can locate it", which
 * nothing in the code implements (availability is a filesystem walk, not a probe
 * of a running server). Discovery is path guessing, so a ComfyUI on F:, on a NAS,
 * under C:\AI\comfy or in a OneDrive-redirected Documents was simply unreachable
 * and the notice never cleared. Locating it writes the same store that generate,
 * upscale and companion discovery all read first, so one pick fixes all three.
 */
function LocateComfy({ onLocated }: { onLocated: () => void }): JSX.Element {
  const [err, setErr] = useState<string | null>(null)
  const pick = (): void => {
    setErr(null)
    void window.filesmith.comfyPickFolder().then((folder) => {
      if (!folder) return
      void window.filesmith.comfySetFolder(folder).then((r) => {
        if (r.ok) onLocated()
        else setErr(r.error ?? "Couldn't use that folder")
      })
    })
  }
  return (
    <div className="space-y-2.5 rounded-xl border border-black/[.10] bg-white p-3">
      <p className="text-[12px] text-muted">ComfyUI wasn&apos;t found automatically.</p>
      <button
        onClick={pick}
        className="w-full rounded-xl bg-accent px-3 py-2 text-[12.5px] font-semibold text-white transition hover:brightness-110"
      >
        Locate my ComfyUI folder
      </button>
      {err && <p className="text-[11.5px] font-medium text-red-600">{err}</p>}
    </div>
  )
}

/**
 * "Add a model" — the escape hatch that means a new architecture never requires
 * an app release. Importing a ComfyUI "Export (API)" workflow is the highest-
 * leverage case: a user who can already generate a model inside ComfyUI can now
 * generate it here, with no knowledge of Filesmith's internals.
 */
function AddModel({
  onAdded,
  comfyFolder
}: {
  onAdded: () => void
  comfyFolder?: string | null
}): JSX.Element {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Changing the ComfyUI folder belongs here as much as in Upscale — both panels
  // read the same store. It used to be reachable from Generate ONLY through the
  // "not found" banner, so once a ComfyUI was located there was no way to point
  // at a different one without going to the Upscale tab.
  const pickComfy = (): void => {
    setMsg(null)
    void window.filesmith.comfyPickFolder().then((folder) => {
      if (!folder) return
      void window.filesmith.comfySetFolder(folder).then((r) => {
        if (r.ok) onAdded()
        else setMsg({ ok: false, text: r.error ?? "Couldn't use that folder" })
      })
    })
  }
  const importOne = (): void => {
    setMsg(null)
    void window.filesmith.registryImport().then((r) => {
      if (!r.ok) {
        if (r.error) setMsg({ ok: false, text: r.error })
        return
      }
      setMsg({
        ok: true,
        text: [`Added ${r.ids?.join(', ')}.`, ...(r.notes ?? [])].join(' ')
      })
      onAdded()
    })
  }
  return (
    <div className="mt-3 space-y-2 border-t border-black/[.07] pt-3">
      <div className="flex gap-2">
        <button
          onClick={importOne}
          className="flex-1 rounded-xl border border-black/[.12] bg-white px-3 py-2 text-[12.5px] font-semibold text-ink transition hover:border-[#b9b9c8]"
        >
          Add a model…
        </button>
        <button
          onClick={() => void window.filesmith.registryOpenFolder()}
          title="Open the folder where your own model entries live"
          className="rounded-xl border border-black/[.12] bg-white px-3 py-2 text-[12.5px] font-semibold text-ink transition hover:border-[#b9b9c8]"
        >
          Open folder
        </button>
      </div>
      <button
        onClick={pickComfy}
        title={comfyFolder ?? 'Choose your ComfyUI folder'}
        className="flex w-full items-center gap-2 rounded-xl border border-black/[.12] bg-white px-3 py-2 text-left text-[12.5px] transition hover:border-[#b9b9c8]"
      >
        <span className="shrink-0 font-semibold text-ink">ComfyUI</span>
        <span className="min-w-0 flex-1 truncate text-dim" dir="rtl">
          {comfyFolder ?? 'Choose folder…'}
        </span>
      </button>
      {msg && (
        <p
          className={`text-[11.5px] leading-relaxed ${msg.ok ? 'text-muted' : 'font-medium text-red-600'}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  )
}

/** Remove the PiD install (repair path). Two clicks: the first arms it. */
function PidRemoveButton({ onRemoved }: { onRemoved: () => void }): JSX.Element {
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = (): void => {
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    void window.filesmith.pidInstalling().then((busy) => {
      if (busy) {
        setError('An install is running. Wait for it to finish first.')
        return
      }
      void window.filesmith.pidRemove().then((r) => {
        if (!r.ok) setError(r.error ?? 'Could not remove the install.')
        else {
          setError(null)
          onRemoved()
        }
      })
    })
  }
  return (
    <div className="mt-2">
      <button
        onClick={remove}
        onBlur={() => setArmed(false)}
        className={`text-[11.5px] font-medium underline-offset-2 hover:underline ${
          armed ? 'text-[#e0483d]' : 'text-muted hover:text-ink'
        }`}
      >
        {armed ? 'Click again to remove the PiD install (~6 GB)' : 'Remove PiD install…'}
      </button>
      {error && <p className="mt-1 text-[11.5px] text-[#e0483d]">{error}</p>}
    </div>
  )
}

/** A dimension field that clamps on BLUR, not on every keystroke: clamping
 * while typing turned "832" into 256 the moment its first digit landed, which
 * made the field impossible to use at all. Steps by the model's own dimStep. */
function DimInput({
  value,
  caps,
  onCommit
}: {
  value: number
  caps?: { minDim?: number; maxDim?: number; dimStep?: number }
  onCommit: (v: number) => void
}): JSX.Element {
  const [text, setText] = useState(String(value))
  // Re-sync when the committed value changes from OUTSIDE (preset picked):
  // the render-time adjustment pattern, not an effect (no extra paint).
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(String(value))
  }
  const commit = (): void => {
    const n = Number(text)
    onCommit(clampDim(Number.isFinite(n) && n > 0 ? n : value, caps))
  }
  return (
    <input
      type="number"
      value={text}
      step={caps?.dimStep ?? 8}
      min={caps?.minDim ?? 256}
      max={caps?.maxDim ?? 4096}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      className="w-full rounded-xl border border-black/[.10] bg-white px-3 py-2 text-sm outline-none focus:border-accent"
    />
  )
}

/**
 * Text-to-image generation options. The prompt lives in the center PromptBox;
 * this panel carries the model + sampling settings and the availability notice.
 */
function GenerateOptions({
  options,
  set
}: {
  options: JobOptions
  set: (k: string, v: string | number) => void
}): JSX.Element {
  const { status, refresh } = useGenerateStatus()
  const model = String(options.model ?? '')
  const w = Number(options.width ?? 1024)
  const h = Number(options.height ?? 1024)
  const seed = Number(options.seed ?? -1)
  // An explicit mode: derived-from-dimensions alone made "Custom…" unreachable
  // (the defaults equal a preset, so the select snapped straight back and the
  // width/height inputs never mounted in any build).
  const isPreset = GEN_SIZES.some((s) => s.width === w && s.height === h)
  const sizeValue =
    String(options.sizeMode ?? '') === 'custom' || !isPreset ? 'custom' : `${w}x${h}`

  const models = useMemo(() => status?.models ?? [], [status])
  const selected = models.find((m) => m.name === model)
  // "Try anyway" is per-model and deliberately not sticky: it must be a
  // conscious choice each time, not a setting that quietly stays on.
  const tryAnyway = Boolean(options.tryAnyway)
  // Dimension limits come from the model's own registry entry. One global 2048
  // ceiling was a guess about SDXL applied to every architecture, silently
  // capping models whose native resolution is higher.
  const dimCaps = status?.dimCaps?.[selected?.arch ?? 'sdxl']
  const arch: GenArch = selected?.arch ?? 'sdxl'
  // Sampler defaults come from the REGISTRY when the main process supplied them,
  // so a user-added family gets its own defaults instead of a built-in's (cfg 7
  // on a distilled model produces garbage). The compiled table is the fallback.
  const info = archInfoFor(arch, status?.archInfo)

  // Default to a runnable text-to-image model once the list loads, and steer away
  // from a restoration checkpoint (SUPIR) or a vanished selection.
  useEffect(() => {
    if (!models.length) return
    if (!selected) {
      const good =
        models.find((m) => m.runnable && !isRestoreName(m.label)) ??
        models.find((m) => m.runnable) ??
        models[0]
      if (good && good.name !== model) set('model', good.name)
    }
  }, [model, models, selected, set])

  // When the architecture changes, reset the sampler knobs to that arch's sane
  // defaults (cfg MUST be 1 for Flux/Z-Image/Krea; steps differ per family).
  // Only AFTER the scan resolves, and only on a real change: the ref used to
  // start null with arch defaulting to 'sdxl' mid-scan, so every mount fired
  // the reset twice and the persisted Steps/CFG were never once honoured.
  const prevArch = useRef<GenArch | null>(null)
  useEffect(() => {
    if (!status) return
    if (prevArch.current === null) {
      prevArch.current = arch
      return
    }
    if (prevArch.current === arch) return
    prevArch.current = arch
    set('tryAnyway', 0)
    set('steps', info.steps)
    set('cfg', info.cfg)
    if (info.hasGuidance) set('guidance', info.guidance)
  }, [arch, info, set, status])

  return (
    <>
      {status && !status.available && <LocateComfy onLocated={refresh} />}
      <div>
        <Label>Model</Label>
        {models.length ? (
          <ModelPicker models={models} value={model} onChange={(v) => set('model', v)} />
        ) : (
          <p className="text-[12px] text-dim">
            No image models found in your ComfyUI models folder.
          </p>
        )}
        {selected && !selected.runnable && selected.missing?.length ? (
          <div className="mt-2.5">
            <CompanionDownload model={selected} onDone={refresh} />
          </div>
        ) : selected && !selected.runnable && selected.reason ? (
          <div className="mt-2 space-y-2">
            <p className="text-[11.5px] leading-relaxed text-muted">{selected.reason}</p>
            {/* An unrecognized model is not a forbidden one. Send it through a
                generic graph and let ComfyUI give its own verdict — the user
                learns something either way, which beats a dead end. */}
            {selected.tryAnyway && (
              <button
                onClick={() => set('tryAnyway', tryAnyway ? 0 : 1)}
                className={`w-full rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
                  tryAnyway
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-black/[.12] bg-white text-ink hover:border-[#b9b9c8]'
                }`}
              >
                {tryAnyway ? 'Will try anyway — click to cancel' : 'Try anyway'}
              </button>
            )}
          </div>
        ) : null}
        <AddModel onAdded={refresh} comfyFolder={status?.comfyFolder} />
      </div>
      {/* Negative prompt only affects arches that use real CFG (SDXL). Flux / Z-Image
          / Krea run at cfg 1, where the negative branch is inert — so hide it there
          rather than let it look like it does something. */}
      {info.cfg !== 1 && (
        <div>
          <Label>Negative prompt</Label>
          <input
            type="text"
            value={String(options.negative ?? '')}
            onChange={(e) => set('negative', e.target.value)}
            className="w-full rounded-xl border border-black/[.10] bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      )}
      <div>
        <Label>Style</Label>
        <div className="grid grid-cols-3 gap-2">
          {GEN_STYLES.map((s) => {
            const sel = String(options.style ?? 'none') === s.id
            return (
              <button
                key={s.id}
                onClick={() => set('style', s.id)}
                className={`rounded-xl border py-2 text-[12px] font-semibold transition ${
                  sel
                    ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_rgba(0,0,0,.06)]'
                    : 'border-black/[.10] bg-white text-[#33333a] hover:border-[#b9b9c8]'
                }`}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">Images</span>
          <span className="text-sm font-semibold text-accent">{Number(options.count ?? 1)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={GEN_MAX_COUNT}
          value={Number(options.count ?? 1)}
          onChange={(e) => set('count', Number(e.target.value))}
          className="w-full accent-accent"
        />
      </div>
      <div>
        <Label>Size</Label>
        <ChoiceSelect
          value={sizeValue}
          choices={[
            ...GEN_SIZES.map((s) => ({ value: `${s.width}x${s.height}`, label: s.label })),
            { value: 'custom', label: 'Custom…' }
          ]}
          onChange={(v) => {
            if (v === 'custom') {
              set('sizeMode', 'custom')
              return
            }
            set('sizeMode', 'preset')
            const [ww, hh] = v.split('x').map(Number)
            set('width', ww)
            set('height', hh)
          }}
        />
        {sizeValue === 'custom' && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <Label>Width</Label>
              <DimInput value={w} caps={dimCaps} onCommit={(v) => set('width', v)} />
            </div>
            <div>
              <Label>Height</Label>
              <DimInput value={h} caps={dimCaps} onCommit={(v) => set('height', v)} />
            </div>
          </div>
        )}
      </div>
      {/* Power-user knobs. The defaults are good for almost everything, so they
          live in a collapsed section with a one-line explanation on each. */}
      <details className="rounded-xl border border-black/[.08] bg-white/50 px-3.5 py-2.5">
        <summary className="cursor-pointer select-none text-[12.5px] font-semibold text-ink">
          Advanced
        </summary>
        <div className="mt-3 space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
                Steps
                <HelpTip text="How many refinement passes the model makes. More adds a little detail but is slower. Turbo models (Z-Image, Krea, Flux 2) need only a handful; SDXL and Flux 1 like ~20-30." />
              </span>
              <span className="text-sm font-semibold text-accent">
                {Number(options.steps ?? info.steps)}
              </span>
            </div>
            <input
              type="range"
              min={arch === 'sdxl' || arch === 'flux1' ? 8 : 1}
              max={50}
              value={Number(options.steps ?? info.steps)}
              onChange={(e) => set('steps', Number(e.target.value))}
              className="w-full accent-accent"
            />
          </div>
          {arch === 'sdxl' ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
                  Guidance (CFG)
                  <HelpTip text="How closely it follows your prompt. About 7 is balanced; lower is looser and more natural, higher sticks to the prompt but can look harsh." />
                </span>
                <span className="text-sm font-semibold text-accent">
                  {Number(options.cfg ?? 7)}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={15}
                step={0.5}
                value={Number(options.cfg ?? 7)}
                onChange={(e) => set('cfg', Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
          ) : info.hasGuidance ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
                  Guidance
                  <HelpTip text="Flux's prompt-adherence dial. Around 3.5 is the sweet spot for Flux 1; lower is more natural, higher follows the prompt harder." />
                </span>
                <span className="text-sm font-semibold text-accent">
                  {Number(options.guidance ?? info.guidance)}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={Number(options.guidance ?? info.guidance)}
                onChange={(e) => set('guidance', Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
          ) : null}
          <div>
            <div className="mb-2.5 flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                Seed
              </span>
              <HelpTip text="The random starting point. The same seed with the same settings makes the exact same image — leave it on Random for variety, or fix it to reproduce a result." />
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={seed}
                onChange={(e) => set('seed', e.target.value === '' ? -1 : Number(e.target.value))}
                className="w-full rounded-xl border border-black/[.10] bg-white px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                onClick={() => set('seed', -1)}
                className={`rounded-xl border px-3.5 py-2 text-[12.5px] font-semibold transition ${
                  seed < 0
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-black/[.12] bg-white text-ink hover:border-[#b9b9c8]'
                }`}
              >
                Random
              </button>
            </div>
          </div>
        </div>
      </details>
    </>
  )
}

/** What these settings will act on. The queue can hold images and video at the
 * same time, so Run has to say which of them it means. Named by CONVERT GROUP,
 * not file kind: a pdf plus a txt is "2 documents", because they run as one
 * batch under one target set. */
function ScopeChip({
  group,
  count,
  known
}: {
  group: string
  count: number
  known: boolean
}): JSX.Element {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-black/[.035] px-3 py-2.5">
      <span
        className="mt-px h-[18px] w-[18px] shrink-0 rounded-md"
        style={{ background: GROUP_COLOR[group] ?? '#6e6e73' }}
      />
      <span className="text-[12.5px] font-medium leading-snug text-muted">
        {known && count > 0 ? (
          <>
            Applies to the <span className="font-bold text-ink">{groupNoun(group, count)}</span>{' '}
            selected.
          </>
        ) : (
          <>Select files to choose what these settings apply to.</>
        )}
      </span>
    </div>
  )
}

export function OptionsPanel({
  tool,
  label,
  options,
  activeKind,
  activeGroup,
  optGroup,
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
  /** The engine tool this workspace runs. */
  tool: ToolId
  /** The verb's own name, used by the Run button. */
  label: string
  options: JobOptions
  activeKind: FileKind | null
  /** The selected convert group, or null with nothing selected. */
  activeGroup: string | null
  /** The group the options actually belong to (falls back when nothing is selected). */
  optGroup: string
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
    // Three regions: a fixed header (the switcher), a scrolling middle (the
    // option groups), and a PINNED footer holding the primary action - which
    // used to be an ordinary last child of one scroll container and left the
    // viewport entirely at the app's own default window size.
    <aside
      className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-black/[.06] bg-white/40"
      style={
        {
          '--color-accent': '#000000',
          '--color-accent-hi': '#242424',
          '--color-accent-soft': '#efeff1'
        } as CSSProperties
      }
    >
      {/* No operation switcher: the rail IS the operation now, so a coloured
          pill here would name the same thing twice. What the panel owes the user
          instead is WHICH files its settings apply to, because one tab's queue
          can hold several convert groups at once. */}
      <div className="px-[22px] pt-6">
        <ScopeChip group={optGroup} count={runCount} known={activeGroup != null} />
        <div className="mt-5 h-px bg-black/[.07]" />
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-[22px] py-5">
        {/* The options are always shown: every file in this category takes the
          same operation, so its options are known before anything is selected.
          Falls back to the category's kind when there's no selection to read
          one from. Only the run button reflects whether files are ready. */}
        <>
          {tool === 'convert' && (
            <ConvertOptions
              options={options}
              activeKind={activeKind ?? fallbackKind}
              sourceExt={sourceExt}
              srcExts={srcExts}
              set={onSet}
            />
          )}
          {tool === 'compress' && (
            <CompressOptions
              options={options}
              activeKind={runKind ?? fallbackKind}
              videoOutputs={videoOutputs}
              set={onSet}
            />
          )}
          {tool === 'resize' && (
            <ResizeOptions options={options} outputs={resizeOutputs} set={onSet} />
          )}
          {tool === 'upscale' && (
            <UpscaleOptions options={options} outputs={upscaleOutputs} set={onSet} />
          )}
          {tool === 'removebg' && <RemoveBgOptions options={options} set={onSet} />}
          {tool === 'pdf' && <PdfOptions options={options} runCount={runCount} set={onSet} />}
          {tool === 'archive' && <ArchiveOptions options={options} srcExts={srcExts} set={onSet} />}
          {tool === 'generate' && <GenerateOptions options={options} set={onSet} />}
        </>
      </div>

      <div className="border-t border-black/[.07] px-[22px] py-4">
        <button
          onClick={onRun}
          disabled={runCount === 0}
          className="w-full rounded-[13px] bg-accent py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(0,0,0,.20)] transition hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
        >
          {label}
          {/* Name the GROUP, not "files": in a mixed queue "Convert 2 files"
              hides which two. */}
          {tool !== 'generate' && runCount > 0 ? ` ${groupNoun(optGroup, runCount)}` : ''}
        </button>
      </div>
    </aside>
  )
}
