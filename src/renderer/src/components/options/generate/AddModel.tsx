import { useState, type JSX } from 'react'
import { Icon } from '../../icons/Icon'
import { SmallButton } from '../../ui/Button'
import { Setting } from '../../ui/Setting'

/**
 * "Add a model": the escape hatch that means a new architecture never requires
 * an app release. Importing a ComfyUI "Export (API)" workflow lets a user who can
 * already generate a model inside ComfyUI generate it here. Changing the ComfyUI
 * folder lives here too, since Generate and Upscale read the same store.
 */
export function AddModel({
  onAdded,
  comfyFolder
}: {
  onAdded: () => void
  comfyFolder?: string | null
}): JSX.Element {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const pickComfy = (): void => {
    setMsg(null)
    void window.filesmith.comfyPickFolder().then((folder) => {
      if (!folder) return
      void window.filesmith.comfySetFolder(folder).then((r) => {
        if (r.ok) onAdded()
        else setMsg({ ok: false, text: r.error ?? "Couldn't use that folder" })
      })
    })
  }
  const importOne = (): void => {
    setMsg(null)
    void window.filesmith.registryImport().then((r) => {
      if (!r.ok) {
        if (r.error) setMsg({ ok: false, text: r.error })
        return
      }
      setMsg({
        ok: true,
        text: [`Added ${r.ids?.join(', ')}.`, ...(r.notes ?? [])].join(' ')
      })
      onAdded()
    })
  }
  return (
    <Setting
      title="Your models"
      desc={comfyFolder ? <code>{comfyFolder}</code> : 'Choose your ComfyUI folder.'}
    >
      <div className="vs-row">
        <SmallButton icon="addfile" onClick={importOne}>
          Add a model
        </SmallButton>
        <SmallButton
          icon="folder"
          onClick={() => void window.filesmith.registryOpenFolder()}
          title="Open the folder where your own model entries live"
        >
          Open folder
        </SmallButton>
      </div>
      <SmallButton icon="folder" onClick={pickComfy} title={comfyFolder ?? undefined}>
        Change ComfyUI folder
      </SmallButton>
      {msg &&
        (msg.ok ? (
          <div className="vs-d">{msg.text}</div>
        ) : (
          <div className="vs-d warn" role="alert">
            <Icon name="warning" size={12} />
            {msg.text}
          </div>
        ))}
    </Setting>
  )
}
