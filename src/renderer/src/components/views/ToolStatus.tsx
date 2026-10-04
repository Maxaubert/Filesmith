import { useEffect, useState, type JSX } from 'react'
import { SmallButton } from '../ui/Button'
import { Setting } from '../ui/Setting'

/** Read-only status of the bundled and on-demand tools (spec 5.4), from the
 * status calls the app already makes, plus the existing folder actions. */
export function ToolStatus(): JSX.Element {
  const [rar, setRar] = useState<boolean | null>(null)
  const [bg, setBg] = useState<{ ready: boolean; uvAvailable: boolean } | null>(null)
  const [comfy, setComfy] = useState<string | null | undefined>(undefined)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void window.filesmith.archiveStatus().then((s) => alive && setRar(s.rar))
    void window.filesmith.removebgStatus().then((s) => alive && setBg(s))
    void window.filesmith.comfyStatus().then((s) => alive && setComfy(s.folder ?? null))
    return () => {
      alive = false
    }
  }, [])
  async function changeComfy(): Promise<void> {
    const folder = await window.filesmith.comfyPickFolder()
    if (!folder) return
    const r = await window.filesmith.comfySetFolder(folder)
    if (r.ok) setComfy(folder)
    setNote(r.ok ? null : (r.error ?? 'That folder could not be used.'))
  }
  return (
    <>
      <Setting
        title="WinRAR"
        desc={
          rar == null
            ? 'Checking'
            : rar
              ? 'Found. RAR and CBR targets are available.'
              : 'Not found. RAR and CBR targets stay disabled.'
        }
      />
      <Setting
        title="Background removal"
        desc={
          bg == null
            ? 'Checking'
            : bg.ready
              ? 'Ready, works offline.'
              : bg.uvAvailable
                ? 'Downloads its model on first use.'
                : 'Needs the free uv tool (winget install astral-sh.uv).'
        }
      />
      <Setting
        title="ComfyUI folder"
        desc={note ?? (comfy === undefined ? 'Checking' : comfy ? <code>{comfy}</code> : 'Not set')}
      >
        <SmallButton icon="folder" onClick={() => void changeComfy()}>
          Change folder
        </SmallButton>
      </Setting>
      <Setting title="Upscale models" desc="Drop your own Real-ESRGAN models into this folder.">
        <SmallButton icon="folder" onClick={() => void window.filesmith.upscaleOpenModelsFolder()}>
          Open folder
        </SmallButton>
      </Setting>
      <Setting title="Model registry" desc="Your added generation models live here.">
        <SmallButton icon="folder" onClick={() => void window.filesmith.registryOpenFolder()}>
          Open folder
        </SmallButton>
      </Setting>
    </>
  )
}
