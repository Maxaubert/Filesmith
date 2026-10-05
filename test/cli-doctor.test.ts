import { describe, expect, it } from 'vitest'
import { collectChecks, runDoctor, type DoctorDeps } from '../src/cli/commands/doctor'
import { parseArgv } from '../src/cli/parse'
import type { EventBody, Reporter } from '../src/cli/events'

const good = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  tool: (n) => ({ path: `R:\\bin\\${n}.exe`, bundled: true }),
  probe: async (cmd) => ({ started: true, firstLine: `${cmd} 1.0` }),
  ghostscript: () => 'R:\\gs\\gswin64c.exe',
  soffice: () => 'R:\\lo\\soffice.com',
  rar: () => null,
  realesrgan: () => 'R:\\re\\realesrgan-ncnn-vulkan.exe',
  ncnnCount: () => 5,
  exists: () => true,
  gpu: async () => ({ name: 'RTX 5090', vramMb: 32607, computeCap: 12, driver: '581.15' }),
  cuda: () => ({ ok: true }),
  pidInstalled: () => false,
  comfyEngineReady: () => false,
  comfyPythonReady: () => false,
  comfyFolder: () => null,
  comfyModelCount: () => 0,
  uv: async () => null,
  rembgExe: () => null,
  rembgModel: () => false,
  comfyAlive: async () => null,
  comfyLaunchable: () => false,
  generationModels: () => [],
  registryWarnings: () => [],
  channelEnabled: () => false,
  userData: () => 'U:\\Filesmith',
  writable: () => true,
  freeBytes: () => 500e9,
  packaged: () => false,
  shimDir: () => 'P:\\Filesmith\\resources\\cli',
  pathEnv: () => '',
  appRunning: async () => false,
  liveLocks: () => [],
  proxyConfigured: async () => false,
  env: {},
  version: '0.6.0',
  bundledVersion: () => null,
  deepSmoke: async () => ({ ok: true, detail: '4x4 upscaled' }),
  verify: async () => [],
  skill: () => ({
    installed: false,
    path: 'H:\\.claude\\skills\\filesmith',
    version: null,
    current: false
  }),
  ...over
})

describe('doctor', () => {
  it('missing AI tools are warnings with exact fix commands, not failures', async () => {
    const checks = await collectChecks(good(), { deep: false, verify: false })
    expect(checks.some((c) => c.status === 'fail')).toBe(false)
    expect(checks.find((c) => c.id === 'pid')).toMatchObject({
      status: 'warn',
      fix: 'filesmith setup pid'
    })
    expect(checks.find((c) => c.id === 'rembg')).toMatchObject({
      status: 'warn',
      fix: 'filesmith setup removebg'
    })
    expect(checks.find((c) => c.id === 'winrar')?.status).toBe('warn')
    expect(checks.find((c) => c.id === 'path')?.status).toBe('skip')
  })

  it('a missing bundled tool fails and the exit code is 1', async () => {
    const deps = good({
      probe: async (cmd) => ({ started: !cmd.includes('mutool'), firstLine: '' })
    })
    const events: EventBody[] = []
    const r: Reporter = { emit: (e) => events.push(e), text: () => {}, close: () => {} }
    expect(await runDoctor(parseArgv(['doctor', '--json']), r, deps, () => 0)).toBe(1)
    expect(events.find((e) => e.event === 'check' && e.id === 'mutool')).toMatchObject({
      status: 'fail',
      fix: 'Reinstall Filesmith'
    })
    expect(events.at(-1)).toMatchObject({ event: 'summary', exitCode: 1 })
  })

  it('packaged: PATH and the bundled version are checked', async () => {
    const off = await collectChecks(good({ packaged: () => true, bundledVersion: () => '0.6.0' }), {
      deep: false,
      verify: false
    })
    expect(off.find((c) => c.id === 'path')).toMatchObject({ status: 'warn' })
    expect(off.find((c) => c.id === 'version')?.status).toBe('ok')
    const on = await collectChecks(
      good({
        packaged: () => true,
        pathEnv: () => 'C:\\Windows;P:\\Filesmith\\resources\\cli\\',
        bundledVersion: () => '0.5.2'
      }),
      { deep: false, verify: false }
    )
    expect(on.find((c) => c.id === 'path')?.status).toBe('ok')
    expect(on.find((c) => c.id === 'version')?.status).toBe('fail')
  })

  it('a system proxy without HTTPS_PROXY is a warning; held locks are reported', async () => {
    const checks = await collectChecks(
      good({
        proxyConfigured: async () => true,
        liveLocks: () => [{ what: 'the AI upscaler engine', host: 'app', pid: 42 }]
      }),
      { deep: false, verify: false }
    )
    expect(checks.find((c) => c.id === 'proxy')?.status).toBe('warn')
    expect(checks.find((c) => c.id === 'installs')).toMatchObject({ status: 'warn' })
  })

  it('--deep and --verify add their checks', async () => {
    const checks = await collectChecks(
      good({ verify: async () => [{ id: 'pid weights', ok: false, detail: 'hash differs' }] }),
      { deep: true, verify: true }
    )
    expect(checks.find((c) => c.id === 'realesrgan-smoke')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'verify pid weights')?.status).toBe('fail')
  })

  it('reports the Claude skill and offers to install or update it', async () => {
    const missing = await collectChecks(good(), { deep: false, verify: false })
    expect(missing.find((c) => c.id === 'skill')).toMatchObject({
      status: 'warn',
      fix: 'filesmith skill install'
    })
    const old = await collectChecks(
      good({ skill: () => ({ installed: true, path: 'x', version: '0.5.0', current: false }) }),
      { deep: false, verify: false }
    )
    expect(old.find((c) => c.id === 'skill')?.detail).toContain('0.5.0')
  })
})
