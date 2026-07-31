// @ts-check
/**
 * The channel publisher: generate a signing keypair, and sign a registry pack.
 *
 * Why this exists: every model download URL points into someone else's Hugging
 * Face repo. When one is reorganized, every installed copy of Filesmith gets a
 * 404 and stays broken until a new release ships. The channel is the lever that
 * fixes that without a release — you publish a signed JSON, and every install
 * picks it up within a day.
 *
 * The app ships with NO key, which disables the channel entirely. That is the
 * safe default: an unsigned channel would mean trusting whatever the network
 * hands back, and a registry entry can name files to download.
 *
 *   node scripts/registry-channel.mjs keygen
 *       Writes channel-private.pem (KEEP IT SECRET, it is gitignored) and
 *       prints the public key to paste into CHANNEL_PUBLIC_KEY_B64.
 *
 *   node scripts/registry-channel.mjs sign resources/registry/gen-archs.json
 *       Writes channel.json — the signed pack to publish at CHANNEL_URL.
 *
 *   node scripts/registry-channel.mjs verify channel.json <publicKeyB64>
 *       Checks a published pack the way the app will.
 */
import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const KEY = join(ROOT, 'channel-private.pem')
const OUT = join(ROOT, 'channel.json')
const log = (...a) => console.log(...a)

/** The 32 raw bytes of an Ed25519 public key, base64 — what the app embeds. */
function rawPublic(publicKey) {
  return publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
}

const [cmd, ...rest] = process.argv.slice(2)

if (cmd === 'keygen') {
  if (existsSync(KEY)) {
    log(`❌ ${KEY} already exists. Delete it first if you really mean to rotate the key.`)
    log('   Rotating invalidates every pack signed with the old one.')
    process.exit(1)
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(KEY, privateKey.export({ format: 'pem', type: 'pkcs8' }))
  log(`✓ private key written to ${KEY}`)
  log('  It is gitignored. Back it up somewhere safe — losing it means you can')
  log('  never publish another update that existing installs will accept.\n')
  log('  Paste this into CHANNEL_PUBLIC_KEY_B64 in src/main/registry/channel.ts:\n')
  log(`  const CHANNEL_PUBLIC_KEY_B64 = '${rawPublic(publicKey)}'\n`)
} else if (cmd === 'sign') {
  const src = rest[0]
  if (!src || !existsSync(src)) {
    log('usage: node scripts/registry-channel.mjs sign <pack.json>')
    process.exit(1)
  }
  if (!existsSync(KEY)) {
    log(`❌ no signing key at ${KEY}. Run: node scripts/registry-channel.mjs keygen`)
    process.exit(1)
  }
  // Sign the SERIALIZED bytes, not the object: signing an object would need a
  // canonical form both sides agree on, and every such scheme has sharp edges.
  const parsed = JSON.parse(readFileSync(src, 'utf-8'))
  if (!Array.isArray(parsed.entries)) {
    log(`❌ ${src} has no "entries" array — that is not a registry pack.`)
    process.exit(1)
  }
  const payload = JSON.stringify(parsed)
  const privateKey = createPrivateKey(readFileSync(KEY))
  const signature = sign(null, Buffer.from(payload, 'utf-8'), privateKey).toString('base64')
  writeFileSync(OUT, JSON.stringify({ signature, payload }, null, 2) + '\n')
  log(`✓ signed ${parsed.entries.length} entries -> ${OUT}`)
  log('  Publish that file at the URL the app checks (FILESMITH_CHANNEL_URL).')
} else if (cmd === 'verify') {
  const [file, pub] = rest
  if (!file || !pub) {
    log('usage: node scripts/registry-channel.mjs verify <channel.json> <publicKeyB64>')
    process.exit(1)
  }
  const pack = JSON.parse(readFileSync(file, 'utf-8'))
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub, 'base64')]),
    format: 'der',
    type: 'spki'
  })
  const ok = verify(
    null,
    Buffer.from(pack.payload, 'utf-8'),
    key,
    Buffer.from(pack.signature, 'base64')
  )
  log(ok ? '✓ signature verifies' : '❌ signature does NOT verify')
  process.exit(ok ? 0 : 1)
} else {
  log('usage:')
  log('  node scripts/registry-channel.mjs keygen')
  log('  node scripts/registry-channel.mjs sign <pack.json>')
  log('  node scripts/registry-channel.mjs verify <channel.json> <publicKeyB64>')
  process.exit(1)
}
