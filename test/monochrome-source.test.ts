import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = join(__dirname, '../src/renderer/src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const grey = (h: string): boolean => {
  const x =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  return x.slice(0, 2) === x.slice(2, 4) && x.slice(2, 4) === x.slice(4, 6)
}

describe('strict monochrome source', () => {
  it('has no non-grey colour literal outside theme/tokens.css', () => {
    const bad: string[] = []
    for (const f of walk(ROOT)) {
      if (!/\.(tsx?|css)$/.test(f) || f.endsWith(`theme${sep}tokens.css`)) continue
      const src = readFileSync(f, 'utf-8')
      for (const m of src.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g))
        if (!grey(m[1].toLowerCase())) bad.push(`${relative(ROOT, f)}: #${m[1]}`)
      for (const m of src.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g))
        if (!(m[1] === m[2] && m[2] === m[3])) bad.push(`${relative(ROOT, f)}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })

  it('carries no light-theme utility classes', () => {
    const bad: string[] = []
    const light =
      /\b(text-ink|text-muted|text-dim|bg-canvas|bg-accent|text-accent|border-accent|bg-white|border-black\/|rounded-(lg|xl|2xl|full|\[))/
    for (const f of walk(ROOT)) {
      if (!/\.tsx?$/.test(f)) continue
      const src = readFileSync(f, 'utf-8')
      if (light.test(src)) bad.push(relative(ROOT, f))
    }
    expect(bad).toEqual([])
  })
})
