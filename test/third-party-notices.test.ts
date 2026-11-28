import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
// @ts-expect-error plain .mjs build script without type declarations
import { PINNED } from '../scripts/pinned-tools.mjs'

const ROOT = resolve(__dirname, '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n')
const NOTICES = 'resources/licenses/THIRD-PARTY-NOTICES.md'

describe('third-party notices', () => {
  const notices = read(NOTICES)

  // A pin bump without a notices update must fail here. sevenZipR only unpacks
  // the 7-Zip installer and is not shipped.
  const pins = Object.entries(PINNED as Record<string, { version: string }>).filter(
    ([id]) => id !== 'sevenZipR'
  )

  it.each(pins)('names the pinned version of %s', (_id, pin) => {
    const version = /^v?[\d.]+(-\d+)?/.exec(pin.version)?.[0]
    expect(version).toBeTruthy()
    expect(notices).toContain(version!.replace(/^v/, ''))
  })

  it('does not pin npm package versions that lockfile updates would make stale', () => {
    const start = notices.indexOf('## Parts of the app itself')
    const end = notices.indexOf('## Source code offer')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const section = notices.slice(start, end)
    expect(section).not.toMatch(/Version:/)
    expect(section).not.toMatch(/\b\d+\.\d+\.\d+\b/)
  })

  // caesiumclt.exe is Apache-2.0 source, but its release binary also compiles in
  // GPL and AGPL crates (Cargo.lock at the pinned tag), so both parts must say so.
  const between = (from: string, to: string): string => {
    const start = notices.indexOf(from)
    expect(start).toBeGreaterThan(-1)
    const end = notices.indexOf(to, start + from.length)
    expect(end).toBeGreaterThan(start)
    return notices.slice(start, end)
  }

  it('states the GPL and AGPL code compiled into caesiumclt.exe', () => {
    const section = between('### CaesiumCLT', '\n### ')
    for (const needle of [
      /imagequant\s+4\.4\.1/,
      /GPL-3\.0-or-later/,
      /gifski\s+1\.34\.0/,
      /AGPL-3\.0-or-later/,
      /`texts\/GPL-3\.0\.txt`/,
      /`texts\/AGPL-3\.0\.txt`/
    ])
      expect(section).toMatch(needle)
  })

  it('offers the source of caesiumclt.exe and its GPL and AGPL parts', () => {
    const offer = between('## Source code offer', '## Downloaded on request')
    expect(offer).toContain('CaesiumCLT')
    expect(offer).toContain('caesium-clt/archive/refs/tags/v1.4.0.tar.gz')
    expect(offer).toContain('imagequant-4.4.1.crate')
    expect(offer).toContain('gifski-1.34.0.crate')
  })

  it('has a licence text for every texts/ file it names', () => {
    const named = [...notices.matchAll(/`texts\/([^`]+)`/g)].map((m) => m[1])
    expect(named.length).toBeGreaterThan(0)
    for (const f of named) expect(existsSync(join(ROOT, 'resources/licenses/texts', f))).toBe(true)
  })

  it('ships with the installer and is checked by verify-bundle', () => {
    expect(read('electron-builder.yml')).toMatch(/from: resources\/licenses\s+to: licenses/)
    expect(read('scripts/verify-bundle.mjs')).toContain("'licenses/THIRD-PARTY-NOTICES.md'")
  })
})

describe('bundle hygiene in the build scripts', () => {
  const fetch = read('scripts/fetch-binaries.mjs')

  it('never ships the debug OpenMP runtime from Real-ESRGAN', () => {
    expect(fetch).toMatch(/NOT_SHIPPED = 'vcomp140d\.dll'/)
    expect(fetch).toMatch(/f\.toLowerCase\(\) !== NOT_SHIPPED/)
    expect(read('scripts/verify-bundle.mjs')).toContain("'realesrgan/vcomp140d.dll'")
  })

  it('--pinned rebuilds every tree instead of keeping an "already bundled" one', () => {
    // Each early return for an existing tree must be skipped when PIN is set.
    const guards = [
      ...fetch.matchAll(/if \(([^\n]*)\) \{\n(?:[^\n]*\n){0,2}?[^\n]*already bundled/g)
    ]
    expect(guards.length).toBe(3)
    for (const g of guards) expect(g[1]).toMatch(/^!PIN && /)
  })
})
