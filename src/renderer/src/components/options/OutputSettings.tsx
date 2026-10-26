import { useEffect, useState, type JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { renderOutputName } from '@shared/outputNaming'
import { Select } from '../ui/Select'
import type { SelectOption } from '../ui/selectNav'
import { CheckSetting, Setting, SettingGroup } from '../ui/Setting'
import { TextField } from '../ui/TextField'
import { addRecentFolder, loadRecentFolders } from './recentFolders'
import type { SetOption } from './types'

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const parentOf = (p: string): string => p.replace(/[\\/][^\\/]+[\\/]?$/, '')
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const PICK = '\u0000pick'
type Known = { downloads: string; desktop: string; pictures: string }

/**
 * OUTPUT > Location, ORIGINALS > Replace originals, NAMING > Rename and
 * METADATA (signed off 2026-10-26, docs/mockups/output-options/). The folder
 * picker is the last entry of the Location dropdown, not a separate button.
 */
export function OutputSettings({
  options,
  set,
  canStrip,
  example
}: {
  options: JobOptions
  set: SetOption
  /** Remove photo metadata applies (images and video). */
  canStrip: boolean
  /** A source name and output extension for the Rename example line. */
  example: { name: string; ext: string }
}): JSX.Element {
  const dir = typeof options.outDir === 'string' ? options.outDir : ''
  const replace = options.replaceOriginals === true
  const renameOn = options.rename === true
  const pattern = typeof options.renamePattern === 'string' ? options.renamePattern : '{name}'
  const [known, setKnown] = useState<Known | null>(null)
  const [recent, setRecent] = useState<string[]>(loadRecentFolders)

  useEffect(() => {
    let live = true
    void window.filesmith.knownFolders().then((k) => live && setKnown(k))
    return () => {
      live = false
    }
  }, [])

  async function choose(): Promise<void> {
    const p = await window.filesmith.pickFolder()
    if (!p) return
    set('outDir', p)
    setRecent(addRecentFolder(p))
  }

  const fixed: SelectOption<string>[] = known
    ? [
        { value: known.downloads, label: 'downloads' },
        { value: known.desktop, label: 'desktop' },
        { value: known.pictures, label: 'pictures' }
      ]
    : []
  const isFixed = (p: string): boolean => fixed.some((f) => same(f.value, p))
  const recents = recent.filter((p) => !isFixed(p))
  // A folder chosen earlier that is neither fixed nor recent still shows as itself.
  const extra = dir && !isFixed(dir) && !recents.some((p) => same(p, dir)) ? [dir] : []
  const choices: SelectOption<string>[] = [
    { value: '', label: 'next to source' },
    ...fixed.map((f, i) => (i === 0 ? { ...f, sep: true } : f)),
    ...[...extra, ...recents].map((p) => ({
      value: p,
      label: baseName(p),
      reason: parentOf(p),
      group: 'recent'
    })),
    { value: PICK, label: 'choose folder…', sep: true }
  ]
  const current = choices.find((c) => c.value !== PICK && same(c.value, dir))?.value ?? dir

  const exampleName = renderOutputName(pattern, example.name, 1, new Date())

  return (
    <>
      <SettingGroup title="OUTPUT">
        <Setting
          title="Location"
          warn={replace}
          desc={
            replace
              ? 'Ignored while Replace originals is on: each new file lands where its original was.'
              : 'Where the new files go.'
          }
        >
          <Select
            label="Location"
            value={current}
            options={choices}
            disabled={replace}
            onChange={(v) => {
              if (v === PICK) void choose()
              else set('outDir', v)
            }}
          />
          {!replace && (
            <div className="vs-dest">
              <span aria-hidden>→</span>
              <span className="p" title={dir || undefined}>
                {dir || 'same folder as each file'}
              </span>
              {dir && (
                <button type="button" onClick={() => window.filesmith.openFile(dir)}>
                  Open
                </button>
              )}
            </div>
          )}
        </Setting>
      </SettingGroup>
      <SettingGroup title="ORIGINALS">
        <CheckSetting
          checked={replace}
          onChange={(v) => set('replaceOriginals', v)}
          label="Replace originals"
          sub="The new file takes the original's place. The original goes to the Recycle Bin, only after the new file is written OK."
        />
      </SettingGroup>
      <SettingGroup title="NAMING">
        <CheckSetting
          checked={renameOn && !replace}
          disabled={replace}
          onChange={(v) => set('rename', v)}
          label="Rename"
          sub={replace ? 'Off while Replace originals is on.' : 'Pattern for the new names.'}
        />
        {renameOn && !replace && (
          <div className="vs-sub">
            <TextField
              aria-label="Rename pattern"
              value={pattern}
              onChange={(e) => set('renamePattern', e.target.value)}
            />
            <div className="vs-d">
              {'{name}'} original name · {'{n}'} 1, 2, 3… · {'{date}'} today
            </div>
            <div className="vs-dest">
              <span aria-hidden>e.g.</span>
              <span className="p">
                {example.name} → {exampleName}
                {example.ext}
              </span>
            </div>
          </div>
        )}
      </SettingGroup>
      <SettingGroup title="METADATA">
        <CheckSetting
          checked={options.keepDates === true}
          onChange={(v) => set('keepDates', v)}
          label="Keep original dates"
          sub="New files keep the source's modified date."
        />
        <CheckSetting
          checked={canStrip && options.stripMetadata === true}
          disabled={!canStrip}
          onChange={(v) => set('stripMetadata', v)}
          label="Remove photo metadata"
          sub={
            canStrip ? 'Strips GPS location, camera and other EXIF data.' : 'Images and video only.'
          }
        />
      </SettingGroup>
    </>
  )
}
