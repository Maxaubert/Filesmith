import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { RangeField } from '../ui/RangeField'
import { Setting, SettingGroup } from '../ui/Setting'
import { TextField } from '../ui/TextField'
import type { SetOption } from './types'

/** Each Tools card is one op, so there is no op picker (spec 4.2). */
export function PdfSettings({
  options,
  runCount,
  set
}: {
  options: JobOptions
  runCount: number
  set: SetOption
}): JSX.Element | null {
  const op = String(options.op ?? 'extract-text')
  if (op === 'pages-to-images')
    return (
      <SettingGroup title="PAGES">
        <Setting title="Resolution" desc="Dots per inch for each rendered page.">
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
      </SettingGroup>
    )
  if (op === 'split-range')
    return (
      <SettingGroup title="PAGES">
        <Setting
          title="Pages to keep"
          desc={
            <>
              Ranges and single pages, for example <code>1-3,5,8-10</code>.
            </>
          }
        >
          <TextField
            aria-label="Pages to keep"
            placeholder="1-3,5,8-10"
            value={String(options.range ?? '')}
            onChange={(e) => set('range', e.target.value)}
          />
        </Setting>
      </SettingGroup>
    )
  // Merge is the one op whose requirement is not visible in the UI (it needs 2+ files).
  if (op === 'merge' && runCount < 2)
    return (
      <SettingGroup title="FILES">
        <Setting title="Merge" desc="Select 2 or more PDFs. They are combined in table order." />
      </SettingGroup>
    )
  return null
}
