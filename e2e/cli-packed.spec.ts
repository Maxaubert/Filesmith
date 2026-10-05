import { test, expect } from '@playwright/test'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { FFMPEG, MAGICK, ROOT, magickEnv } from './helpers'

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

function ffmpegPids(): Set<string> {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq ffmpeg.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf-8'
  })
  return new Set(
    out
      .split(/\r?\n/)
      .filter((l) => l.startsWith('"ffmpeg.exe"'))
      .map((l) => l.split('","')[1])
  )
}

// Ctrl+C as a person presses it: a real console (not a pipe), the cmd shim,
// and the Ctrl+C key record in the console input. Filesmith.exe in Node mode
// never gets SIGINT on Windows, so this pins the raw-mode console read in
// src/cli/consoleCtrlC.ts: the job is canceled, the summary printed, the exit
// code is 130 (no "Terminate batch job" prompt in between), ffmpeg is gone
// and neither the part file nor the reserved name is left behind.
test('Ctrl+C in a console cancels cleanly: exit 130, no ffmpeg, no partial output', async () => {
  test.setTimeout(180_000)
  const video = join(work, 'long video.mp4')
  execFileSync(FFMPEG, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1920x1080:rate=30:duration=40',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    video
  ])
  const result = join(work, 'result.json')
  const before = ffmpegPids()
  // Start-Process gives the helper a console of its own (minimized). It joins
  // -ArgumentList with spaces, so every value carries its own quotes.
  const q = (s: string): string => `'"${s}"'`
  const helperArgs = [
    q('-NoProfile'),
    q('-ExecutionPolicy'),
    q('Bypass'),
    q('-File'),
    q(join(ROOT, 'e2e', 'ctrlc-console.ps1')),
    q('-Shim'),
    q(CMD),
    q('-WorkDir'),
    q(work),
    q('-Video'),
    q(video),
    q('-Result'),
    q(result)
  ].join(',')
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Start-Process powershell.exe -Wait -WindowStyle Minimized -ArgumentList @(${helperArgs})`
    ],
    { encoding: 'utf-8', timeout: 170_000 }
  )
  expect(r.status, r.stderr).toBe(0)
  const out = JSON.parse(readFileSync(result, 'utf-8').replace(/^\uFEFF/, '')) as {
    pressed: boolean
    partSeen: boolean
    exitCode: number
    screen: string
    error: string
  }
  expect(out.error).toBe('')
  expect(out.partSeen).toBe(true)
  expect(out.pressed).toBe(true)
  expect(out.exitCode).toBe(130)
  expect(out.screen).toMatch(/1 canceled/)
  expect(out.screen).not.toMatch(/Terminate batch job/)
  expect(readdirSync(work).sort()).toEqual(['long video.mp4', 'result.json'])
  let orphans: string[] = []
  for (let i = 0; i < 20; i++) {
    orphans = [...ffmpegPids()].filter((pid) => !before.has(pid))
    if (!orphans.length) break
    await new Promise((res) => setTimeout(res, 250))
  }
  expect(orphans).toEqual([])
})
