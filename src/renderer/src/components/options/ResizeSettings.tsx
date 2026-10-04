import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { RESIZE_FITS } from '@shared/resize'
import { OutputSizeList, type SizeRow } from '../ui/OutputSizeList'
import { RangeField } from '../ui/RangeField'
import { Segmented } from '../ui/Segmented'
import { Setting, SettingGroup } from '../ui/Setting'
import { NumberField } from '../ui/TextField'
import type { SetOption } from './types'

const dim = (v: unknown): number | '' =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v)

export function ResizeSettings({
  options,
  outputs,
  set
}: {
  options: JobOptions
  outputs: SizeRow[]
  set: SetOption
}): JSX.Element {
  const mode = String(options.mode ?? 'percent')
  return (
    <SettingGroup title="SIZE">
      <Setting title="Mode">
        <Segmented
          label="Mode"
          value={mode}
          options={[
            { value: 'percent', label: 'percent' },
            { value: 'dimensions', label: 'dimensions' }
          ]}
          onChange={(v) => set('mode', v)}
        />
      </Setting>
      {mode === 'percent' ? (
        <Setting title="Percent">
          <RangeField
            label="Percent"
            min={5}
            max={200}
            value={Number(options.percent ?? 50)}
            onChange={(v) => set('percent', v)}
            format={(v) => `${v}%`}
          />
        </Setting>
      ) : (
        <>
          <Setting title="Width and height" desc="Leave one blank to scale by the other.">
            <div className="vs-row">
              <NumberField
                label="Width"
                placeholder="auto"
                value={dim(options.width)}
                onCommit={(v) => set('width', v)}
                clamp={(n) => Math.max(1, Math.round(n))}
              />
              <NumberField
                label="Height"
                placeholder="auto"
                value={dim(options.height)}
                onCommit={(v) => set('height', v)}
                clamp={(n) => Math.max(1, Math.round(n))}
              />
            </div>
          </Setting>
          <Setting
            title="Fit"
            desc="Contain keeps the aspect ratio inside the box; stretch honours both numbers."
          >
            <Segmented
              label="Fit"
              value={options.fit === 'stretch' ? 'stretch' : 'contain'}
              options={RESIZE_FITS.map((f) => ({ value: f.value, label: f.label.toLowerCase() }))}
              onChange={(v) => set('fit', v)}
            />
            <OutputSizeList rows={outputs} />
          </Setting>
        </>
      )}
    </SettingGroup>
  )
}
