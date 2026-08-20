import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'

/**
 * A record of what every downloaded artifact actually hashed to.
 *
 * The registry carries a declared `sha256` where we know one, and that is always
 * authoritative. But most upstream model files publish no checksum we can ship,
 * and refusing to download without one would simply disable the feature. So the
 * first successful download of a URL records its hash here, and every LATER
 * fetch of that URL is verified against it. That is trust-on-first-use: it does
 * not protect the first download, but it does mean a re-download that silently
 * returns different bytes — a hijacked mirror, a captive portal, a repo whose
 * contents changed under a moving `resolve/main` branch — is caught and
 * discarded rather than overwriting a good file.
 *
 * It also gives the user something concrete: the ledger is a plain JSON file
 * they can read, and every entry names the host it came from.
 */

export interface IntegrityRecord {
  sha256: string
  bytes: number
  host: string
  /** ISO timestamp of the first time we saw these bytes. */
  firstSeen: string
}

type Ledger = Record<string, IntegrityRecord>

function ledgerPath(): string | null {
  try {
    return join(app.getPath('userData'), 'integrity.json')
  } catch {
    return null // outside an Electron runtime (tests)
  }
}

function read(): Ledger {
  const p = ledgerPath()
  if (!p || !existsSync(p)) return {}
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as Ledger
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {} // a corrupt ledger degrades to "no history", never to a crash
  }
}

function write(l: Ledger): void {
  const p = ledgerPath()
  if (!p) return
  try {
    mkdirSync(dirname(p), { recursive: true })
    // Write + rename so a crash mid-write can't leave a truncated ledger that
    // would then be read as "no history" for every artifact.
    const tmp = `${p}.part`
    writeFileSync(tmp, JSON.stringify(l, null, 2))
    renameSync(tmp, p)
  } catch {
    /* best effort — a read-only profile still downloads, just without history */
  }
}

/** The hash we expect for a URL: the declared one, else what we saw last time. */
export function expectedHash(url: string, declared?: string): string | undefined {
  if (declared) return declared
  return read()[url]?.sha256
}

/** Record a completed download. A declared hash was already verified upstream. */
export function recordHash(url: string, sha256: string, bytes: number): void {
  // A resumed transfer hashes only its tail and reports '' — recording that
  // would anchor future verifications to an empty string.
  if (!sha256) return
  const l = read()
  if (l[url]?.sha256 === sha256) return
  let host = url
  try {
    host = new URL(url).host
  } catch {
    /* keep the raw url */
  }
  l[url] = { sha256, bytes, host, firstSeen: new Date().toISOString() }
  write(l)
}

/** Everything we've recorded, for a provenance view. */
export function integrityLedger(): Ledger {
  return read()
}
