import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { run } from './run'
import { userDataPath } from './env'
import { downloadFile } from './net/download'
import { expectedHash, recordHash } from './net/integrity'
import { resolveUv } from './toolResolver'

export interface InstallProgress {
  (step: string, pct: number | null): void
}

/** Cancel and byte-level progress for an install (spec 5.3). */
export interface InstallOpts {
  signal?: AbortSignal
  onBytes?: (got: number, total: number) => void
}

// PiD's pyproject requires a recent uv, and a stale system uv is worse than
// none: it is found first but cannot satisfy the floor. So a known-good uv is
// bootstrapped when the resolved one is missing or too old.
const UV_VERSION = '0.11.30'
const UV_MIN = [0, 11, 28] as const
const UV_ZIP = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`

/** Windows' bundled bsdtar, by full path: it handles >260-char paths, and a GNU
 * tar earlier on PATH (Git's) treats `C:\...` as a remote host. */
export function winTar(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

/** True when `uv --version` reports a version at or above UV_MIN. */
export async function uvVersionOk(uv: string): Promise<boolean> {
  try {
    const { code, stdout } = await run(uv, ['--version'])
    if (code !== 0) return false
    const m = /uv (\d+)\.(\d+)\.(\d+)/.exec(stdout)
    if (!m) return false
    const v = [Number(m[1]), Number(m[2]), Number(m[3])] as const
    for (let i = 0; i < 3; i += 1) {
      if (v[i] > UV_MIN[i]) return true
      if (v[i] < UV_MIN[i]) return false
    }
    return true
  } catch {
    return false
  }
}

/** A uv new enough for PiD and rembg: an installed one, else a pinned
 * standalone uv downloaded into %APPDATA%\Filesmith\uv. */
export async function ensureUv(
  onProgress: InstallProgress,
  opts: InstallOpts = {}
): Promise<string> {
  const found = resolveUv()
  if (found && (await uvVersionOk(found))) return found
  const uvDir = userDataPath('uv')
  const uvExe = join(uvDir, 'uv.exe')
  if (existsSync(uvExe) && (await uvVersionOk(uvExe))) return uvExe

  opts.signal?.throwIfAborted()
  onProgress('Downloading uv', null)
  mkdirSync(userDataPath(), { recursive: true })
  const uvTmp = mkdtempSync(join(userDataPath(), 'uv-'))
  try {
    const zip = join(uvTmp, 'uv.zip')
    const r = await downloadFile(UV_ZIP, zip, {
      onPct: (p) => onProgress('Downloading uv', p),
      sha256: expectedHash(UV_ZIP),
      signal: opts.signal,
      onBytes: opts.onBytes
    })
    recordHash(r.url, r.sha256, r.bytes)
    rmSync(uvDir, { recursive: true, force: true })
    mkdirSync(uvDir, { recursive: true })
    const ex = await run(winTar(), ['-xf', zip, '-C', uvDir], { signal: opts.signal })
    if (ex.code !== 0) throw new Error(`uv extract failed: ${ex.stderr.slice(-400)}`)
  } finally {
    rmSync(uvTmp, { recursive: true, force: true })
  }
  if (!existsSync(uvExe)) throw new Error('uv bootstrap failed (no uv.exe after extract)')
  return uvExe
}
