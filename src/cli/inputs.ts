import { globSync, readdirSync, statSync } from 'fs'
import { basename, join, resolve } from 'path'
import type { FileInfo } from '@shared/types'
import type { PathState } from './options'

export interface InputIssue {
  arg: string
  code: 'NOT_FOUND' | 'NO_MATCH'
  message: string
}
export interface SkippedInput {
  path: string
  code: 'UNSUPPORTED_KIND'
  message: string
}
export interface ExpandOptions {
  cwd: string
  recursive: boolean
  /** Folder members the verb cannot take are skipped, not failed (spec 2.2). */
  accepts(f: FileInfo): boolean
  fileInfo(p: string): FileInfo
  readStdin(): Promise<string>
}
export interface ExpandResult {
  files: string[]
  issues: InputIssue[]
  skipped: SkippedInput[]
}

const GLOB_CHARS = /[*?[]/
const SYSTEM_FILES = new Set(['thumbs.db', 'desktop.ini'])

export const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

const hidden = (name: string): boolean =>
  name.startsWith('.') || SYSTEM_FILES.has(name.toLowerCase())

export function pathState(p: string): PathState {
  try {
    const st = statSync(p)
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'missing'
  } catch {
    return 'missing'
  }
}

function folderFiles(dir: string, recursive: boolean): string[] {
  const out: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !hidden(e.name))
    .sort((a, b) => naturalCompare(a.name, b.name))
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isFile()) out.push(p)
    else if (e.isDirectory() && recursive) out.push(...folderFiles(p, true))
  }
  return out
}

/** cmd and PowerShell pass wildcards through, so the CLI expands them itself
 * (spec 2.2). The static prefix becomes the glob's cwd, which makes absolute
 * patterns and drive letters work. */
export function expandGlob(pattern: string, cwd: string): string[] {
  const norm = pattern.replace(/\\/g, '/')
  const parts = norm.split('/')
  const i = parts.findIndex((s) => GLOB_CHARS.test(s))
  let base = parts.slice(0, i).join('/')
  if (/^[A-Za-z]:$/.test(base)) base += '/'
  if (base === '' && norm.startsWith('/')) base = '/'
  const root = resolve(cwd, base || '.')
  return globSync(parts.slice(i).join('/'), { cwd: root })
    .map((rel) => resolve(root, rel))
    .filter((p) => pathState(p) === 'file' && !hidden(basename(p)))
    .sort(naturalCompare)
}

export async function expandInputs(args: string[], o: ExpandOptions): Promise<ExpandResult> {
  const files: string[] = []
  const issues: InputIssue[] = []
  const skipped: SkippedInput[] = []
  const seen = new Set<string>()
  const add = (p: string): void => {
    const k = p.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    files.push(p)
  }

  const list: string[] = []
  for (const a of args) {
    if (a !== '-') list.push(a)
    else
      list.push(
        ...(await o.readStdin())
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      )
  }

  for (const arg of list) {
    const abs = resolve(o.cwd, arg)
    const state = pathState(abs)
    if (state === 'file') {
      add(abs)
    } else if (state === 'dir') {
      for (const p of folderFiles(abs, o.recursive)) {
        if (o.accepts(o.fileInfo(p))) add(p)
        else
          skipped.push({
            path: p,
            code: 'UNSUPPORTED_KIND',
            message: 'not a file this command takes'
          })
      }
    } else if (GLOB_CHARS.test(arg)) {
      const hits = expandGlob(arg, o.cwd)
      if (hits.length) hits.forEach(add)
      else issues.push({ arg, code: 'NO_MATCH', message: `No file matches ${arg}` })
    } else {
      issues.push({ arg, code: 'NOT_FOUND', message: `File not found: ${abs}` })
    }
  }
  return { files, issues, skipped }
}
