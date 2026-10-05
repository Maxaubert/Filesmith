import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SkillStatus } from '@shared/ipc'
import { resourcePath } from './env'

/** The files the installer owns; anything else in the folder is left alone. */
export const SKILL_FILES = ['SKILL.md', 'reference.md'] as const

export function skillTargetDir(home: string): string {
  return join(home, '.claude', 'skills', 'filesmith')
}

export function skillSourceDir(): string {
  return resourcePath('skill', 'filesmith')
}

/** What the skill tells an agent to run when `filesmith` is not on PATH yet:
 * the sh shim (Claude Code's Bash tool is Git Bash), forward slashes. */
export function skillCommand(packaged: boolean, resourcesDir: string): string {
  const fwd = (p: string): string => p.replace(/\\/g, '/')
  return packaged
    ? fwd(join(resourcesDir, 'cli', 'filesmith'))
    : `node ${fwd(join(resourcesDir, '..', 'out', 'main', 'cli.js'))}`
}

export function renderSkillFile(text: string, version: string, command: string): string {
  return text.replaceAll('{{VERSION}}', version).replaceAll('{{FILESMITH}}', command)
}

function installedVersion(dir: string): string | null {
  try {
    return (
      /^\s*filesmith-version:\s*(\S+)/m.exec(readFileSync(join(dir, 'SKILL.md'), 'utf-8'))?.[1] ??
      null
    )
  } catch {
    return null
  }
}

export function skillStatus(home: string, version: string): SkillStatus {
  const path = skillTargetDir(home)
  const v = installedVersion(path)
  return { installed: v != null, path, version: v, current: v === version }
}

export interface SkillInstallOutcome {
  path: string
  updated: boolean
  previousVersion?: string
  /** Files that were (or, in a dry run, would be) written. */
  changed: string[]
}

/** Copy the bundled skill into ~/.claude/skills/filesmith (spec 6.3). Shared by
 * `filesmith skill install` and the Settings button; `trash` is the host's
 * Recycle Bin call, used for a file that is being replaced. */
export async function installSkill(e: {
  home: string
  version: string
  command: string
  sourceDir?: string
  trash(path: string): Promise<void>
  dryRun?: boolean
}): Promise<SkillInstallOutcome> {
  const src = e.sourceDir ?? skillSourceDir()
  const dest = skillTargetDir(e.home)
  const previous = installedVersion(dest)
  const files = SKILL_FILES.map((name) => ({
    name,
    text: renderSkillFile(readFileSync(join(src, name), 'utf-8'), e.version, e.command)
  }))
  const changed = files
    .filter((f) => {
      try {
        return readFileSync(join(dest, f.name), 'utf-8') !== f.text
      } catch {
        return true
      }
    })
    .map((f) => f.name)
  if (!e.dryRun) {
    mkdirSync(dest, { recursive: true })
    for (const f of files) {
      if (!changed.includes(f.name)) continue
      const target = join(dest, f.name)
      if (existsSync(target)) await e.trash(target)
      writeFileSync(target, f.text)
    }
  }
  return {
    path: dest,
    updated: previous != null,
    ...(previous ? { previousVersion: previous } : {}),
    changed
  }
}
