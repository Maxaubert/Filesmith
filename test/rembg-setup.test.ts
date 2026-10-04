import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { engineEnv, setEngineEnv } from '../src/main/env'
import {
  existingRembgModelFile,
  installedRembgExe,
  legacyRembgExe,
  rembgEnv,
  rembgExe,
  rembgModelDir,
  rembgModelFile,
  rembgModelNestedFile,
  rembgModelPresent
} from '../src/main/rembg/paths'
import { legacyRembgModelFile, setupRembg } from '../src/main/rembg/setup'
import { removebgStatus, resolveRembg } from '../src/main/toolResolver'
import { JobQueue } from '../src/main/jobQueue'
import type { JobEvent } from '@shared/types'

const saved = engineEnv()
const savedAppData = process.env.APPDATA
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fs-rembg-'))
  setEngineEnv({ ...saved, userData: join(root, 'ud') })
  process.env.APPDATA = join(root, 'appdata')
})
afterEach(() => {
  setEngineEnv(saved)
  process.env.APPDATA = savedAppData
  rmSync(root, { recursive: true, force: true })
})

const touch = (p: string): void => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, 'x')
}

describe('rembg paths (M6)', () => {
  it('the pinned model folder lives under userData', () => {
    expect(rembgModelDir()).toBe(join(root, 'ud', 'models', 'rembg'))
    expect(rembgModelFile('birefnet-general')).toBe(
      join(root, 'ud', 'models', 'rembg', 'birefnet-general.onnx')
    )
    expect(rembgEnv().U2NET_HOME).toBe(rembgModelDir())
  })

  it('finds the model in the flat layout and in rembg 2.0.85+ per-model layout', () => {
    expect(rembgModelPresent('u2net')).toBe(false)
    touch(rembgModelNestedFile('u2net'))
    expect(rembgModelNestedFile('u2net')).toBe(
      join(root, 'ud', 'models', 'rembg', 'models', 'u2net', 'u2net.onnx')
    )
    expect(rembgModelPresent('u2net')).toBe(true)
    expect(existingRembgModelFile('u2net')).toBe(rembgModelNestedFile('u2net'))
    touch(rembgModelFile('u2net'))
    expect(existingRembgModelFile('u2net')).toBe(rembgModelFile('u2net'))
  })

  it('prefers our tool dir, falls back to a pre-0.6 uv tool install', () => {
    expect(installedRembgExe()).toBeNull()
    touch(legacyRembgExe())
    expect(installedRembgExe()).toBe(legacyRembgExe())
    touch(rembgExe())
    expect(installedRembgExe()).toBe(rembgExe())
  })

  it('resolveRembg never falls back to uv tool run', () => {
    expect(resolveRembg()).toBeNull()
    touch(rembgExe())
    expect(resolveRembg()).toEqual({ cmd: rembgExe(), prefix: [], env: rembgEnv() })
  })

  it('removebg:status is ready only with the tool AND the default model', async () => {
    touch(rembgExe())
    expect((await removebgStatus()).ready).toBe(false)
    touch(rembgModelFile('birefnet-general'))
    expect((await removebgStatus()).ready).toBe(true)
  })
})

describe('setupRembg', () => {
  it('reuses a pre-0.6 model from U2NET_HOME instead of downloading it again', async () => {
    touch(rembgExe())
    const legacyHome = join(root, 'u2net')
    touch(join(legacyHome, 'birefnet-general.onnx'))
    const savedU2 = process.env.U2NET_HOME
    process.env.U2NET_HOME = legacyHome
    try {
      expect(legacyRembgModelFile('birefnet-general')).toBe(
        join(legacyHome, 'birefnet-general.onnx')
      )
      const steps: string[] = []
      await setupRembg('birefnet-general', (s) => steps.push(s))
      expect(rembgModelPresent('birefnet-general')).toBe(true)
      expect(steps).toEqual(['Reusing the birefnet-general model already on this PC', 'Ready'])
    } finally {
      if (savedU2 === undefined) delete process.env.U2NET_HOME
      else process.env.U2NET_HOME = savedU2
    }
  })

  it('finds a pre-0.6 model under ~/.rembg in the per-model layout', () => {
    const home = join(root, 'home')
    expect(legacyRembgModelFile('u2net', {}, home)).toBe(join(home, '.u2net', 'u2net.onnx'))
    touch(join(home, '.rembg', 'models', 'u2net', 'u2net.onnx'))
    expect(legacyRembgModelFile('u2net', {}, home)).toBe(
      join(home, '.rembg', 'models', 'u2net', 'u2net.onnx')
    )
  })

  it('is a no-op when the tool and model are present (no spawn, no download)', async () => {
    touch(rembgExe())
    touch(rembgModelFile('birefnet-general'))
    const steps: string[] = []
    await setupRembg('birefnet-general', (s) => steps.push(s))
    expect(steps).toEqual(['Ready'])
    expect(rembgModelPresent('birefnet-general')).toBe(true)
  })
})

describe('no downloads in CLI jobs (M5)', () => {
  it('a removebg job with allowDownload false fails with the setup command', async () => {
    setEngineEnv({ ...engineEnv(), host: 'cli' })
    const img = join(root, 'a.png')
    writeFileSync(img, 'x')
    const done = new Promise<JobEvent>((res) => {
      const q = new JobQueue(
        (e) => {
          if (e.status === 'failed' || e.status === 'done') res(e)
        },
        1,
        { allowDownload: false }
      )
      q.add({ id: '1', tool: 'removebg', input: img, options: {} })
    })
    const ev = await done
    expect(ev.status).toBe('failed')
    expect(ev.error).toBe('Background removal is not set up yet. Run: filesmith setup removebg.')
  })
})
