// @ts-check
/**
 * Fill in real sha256 checksums for every download in the shipped registry, and
 * pin each URL to an immutable commit revision.
 *
 * Hugging Face keeps large files in git-LFS, and an LFS object id IS the
 * sha256 of the content — exposed per file by the repo tree API. So a checksum
 * we can actually verify against was available all along; it just had to be
 * fetched rather than invented.
 *
 * Pinning matters as much as the hash. A `resolve/main` URL points at a moving
 * branch: the bytes behind it can change, which would make a baked-in hash fail
 * for everyone. Pinned to a commit sha, the URL and its hash agree forever, and
 * the branch URL stays on as a fallback mirror for the day the pinned revision
 * disappears (the download code deliberately does NOT enforce the primary hash
 * against a fallback, since it belongs to the pinned copy).
 *
 *   node scripts/registry-hashes.mjs            # rewrite resources/registry/*.json
 *   node scripts/registry-hashes.mjs --check    # verify only, non-zero if stale
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK = join(HERE, '..', 'resources', 'registry', 'gen-archs.json')
const CHECK = process.argv.includes('--check')
const log = (...a) => console.log(...a)

/** Split a Hugging Face resolve URL into {repo, revision, path}. */
function parseHfUrl(url) {
  const m = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/.exec(url)
  return m ? { repo: m[1], revision: m[2], path: m[3] } : null
}

const treeCache = new Map()

/** The repo tree at a revision, as a path -> entry map. */
async function tree(repo, revision) {
  const key = `${repo}@${revision}`
  if (treeCache.has(key)) return treeCache.get(key)
  const res = await fetch(
    `https://huggingface.co/api/models/${repo}/tree/${revision}?recursive=1&expand=1`
  )
  if (!res.ok) throw new Error(`tree ${repo}@${revision}: HTTP ${res.status}`)
  const list = await res.json()
  const map = new Map(list.map((e) => [e.path, e]))
  treeCache.set(key, map)
  return map
}

const shaCache = new Map()

/** The repo's current commit sha, so a moving branch becomes an immutable pin. */
async function headSha(repo) {
  if (shaCache.has(repo)) return shaCache.get(repo)
  const res = await fetch(`https://huggingface.co/api/models/${repo}`)
  if (!res.ok) throw new Error(`info ${repo}: HTTP ${res.status}`)
  const sha = (await res.json()).sha
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error(`${repo}: no commit sha`)
  shaCache.set(repo, sha)
  return sha
}

/** Every `download` object in the pack, wherever it is nested. */
function eachDownload(node, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) eachDownload(v, out)
  } else if (node && typeof node === 'object') {
    if (node.download && typeof node.download === 'object') out.push(node)
    for (const v of Object.values(node)) eachDownload(v, out)
  }
  return out
}

const pack = JSON.parse(readFileSync(PACK, 'utf-8'))
const companions = eachDownload(pack)
log(`${companions.length} downloads in ${PACK}\n`)

let changed = 0
let failed = 0

for (const c of companions) {
  const d = c.download
  const label = `${c.label ?? d.filename}`
  // The branch URL is the one to look up: it is what a human maintains. A
  // previously pinned primary is refreshed from it, never treated as the source.
  const branchUrl = [...d.urls].reverse().find((u) => parseHfUrl(u)?.revision === 'main')
  const parsed = parseHfUrl(branchUrl ?? d.urls[0])
  if (!parsed) {
    log(`  ! ${label}: not a Hugging Face resolve URL — left alone`)
    failed += 1
    continue
  }
  try {
    const entry = (await tree(parsed.repo, 'main')).get(parsed.path)
    if (!entry) throw new Error(`${parsed.path} not found in ${parsed.repo}`)
    const sha256 = entry.lfs?.oid
    if (!/^[0-9a-f]{64}$/.test(sha256 ?? ''))
      throw new Error(`${parsed.path} is not an LFS file (no sha256 available)`)
    const commit = await headSha(parsed.repo)
    const pinned = `https://huggingface.co/${parsed.repo}/resolve/${commit}/${parsed.path}`
    const branch = `https://huggingface.co/${parsed.repo}/resolve/main/${parsed.path}`

    const isCurrent = d.sha256 === sha256 && d.urls[0] === pinned
    if (isCurrent) {
      log(`  = ${label}`)
      continue
    }
    if (CHECK) {
      log(
        `  ! ${label}: STALE (pack has ${d.sha256?.slice(0, 12) ?? 'no hash'}, upstream ${sha256.slice(0, 12)})`
      )
      failed += 1
      continue
    }
    d.sha256 = sha256
    d.bytes = entry.lfs?.size ?? entry.size
    d.urls = [pinned, branch]
    changed += 1
    log(`  + ${label}  ${sha256.slice(0, 12)}…  @${commit.slice(0, 7)}`)
  } catch (e) {
    // A gated or renamed repo must not stop the rest: that entry keeps whatever
    // it had (no hash = trust-on-first-use), which is exactly today's behaviour.
    log(`  ! ${label}: ${e.message}`)
    failed += 1
  }
}

if (!CHECK && changed) {
  writeFileSync(PACK, JSON.stringify(pack, null, 2) + '\n')
  log(`\nwrote ${changed} update(s)`)
}
if (failed) {
  log(`\n${failed} could not be resolved.`)
  if (CHECK) process.exit(1)
}
