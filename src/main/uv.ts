import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { run } from './run'
import { pidRoot } from './pid/paths'

/**
 * Finding uv, in one place.
 *
 * `toolResolver.resolveUv()` documented itself as checking "winget's package
 * dir, the standard user install, or PATH" and then checked three fixed paths
 * and returned null — there was no PATH probe anywhere in the codebase. Worse,
 * `pid/install.ts` ALREADY downloads a pinned standalone uv into
 * `<pidRoot>/uv/uv.exe` when the lookup fails, and the lookup never checked that
 * location. So a user who had just sat through a ~6 GB PiD install was still
 * told "Background removal needs uv... winget install astral-sh.uv".
 *
 * The winget path was also hardcoded down to the package family hash, which
 * changes if the package is republished.
 */

const EXE = process.platform === 'win32' ? '.exe' : ''

/** winget package dirs matching `astral-sh.uv_*`, enumerated rather than
 * hardcoded to one family hash. */
function wingetCandidates(): string[] {
  const root = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages')
  try {
    return readdirSync(root)
      .filter((d) => d.toLowerCase().startsWith('astral-sh.uv'))
      .map((d) => join(root, d, 'uv' + EXE))
  } catch {
    return []
  }
}

/** Every place a uv might be, best-first. */
export function uvCandidates(): string[] {
  const out: string[] = []
  // The one WE downloaded — checked first, because if it exists it is the one we
  // know satisfies PiD's version floor. pidRoot() needs Electron, so a missing
  // runtime (tests) simply skips this candidate rather than throwing.
  try {
    out.push(join(pidRoot(), 'uv', 'uv' + EXE))
  } catch {
    /* no Electron */
  }
  out.push(...wingetCandidates())
  if (process.env.USERPROFILE) out.push(join(process.env.USERPROFILE, '.local', 'bin', 'uv' + EXE))
  if (process.env.LOCALAPPDATA)
    out.push(join(process.env.LOCALAPPDATA, 'Programs', 'uv', 'uv' + EXE))
  return out
}

let pathProbe: { found: boolean } | null = null

/** A uv on PATH, probed once per session (a spawn is not free). */
export async function uvOnPath(): Promise<boolean> {
  if (pathProbe) return pathProbe.found
  try {
    const { code } = await run('uv', ['--version'])
    pathProbe = { found: code === 0 }
  } catch {
    pathProbe = { found: false }
  }
  return pathProbe.found
}

/** A uv path, or null. Synchronous — filesystem candidates only. */
export function findUv(): string | null {
  return uvCandidates().find((p) => existsSync(p)) ?? null
}

/** A uv path or the bare name if one answers on PATH; null if there is none. */
export async function findUvAsync(): Promise<string | null> {
  const local = findUv()
  if (local) return local
  return (await uvOnPath()) ? 'uv' : null
}
