import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

const ROOT = resolve(__dirname, '..', '..')
const IMPORT_RE =
  /^\s*(import|export)\s+(type\s+)?[^'"]*?\sfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm

function resolveSpec(from: string, spec: string): string | null {
  let base: string | null = null
  if (spec.startsWith('@shared/')) base = join(ROOT, 'src', 'shared', spec.slice('@shared/'.length))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  if (!base) return null
  for (const cand of [base + '.ts', base + '.tsx', join(base, 'index.ts'), base])
    if (existsSync(cand) && cand.match(/\.tsx?$/)) return cand
  return null
}

/** Every source file reachable from `entry` through value imports (type-only
 * imports are erased by the compiler and ignored here), plus the bare module
 * names it pulls in (node builtins, 'electron', npm packages). */
export function importGraph(entry: string): { files: string[]; externals: Set<string> } {
  const seen = new Set<string>()
  const externals = new Set<string>()
  const stack = [resolve(entry)]
  while (stack.length) {
    const file = stack.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf-8')
    for (const m of src.matchAll(IMPORT_RE)) {
      if (m[2]) continue // import type ... from
      const spec = m[3] ?? m[4] ?? m[5]
      if (!spec) continue
      const target = resolveSpec(file, spec)
      if (target) stack.push(target)
      else if (!spec.startsWith('.') && !spec.startsWith('@shared/')) externals.add(spec)
    }
  }
  return { files: [...seen], externals }
}
