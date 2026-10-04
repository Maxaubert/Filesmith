import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { RangeField } from '../ui/RangeField'
import { Segmented } from '../ui/Segmented'
import { Setting, SettingGroup } from '../ui/Setting'
import type { SetOption } from './types'

/** Page rendering for every route that turns a PDF into images. Writes
 * `pageQuality`, never `quality`, so it cannot collide with convert's preset. */
export function PageRenderSettings({
  options,
  set
}: {
  options: JobOptions
  set: SetOption
}): JSX.Element {
  const pageFormat = String(options.pageFormat ?? 'jpg')
  return (
    <SettingGroup title="PAGES">
      <Setting title="Resolution" desc="Dots per inch when each page is rendered.">
        <RangeField
          label="Resolution"
          min={72}
          max={400}
          step={2}
          value={Number(options.dpi ?? 150)}
          onChange={(v) => set('dpi', v)}
          format={(v) => `${v} dpi`}
        />
      </Setting>
      <Setting
        title="Page format"
        desc={
          pageFormat === 'jpg'
            ? 'Much smaller files, the usual choice for comics.'
            : 'Lossless, but a long comic runs to hundreds of megabytes.'
        }
      >
        <Segmented
          label="Page format"
          value={pageFormat}
          options={[
            { value: 'jpg', label: 'jpg' },
            { value: 'png', label: 'png' }
          ]}
          onChange={(v) => set('pageFormat', v)}
        />
      </Setting>
      {pageFormat === 'jpg' && (
        <Setting title="Page quality">
          <RangeField
            label="Page quality"
            min={10}
            max={100}
            value={Number(options.pageQuality ?? 100)}
            onChange={(v) => set('pageQuality', v)}
            ends={['smaller file', 'higher quality']}
          />
        </Setting>
      )}
    </SettingGroup>
  )
}
