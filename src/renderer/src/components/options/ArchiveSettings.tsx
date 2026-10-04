import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { ARCHIVE_FORMATS, COMIC_FORMATS, needsRar } from '@shared/archive'
import { ChipGrid } from '../ui/ChipGrid'
import { Segmented } from '../ui/Segmented'
import { Setting, SettingGroup } from '../ui/Setting'
import { PageRenderSettings } from './PageRenderSettings'
import type { SetOption } from './types'

/** Archive Tools cards (only reachable when such a card exists). from-pdf reuses
 * PageRenderSettings, which fixes the old bug where this panel wrote `quality`
 * while the engine reads `pageQuality`. */
export function ArchiveSettings({
  options,
  srcExts,
  hasRar,
  set
}: {
  options: JobOptions
  srcExts: string[]
  hasRar: boolean
  set: SetOption
}): JSX.Element {
  const op = String(options.op ?? 'repack')
  const targets = (list: typeof ARCHIVE_FORMATS): JSX.Element => (
    <Setting title="Format">
      <ChipGrid
        label="Format"
        value={String(options.format ?? '.cbz')}
        chips={list.map((f) => {
          // .zip and .cbz are the same container but not the same file: compare by extension.
          const isSource = srcExts.includes(f.ext)
          const noRar = needsRar(f.ext) && !hasRar
          return {
            value: f.ext,
            label: f.label.toLowerCase(),
            disabled: isSource || noRar,
            title: noRar
              ? 'WinRAR not found'
              : isSource
                ? 'Files are already this format'
                : undefined
          }
        })}
        onChange={(v) => set('format', v)}
      />
    </Setting>
  )
  if (op === 'extract')
    return (
      <SettingGroup title="OUTPUT">
        <Setting title="Extract" desc="Each archive is unpacked into its own folder next to it." />
      </SettingGroup>
    )
  if (op === 'to-pdf')
    return (
      <SettingGroup title="OUTPUT">
        <Setting
          title="To PDF"
          desc="Pages are ordered by filename, the way a reader shows them."
        />
      </SettingGroup>
    )
  if (op === 'from-pdf')
    return (
      <>
        <SettingGroup title="FORMAT">{targets(COMIC_FORMATS)}</SettingGroup>
        <PageRenderSettings options={options} set={set} />
      </>
    )
  return (
    <SettingGroup title="FORMAT">
      {targets(ARCHIVE_FORMATS)}
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
    </SettingGroup>
  )
}
