import { useCallback, useEffect, useState, type JSX } from 'react'
import { Icon } from '../../icons/Icon'
import { SmallButton } from '../../ui/Button'
import { ProgressBar } from '../../ui/ProgressBar'
import { Setting } from '../../ui/Setting'

// The PiD (NVIDIA) upscaler tier is an on-demand engine: a multi-GB download the
// user opts into, gated behind an NVIDIA GPU. The GPU and install-state probe
// lives beside it in hooks/usePidStatus.

/**
 * First-use install for the PiD engine. Shown when PiD is selected but not yet
 * installed. Leads with the licence reality (NVIDIA's weights are non-commercial)
 * because that is the one thing a user cannot undo by uninstalling, then a single
 * download button that streams step and percent while it runs.
 */
export function PidInstallCard({ onInstalled }: { onInstalled: () => void }): JSX.Element {
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<{ step: string; pct: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Subscribe once; the main process streams 'pid:progress' during install.
  useEffect(() => window.filesmith.onPidProgress(setProgress), [])

  const install = useCallback((): void => {
    setInstalling(true)
    setError(null)
    setProgress(null)
    void window.filesmith.pidInstall().then((r) => {
      setInstalling(false)
      if (r.ok) onInstalled()
      else setError(r.error ?? 'Install failed')
    })
  }, [onInstalled])

  const pct = progress?.pct ?? null
  return (
    <Setting title="PiD engine" desc="About 6 GB, downloaded once. Non-commercial use only.">
      {installing ? (
        <>
          <ProgressBar wide value={pct} label="Installing PiD" />
          <span className="mono">
            {progress?.step ?? 'Preparing'}
            {pct != null ? ` ${pct}%` : ''}
          </span>
        </>
      ) : (
        <SmallButton icon="pull" onClick={install}>
          Download PiD (about 6 GB)
        </SmallButton>
      )}
      {error && (
        <div className="vs-d warn" role="alert">
          <Icon name="warning" size={12} />
          {error}
        </div>
      )}
    </Setting>
  )
}

/** Remove the PiD install (repair path). Two clicks: the first arms it, so an
 * accidental click cannot cost a 6 GB re-download. */
export function PidRemoveButton({ onRemoved }: { onRemoved: () => void }): JSX.Element {
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = (): void => {
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    void window.filesmith.pidInstalling().then((busy) => {
      if (busy) {
        setError('An install is running. Wait for it to finish first.')
        return
      }
      void window.filesmith.pidRemove().then((r) => {
        if (!r.ok) setError(r.error ?? 'Could not remove the install.')
        else {
          setError(null)
          onRemoved()
        }
      })
    })
  }
  return (
    <Setting title="PiD install" desc="Remove it to repair a broken install or free about 6 GB.">
      <SmallButton icon="trash" onClick={remove} onBlur={() => setArmed(false)}>
        {armed ? 'Click again to remove PiD' : 'Remove PiD install'}
      </SmallButton>
      {error && (
        <div className="vs-d warn" role="alert">
          <Icon name="warning" size={12} />
          {error}
        </div>
      )}
    </Setting>
  )
}
