import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { engineEnv, setEngineEnv } from '../src/main/env'
import { downloadFile } from '../src/main/net/download'
import { expectedHash, recordHash } from '../src/main/net/integrity'

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')
const BODY = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'.repeat(8))

type Handler = (req: IncomingMessage, res: ServerResponse) => void

const saved = engineEnv()
let server: Server | undefined
let base = ''
let tmp = ''
let seen: IncomingMessage[] = []

function serve(handler: Handler): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      seen.push(req)
      handler(req, res)
    })
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
      resolve()
    })
  })
}

const ok =
  (body: Buffer = BODY): Handler =>
  (_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': body.length
    })
    res.end(body)
  }

/** Sends `cut` bytes of a body that declares its full length, then kills the socket. */
const truncated =
  (body: Buffer, cut: number): Handler =>
  (_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': body.length
    })
    res.write(body.subarray(0, cut))
    setTimeout(() => res.destroy(), 20)
  }

beforeEach(() => {
  seen = []
  tmp = mkdtempSync(join(tmpdir(), 'fs-download-'))
  setEngineEnv({ ...saved, userData: join(tmp, 'userData'), fetch: (u, i) => fetch(u, i) })
})

afterEach(async () => {
  setEngineEnv(saved)
  const s = server
  server = undefined
  if (s) {
    s.closeAllConnections()
    await new Promise<void>((r) => s.close(() => r()))
  }
  rmSync(tmp, { recursive: true, force: true })
})

