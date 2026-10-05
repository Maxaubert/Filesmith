import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  engineEnv,
  resetEngineEnvForTests,
  resourcePath,
  setEngineEnv,
  userDataPath,
  type EngineEnv
} from '../src/main/env'
import { cliEngineEnv } from '../src/cli/env'
import { resolveTool } from '../src/main/toolResolver'

const saved = engineEnv()
afterEach(() => setEngineEnv(saved))

const fakeFetch: EngineEnv['fetch'] = () => Promise.reject(new Error('no network in tests'))

describe('engineEnv', () => {
  it('throws a clear error when nothing configured it', () => {
    resetEngineEnvForTests()
    expect(() => engineEnv()).toThrow('engine env not configured')
  })

  it('joins resource and userData paths from the configured env', () => {
    setEngineEnv({ ...saved, resourcesDir: 'R:\\res', userData: 'U:\\data' })
    expect(resourcePath('bin', 'ffmpeg.exe')).toBe(join('R:\\res', 'bin', 'ffmpeg.exe'))
    expect(userDataPath('pid')).toBe(join('U:\\data', 'pid'))
  })

  it('resolveTool finds a bundled binary under resourcesDir/bin', () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-env-'))
    try {
      mkdirSync(join(root, 'bin'))
      writeFileSync(join(root, 'bin', 'ffmpeg.exe'), '')
      setEngineEnv({ ...saved, resourcesDir: root })
      expect(resolveTool('ffmpeg')).toBe(join(root, 'bin', 'ffmpeg.exe'))
      expect(resolveTool('nope')).toBe('nope')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('cliEngineEnv', () => {
  const base = {
    env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' },
    homedir: 'C:\\Users\\a',
    moduleDir: 'D:\\repo\\out\\main'
  }

  it('packaged: Filesmith.exe uses process.resourcesPath and %APPDATA%\\Filesmith', () => {
    const e = cliEngineEnv(
      {
        ...base,
        execPath: 'C:\\Users\\a\\AppData\\Local\\Programs\\Filesmith\\Filesmith.exe',
        resourcesPath: 'C:\\Users\\a\\AppData\\Local\\Programs\\Filesmith\\resources'
      },
      fakeFetch
    )
    expect(e.resourcesDir).toBe('C:\\Users\\a\\AppData\\Local\\Programs\\Filesmith\\resources')
    expect(e.userData).toBe(join('C:\\Users\\a\\AppData\\Roaming', 'Filesmith'))
    expect(e.downloadsDir).toBe(join('C:\\Users\\a', 'Downloads'))
    expect(e.host).toBe('cli')
  })

  it('packaged without resourcesPath falls back to <exe dir>\\resources', () => {
    const e = cliEngineEnv({ ...base, execPath: 'C:\\P\\Filesmith\\FILESMITH.EXE' }, fakeFetch)
    expect(e.resourcesDir).toBe(join('C:\\P\\Filesmith', 'resources'))
  })

  it('dev (node or electron.exe): the repo resources folder two levels above out/main', () => {
    const e = cliEngineEnv({ ...base, execPath: 'C:\\node\\node.exe' }, fakeFetch)
    expect(e.resourcesDir).toBe(join('D:\\repo', 'resources'))
  })

  it('FILESMITH_USER_DATA overrides the data folder (e2e isolation)', () => {
    const e = cliEngineEnv(
      { ...base, env: { ...base.env, FILESMITH_USER_DATA: 'T:\\ud' }, execPath: 'node.exe' },
      fakeFetch
    )
    expect(e.userData).toBe('T:\\ud')
  })
})
