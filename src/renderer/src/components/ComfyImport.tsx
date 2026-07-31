import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ComfyModel } from '@shared/comfy'
import type { ComfyStatus } from './useComfyModels'

// The "Import from ComfyUI" flow, shown under the Upscale model picker when an
// NVIDIA GPU is present. Three states: engine not built (one-time env setup),
// engine ready but no folder chosen (browse), and folder chosen (rescan / change
// + an optional "not usable" disclosure for files spandrel couldn't load).

function ProgressBar({ pct, step }: { pct: number | null; step: string }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-[#ececf2]">
        {pct == null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] text-dim">
        <span className="truncate">{step}</span>
        {pct != null && <span className="shrink-0 font-mono">{pct}%</span>}
      </div>
    </div>
  )
}

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

  // Record the folder without a scan: the scan needs the engine we don't have
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

  return (
    <div className="space-y-3 rounded-xl border border-black/[.10] bg-white p-3.5">
      {!status.engineReady ? (
        <>
          {/* The download size is the one thing the buttons can't say. */}
          <p className="text-[12.5px] text-muted">
            Use your own ComfyUI upscale models.{' '}
            {status.envExists ? (
              <>Quick one-time setup.</>
            ) : (
              <>
                One-time setup: <span className="font-semibold text-ink">~3 GB</span>, shared with
                PiD.
              </>
            )}
          </p>
          {busy === 'install' ? (
            <ProgressBar pct={progress?.pct ?? null} step={progress?.step ?? 'Preparing…'} />
          ) : (
            <div className="space-y-2">
              <button
                onClick={installEngine}
                className="w-full rounded-xl bg-accent py-2.5 text-[13px] font-semibold text-white transition hover:bg-accent-hi"
              >
                Set up upscale engine
              </button>
              {/* Browse is deliberately available BEFORE the engine exists. It
                  used to render only when engineReady, and engineReady depends
                  on finding a ComfyUI Python — so a user whose ComfyUI was not
                  in the guessed paths had to download 3 GB before the app would
                  let them point at the ComfyUI they already had. Pointing at the
                  folder is what makes discovery work, so it has to come first. */}
              <button
                onClick={locateOnly}
                className="w-full rounded-xl border border-black/[.12] bg-white py-2.5 text-[13px] font-semibold text-ink transition hover:border-[#b9b9c8]"
              >
                {status.folder ? 'Change ComfyUI folder' : 'I already have ComfyUI — locate it'}
              </button>
              {status.folder && (
                <p className="truncate text-[11.5px] text-dim" title={status.folder}>
                  Using {status.folder}
                </p>
              )}
            </div>
          )}
        </>
      ) : busy === 'scan' ? (
        <ProgressBar pct={null} step="Scanning your models…" />
      ) : (
        <>
          {status.folder && (
            <p className="truncate text-[11.5px] text-dim" title={status.folder}>
              From {status.folder}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={pickAndScan}
              className="flex-1 rounded-xl bg-accent py-2.5 text-[13px] font-semibold text-white transition hover:bg-accent-hi"
            >
              {status.folder ? 'Change folder' : 'Browse to ComfyUI folder'}
            </button>
            {status.folder && (
              <button
                onClick={() => scan(status.folder as string)}
                className="rounded-xl border border-black/[.12] bg-white px-3.5 py-2.5 text-[13px] font-semibold text-ink transition hover:border-[#b9b9c8]"
              >
                Rescan
              </button>
            )}
          </div>
          {unsupported.length > 0 && (
            <details className="text-[11.5px] text-dim">
              <summary className="cursor-pointer select-none">
                {unsupported.length} file{unsupported.length === 1 ? '' : 's'} not usable
              </summary>
              <ul className="mt-1.5 space-y-1">
                {unsupported.map((m) => (
                  <li key={m.path} className="truncate" title={m.reason}>
                    {m.name} — {m.reason ?? 'unsupported'}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {error && <p className="text-[11.5px] text-[#e0483d]">{error}</p>}
    </div>
  )
}
