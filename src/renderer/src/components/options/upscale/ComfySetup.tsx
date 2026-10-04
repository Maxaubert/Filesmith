import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ComfyModel } from '@shared/comfy'
import { Icon } from '../../icons/Icon'
import { SmallButton } from '../../ui/Button'
import { ProgressBar } from '../../ui/ProgressBar'
import { Setting } from '../../ui/Setting'
import type { ComfyStatus } from '../hooks/useComfyModels'

// The "Import from ComfyUI" flow, shown under the Upscale model picker when an
// NVIDIA GPU is present. Three states: engine not built (one-time env setup),
// scanning, and ready (browse / change / rescan, plus the list of files the
// engine could not load).

export function ComfyImportCard({
  status,
  refresh
}: {
  status: ComfyStatus
  refresh: () => void
}): JSX.Element {
  const [busy, setBusy] = useState<'install' | 'scan' | null>(null)
  const [progress, setProgress] = useState<{ step: string; pct: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<ComfyModel[] | null>(null)

  useEffect(() => window.filesmith.onComfyProgress(setProgress), [])

  const scan = useCallback(
    (folder: string): void => {
      setBusy('scan')
      setError(null)
      void window.filesmith.comfyScan(folder).then((r) => {
        setBusy(null)
        if (r.ok) {
          setLastScan(r.models ?? [])
          refresh()
        } else setError(r.error ?? 'Scan failed')
      })
    },
    [refresh]
  )

  const pickAndScan = useCallback((): void => {
    void window.filesmith.comfyPickFolder().then((folder) => {
      if (folder) scan(folder)
    })
  }, [scan])

  // Record the folder without a scan: the scan needs the engine we do not have
  // yet, but remembering the location is exactly what lets the engine be found.
  const locateOnly = useCallback((): void => {
    setError(null)
    void window.filesmith.comfyPickFolder().then((folder) => {
      if (!folder) return
      void window.filesmith.comfySetFolder(folder).then((r) => {
        if (r.ok) refresh()
        else setError(r.error ?? "Couldn't use that folder")
      })
    })
  }, [refresh])

  const installEngine = useCallback((): void => {
    setBusy('install')
    setError(null)
    setProgress(null)
    void window.filesmith.comfyInstall().then((r) => {
      setBusy(null)
      if (r.ok) refresh()
      else setError(r.error ?? 'Setup failed')
    })
  }, [refresh])

  const unsupported = (lastScan ?? []).filter((m) => m.badge === 'unsupported')
  const errorLine = error && (
    <div className="vs-d warn" role="alert">
      <Icon name="warning" size={12} />
      {error}
    </div>
  )

  if (!status.engineReady) {
    const pct = progress?.pct ?? null
    return (
      <Setting
        title="ComfyUI models"
        desc={
          status.envExists
            ? 'Use your own ComfyUI upscale models. Quick one-time setup.'
            : 'Use your own ComfyUI upscale models. One-time setup: about 3 GB, shared with PiD.'
        }
      >
        {busy === 'install' ? (
          <>
            <ProgressBar wide value={pct} label="Setting up the upscale engine" />
            <span className="mono">
              {progress?.step ?? 'Preparing'}
              {pct != null ? ` ${pct}%` : ''}
            </span>
          </>
        ) : (
          <>
            <SmallButton icon="pull" onClick={installEngine}>
              Set up upscale engine
            </SmallButton>
            {/* Browse is deliberately available BEFORE the engine exists:
                pointing at the folder is what makes discovery work. */}
            <SmallButton icon="folder" onClick={locateOnly}>
              {status.folder ? 'Change ComfyUI folder' : 'Locate my ComfyUI folder'}
            </SmallButton>
            {status.folder && (
              <span className="mono" title={status.folder}>
                {status.folder}
              </span>
            )}
          </>
        )}
        {errorLine}
      </Setting>
    )
  }

  if (busy === 'scan')
    return (
      <Setting title="ComfyUI models" desc="Scanning your models.">
        <ProgressBar wide value={null} label="Scanning your models" />
      </Setting>
    )

  return (
    <Setting
      title="ComfyUI models"
      desc={status.folder ? <code>{status.folder}</code> : 'Choose your ComfyUI folder.'}
    >
      <div className="vs-row">
        <SmallButton icon="folder" onClick={pickAndScan}>
          {status.folder ? 'Change folder' : 'Browse to ComfyUI folder'}
        </SmallButton>
        {status.folder && (
          <SmallButton icon="retry" onClick={() => scan(status.folder as string)}>
            Rescan
          </SmallButton>
        )}
      </div>
      {unsupported.length > 0 && (
        <>
          <div className="vs-d">
            {unsupported.length} file{unsupported.length === 1 ? '' : 's'} not usable
          </div>
          <ul className="sizes mono">
            {unsupported.map((m) => (
              <li key={m.path} title={m.reason}>
                <span className="nm">{m.name}</span>
                <span>{m.reason ?? 'unsupported'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {errorLine}
    </Setting>
  )
}
