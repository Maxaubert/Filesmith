import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'

// Owner rule: no em-dashes anywhere in this work. Scans everything this change
// adds; a file that does not exist yet is simply skipped.
const ROOT = resolve(__dirname, '..')
const TARGETS = [
  'src/cli',
  'src/main/env.ts',
  'src/main/boot.ts',
  'src/main/atomicWrite.ts',
  'src/main/locks.ts',
  'src/main/recycle.ts',
  'src/main/uvInstall.ts',
  'src/main/skill.ts',
  'src/main/rembg',
  'src/main/tools/plan.ts',
  'src/main/tools/readiness.ts',
  'src/renderer/src/components/views/ClaudeSkill.tsx',
  'resources/cli',
  'resources/skill',
  'build/installer/path.nsh',
  'docs/cli.md',
  'docs/superpowers/plans/2026-10-04-cli-and-skill.md',
  'src/renderer/src/components/queue',
  'src/renderer/src/theme/viewsizes.css',
  'e2e/viewsizes.spec.ts',
  'docs/superpowers/specs/2026-10-05-view-sizes-design.md',
  'docs/superpowers/plans/2026-10-05-view-sizes.md'
]

function files(p: string): string[] {
  if (!existsSync(p)) return []
  if (statSync(p).isFile()) return [p]
  return readdirSync(p).flatMap((n) => files(join(p, n)))
}

describe('no em-dashes', () => {
  it('none of the new files contain U+2014', () => {
    const offenders = TARGETS.flatMap((t) => files(join(ROOT, t))).filter((f) =>
      readFileSync(f, 'utf-8').includes('\u2014')
    )
    expect(offenders).toEqual([])
  })
})
