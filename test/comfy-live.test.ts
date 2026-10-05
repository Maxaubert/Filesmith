import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { engineEnv, setEngineEnv, userDataPath } from '../src/main/env'
import {
  candidateComfyUrls,
  clearLiveComfy,
  liveComfyUrl,
  recordLiveComfy
} from '../src/main/generate/comfy'

const saved = engineEnv()
afterEach(() => {
  clearLiveComfy()
  setEngineEnv(saved)
})

describe('comfy-live.json (M8)', () => {
  it('the app records the ComfyUI it launched and the CLI tries it first', () => {
    setEngineEnv({ ...saved, host: 'app' })
    recordLiveComfy('http://127.0.0.1:51234')
    expect(liveComfyUrl()).toBe('http://127.0.0.1:51234')
    setEngineEnv({ ...saved, host: 'cli' })
    const urls = candidateComfyUrls()
    expect(urls.indexOf('http://127.0.0.1:51234')).toBeLessThan(
      urls.indexOf('http://127.0.0.1:8188')
    )
  })

  it('a CLI-launched ComfyUI is never advertised (it dies with the CLI)', () => {
    setEngineEnv({ ...saved, host: 'cli' })
    recordLiveComfy('http://127.0.0.1:51235')
    expect(liveComfyUrl()).toBeNull()
  })

  it('ignores a record whose process is gone', () => {
    mkdirSync(dirname(userDataPath('comfy-live.json')), { recursive: true })
    writeFileSync(
      userDataPath('comfy-live.json'),
      JSON.stringify({ url: 'http://127.0.0.1:1', pid: 999_999_999 })
    )
    expect(liveComfyUrl()).toBeNull()
  })
})
