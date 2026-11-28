import * as fs from 'fs'
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

/**
 * Drive roots that actually exist, rather than the hardcoded C:/D:/E:. A ComfyUI
 * on F: or a NAS letter was previously unreachable by discovery, and the folder
 * picker was gated behind a 3 GB download, so those users had no way in at all.
 *
 * Probing is NOT synchronous. The status IPC handlers call this on the Electron
 * main thread, and a sync stat of a mapped drive whose NAS is offline blocks for
 * many seconds, so the old C: to Z: loop froze the app on every Generate refresh.
 * Instead:
 * - The first call starts one async probe (fs.promises.stat per letter, each
 *   raced against DRIVE_PROBE_TIMEOUT_MS) and returns at once. A stat that has
 *   finished but is not delivered yet (blocked main thread) does not time out.
 * - Until that probe finishes, the answer is the system drive only (no fs call).
 *   The user's picked folder always comes first in comfyCandidateDirs, so this
 *   guess never hides a ComfyUI the user chose.
 * - The result is cached and refreshed at most every DRIVE_REFRESH_MS; during a
 *   refresh the previous list is returned.
 * - A letter that timed out is skipped while its stat is still pending, since each
 *   hung stat holds a libuv pool thread. When that late stat settles the letter
 *   is probed again on the next refresh (a disk that spun up, a share that
 *   reconnected), and a late success makes the cached list stale at once.
 * - Async entry points (the CLI, the status IPC handlers) await
 *   ensureDriveRoots() first, so their first scan already sees every drive.
 */
const DRIVE_PROBE_TIMEOUT_MS = 1500
const DRIVE_REFRESH_MS = 5 * 60_000

let driveCache: string[] | null = null
let driveProbedAt = 0
let driveProbe: Promise<string[]> | null = null
const hungDrives = new Set<string>()

/** Forget the cached drive list (for tests). */
export function resetDriveRootsCache(): void {
  driveCache = null
  driveProbedAt = 0
  driveProbe = null
  hungDrives.clear()
}

/** The system drive as `X:\`, without touching the filesystem. */
function systemDriveRoot(): string {
  const from = [process.env.SystemDrive ?? '', homedir()].find((p) => /^[A-Za-z]:/.test(p))
  return (from ? from[0] : 'C').toUpperCase() + ':\\'
}

/** One drive letter: true if it is a directory, false if absent, unreadable or slow. */
function probeDrive(d: string): Promise<boolean> {
  return new Promise((done) => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(ok)
    }
    // After a blocked main thread, an expired timer runs before the loop has
    // delivered stat results that are already complete. So give I/O one turn
    // (setImmediate runs after the poll phase) before calling the drive hung.
    const timer = setTimeout(() => {
      setImmediate(() => {
        if (settled) return
        hungDrives.add(d)
        finish(false)
      })
    }, DRIVE_PROBE_TIMEOUT_MS)
    timer.unref?.()
    // A stat that settles after the timeout frees its pool thread, so the
    // letter may be probed again. A late success also marks the cache stale,
    // so the next driveRoots() call starts a refresh that picks the drive up.
    const late = (ok: boolean): void => {
      if (!hungDrives.delete(d)) return
      if (ok) driveProbedAt = 0
    }
    fs.promises.stat(d).then(
      (st) => (settled ? late(st.isDirectory()) : finish(st.isDirectory())),
      () => (settled ? late(false) : finish(false))
    )
  })
}

/**
 * Start (or join) the async drive probe. Resolves with the fresh list, which is
 * also cached for driveRoots(). Exported so tests and callers that can wait may.
 */
export function probeDriveRoots(): Promise<string[]> {
  if (driveProbe) return driveProbe
  const letters: string[] = []
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const d = String.fromCharCode(c) + ':\\'
    if (!hungDrives.has(d)) letters.push(d)
  }
  const probe = Promise.all(letters.map(probeDrive)).then((ok) => {
    const found = letters.filter((_, i) => ok[i])
    if (driveProbe === probe) {
      driveCache = found
      driveProbedAt = Date.now()
      driveProbe = null
    }
    return found
  })
  driveProbe = probe
  return probe
}

/**
 * For callers that can wait: on the first call, wait for the drive probe
 * (bounded by DRIVE_PROBE_TIMEOUT_MS), so the first scan is not limited to the
 * system drive. Later calls return at once; a stale list refreshes in the
 * background as before.
 */
export async function ensureDriveRoots(): Promise<void> {
  if (process.platform !== 'win32' || driveCache !== null) return
  await probeDriveRoots()
}

function driveRoots(): string[] {
  if (process.platform !== 'win32') return ['/']
  const stale = driveCache === null || Date.now() - driveProbedAt > DRIVE_REFRESH_MS
  if (stale && !driveProbe) void probeDriveRoots()
  return driveCache ?? [systemDriveRoot()]
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
