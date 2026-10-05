import { useEffect, useState, type JSX } from 'react'
import type { SkillStatus } from '@shared/ipc'
import { SmallButton } from '../ui/Button'
import { Setting } from '../ui/Setting'

/** Settings > CLAUDE: install or update the Filesmith skill for Claude Code. */
export function ClaudeSkill(): JSX.Element {
  const [status, setStatus] = useState<SkillStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void window.filesmith.skillStatus().then((s) => alive && setStatus(s))
    return () => {
      alive = false
    }
  }, [])
  async function install(): Promise<void> {
    setBusy(true)
    setError(null)
    const r = await window.filesmith.installSkill()
    if (!r.ok) setError(r.error ?? 'The skill could not be installed.')
    setStatus(await window.filesmith.skillStatus())
    setBusy(false)
  }
  const desc =
    error ??
    (status == null
      ? 'Checking'
      : status.installed
        ? `Installed ${status.version}`
        : 'Not installed')
  return (
    <Setting title="Claude Code skill" desc={desc} warn={error != null}>
      <SmallButton onClick={() => void install()} disabled={busy}>
        {status?.installed && !status.current ? 'Update Claude skill' : 'Install Claude skill'}
      </SmallButton>
    </Setting>
  )
}
