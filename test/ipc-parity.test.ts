import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'

// Every channel the preload sends or invokes must be handled in main. The
// `reveal` handler was dropped once (#21) and nothing noticed.
const ROOT = resolve(__dirname, '..')
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })

describe('preload <-> main channels', () => {
  it('has a main handler for every preload channel', () => {
    const preload = readFileSync(join(ROOT, 'src/preload/index.ts'), 'utf-8')
    const used = [...preload.matchAll(/ipcRenderer\.(?:send|invoke)\(\s*'([^']+)'/g)].map(
      (m) => m[1]
    )
    const main = walk(join(ROOT, 'src/main'))
      .map((f) => readFileSync(f, 'utf-8'))
      .join('\n')
    const handled = new Set(
      [...main.matchAll(/ipcMain\.(?:on|handle)\(\s*'([^']+)'/g)].map((m) => m[1])
    )
    expect(used.filter((c) => !handled.has(c))).toEqual([])
  })
})
