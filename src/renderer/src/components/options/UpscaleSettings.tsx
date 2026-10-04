import { useEffect, useMemo, useState, type JSX } from 'react'
import type { JobOptions } from '@shared/types'
import {
  UPSCALE_COMFY,
  UPSCALE_FACTORS,
  UPSCALE_GPU_MODES,
  UPSCALE_MODELS,
  type Choice,
  type UpscaleModel
} from '@shared/compress'
import { SmallButton } from '../ui/Button'
import { ChipGrid } from '../ui/ChipGrid'
import { OutputSizeList, type SizeRow } from '../ui/OutputSizeList'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { Setting, SettingGroup } from '../ui/Setting'
import { useComfyModels } from './hooks/useComfyModels'
import { usePidStatus } from './hooks/usePidStatus'
import { ComfyImportCard } from './upscale/ComfySetup'
import { PidInstallCard, PidRemoveButton } from './upscale/PidSetup'
import type { SetOption } from './types'

/**
 * Image Upscale. Two-level model picker: the Real-ESRGAN models on disk, plus an
 * "AI models" category (NVIDIA only) holding a second picker of the imported
 * ComfyUI ESRGAN models and PiD. Stored value is a model id | 'pid' | 'comfy'
 * (category placeholder) | 'comfy:<path>'.
 */
export function UpscaleSettings({
  options,
  outputs,
  set
}: {
  options: JobOptions
  outputs: SizeRow[]
  set: SetOption
}): JSX.Element {
  const factor = Number(options.upscaleFactor ?? 4)
  const comfy = useComfyModels()
  const { status: pid, refresh: refreshPid } = usePidStatus()
  const rawModel = String(options.upscaleModel ?? 'photo')
  const hasNvidia = Boolean(comfy.status?.nvidia || pid?.nvidia)
  // Which Real-ESRGAN models exist is read from disk, not frozen at build time.
  const [ncnn, setNcnn] = useState<{ value: string; label: string; user: boolean }[] | null>(null)
  useEffect(() => {
    let alive = true
    void window.filesmith.upscaleModels().then((m) => alive && setNcnn(m))
    return () => {
      alive = false
    }
  }, [])
  const comfyModels = comfy.status?.models
  // Memoized: the validity effect below depends on this list and calls set().
  const comfyChoices = useMemo(
    () =>
      (comfyModels ?? []).map((m) => ({
        value: `comfy:${m.path}`,
        label: `${m.name}, ${m.scale}×${m.badge === 'experimental' ? ', experimental' : ''}`
      })),
    [comfyModels]
  )
  // Fall back to the legacy Photo/Anime aliases until the disk scan returns, so
  // the picker is never empty for a frame.
  const ncnnChoices: Choice<UpscaleModel>[] = ncnn?.length
    ? ncnn.map((m) => ({
        value: m.value as UpscaleModel,
        label: m.user ? `${m.label}, added by you` : m.label
      }))
    : UPSCALE_MODELS
  const isPid = rawModel === 'pid'
  const isComfyPath = rawModel.startsWith('comfy:')
  const inAi = isPid || isComfyPath || rawModel === 'comfy'
  const category = inAi
    ? 'comfy'
    : ncnnChoices.some((c) => c.value === rawModel)
      ? rawModel
      : (ncnnChoices[0]?.value ?? 'photo')
  const categoryChoices = [...ncnnChoices, ...(hasNvidia ? [UPSCALE_COMFY] : [])]
  // PiD is only offered when it is actually attainable: already installed, or
  // its weights are reusable from the user's ComfyUI.
  const showPid = hasNvidia && Boolean(pid?.installed || comfy.status?.pidReusable)
  const subChoices = [
    ...comfyChoices,
    ...(showPid ? [{ value: 'pid', label: 'PiD (diffusion), 4×' }] : [])
  ]
  const subDefault = comfyChoices[0]?.value ?? (showPid ? 'pid' : 'comfy')
  const subValue = isPid ? 'pid' : isComfyPath ? rawModel : subDefault
  const pidNeedsInstall = isPid && pid != null && !pid.installed
  const vramMb = pid?.nvidia?.vramMb ?? null
  const lowVram = isPid && vramMb != null && vramMb < 12_000
  const pickCategory = (v: string): void => set('upscaleModel', v === 'comfy' ? subDefault : v)

  // Keep the stored value valid once both statuses have loaded: an AI choice
  // with no GPU falls back to Photo; a vanished comfy:<path>, or PiD that is not
  // showable, falls back to the first available AI model.
  useEffect(() => {
    if (pid == null || comfy.status == null) return
    if (inAi && !hasNvidia) set('upscaleModel', 'photo')
    else if (isComfyPath && !comfyChoices.some((c) => c.value === rawModel))
      set('upscaleModel', subDefault)
    else if (isPid && !showPid) set('upscaleModel', subDefault)
  }, [
    pid,
    comfy.status,
    hasNvidia,
    inAi,
    isComfyPath,
    isPid,
    showPid,
    rawModel,
    comfyChoices,
    subDefault,
    set
  ])
  // Why the AI tier is missing, instead of silently hiding it.
  const gpuReason = !hasNvidia ? (pid?.cudaReason ?? comfy.status?.cudaReason) : undefined

  return (
    <>
      <SettingGroup title="MODEL">
        <Setting title="Factor">
          <ChipGrid
            label="Factor"
            cols={3}
            value={factor}
            chips={UPSCALE_FACTORS.map((f) => ({ value: f, label: `${f}×` }))}
            onChange={(v) => set('upscaleFactor', v)}
          />
        </Setting>
        <Setting title="Model" desc={gpuReason ?? undefined}>
          <Select
            label="Model"
            value={category}
            options={categoryChoices}
            onChange={pickCategory}
          />
          {category === 'comfy' && subChoices.length > 0 && (
            <Select
              label="AI model"
              value={subValue}
              options={subChoices}
              onChange={(v) => set('upscaleModel', v)}
            />
          )}
          {!inAi && (
            <SmallButton
              icon="folder"
              onClick={() => void window.filesmith.upscaleOpenModelsFolder()}
            >
              Add your own model
            </SmallButton>
          )}
        </Setting>
        {category === 'comfy' && pidNeedsInstall && <PidInstallCard onInstalled={refreshPid} />}
        {category === 'comfy' && isPid && pid?.installed && (
          <PidRemoveButton onRemoved={refreshPid} />
        )}
        {category === 'comfy' && comfy.status && (
          <ComfyImportCard status={comfy.status} refresh={comfy.refresh} />
        )}
      </SettingGroup>
      {(!isPid || lowVram) && (
        <SettingGroup title="PERFORMANCE">
          {/* PiD runs in one pass and cannot be paced, so it gets no control. */}
          {!isPid && (
            <Setting title="GPU mode">
              <Segmented
                label="GPU mode"
                value={String(options.gpuMode ?? 'full')}
                options={UPSCALE_GPU_MODES.map((o) => ({
                  value: o.value,
                  label: o.label.toLowerCase()
                }))}
                onChange={(v) => set('gpuMode', v)}
              />
            </Setting>
          )}
          {lowVram && (
            <Setting
              title="Graphics memory"
              warn
              desc={`Your GPU reports about ${Math.round((vramMb as number) / 1024)} GB, so PiD reduces the resolution of large images to fit.`}
            />
          )}
        </SettingGroup>
      )}
      {outputs.length > 0 && (
        <SettingGroup title="OUTPUT">
          <Setting title="Output size">
            <OutputSizeList rows={outputs} />
          </Setting>
        </SettingGroup>
      )}
    </>
  )
}
