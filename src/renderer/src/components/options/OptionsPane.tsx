import type { JSX } from 'react'
import type { FileKind, JobOptions, ToolId } from '@shared/types'
import type { TabId } from '@shared/tabs'
import { EstimateCard } from '../ui/EstimateCard'
import type { SizeRow } from '../ui/OutputSizeList'
import { ArchiveSettings } from './ArchiveSettings'
import { CompressSettings } from './CompressSettings'
import { ConvertSettings } from './ConvertSettings'
import { GenerateSettings } from './generate/GenerateSettings'
import { OutputSettings } from './OutputSettings'
import { useArchiveStatus } from './hooks/useArchiveStatus'
import { PdfSettings } from './PdfSettings'
import { RemoveBgSettings } from './RemoveBgSettings'
import { ResizeSettings } from './ResizeSettings'
import type { SetOption } from './types'
import { UpscaleSettings } from './UpscaleSettings'

/** EXACTLY ONE settings body per workspace, chosen in one place: a list of
 * `tool === x &&` lines once lost a guard and rendered two panels at once. */
export function OptionsPane({
  tab,
  tool,
  options,
  kind,
  srcExts,
  sourceExt,
  sampleName,
  runCount,
  videoOutputs,
  resizeOutputs,
  upscaleOutputs,
  estimate,
  set
}: {
  tab: TabId
  tool: ToolId
  options: JobOptions
  kind: FileKind
  srcExts: string[]
  sourceExt: string | null
  /** The first file in scope, for the Rename example. */
  sampleName: string | null
  runCount: number
  videoOutputs: SizeRow[]
  resizeOutputs: SizeRow[]
  upscaleOutputs: SizeRow[]
  estimate: { from: number; to: number; files: number } | null
  set: SetOption
}): JSX.Element {
  // One status call for the whole pane (it used to be made twice).
  const { rar } = useArchiveStatus()
  function body(): JSX.Element | null {
    // Convert owns its target choice for every route, including archive ones.
    if (tab === 'convert')
      return (
        <ConvertSettings
          options={options}
          kind={kind}
          sourceExt={sourceExt}
          srcExts={srcExts}
          verb={tool === 'archive' ? String(options.op ?? '') : undefined}
          hasRar={rar}
          set={set}
        />
      )
    switch (tool) {
      case 'compress':
        return (
          <CompressSettings options={options} kind={kind} videoOutputs={videoOutputs} set={set} />
        )
      case 'resize':
        return <ResizeSettings options={options} outputs={resizeOutputs} set={set} />
      case 'upscale':
        return <UpscaleSettings options={options} outputs={upscaleOutputs} set={set} />
      case 'removebg':
        return <RemoveBgSettings options={options} set={set} />
      case 'pdf':
        return <PdfSettings options={options} runCount={runCount} set={set} />
      case 'archive':
        return <ArchiveSettings options={options} srcExts={srcExts} hasRar={rar} set={set} />
      case 'generate':
        return <GenerateSettings options={options} set={set} />
      default:
        return null
    }
  }
  // Output options (Location, Replace, Rename, Metadata) for the one-in,
  // one-file-out verbs. Archive routes on Convert keep their own outputs.
  const fileOut =
    (tab === 'convert' && tool !== 'archive') ||
    tool === 'compress' ||
    tool === 'resize' ||
    tool === 'upscale' ||
    tool === 'removebg'
  const canStrip =
    (kind === 'image' || kind === 'video') &&
    (tool === 'convert' || tool === 'compress' || tool === 'resize')
  const stem = (sampleName ?? 'photo.png').replace(/\.[^.]+$/, '')
  const outExt = exampleExt(tool, kind, options, sourceExt ?? '.png')
  return (
    <div className="vs">
      {body()}
      {fileOut && (
        <OutputSettings
          options={options}
          set={set}
          canStrip={canStrip}
          example={{ name: stem, ext: outExt }}
        />
      )}
      {estimate && <EstimateCard from={estimate.from} to={estimate.to} files={estimate.files} />}
    </div>
  )
}

/** The extension a run would most likely produce, for the Rename example only. */
function exampleExt(tool: ToolId, kind: FileKind, o: JobOptions, src: string): string {
  if (tool === 'convert') return String(o.format ?? src)
  if (tool === 'upscale' || tool === 'removebg') return '.png'
  if (tool === 'compress') {
    if (kind === 'video') return '.mp4'
    if (kind === 'image' && o.imageFormat && o.imageFormat !== 'keep') return `.${o.imageFormat}`
  }
  return src
}