describe('downloadFile', () => {
  it('writes the file when the declared sha256 matches', async () => {
    await serve(ok())
    const dest = join(tmp, 'out', 'a.bin')
    const r = await downloadFile(`${base}/a`, dest, { sha256: sha(BODY).toUpperCase() })
    expect(r).toEqual({ bytes: BODY.length, sha256: sha(BODY), url: `${base}/a` })
    expect(readFileSync(dest).equals(BODY)).toBe(true)
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(existsSync(`${dest}.part.meta`)).toBe(false)
  })

  it('rejects and discards the partial file on a sha256 mismatch', async () => {
    await serve(ok())
    const dest = join(tmp, 'a.bin')
    await expect(downloadFile(`${base}/a`, dest, { sha256: sha('other') })).rejects.toThrow(
      /does not match its expected checksum/
    )
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('rejects a body smaller than minBytes and leaves nothing', async () => {
    await serve(ok())
    const dest = join(tmp, 'a.bin')
    await expect(downloadFile(`${base}/a`, dest, { minBytes: BODY.length + 1 })).rejects.toThrow(
      /looks wrong/
    )
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('rejects an HTML error page served as 200', async () => {
    await serve((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html></html>')
    })
    await expect(downloadFile(`${base}/a`, join(tmp, 'a.bin'))).rejects.toThrow(
      /did not return a file/
    )
  })

  describe('resume', () => {
    it('continues a cut-off transfer with a Range request', async () => {
      let first = true
      await serve((req, res) => {
        if (first) {
          first = false
          return truncated(BODY, 100)(req, res)
        }
        const m = /bytes=(\d+)-/.exec(String(req.headers.range))
        const from = Number(m?.[1] ?? 0)
        const tail = BODY.subarray(from)
        res.writeHead(206, {
          'content-type': 'application/octet-stream',
          'content-length': tail.length,
          'content-range': `bytes ${from}-${BODY.length - 1}/${BODY.length}`
        })
        res.end(tail)
      })
      const dest = join(tmp, 'a.bin')
      await expect(downloadFile(`${base}/a`, dest)).rejects.toThrow()
      expect(existsSync(dest)).toBe(false)
      expect(existsSync(`${dest}.part`)).toBe(true)

      const r = await downloadFile(`${base}/a`, dest)
      const range = String(seen[1].headers.range)
      expect(range).toMatch(/^bytes=\d+-$/)
      expect(Number(/\d+/.exec(range)![0])).toBeGreaterThan(0)
      expect(sha(readFileSync(dest))).toBe(sha(BODY))
      expect(r.bytes).toBe(BODY.length)
      // A resumed transfer only hashed its tail, so it reports no digest.
      expect(r.sha256).toBe('')
      expect(existsSync(`${dest}.part`)).toBe(false)
    })

    it('starts over when the server ignores Range and sends 200', async () => {
      let first = true
      await serve((req, res) => {
        if (first) {
          first = false
          return truncated(BODY, 50)(req, res)
        }
        ok()(req, res)
      })
      const dest = join(tmp, 'a.bin')
      await expect(downloadFile(`${base}/a`, dest)).rejects.toThrow()
      const r = await downloadFile(`${base}/a`, dest)
      expect(seen[1].headers.range).toBeDefined()
      expect(readFileSync(dest).equals(BODY)).toBe(true)
      expect(r.sha256).toBe(sha(BODY))
    })

    it('does not resume a part file that came from another url', async () => {
      await serve(ok())
      const dest = join(tmp, 'a.bin')
      writeFileSync(`${dest}.part`, 'stale')
      writeFileSync(`${dest}.part.meta`, JSON.stringify({ url: 'http://elsewhere/x' }))
      await downloadFile(`${base}/a`, dest)
      expect(seen[0].headers.range).toBeUndefined()
      expect(readFileSync(dest).equals(BODY)).toBe(true)
    })
  })

  describe('mirrors', () => {
    it('falls back to the next url and enforces the declared hash only on the first', async () => {
      const other = Buffer.from('a different branch copy of the file')
      await serve((req, res) => {
        if (req.url === '/pinned') {
          res.writeHead(404)
          return res.end()
        }
        ok(other)(req, res)
      })
      const dest = join(tmp, 'a.bin')
      // The declared hash belongs to the pinned url; the mirror bytes differ.
      const r = await downloadFile([`${base}/pinned`, `${base}/branch`], dest, {
        sha256: sha(BODY)
      })
      expect(r.url).toBe(`${base}/branch`)
      expect(readFileSync(dest).equals(other)).toBe(true)
    })

    it('enforces the declared hash on the first (pinned) url', async () => {
      await serve(ok(Buffer.from('wrong bytes')))
      const dest = join(tmp, 'a.bin')
      await expect(downloadFile([`${base}/pinned`], dest, { sha256: sha(BODY) })).rejects.toThrow()
      expect(existsSync(dest)).toBe(false)
    })

    it('reports the last error when every mirror fails', async () => {
      await serve((_q, res) => {
        res.writeHead(404)
        res.end()
      })
      await expect(downloadFile([`${base}/a`, `${base}/b`], join(tmp, 'a.bin'))).rejects.toThrow(
        /Download failed \(404\)/
      )
    })
  })

  describe('trust on first use (as callers use the ledger)', () => {
    it('records the first hash, then rejects different bytes for the same url', async () => {
      let body = BODY
      await serve((req, res) => ok(body)(req, res))
      const url = `${base}/model`

      expect(expectedHash(url)).toBeUndefined()
      const r1 = await downloadFile(url, join(tmp, 'a.bin'), { sha256: expectedHash(url) })
      recordHash(r1.url, r1.sha256, r1.bytes)
      expect(expectedHash(url)).toBe(sha(BODY))

      body = Buffer.from('changed under a moving branch')
      const dest2 = join(tmp, 'b.bin')
      await expect(downloadFile(url, dest2, { sha256: expectedHash(url) })).rejects.toThrow(
        /does not match/
      )
      expect(existsSync(dest2)).toBe(false)
    })

    it('does not crash on a corrupt ledger', async () => {
      await serve(ok())
      mkdirSync(engineEnv().userData, { recursive: true })
      writeFileSync(join(engineEnv().userData, 'integrity.json'), '{not json')
      const url = `${base}/model`
      expect(expectedHash(url)).toBeUndefined()
      const dest = join(tmp, 'a.bin')
      const r = await downloadFile(url, dest, { sha256: expectedHash(url) })
      recordHash(r.url, r.sha256, r.bytes)
      expect(expectedHash(url)).toBe(sha(BODY))
      expect(readFileSync(dest).equals(BODY)).toBe(true)
    })
  })

  it('aborts through opts.signal with the cancel message and leaves no finished file', async () => {
    await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 1000 })
      res.write('x'.repeat(10))
      // never ends
    })
    const ac = new AbortController()
    const dest = join(tmp, 'a.bin')
    const p = downloadFile(`${base}/a`, dest, { signal: ac.signal })
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toThrow('Download cancelled')
    expect(existsSync(dest)).toBe(false)
  })
})
