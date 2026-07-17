import type { JSX } from 'react'
import type { FileKind, JobOptions, ToolId } from '@shared/types'
import { familyFormats, isSameFormat } from '@shared/convert'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  IMAGE_FORMATS,
  PDF_LEVELS,
  VIDEO_CODECS,
  VIDEO_RESOLUTIONS,
  type Choice
} from '@shared/compress'
import { toolMeta } from '../lib/tools'

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
                    ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_rgba(91,91,214,.10)]'
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

/** A grid of option cards (label + sub-label), like the convert format grid. */
function ChoiceGrid<T extends string>({
  value,
  choices,
  cols = 2,
  onChange
}: {
  value: T
  choices: Choice<T>[]
  cols?: 2 | 3
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {choices.map((c) => {
        const sel = value === c.value
        return (
          <button
            key={c.value}
            onClick={() => onChange(c.value)}
            className={`rounded-xl border py-2 text-[12.5px] font-semibold leading-tight transition ${
              sel
                ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_rgba(91,91,214,.10)]'
                : 'border-black/[.10] bg-white text-[#33333a] hover:border-[#b9b9c8]'
            }`}
          >
            {c.label}
            {c.sub && (
              <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide opacity-60">
                {c.sub}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** A styled single-select dropdown (label + optional sub description). */
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
            {c.sub ? ` (${c.sub})` : ''}
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
        <p className="text-[12.5px] leading-relaxed text-muted">
          Lossless keeps images untouched; the other levels downsample embedded images
          (~300/150/72 dpi).
        </p>
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
          <Label>Resolution</Label>
          <ChoiceGrid
            value={String(options.resolution ?? 'original')}
            choices={VIDEO_RESOLUTIONS}
            cols={3}
            onChange={(v) => set('resolution', v)}
          />
        </div>
        {String(options.resolution ?? 'original') !== 'original' &&
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
                      ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_rgba(91,91,214,.10)]'
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

function ResizeOptions({
  options,
  set
}: {
  options: JobOptions
  set: (k: string, v: string | number) => void
}): JSX.Element {
  const mode = String(options.mode ?? 'percent')
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
    </>
  )
}

// Every PDF operation, with a short grid label + tooltip + descriptive hint.
const PDF_OPS: { value: string; label: string; title: string; hint: string }[] = [
  {
    value: 'extract-text',
    label: 'Text',
    title: 'Extract the text layer',
    hint: 'Save the PDF’s text layer as a .txt file next to it.'
  },
  {
    value: 'pages-to-images',
    label: 'Pages → PNG',
    title: 'Render each page to a PNG image',
    hint: 'Render every page to a PNG in a new folder.'
  },
  {
    value: 'compress',
    label: 'Compress',
    title: 'Shrink the PDF',
    hint: 'Rewrite the PDF smaller (garbage-collect + compress streams). Lossless.'
  },
  {
    value: 'merge',
    label: 'Merge',
    title: 'Combine the selected PDFs into one',
    hint: 'Combine the selected PDFs, in queue order, into one new PDF.'
  },
  {
    value: 'split-range',
    label: 'Split',
    title: 'Keep only certain pages',
    hint: 'Keep only the pages you list, in a new PDF.'
  },
  {
    value: 'split-pages',
    label: 'Burst',
    title: 'Save every page as its own PDF',
    hint: 'Save every page as its own PDF in a new folder.'
  },
  {
    value: 'extract-images',
    label: 'Extract imgs',
    title: 'Pull embedded images out of the PDF',
    hint: 'Pull every embedded image into a new folder.'
  }
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
  const current = PDF_OPS.find((o) => o.value === op)
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
                    ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_rgba(91,91,214,.10)]'
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
      {op === 'merge' ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          {runCount >= 2
            ? `${runCount} PDFs will be merged, in queue order, into one new PDF.`
            : 'Select 2 or more PDFs (in the queue) to merge them.'}
        </p>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-muted">{current?.hint}</p>
      )}
    </>
  )
}

export function OptionsPanel({
  tool,
  options,
  activeKind,
  runKind,
  videoOutputs,
  sourceExt,
  srcExts,
  runCount,
  onSet,
  onRun
}: {
  tool: ToolId
  options: JobOptions
  activeKind: FileKind | null
  runKind: FileKind | null
  videoOutputs?: VideoOutputRow[]
  sourceExt: string | null
  srcExts: string[]
  runCount: number
  onSet: (k: string, v: string | number | boolean) => void
  onRun: () => void
}): JSX.Element {
  const meta = toolMeta(tool)
  return (
    <aside className="scroll-thin flex w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-black/[.06] bg-white/40 px-[22px] py-6">
      <div>
        <h3 className="text-base font-bold">{meta.label} options</h3>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {runCount > 0
            ? `Applies to ${runCount} file${runCount === 1 ? '' : 's'}.`
            : 'Select files to begin.'}
        </p>
      </div>

      {activeKind === null ? (
        // Nothing selected: don't assume a kind or show bogus choices (e.g. a
        // format grid). Reveal the real options once a file is selected.
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          <span className="text-[13px] font-medium text-[#a2a2ac]">No files selected</span>
        </div>
      ) : (
        <>
          {tool === 'convert' && (
            <ConvertOptions
              options={options}
              activeKind={activeKind}
              sourceExt={sourceExt}
              srcExts={srcExts}
              set={onSet}
            />
          )}
          {tool === 'compress' && (
            <CompressOptions
              options={options}
              activeKind={runKind}
              videoOutputs={videoOutputs}
              set={onSet}
            />
          )}
          {tool === 'resize' && <ResizeOptions options={options} set={onSet} />}
          {tool === 'pdf' && <PdfOptions options={options} runCount={runCount} set={onSet} />}
        </>
      )}

      <button
        onClick={onRun}
        disabled={runCount === 0}
        className="mt-auto rounded-[13px] bg-accent py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(91,91,214,.32)] transition hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
      >
        {meta.verb}
        {runCount > 0 ? ` ${runCount} file${runCount === 1 ? '' : 's'}` : ''}
      </button>
      <div className="-mt-3 text-center text-[11.5px] text-dim">Saved next to each original</div>
    </aside>
  )
}
