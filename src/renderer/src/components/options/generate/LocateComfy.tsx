import { useState, type JSX } from 'react'
import { Icon } from '../../icons/Icon'
import { SmallButton } from '../../ui/Button'
import { Setting, SettingGroup } from '../../ui/Setting'

/**
 * "ComfyUI was not found", with a way out. Discovery is path guessing, so a
 * ComfyUI on another drive, a NAS or a redirected Documents folder was otherwise
 * unreachable. Locating it writes the same store that generate, upscale and
 * companion discovery all read first, so one pick fixes all three.
 */
export function LocateComfy({ onLocated }: { onLocated: () => void }): JSX.Element {
  const [err, setErr] = useState<string | null>(null)
  const pick = (): void => {
    setErr(null)
    void window.filesmith.comfyPickFolder().then((folder) => {
      if (!folder) return
      void window.filesmith.comfySetFolder(folder).then((r) => {
        if (r.ok) onLocated()
        else setErr(r.error ?? "Couldn't use that folder")
      })
    })
  }
  return (
    <SettingGroup title="COMFYUI">
      <Setting title="ComfyUI" warn desc="ComfyUI was not found automatically.">
        <SmallButton icon="folder" onClick={pick}>
          Locate my ComfyUI folder
        </SmallButton>
        {err && (
          <div className="vs-d warn" role="alert">
            <Icon name="warning" size={12} />
            {err}
          </div>
        )}
      </Setting>
    </SettingGroup>
  )
}
