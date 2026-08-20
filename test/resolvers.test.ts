import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { comfyCandidateDirs, comfySearchRoots, trustedRoots } from '../src/main/comfy/roots'
import { uvCandidates } from '../src/main/uv'
import { checkDiskSpace } from '../src/main/pid/install'

// M12: the machine-dependent resolution code — the exact code that differs
// between the developer's machine and everyone else's — had ZERO test coverage.
// The suite passed everywhere precisely because it never exercised it. These are
// nearly pure over env vars plus the filesystem, so a temp fixture is enough.

const root = mkdtempSync(join(tmpdir(), 'filesmith-resolve-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ENV_KEYS = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'OneDrive'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
})

function restore(): void {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
}

describe('uv discovery', () => {
  it('enumerates winget package dirs instead of hardcoding the family hash', () => {
    // The old code hardcoded astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe,
    // which changes if the package is republished.
    const local = join(root, 'local')
    const pkg = join(local, 'Microsoft', 'WinGet', 'Packages', 'astral-sh.uv_SomeOtherHash')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'uv.exe'), 'x')
    process.env.LOCALAPPDATA = local
    try {
      expect(uvCandidates().some((p) => p.startsWith(pkg))).toBe(true)
    } finally {
      restore()
    }
  })

  it('lists a candidate under every configured root', () => {
    // The sharpest gap in the audit was that pid/install.ts ALREADY downloads a
    // pinned uv into <pidRoot>/uv/uv.exe and the resolver never looked there —
    // so a user who had just sat through a ~6 GB install was still told to go
    // run `winget install astral-sh.uv` in a terminal. That candidate is first
    // in the list; it needs Electron for pidRoot(), so this covers the rest.
    process.env.USERPROFILE = join(root, 'profile')
    process.env.LOCALAPPDATA = join(root, 'local2')
    try {
      const c = uvCandidates()
      expect(c).toContain(join(root, 'profile', '.local', 'bin', 'uv.exe'))
      expect(c).toContain(join(root, 'local2', 'Programs', 'uv', 'uv.exe'))
    } finally {
      restore()
    }
  })

  it('ignores an unset LOCALAPPDATA without throwing', () => {
    delete process.env.LOCALAPPDATA
    try {
      expect(() => uvCandidates()).not.toThrow()
    } finally {
      restore()
    }
  })
})

describe('ComfyUI discovery: reading is wide, EXECUTING is narrow', () => {
  it('searches drive roots and Downloads/Desktop for models', () => {
    const roots = comfySearchRoots()
    expect(roots.some((r) => /Downloads$/i.test(r))).toBe(true)
    expect(roots.some((r) => /Desktop$/i.test(r))).toBe(true)
    expect(roots.some((r) => /^[A-Z]:\\$/.test(r))).toBe(true)
  })

  it('omits all three from the TRUSTED roots used before spawning a python', () => {
    // icacls C:\ grants Authenticated Users:(AD), so a non-elevated process can
    // create C:\ComfyUI\ — and interpreter discovery ends in spawning what it
    // finds. Reading a models folder from a wide net is fine; executing a binary
    // found by one is not.
    const t = trustedRoots()
    expect(t.some((r) => /^[A-Z]:\\$/.test(r))).toBe(false)
    expect(t.some((r) => /Downloads$/i.test(r))).toBe(false)
    expect(t.some((r) => /Desktop$/i.test(r))).toBe(false)
  })

  it('trusted discovery is a strict subset of full discovery', () => {
    const full = new Set(comfyCandidateDirs())
    for (const d of comfyCandidateDirs({ trusted: true })) expect(full.has(d)).toBe(true)
  })

  it('still reaches the ComfyUI Desktop app-data locations when trusted', () => {
    // Desktop is the official installer — the trusted narrowing must not lock
    // out precisely the non-technical user it is meant to protect.
    process.env.APPDATA = join(root, 'appdata')
    process.env.LOCALAPPDATA = join(root, 'localappdata')
    try {
      const dirs = comfyCandidateDirs({ trusted: true })
      expect(dirs).toContain(join(root, 'appdata', 'ComfyUI'))
      expect(dirs).toContain(join(root, 'localappdata', 'Programs', '@comfyorgcomfyui-electron'))
    } finally {
      restore()
    }
  })
})

describe('disk-space preflight', () => {
  it('permits a requirement that obviously fits', () => {
    expect(checkDiskSpace(1024, root).ok).toBe(true)
  })

  it('refuses an impossible requirement with a readable reason', () => {
    // A full disk used to surface as whatever the write stream happened to
    // throw, several GB into a multi-GB download.
    const r = checkDiskSpace(Number.MAX_SAFE_INTEGER, root)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/disk space/i)
    expect(r.reason).toMatch(/GB/)
  })

  it('never blocks on a failed probe', () => {
    // Refusing to install because we could not measure would be worse than not
    // measuring at all.
    expect(checkDiskSpace(0, root).ok).toBe(true)
    expect(checkDiskSpace(-1, root).ok).toBe(true)
    expect(checkDiskSpace(1024, join(root, 'does-not-exist')).ok).toBe(true)
  })
})
