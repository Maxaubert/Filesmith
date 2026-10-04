import type { JSX } from 'react'
import type { FileKind, JobOptions } from '@shared/types'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  IMAGE_FORMATS,
  PDF_LEVELS,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  VIDEO_CODECS
} from '@shared/compress'
import { ChipGrid } from '../ui/ChipGrid'
import { OutputSizeList, type SizeRow } from '../ui/OutputSizeList'
import { RangeField } from '../ui/RangeField'
import { Select } from '../ui/Select'
import { CheckSetting, Setting, SettingGroup } from '../ui/Setting'
import type { SetOption } from './types'

const quality = (options: JobOptions, set: SetOption): JSX.Element => (
  <Setting title="Quality">
    <RangeField
      label="Quality"
      min={10}
      max={100}
      value={Number(options.quality ?? 80)}
      onChange={(v) => set('quality', v)}
      ends={['smaller file', 'higher quality']}
    />
  </Setting>
)

export function CompressSettings({
  options,
  kind,
  videoOutputs,
  set
}: {
  options: JobOptions
  kind: FileKind
  videoOutputs: SizeRow[]
  set: SetOption
}): JSX.Element {
  if (kind === 'pdf')
    return (
      <SettingGroup title="PDF">
        <Setting
          title="Level"
          desc="Lossless keeps every pixel; smallest recompresses images hardest."
        >
          <Select
            label="Level"
            value={String(options.pdfLevel ?? 'balanced')}
            options={PDF_LEVELS}
            onChange={(v) => set('pdfLevel', v)}
          />
        </Setting>
        <Setting title="Colour">
          <CheckSetting
            checked={Boolean(options.pdfGray)}
            onChange={(v) => set('pdfGray', v)}
            label="Convert to greyscale"
            sub="Smaller, but every page loses its colour"
          />
        </Setting>
      </SettingGroup>
    )
  if (kind === 'video') {
    const scale = Number(options.scale ?? 100)
    return (
      <SettingGroup title="VIDEO">
        <Setting title="Codec">
          <Select
            label="Codec"
            value={String(options.videoCodec ?? 'h264')}
            options={VIDEO_CODECS}
            onChange={(v) => set('videoCodec', v)}
          />
        </Setting>
        <Setting title="Scale" desc="Downscale while compressing.">
          <RangeField
            label="Scale"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={scale}
            onChange={(v) => set('scale', v)}
            format={(v) => (v === 100 ? 'original' : `${v}%`)}
            ends={[`${SCALE_MIN}%`, 'original']}
          />
          {scale < 100 && <OutputSizeList rows={videoOutputs} />}
        </Setting>
        {quality(options, set)}
      </SettingGroup>
    )
  }
  if (kind === 'audio')
    return (
      <SettingGroup title="AUDIO">
        <Setting title="Codec">
          <Select
            label="Codec"
            value={String(options.audioCodec ?? 'keep')}
            options={AUDIO_CODECS}
            onChange={(v) => set('audioCodec', v)}
          />
        </Setting>
        <Setting title="Bitrate">
          <ChipGrid
            label="Bitrate"
            cols={3}
            value={Number(options.audioBitrate ?? 192)}
            chips={AUDIO_BITRATES.map((b) => ({ value: b, label: `${b}k` }))}
            onChange={(v) => set('audioBitrate', v)}
          />
        </Setting>
      </SettingGroup>
    )
  return (
    <SettingGroup title="FORMAT">
      <Setting title="Format">
        <Select
          label="Format"
          value={String(options.imageFormat ?? 'keep')}
          options={IMAGE_FORMATS}
          onChange={(v) => set('imageFormat', v)}
        />
      </Setting>
      {quality(options, set)}
    </SettingGroup>
  )
}
