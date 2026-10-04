import type { JSX } from 'react'
import type { GenModel } from '@shared/genArch'
import { Select } from '../../ui/Select'

/** Model picker grouped by architecture (Checkpoints / Flux / Z-Image / ...).
 * Non-runnable models stay selectable and are annotated, so picking one reveals
 * the download block or Try anyway instead of being a dead, greyed-out row. */
export function ModelSelect({
  models,
  value,
  onChange
}: {
  models: GenModel[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  // Keep each architecture's models together, in first-seen group order, so the
  // popup draws one heading per group.
  const groups: string[] = []
  for (const m of models) if (!groups.includes(m.group)) groups.push(m.group)
  const options = groups.flatMap((g) =>
    models
      .filter((m) => m.group === g)
      .map((m) => ({
        value: m.name,
        label: m.label,
        group: g,
        reason: m.runnable ? undefined : 'needs download'
      }))
  )
  return <Select label="Model" value={value} options={options} onChange={onChange} />
}
