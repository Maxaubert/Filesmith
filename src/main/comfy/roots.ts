import { existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { readComfyStore } from './store'

/**
 * The single source of truth for "where might ComfyUI be?".
 *
 * This list used to be copy-pasted in three places (discover.ts twice,
 * pythonEnv.ts once) and had already drifted between the copies — a folder name
 * added to one search was invisible to the other two, so the app could find a
 * user's models but not their Python, or vice versa. One list, used everywhere.
 *
 * Guessing is a convenience, never the contract: the folder the user picked
 * (`readComfyStore().folder`) always comes first and always wins.
 */

/** Folder names people actually install ComfyUI under. */
export const COMFY_DIR_NAMES = [
  'ComfyUI',
  'comfyui',
  'ComfyUI-Shared',
  'ComfyUI-Installs',
  'ComfyUI_windows_portable',
  'ComfyUI-Zluda',
  'StabilityMatrix'
]

function isDir(d: string): boolean {
  try {
    return existsSync(d) && statSync(d).isDirectory()
  } catch {
    return false
  }
}

/**
 * Drive roots that actually exist, rather than the hardcoded C:/D:/E:. A ComfyUI
 * on F: or a NAS letter was previously unreachable by discovery, and the folder
 * picker was gated behind a 3 GB download, so those users had no way in at all.
 */
function driveRoots(): string[] {
  if (process.platform !== 'win32') return ['/']
  const out: string[] = []
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const d = String.fromCharCode(c) + ':\\'
    if (isDir(d)) out.push(d)
  }
  return out
}

/**
 * Per-user roots, including the OneDrive-redirected Documents/Desktop that
 * `join(homedir(), 'Documents')` misses entirely on a machine with Known Folder
 * Move enabled (very common on Windows 11 with a Microsoft account).
 */
function userRoots(): string[] {
  const home = homedir()
  const out = [home, join(home, 'Desktop'), join(home, 'Documents'), join(home, 'Downloads')]
  const oneDrives = [
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    process.env.OneDriveCommercial,
    join(home, 'OneDrive')
  ].filter((p): p is string => Boolean(p))
  for (const od of new Set(oneDrives)) out.push(od, join(od, 'Desktop'), join(od, 'Documents'))
  return [...new Set(out)]
}

/** Every root worth probing for a ComfyUI folder, nearest-to-the-user first. */
export function comfySearchRoots(): string[] {
  return [...userRoots(), ...driveRoots()]
}

/** Roots only the user or an installer writes — no drive roots, no Downloads,
 * no Desktop. Used where discovery leads to EXECUTING what it finds. */
export function trustedRoots(): string[] {
  const home = homedir()
  return [home, join(home, 'Documents')].filter(Boolean)
}

/**
 * Candidate ComfyUI directories: the remembered folder first (it is the only one
 * that is not a guess), then every root x name combination. Order matters —
 * callers take the first match.
 *
 * `trusted: true` narrows discovery to locations only the user (or an installer)
 * writes: the folder they picked, their profile, and the two app-data roots. It
 * omits the drive roots, Downloads and Desktop.
 *
 * That distinction matters for one caller specifically. `icacls C:\` grants
 * `Authenticated Users:(AD)`, so a NON-elevated process can create `C:\ComfyUI\`
 * — and interpreter discovery ends in SPAWNING the python.exe it finds. Reading
 * a models folder from a wide net is fine; executing a binary found by one is
 * not. Now that the folder picker exists (Phase 2), a user whose ComfyUI lives
 * in an untrusted location can point at it explicitly, which is strictly better
 * than guessing on their behalf.
 */
export function comfyCandidateDirs(opts?: { trusted?: boolean }): string[] {
  const out: string[] = []
  const remembered = readComfyStore()?.folder
  if (remembered) out.push(remembered)
  const roots = opts?.trusted ? trustedRoots() : comfySearchRoots()
  for (const root of roots) for (const name of COMFY_DIR_NAMES) out.push(join(root, name))
  // ComfyUI Desktop (the official installer) keeps user data under %APPDATA% and
  // the app itself under %LOCALAPPDATA%\Programs.
  if (process.env.APPDATA) out.push(join(process.env.APPDATA, 'ComfyUI'))
  if (process.env.LOCALAPPDATA)
    out.push(join(process.env.LOCALAPPDATA, 'Programs', '@comfyorgcomfyui-electron'))
  return [...new Set(out)]
}

/**
 * Sub-paths under a candidate root where a ComfyUI tree may actually sit.
 * `resources/ComfyUI` and `resources/app/ComfyUI` are the ComfyUI **Desktop**
 * layouts: the installer puts its uv venv in the user's chosen base dir while
 * ComfyUI's own source lives inside the Electron app, so without these depths a
 * Desktop install was reported "not found" forever no matter what.
 */
export const COMFY_NEST_DEPTHS = [
  [],
  ['ComfyUI'],
  ['ComfyUI', 'ComfyUI'],
  ['resources', 'ComfyUI'],
  ['resources', 'app', 'ComfyUI']
]

/** Every nested location to check under one candidate root. */
export function comfyNestedDirs(root: string): string[] {
  return COMFY_NEST_DEPTHS.map((d) => (d.length ? join(root, ...d) : root))
}
