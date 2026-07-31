import { createPublicKey, verify } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { RegistryFile } from '@shared/registry'
import { ensureUserLayers, layerDir, reloadRegistry } from './load'

/**
 * Layer 2: the channel. A signed registry pack fetched from a URL we control.
 *
 * This is the remote lever, and it is the single most valuable thing in the
 * whole registry design. The day Comfy-Org moves
 * `t5xxl_fp8_e4m3fn_scaled.safetensors`, every existing install currently gets
 * `Download failed (404)` and a retry button, forever, until a new release ships.
 * With a channel, one JSON update fixes every install within a day — no release,
 * no signing ceremony, no download prompt.
 *
 * Rules, in order of importance:
 *  - NO SIGNATURE, NO TRUST. The pack is verified with Ed25519 against a public
 *    key compiled into the app before it is allowed anywhere near the registry.
 *    A failed check keeps the previous cache untouched.
 *  - Offline is a first-class state, not an error. Any failure — network down,
 *    bad signature, malformed JSON — silently keeps what we already have. The
 *    app runs on layers 1 + 3 and nothing is degraded relative to before.
 *  - Layer 2 is a CACHE. It is replaced wholesale, never merged into, and the
 *    user's layer 3 always wins over it.
 *  - At most one check a day, in the background, never blocking startup.
 */

/**
 * The channel signing key, as a base64 raw Ed25519 public key (32 bytes).
 *
 * EMPTY BY DEFAULT, which disables the channel entirely. That is deliberate: a
 * channel with no key would either have to trust unsigned content or pretend to
 * verify, and both are worse than not having the feature. Publishing a channel
 * means generating a keypair, putting the public half here, and serving a signed
 * pack at CHANNEL_URL. Until then this code is inert and costs nothing.
 */
const CHANNEL_PUBLIC_KEY_B64 = ''

/** Where signed packs are published. Overridable for testing a staging channel. */
const CHANNEL_URL = process.env.FILESMITH_CHANNEL_URL ?? ''

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** The signed envelope served by the channel. */
interface SignedPack {
  /** base64 Ed25519 signature over the exact bytes of `payload`. */
  signature: string
  /** The registry pack, as a JSON STRING — signing the serialized form avoids
   * every canonicalization problem that signing an object would create. */
  payload: string
}

export function channelEnabled(): boolean {
  return CHANNEL_PUBLIC_KEY_B64.length > 0 && CHANNEL_URL.length > 0
}

function stampPath(): string | null {
  try {
    return join(app.getPath('userData'), 'registry', 'channel', '.last-check')
  } catch {
    return null
  }
}

function dueForCheck(): boolean {
  const p = stampPath()
  if (!p) return false
  try {
    if (!existsSync(p)) return true
    const last = Number(readFileSync(p, 'utf-8').trim())
    return !Number.isFinite(last) || Date.now() - last > CHECK_INTERVAL_MS
  } catch {
    return true
  }
}

function stampChecked(): void {
  const p = stampPath()
  if (!p) return
  try {
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, String(Date.now()))
  } catch {
    /* best effort */
  }
}

/** Verify an Ed25519 signature over the payload bytes. Pure given the key. */
export function verifyPack(pack: SignedPack, publicKeyB64: string): boolean {
  if (!publicKeyB64) return false
  try {
    const key = createPublicKey({
      // Wrap the 32 raw bytes in the fixed SPKI prefix for Ed25519, so the key
      // can be published as plain base64 rather than as a PEM blob.
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKeyB64, 'base64')
      ]),
      format: 'der',
      type: 'spki'
    })
    return verify(null, Buffer.from(pack.payload, 'utf-8'), key, Buffer.from(pack.signature, 'base64'))
  } catch {
    return false
  }
}

/**
 * Fetch, verify and install a channel pack. Returns what happened; never throws.
 * `force` skips the once-a-day gate (for a manual "check now").
 */
export async function refreshChannel(force = false): Promise<{
  updated: boolean
  reason: string
}> {
  if (!channelEnabled()) return { updated: false, reason: 'channel not configured' }
  if (!force && !dueForCheck()) return { updated: false, reason: 'checked recently' }

  const dir = layerDir('channel')
  if (!dir) return { updated: false, reason: 'no writable data folder' }

  try {
    const { net } = await import('electron')
    const res = await net.fetch(CHANNEL_URL, { signal: AbortSignal.timeout(15_000) })
    stampChecked()
    if (!res.ok) return { updated: false, reason: `channel returned ${res.status}` }
    const pack = (await res.json()) as SignedPack
    if (!pack?.payload || !pack?.signature)
      return { updated: false, reason: 'channel response is not a signed pack' }
    // Verify BEFORE parsing the payload as a registry, and before touching disk.
    if (!verifyPack(pack, CHANNEL_PUBLIC_KEY_B64))
      return { updated: false, reason: 'signature did not verify — keeping the cached registry' }

    const parsed = JSON.parse(pack.payload) as RegistryFile
    if (!parsed || !Array.isArray(parsed.entries))
      return { updated: false, reason: 'signed payload is not a registry pack' }

    // Replace the cache wholesale. Write + rename so an interrupted refresh
    // can't leave a half-written pack that the loader would then reject.
    ensureUserLayers()
    const dest = join(dir, 'channel.json')
    const tmp = `${dest}.part`
    writeFileSync(tmp, pack.payload)
    rmSync(dest, { force: true })
    renameSync(tmp, dest)
    reloadRegistry()
    return { updated: true, reason: `${parsed.entries.length} entries` }
  } catch (e) {
    stampChecked()
    // Offline is not an error. Keep the cache and carry on.
    return { updated: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Kick off a background refresh. Never awaited by startup. */
export function scheduleChannelRefresh(): void {
  if (!channelEnabled()) return
  setTimeout(() => {
    void refreshChannel().then((r) => {
      if (r.updated) console.log('[registry] channel updated:', r.reason)
    })
  }, 5_000).unref?.()
}
