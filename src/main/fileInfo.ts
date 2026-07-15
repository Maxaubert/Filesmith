import { statSync } from 'fs'
import { basename, extname } from 'path'
import { fileKind } from '@shared/fileKind'
import type { FileInfo } from '@shared/types'

/** Build a FileInfo from an absolute path (size best-effort). */
export function fileInfoFromPath(p: string): FileInfo {
  const ext = extname(p).toLowerCase()
  let size = 0
  try {
    size = statSync(p).size
  } catch {
    // file may have moved/been deleted; size stays 0
  }
  return { path: p, name: basename(p), ext, kind: fileKind(ext), size }
}
