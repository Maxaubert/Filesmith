import { useEffect, useMemo, useRef, type JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { GEN_MAX_COUNT, GEN_SIZES, GEN_STYLES, clampDim } from '@shared/generate'
import { archInfoFor, type GenArch } from '@shared/genArch'
import { SmallButton } from '../../ui/Button'
import { ChipGrid } from '../../ui/ChipGrid'
import { RangeField } from '../../ui/RangeField'
import { Select } from '../../ui/Select'
import { Setting, SettingGroup } from '../../ui/Setting'
import { NumberField, TextField } from '../../ui/TextField'
import { useGenerateStatus } from '../hooks/useGenerateStatus'
import type { SetOption } from '../types'
import { AddModel } from './AddModel'
import { AdvancedSettings } from './AdvancedSettings'
import { CompanionDownload } from './CompanionDownload'
import { LocateComfy } from './LocateComfy'
import { ModelSelect } from './ModelSelect'
import { isRestoreName } from './restore'

/** Text-to-image options. The prompt lives in the centre; this pane carries the
 * model, prompt extras, output and sampling settings. */
export function GenerateSettings({
  options,
  set
}: {
  options: JobOptions
  set: SetOption
}): JSX.Element {
  const { status, refresh } = useGenerateStatus()
  const model = String(options.model ?? '')
  const w = Number(options.width ?? 1024)
  const h = Number(options.height ?? 1024)
  // An explicit mode: derived-from-dimensions alone made "custom" unreachable
  // (the defaults equal a preset, so the select snapped straight back).
  const isPreset = GEN_SIZES.some((s) => s.width === w && s.height === h)
  const sizeValue =
    String(options.sizeMode ?? '') === 'custom' || !isPreset ? 'custom' : `${w}x${h}`
  const models = useMemo(() => status?.models ?? [], [status])
  const selected = models.find((m) => m.name === model)
  // "Try anyway" is per-model and deliberately not sticky.
  const tryAnyway = Boolean(options.tryAnyway)
  // Dimension limits come from the model's own registry entry.
  const dimCaps = status?.dimCaps?.[selected?.arch ?? 'sdxl']
  const arch: GenArch = selected?.arch ?? 'sdxl'
  // Sampler defaults come from the registry when main supplied them.
  const info = archInfoFor(arch, status?.archInfo)

  // Default to a runnable text-to-image model once the list loads, and steer
  // away from a restoration checkpoint (SUPIR) or a vanished selection.
  useEffect(() => {
    if (!models.length || selected) return
    const good =
      models.find((m) => m.runnable && !isRestoreName(m.label)) ??
      models.find((m) => m.runnable) ??
      models[0]
    if (good && good.name !== model) set('model', good.name)
  }, [model, models, selected, set])

  // When the architecture changes, reset the sampler knobs to that arch's sane
  // defaults. Only after the scan resolves, and only on a real change.
  const prevArch = useRef<GenArch | null>(null)
  useEffect(() => {
    if (!status) return
    if (prevArch.current === null) {
      prevArch.current = arch
      return
    }
    if (prevArch.current === arch) return
    prevArch.current = arch
    set('tryAnyway', 0)
    set('steps', info.steps)
    set('cfg', info.cfg)
    if (info.hasGuidance) set('guidance', info.guidance)
  }, [arch, info, set, status])

  const sizeChoices = [
    ...GEN_SIZES.map((s) => ({ value: `${s.width}x${s.height}`, label: s.label })),
    { value: 'custom', label: 'custom' }
  ]
  const needsFiles = Boolean(selected && !selected.runnable && selected.missing?.length)
  const unrunnable = selected && !selected.runnable && !needsFiles ? selected : null
  return (
    <>
      {status && !status.available && <LocateComfy onLocated={refresh} />}
      <SettingGroup title="MODEL">
        <Setting
          title="Model"
          desc={
            !models.length
              ? 'No image models found in your ComfyUI models folder.'
              : (unrunnable?.reason ?? undefined)
          }
        >
          {models.length > 0 && (
            <ModelSelect models={models} value={model} onChange={(v) => set('model', v)} />
          )}
          {/* An unrecognised model is not a forbidden one: send it through a
              generic graph and let ComfyUI give its own verdict. */}
          {unrunnable?.reason && unrunnable.tryAnyway && (
            <SmallButton
              icon={tryAnyway ? 'close' : 'play'}
              onClick={() => set('tryAnyway', tryAnyway ? 0 : 1)}
            >
              {tryAnyway ? 'Will try anyway, click to cancel' : 'Try anyway'}
            </SmallButton>
          )}
        </Setting>
        {selected && needsFiles && <CompanionDownload model={selected} onDone={refresh} />}
        <AddModel onAdded={refresh} comfyFolder={status?.comfyFolder} />
      </SettingGroup>
      <SettingGroup title="PROMPT">
        {/* Negative prompt only affects arches that use real CFG (SDXL). At cfg 1
            the negative branch is inert, so it is hidden there. */}
        {info.cfg !== 1 && (
          <Setting title="Negative prompt" desc="What the image should avoid.">
            <TextField
              aria-label="Negative prompt"
              value={String(options.negative ?? '')}
              onChange={(e) => set('negative', e.target.value)}
            />
          </Setting>
        )}
        <Setting title="Style">
          <ChipGrid
            label="Style"
            cols={3}
            value={String(options.style ?? 'none')}
            chips={GEN_STYLES.map((s) => ({ value: s.id, label: s.label.toLowerCase() }))}
            onChange={(v) => set('style', v)}
          />
        </Setting>
      </SettingGroup>
      <SettingGroup title="OUTPUT">
        <Setting title="Count">
          <RangeField
            label="Count"
            min={1}
            max={GEN_MAX_COUNT}
            value={Number(options.count ?? 1)}
            onChange={(v) => set('count', v)}
          />
        </Setting>
        <Setting title="Size">
          <Select
            label="Size"
            value={sizeValue}
            options={sizeChoices}
            onChange={(v) => {
              if (v === 'custom') {
                set('sizeMode', 'custom')
                return
              }
              set('sizeMode', 'preset')
              const [sw, sh] = v.split('x').map(Number)
              set('width', sw)
              set('height', sh)
            }}
          />
          {sizeValue === 'custom' && (
            <div className="vs-row">
              <NumberField
                label="Width"
                value={w}
                onCommit={(v) => v !== '' && set('width', v)}
                clamp={(n) => clampDim(n, dimCaps)}
              />
              <NumberField
                label="Height"
                value={h}
                onCommit={(v) => v !== '' && set('height', v)}
                clamp={(n) => clampDim(n, dimCaps)}
              />
            </div>
          )}
        </Setting>
      </SettingGroup>
      <AdvancedSettings options={options} arch={arch} info={info} set={set} />
    </>
  )
}
