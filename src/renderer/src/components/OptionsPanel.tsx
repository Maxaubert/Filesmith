import type { JSX } from 'react'
import type { FileKind, JobOptions, ToolId } from '@shared/types'
import { familyFormats, isSameFormat } from '@shared/convert'
import { toolMeta } from '../lib/tools'

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

function CompressOptions({
  options,
  set
}: {
  options: JobOptions
  set: (k: string, v: string | number) => void
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

function PdfOptions({
  options,
  set
}: {
  options: JobOptions
  set: (k: string, v: string | number) => void
}): JSX.Element {
  const op = String(options.op ?? 'extract-text')
  return (
    <>
      <div>
        <Label>Operation</Label>
        <Segmented
          value={op}
          onChange={(v) => set('op', v)}
          options={[
            { value: 'extract-text', label: 'Text' },
            { value: 'pages-to-images', label: 'Images' },
            { value: 'compress', label: 'Compress' }
          ]}
        />
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
      <p className="text-[12.5px] leading-relaxed text-muted">
        {op === 'extract-text' && 'Save the PDF’s text layer as a .txt file next to it.'}
        {op === 'pages-to-images' && 'Render every page to a PNG in a new folder.'}
        {op === 'compress' && 'Rewrite the PDF smaller (garbage-collect + compress streams).'}
      </p>
    </>
  )
}

export function OptionsPanel({
  tool,
  options,
  activeKind,
  sourceExt,
  srcExts,
  runCount,
  onSet,
  onRun
}: {
  tool: ToolId
  options: JobOptions
  activeKind: FileKind | null
  sourceExt: string | null
  srcExts: string[]
  runCount: number
  onSet: (k: string, v: string | number) => void
  onRun: () => void
}): JSX.Element {
  const meta = toolMeta(tool)
  return (
    <aside className="flex w-[300px] shrink-0 flex-col gap-5 border-l border-black/[.06] bg-white/40 px-[22px] py-6">
      <div>
        <h3 className="text-base font-bold">{meta.label} options</h3>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {runCount > 0
            ? `Applies to ${runCount} file${runCount === 1 ? '' : 's'}.`
            : 'Select files to begin.'}
        </p>
      </div>

      {tool === 'convert' && (
        <ConvertOptions
          options={options}
          activeKind={activeKind}
          sourceExt={sourceExt}
          srcExts={srcExts}
          set={onSet}
        />
      )}
      {tool === 'compress' && <CompressOptions options={options} set={onSet} />}
      {tool === 'resize' && <ResizeOptions options={options} set={onSet} />}
      {tool === 'pdf' && <PdfOptions options={options} set={onSet} />}

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
