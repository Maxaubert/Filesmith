import type { JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { SmallButton } from '../ui/Button'
import { Select } from '../ui/Select'
import { Setting, SettingGroup } from '../ui/Setting'
import type { SetOption } from './types'

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** OUTPUT > Location (engine support: Task 3) and FILES > If file exists, which
 * is fixed because the never-overwrite rule leaves one possible value (O7). */
export function OutputSettings({
  options,
  set
}: {
  options: JobOptions
  set: SetOption
}): JSX.Element {
  const dir = typeof options.outDir === 'string' ? options.outDir : ''
  async function choose(): Promise<void> {
    const p = await window.filesmith.pickFolder()
    if (p) set('outDir', p)
  }
  return (
    <>
      <SettingGroup title="OUTPUT">
        <Setting
          title="Location"
          desc={dir ? <code>{dir}</code> : 'Files are written next to each source.'}
        >
          <div className="vs-row">
            <Select
              label="Location"
              value={dir ? 'folder' : 'source'}
              options={[
                { value: 'source', label: 'next to source' },
                {
                  value: 'folder',
                  label: dir ? baseName(dir) : 'chosen folder',
                  disabled: !dir,
                  reason: dir ? undefined : 'choose one first'
                }
              ]}
              onChange={(v) => {
                if (v === 'source') set('outDir', '')
              }}
            />
            <SmallButton icon="folder" onClick={() => void choose()}>
              Choose folder
            </SmallButton>
          </div>
        </Setting>
      </SettingGroup>
      <SettingGroup title="FILES">
        <Setting title="If file exists" desc="Existing files are never overwritten.">
          <Select
            half
            disabled
            label="If file exists"
            value="add"
            options={[{ value: 'add', label: 'add (2)' }]}
            onChange={() => undefined}
          />
        </Setting>
      </SettingGroup>
    </>
  )
}
