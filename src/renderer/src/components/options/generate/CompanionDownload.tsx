import { useState, type JSX } from 'react'
import type { GenModel } from '@shared/genArch'
import { Icon } from '../../icons/Icon'
import { SmallButton } from '../../ui/Button'
import { ProgressBar } from '../../ui/ProgressBar'
import { Setting } from '../../ui/Setting'

/** Shown when the selected model is missing its text-encoder / VAE files. Fetches
 * them into the user's ComfyUI folders, then refreshes so the model goes runnable:
 * the "works for anyone" path, not just a machine that already has the files. */
export function CompanionDownload({
  model,
  onDone
}: {
  model: GenModel
  onDone: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const missing = model.missing ?? []

  const start = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    const id = `dl-${model.name}`
    const off = window.filesmith.onGenerateDownloadProgress((p) => {
      if (p.id !== id) return
      setMsg(`${p.label} (${p.index}/${p.total})`)
      setPct(p.pct)
    })
    try {
      const r = await window.filesmith.generateDownload(id, model.name)
      if (!r.ok) setErr(r.error ?? 'Download failed.')
      else onDone()
    } finally {
      off()
      setBusy(false)
    }
  }

  return (
    <Setting
      title="Required files"
      desc={`This model needs ${missing.length} file${missing.length === 1 ? '' : 's'} you do not have yet.`}
    >
      <ul className="sizes mono">
        {missing.map((m) => (
          <li key={m.filename} title={m.label}>
            <span className="nm">{m.label}</span>
            <span>{m.approxSize}</span>
          </li>
        ))}
      </ul>
      {busy ? (
        <>
          <ProgressBar wide value={pct} label="Downloading required files" />
          <span className="mono">
            {msg ?? 'Starting'}
            {pct != null ? ` ${pct}%` : ''}
          </span>
        </>
      ) : (
        <SmallButton icon="pull" onClick={() => void start()}>
          Download required files
        </SmallButton>
      )}
      {err && (
        <div className="vs-d warn" role="alert">
          <Icon name="warning" size={12} />
          {err}
        </div>
      )}
    </Setting>
  )
}
