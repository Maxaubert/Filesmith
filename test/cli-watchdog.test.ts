import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { reserveOutput, reserveOutputDir, setOutputObserver } from '../src/main/atomicOutput'
import type { OutputRecord } from '../src/main/atomicOutput'
import { cleanUp, WatchdogState } from '../src/cli/watchdogCore'

// The watchdog cleans up after a CLI that was killed outright. It acts only on
// what the CLI told it, and only on this run's own leftovers.

let dir: string
let records: OutputRecord[]
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-watchdog-'))
  records = []
  setOutputObserver({ reserved: (r) => records.push(r), settled: () => {} })
})
afterEach(() => {
  setOutputObserver(null)
  rmSync(dir, { recursive: true, force: true })
})

const deps = (killed: Array<[number, string]> = []) => ({
  kill: (pid: number, image: string) => void killed.push([pid, image]),
  sleep: async () => {}
})
const ls = (): string[] => readdirSync(dir).sort()

describe('watchdog', () => {
  it('after a crash, removes the part and the placeholder and kills the tools', async () => {
    writeFileSync(join(dir, 'keep.txt'), 'a user file')
    const out = reserveOutput(join(dir, 'clip.mkv'), '.mp4', 'compressed')
    writeFileSync(out.part, 'half a video')
    const folder = reserveOutputDir(dir, 'doc (split)')
    writeFileSync(join(folder.part, 'doc-1.pdf'), 'p1')

    const state = new WatchdogState()
    for (const r of records) state.apply(JSON.stringify({ t: 'out', r }))
    state.apply(JSON.stringify({ t: 'pid', pid: 4242, image: 'ffmpeg.exe' }))
    state.apply(JSON.stringify({ t: 'pid', pid: 4343, image: 'magick.exe' }))
    state.apply(JSON.stringify({ t: 'ended', pid: 4343 }))
    state.apply('{"t":"settled","pa') // a torn last line from a killed writer is ignored
    const killed: Array<[number, string]> = []
    await cleanUp(state, deps(killed))

    expect(killed).toEqual([[4242, 'ffmpeg.exe']])
    expect(ls()).toEqual(['keep.txt'])
    out.discard() // the dead process never would; here it must find nothing left
    folder.discard()
  })

  it('does nothing after a clean end (bye)', async () => {
    const out = reserveOutput(join(dir, 'a.png'), '.webp', 'converted')
    writeFileSync(out.part, 'x')
    const state = new WatchdogState()
    state.apply(JSON.stringify({ t: 'out', r: records[0] }))
    state.apply(JSON.stringify({ t: 'pid', pid: 1, image: 'ffmpeg.exe' }))
    state.apply(JSON.stringify({ t: 'bye' }))
    const killed: Array<[number, string]> = []
    await cleanUp(state, deps(killed))
    expect(killed).toEqual([])
    expect(ls()).toEqual(['a.filesmith-part.webp', 'a.webp'])
    out.discard()
  })

  it('never removes a committed output, even when the settle message was lost', async () => {
    const out = reserveOutput(join(dir, 'a.png'), '.webp', 'converted')
    writeFileSync(out.part, 'the result')
    const state = new WatchdogState()
    state.apply(JSON.stringify({ t: 'out', r: records[0] }))
    expect(out.commit()).toBe(join(dir, 'a.webp'))
    await cleanUp(state, deps())
    expect(ls()).toEqual(['a.webp'])
  })

  it('never removes a file that replaced the placeholder', async () => {
    const out = reserveOutput(join(dir, 'a.png'), '.webp', 'converted')
    const state = new WatchdogState()
    state.apply(JSON.stringify({ t: 'out', r: records[0] }))
    rmSync(out.path)
    writeFileSync(out.path, 'someone else')
    await cleanUp(state, deps())
    expect(ls()).toEqual(['a.webp'])
    out.discard()
  })
})
