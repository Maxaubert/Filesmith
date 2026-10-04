import { test, expect } from '@playwright/test'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { MAGICK, ROOT, magickEnv } from './helpers'

// The shims as installed: dist/win-unpacked is the install layout. Build it with
// `npm run build && npx electron-builder --win dir` first.
const RES = join(ROOT, 'dist', 'win-unpacked', 'resources')
const CMD = join(RES, 'cli', 'filesmith.cmd')
const SH = join(RES, 'cli', 'filesmith').replace(/\\/g, '/')
const VERSION = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string }
).version

test.skip(!existsSync(CMD), 'build the unpacked app first: npx electron-builder --win dir')

let work: string
test.beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'fs-packed-'))
})
test.afterEach(() => rmSync(work, { recursive: true, force: true }))

// `/s /c` strips the first and the last quote of the line, so the whole command
// is wrapped in one more pair (what Node itself does for shell: true).
const viaCmd = (args: string): ReturnType<typeof spawnSync<string>> =>
  spawnSync('cmd.exe', ['/d', '/s', '/c', `""${CMD}" ${args}"`], {
    encoding: 'utf-8',
    windowsVerbatimArguments: true,
    env: { ...process.env, FILESMITH_USER_DATA: join(work, '.ud') }
  })

test('filesmith.cmd: version, waits, and passes exit codes through', () => {
  expect(viaCmd('--version').stdout.trim()).toBe(VERSION)
  expect(viaCmd('convert x.png --bogus').status).toBe(2)
})

test('filesmith.cmd keeps spaces, & and non-ASCII letters in paths', () => {
  const file = join(work, 'a & b ä.png')
  execFileSync(MAGICK, ['-size', '8x8', 'xc:red', file], { env: magickEnv })
  const r = viaCmd(`convert "${file}" --to webp --dry-run --json`)
  expect(r.status).toBe(0)
  const plan = r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { event: string; input?: string })
    .find((e) => e.event === 'plan')
  expect(plan?.input).toBe(file)
})

// Git for Windows puts only Git\cmd on PATH by default, so `sh` may not resolve
// from a PowerShell-launched test run; Git Bash's own sh sits in Git\bin.
function gitSh(): string | undefined {
  if (!spawnSync('sh', ['-c', 'exit 0']).error) return 'sh'
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf-8' })
  const git = where.stdout?.split(/\r?\n/).find((l) => l.trim().endsWith('git.exe'))
  const sh = git ? join(dirname(dirname(git.trim())), 'bin', 'sh.exe') : undefined
  return sh && existsSync(sh) ? sh : undefined
}

test('the sh shim works from Git Bash', () => {
  const sh = gitSh()
  test.skip(!sh, 'Git Bash (sh) is not installed')
  const r = spawnSync(sh as string, [SH, '--version'], { encoding: 'utf-8' })
  expect(r.stdout.trim()).toBe(VERSION)
})
