import { useEffect, useState, type JSX } from 'react'
import type { JobOptions } from '@shared/types'
import { BG_DEFAULTS, BG_FILLS, type BgFill } from '@shared/removebg'
import { SmallButton } from '../ui/Button'
import { Select } from '../ui/Select'
import { Setting, SettingGroup } from '../ui/Setting'
import type { SetOption } from './types'

/** One fill choice plus its custom colour or image. The model and matting
 * thresholds are deliberately not exposed (see src/shared/removebg.ts). */
export function RemoveBgSettings({
  options,
  set
}: {
  options: JobOptions
  set: SetOption
}): JSX.Element {
  const fill = String(options.bgFill ?? BG_DEFAULTS.bgFill) as BgFill
  const bgImage = String(options.bgImagePath ?? '')
  const color = String(options.bgCustomColor ?? BG_DEFAULTS.bgCustomColor)
  // Disclose up front that background removal is AI-powered and, on first use,
  // downloads a model, so nobody hits a mid-run surprise.
  const [rembg, setRembg] = useState<{ ready: boolean; uvAvailable: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    void window.filesmith.removebgStatus().then((s) => alive && setRembg(s))
    return () => {
      alive = false
    }
  }, [])
  const notice =
    rembg && !rembg.ready ? (
      rembg.uvAvailable ? (
        'The first run downloads the AI model once (a few hundred MB), then works offline.'
      ) : (
        <>
          Needs the free uv tool: <code>winget install astral-sh.uv</code>, then reopen Filesmith.
        </>
      )
    ) : undefined
  return (
    <SettingGroup title="BACKGROUND">
      <Setting title="Fill" desc={notice} warn={notice != null}>
        <Select label="Fill" value={fill} options={BG_FILLS} onChange={(v) => set('bgFill', v)} />
      </Setting>
      {fill === 'custom' && (
        <Setting title="Custom colour">
          {/* The swatch shows user data, the one non-grey value on screen (spec 4.2). */}
          <label className="swatch">
            <span className="sw" style={{ background: color }} />
            <span className="mono">{color}</span>
            <input
              type="color"
              className="sr-only"
              value={color}
              onChange={(e) => set('bgCustomColor', e.target.value)}
            />
          </label>
        </Setting>
      )}
      {fill === 'image' && (
        <Setting
          title="Background image"
          desc={bgImage ? <code>{bgImage.split(/[\\/]/).pop()}</code> : undefined}
        >
          <SmallButton
            icon="image"
            onClick={() =>
              void window.filesmith.pickImage().then((p) => {
                if (p) set('bgImagePath', p)
              })
            }
          >
            Choose image
          </SmallButton>
        </Setting>
      )}
    </SettingGroup>
  )
}
