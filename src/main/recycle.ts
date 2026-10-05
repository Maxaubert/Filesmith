import { existsSync, readdirSync, statSync, statfsSync } from 'fs'
import { dirname, join } from 'path'
import { run } from './run'

/** Beyond this Windows deletes "to the Recycle Bin" permanently, so we refuse
 * instead (the owner's rule for deletes; spec 5.3, deviation D-e). */
export const RECYCLE_LIMIT = { bytes: 5 * 1024 ** 3, files: 5000 }

export function folderStats(path: string): { bytes: number; files: number } {
  const st = statSync(path)
  if (!st.isDirectory()) return { bytes: st.size, files: 1 }
  let bytes = 0
  let files = 0
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        files++
        try {
          bytes += statSync(p).size
        } catch {
          /* vanished */
        }
      }
    }
  }
  walk(path)
  return { bytes, files }
}

export function tooBigForRecycleBin(s: { bytes: number; files: number }): boolean {
  return s.bytes > RECYCLE_LIMIT.bytes || s.files > RECYCLE_LIMIT.files
}

/** Free bytes on the volume holding `path` (or its nearest existing parent). */
export function freeBytesAt(path: string): number | null {
  let p = path
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p)
  try {
    const st = statfsSync(p)
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return null
  }
}

/** Send a file or folder to the Recycle Bin through the shell's own API. The
 * path travels in an environment variable, never in the script text. */
export async function moveToRecycleBin(path: string): Promise<void> {
  const ps = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  // `if { } else { }` must stay on one statement: PowerShell rejects an `else`
  // after a `;`.
  const script = [
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    '$p = $env:FILESMITH_RECYCLE',
    "if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }"
  ].join('; ')
  const r = await run(
    ps,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env: { ...process.env, FILESMITH_RECYCLE: path }
    }
  )
  if (r.code !== 0 || existsSync(path))
    throw new Error(
      `Could not move ${path} to the Recycle Bin. ${r.stderr.trim().split('\n').pop() ?? ''}`.trim()
    )
}
