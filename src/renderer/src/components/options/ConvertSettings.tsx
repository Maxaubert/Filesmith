import type { JSX } from 'react'
import type { FileKind, JobOptions } from '@shared/types'
import { familyFormats, isSameFormat, sharedTargets } from '@shared/convert'
import { needsRar } from '@shared/archive'
import { Select } from '../ui/Select'
import type { SelectOption } from '../ui/selectNav'
import { Segmented } from '../ui/Segmented'
import { Setting, SettingGroup } from '../ui/Setting'
import { OutputSettings } from './OutputSettings'
import { PageRenderSettings } from './PageRenderSettings'
import type { SetOption } from './types'

export function ConvertSettings({
  options,
  kind,
  sourceExt,
  srcExts,
  verb,
  hasRar,
  set
}: {
  options: JobOptions
  kind: FileKind
  sourceExt: string | null
  srcExts: string[]
  /** The archive verb this target resolves to, if any: repack / to-pdf / from-pdf. */
  verb?: string
  hasRar: boolean
  set: SetOption
}): JSX.Element {
  // Targets valid for EVERY selected source, so a mixed pdf+docx selection never
  // offers CBZ (which only the pdf could do).
  const formats = srcExts.length
    ? sharedTargets(kind, srcExts)
    : familyFormats(kind, sourceExt ?? '')
  const choices: SelectOption<string>[] = formats.map((f) => {
    // Grey out (and block) any format a selected source already is: with a
    // PNG + JPEG selection, neither PNG nor JPEG is a valid target.
    const isSource = srcExts.some((e) => isSameFormat(f.ext, e))
    const noRar = needsRar(f.ext) && !hasRar
    return {
      value: f.ext,
      label: f.label.toLowerCase(),
      disabled: isSource || noRar,
      reason: noRar ? 'WinRAR not found' : isSource ? 'already this format' : undefined
    }
  })
  return (
    <>
      <SettingGroup title="FORMAT">
        <Setting title="Format" desc="The format the selected files are converted to.">
          <Select
            label="Format"
            value={String(options.format ?? '')}
            options={choices}
            onChange={(v) => set('format', v)}
          />
        </Setting>
        {kind === 'image' && (
          <Setting title="Quality" desc="Smaller files, or closer to the original.">
            <Segmented
              label="Quality"
              value={String(options.quality ?? 'balanced')}
              options={[
                { value: 'smaller', label: 'smaller' },
                { value: 'balanced', label: 'balanced' },
                { value: 'best', label: 'best' }
              ]}
              onChange={(v) => set('quality', v)}
            />
          </Setting>
        )}
        {verb === 'repack' && (
          <Setting
            title="Compression"
            desc="Comic pages are already compressed images, so store is faster at the same size."
          >
            <Segmented
              label="Compression"
              value={options.store === false ? 'normal' : 'store'}
              options={[
                { value: 'store', label: 'store' },
                { value: 'normal', label: 'normal' }
              ]}
              onChange={(v) => set('store', v === 'store')}
            />
          </Setting>
        )}
      </SettingGroup>
      {verb === 'from-pdf' && <PageRenderSettings options={options} set={set} />}
      {!verb && <OutputSettings options={options} set={set} />}
    </>
  )
}
