import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { downloadFile } from '../net/download'
import { expectedHash, recordHash } from '../net/integrity'
import { checkDiskSpace } from '../pid/install'
import { findGenerationModel, primaryModelsDir } from './models'

/** Parse an approxSize like "8 GB" / "335 MB" into bytes (0 if unparseable). */
function approxBytes(s: string): number {
  const m = /([\d.]+)\s*(gb|mb|kb|b)/i.exec(s)
  if (!m) return 0
  const n = parseFloat(m[1])
  const unit = m[2].toLowerCase()
  const mult = unit === 'gb' ? 1e9 : unit === 'mb' ? 1e6 : unit === 'kb' ? 1e3 : 1
  return Math.round(n * mult)
}

// Fetch the text-encoder / VAE files a recognized model needs but the user
// doesn't have yet, into their ComfyUI models tree. This is the "works for
// anyone" path: a model whose architecture we support but whose companions are
// absent becomes runnable after a one-click download, rather than a dead end.

export interface CompanionProgress {
  /** 1-based index of the file being fetched, and how many total. */
  index: number
  total: number
  label: string
  filename: string
  /** 0-100, or null while connecting. */
  pct: number | null
}

/**
 * Download every missing companion for `modelName`. Skips files already present
 * (idempotent / resumable across runs). Throws if the model is unknown, already
 * complete, or no ComfyUI models dir can be located.
 */
export async function downloadCompanions(
  modelName: string,
  onProgress: (p: CompanionProgress) => void
): Promise<void> {
  const model = findGenerationModel(modelName)
  if (!model) throw new Error('That model was not found. Try rescanning.')
  const missing = model.missing ?? []
  if (!missing.length) throw new Error('This model already has everything it needs.')

  // Download into the SAME models tree the model lives under, so the ComfyUI that
  // loads the model also sees its new encoders/VAE (multi-install machines).
  const root = primaryModelsDir(model.baseDir)
  if (!root) throw new Error('Could not find your ComfyUI models folder to download into.')

  // Refuse before a multi-GB download that cannot fit — measured on the volume
  // the companions actually land on (the ComfyUI tree), not pidRoot's. ENOSPC
  // otherwise surfaces gigabytes in, as a raw stream error.
  const needed = missing.reduce((a, f) => a + (f.bytes ?? approxBytes(f.approxSize)), 0)
  const space = checkDiskSpace(needed, root)
  if (!space.ok) throw new Error(space.reason)

  const total = missing.length
  for (let i = 0; i < missing.length; i += 1) {
    const f = missing[i]
    const dest = join(root, f.subdir, f.filename)
    // Skip a companion already fetched. "Complete" means matching the declared
    // byte size when the registry knows it, not merely non-empty: a file some
    // other tool is mid-write (or a stale copy of a corrected upstream file)
    // must not read as done forever.
    try {
      const st = existsSync(dest) ? statSync(dest) : null
      if (st && st.size > 0 && (f.bytes == null || st.size === f.bytes)) {
        onProgress({ index: i + 1, total, label: f.label, filename: f.filename, pct: 100 })
        continue
      }
    } catch {
      /* fall through to download */
    }
    onProgress({ index: i + 1, total, label: f.label, filename: f.filename, pct: null })
    // Require at least half the advertised size so a truncated body / error page
    // isn't cached as a "complete" companion that then poisons every rescan.
    const minBytes = Math.floor(approxBytes(f.approxSize) * 0.5)
    const urls = f.urls?.length ? f.urls : [f.url]
    // Verify against the declared checksum when the registry has one, else
    // against whatever this URL gave us last time (trust-on-first-use), so a
    // re-download that quietly returns different bytes is discarded instead of
    // overwriting a good file.
    const sha256 = expectedHash(urls[0], f.sha256)
    const result = await downloadFile(urls, dest, {
      onPct: (pct) =>
        onProgress({ index: i + 1, total, label: f.label, filename: f.filename, pct }),
      minBytes: minBytes || undefined,
      sha256
    })
    recordHash(result.url, result.sha256, result.bytes)
  }
}
