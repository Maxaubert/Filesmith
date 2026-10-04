import { useState, type JSX } from 'react'
import type { JobOptions } from '@shared/types'
import type { ArchInfo, GenArch } from '@shared/genArch'
import { RangeField } from '../../ui/RangeField'
import { CheckSetting, Setting, SettingGroup } from '../../ui/Setting'
import { NumberField } from '../../ui/TextField'
import type { SetOption } from '../types'

/** Power-user knobs. The defaults are good for almost everything, so they live
 * in a collapsed group with a one-line description on each. */
export function AdvancedSettings({
  options,
  arch,
  info,
  set
}: {
  options: JobOptions
  arch: GenArch
  info: ArchInfo
  set: SetOption
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const seed = Number(options.seed ?? -1)
  const random = !(seed >= 0)
  return (
    <SettingGroup title="ADVANCED" collapsible open={open} onToggle={() => setOpen((o) => !o)}>
      <Setting
        title="Steps"
        desc="How many refinement passes the model makes. More adds a little detail but is slower. Turbo models (Z-Image, Krea, Flux 2) need only a handful; SDXL and Flux 1 like 20 to 30."
      >
        <RangeField
          label="Steps"
          min={arch === 'sdxl' || arch === 'flux1' ? 8 : 1}
          max={50}
          value={Number(options.steps ?? info.steps)}
          onChange={(v) => set('steps', v)}
        />
      </Setting>
      {arch === 'sdxl' ? (
        <Setting
          title="Guidance (CFG)"
          desc="How closely it follows your prompt. About 7 is balanced; lower is looser and more natural, higher sticks to the prompt but can look harsh."
        >
          <RangeField
            label="Guidance (CFG)"
            min={1}
            max={15}
            step={0.5}
            value={Number(options.cfg ?? 7)}
            onChange={(v) => set('cfg', v)}
          />
        </Setting>
      ) : info.hasGuidance ? (
        <Setting
          title="Guidance"
          desc="Flux's prompt-adherence dial. Around 3.5 is the sweet spot for Flux 1; lower is more natural, higher follows the prompt harder."
        >
          <RangeField
            label="Guidance"
            min={1}
            max={10}
            step={0.5}
            value={Number(options.guidance ?? info.guidance)}
            onChange={(v) => set('guidance', v)}
          />
        </Setting>
      ) : null}
      <Setting
        title="Seed"
        desc="The random starting point. The same seed with the same settings makes the exact same image. Leave it random for variety, or fix it to reproduce a result."
      >
        <NumberField
          label="Seed"
          placeholder="random"
          value={random ? '' : seed}
          onCommit={(v) => set('seed', v === '' ? -1 : Math.max(0, Math.round(v)))}
        />
        <CheckSetting
          checked={random}
          onChange={(v) =>
            // Unticking picks a concrete seed, so the field shows what will run.
            set('seed', v ? -1 : Math.floor(Math.random() * 2 ** 31))
          }
          label="Random seed"
        />
      </Setting>
    </SettingGroup>
  )
}
