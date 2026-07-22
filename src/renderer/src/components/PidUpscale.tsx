import { useCallback, useEffect, useState, type JSX } from 'react'

// The PiD (NVIDIA) upscaler tier is an on-demand engine: a multi-GB download the
// user opts into, gated behind an NVIDIA GPU. The first-use install card here
// carries that flow (licence notice + one-click download + progress); the GPU /
// install-state probe lives beside it in usePidStatus.

/**
 * First-use install for the PiD engine. Shown when PiD is selected but not yet
 * installed. Leads with the licence reality (NVIDIA's weights are non-commercial)
 * because that's the one thing a user can't undo by uninstalling, then a single
 * download button that streams step + percent while it runs.
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
    <div className="space-y-3 rounded-xl border border-black/[.10] bg-white p-3.5">
      <p className="text-[12.5px] leading-relaxed text-muted">
        PiD is NVIDIA&apos;s diffusion upscaler. Its model weights are licensed for
        <span className="font-semibold text-ink"> non-commercial use only</span>. A one-time
        <span className="font-semibold text-ink"> ~6 GB</span> download sets it up.
      </p>

      {installing ? (
        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-[#ececf2]">
            {pct == null ? (
              // Indeterminate: a step is running with no byte-count (env build, extract).
              <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
            ) : (
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] text-dim">
            <span className="truncate">{progress?.step ?? 'Preparing…'}</span>
            {pct != null && <span className="shrink-0 font-mono">{pct}%</span>}
          </div>
        </div>
      ) : (
        <button
          onClick={install}
          className="w-full rounded-xl bg-accent py-2.5 text-[13px] font-semibold text-white transition hover:bg-accent-hi"
        >
          Download PiD (~6 GB)
        </button>
      )}

      {error && <p className="text-[11.5px] text-[#e0483d]">{error}</p>}
    </div>
  )
}
