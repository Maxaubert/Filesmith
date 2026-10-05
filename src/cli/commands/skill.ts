import type { SkillStatus } from '@shared/ipc'
import type { SkillInstallOutcome } from '../../main/skill'
import type { CommandSpec } from '../catalog'
import type { Reporter } from '../events'
import type { ParsedArgs } from '../parse'
import { VERSION } from '../version'

export interface SkillDeps {
  install(o: { dryRun: boolean }): Promise<SkillInstallOutcome>
  status(): SkillStatus
  sourceDir(): string
}

export async function runSkill(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SkillDeps,
  clock: () => number
): Promise<number> {
  const t0 = clock()
  const cmd = args.command as CommandSpec
  if (cmd.id === 'skill status') {
    const s = deps.status()
    reporter.emit({
      event: 'check',
      id: 'skill',
      group: 'skill',
      status: s.installed && s.current ? 'ok' : 'warn',
      detail: s.installed
        ? `${s.version} at ${s.path}${s.current ? '' : `, the app is ${VERSION}`}`
        : 'not installed',
      fix: s.installed && s.current ? undefined : 'filesmith skill install'
    })
    return 0
  }
  reporter.emit({
    event: 'run',
    command: 'skill install',
    version: VERSION,
    dryRun: args.dryRun,
    inputs: 0,
    options: {}
  })
  const r = await deps.install({ dryRun: args.dryRun })
  if (args.dryRun) {
    reporter.emit({ event: 'step', step: 'From', pct: null, detail: deps.sourceDir() })
    reporter.emit({ event: 'step', step: 'To', pct: null, detail: r.path })
    reporter.emit({
      event: 'step',
      step: 'Would write',
      pct: null,
      detail: r.changed.length ? r.changed.join(', ') : 'nothing, already current'
    })
  } else {
    reporter.emit({
      event: 'done',
      path: r.path,
      updated: r.updated,
      previousVersion: r.previousVersion
    })
  }
  reporter.emit({
    event: 'summary',
    ok: 1,
    failed: 0,
    skipped: 0,
    canceled: 0,
    inBytes: 0,
    outBytes: 0,
    ms: clock() - t0,
    exitCode: 0
  })
  return 0
}
