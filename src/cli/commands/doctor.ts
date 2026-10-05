import type { GenModel } from '@shared/genArch'
import { BG_DEFAULTS } from '@shared/removebg'
import { formatBytes } from '@shared/compress'
import type { SkillStatus } from '@shared/ipc'
import type { Reporter } from '../events'
import type { ParsedArgs } from '../parse'
import { VERSION } from '../version'

export interface Check {
  id: string
  group: string
  status: 'ok' | 'warn' | 'fail' | 'skip'
  detail: string
  fix?: string
}

export interface DoctorDeps {
  tool(name: string): { path: string; bundled: boolean }
  probe(cmd: string, args: string[]): Promise<{ started: boolean; firstLine: string }>
  ghostscript(): string
  soffice(): string
  rar(): string | null
  realesrgan(): string
  ncnnCount(): number
  exists(p: string): boolean
  gpu(): Promise<{
    name: string
    vramMb: number | null
    computeCap: number | null
    driver: string | null
  } | null>
  cuda(gpu: Awaited<ReturnType<DoctorDeps['gpu']>>): { ok: boolean; reason?: string }
  pidInstalled(): boolean
  comfyEngineReady(): boolean
  comfyPythonReady(): boolean
  comfyFolder(): string | null
  comfyModelCount(): number
  uv(): Promise<string | null>
  rembgExe(): string | null
  rembgModel(model: string): boolean
  comfyAlive(): Promise<string | null>
  comfyLaunchable(): boolean
  generationModels(): GenModel[]
  registryWarnings(): string[]
  channelEnabled(): boolean
  userData(): string
  writable(dir: string): boolean
  freeBytes(dir: string): number | null
  packaged(): boolean
  shimDir(): string
  pathEnv(): string
  appRunning(): Promise<boolean>
  liveLocks(): { what: string; host: string; pid: number }[]
  proxyConfigured(): Promise<boolean>
  env: Record<string, string | undefined>
  version: string
  bundledVersion(): string | null
  deepSmoke(): Promise<{ ok: boolean; detail: string }>
  verify(): Promise<{ id: string; ok: boolean; detail: string }[]>
  skill(): SkillStatus
}

const SETUP_COMFY = 'filesmith setup comfy --folder "<ComfyUI folder>"'
const CORE: [string, string[], string][] = [
  ['ffmpeg', ['-version'], 'video and audio'],
  ['ffprobe', ['-version'], 'video sizes and durations'],
  ['magick', ['-version'], 'every image job'],
  ['mutool', ['-v'], 'the PDF tools'],
  ['caesiumclt', ['--version'], 'image compress'],
  ['7z', [], 'archives']
]
const norm = (p: string): string =>
  p
    .trim()
    .replace(/[\\/]+$/, '')
    .toLowerCase()

/** Read-only checklist (spec 5.4). AI tools are optional: missing is `warn`. */
export async function collectChecks(
  deps: DoctorDeps,
  o: { deep: boolean; verify: boolean }
): Promise<Check[]> {
  const checks: Check[] = []
  const add = (c: Check): void => void checks.push(c)

  for (const [name, args, what] of CORE) {
    const t = deps.tool(name)
    const p = await deps.probe(t.path, args)
    add({
      id: name,
      group: 'core',
      status: !p.started ? 'fail' : t.bundled ? 'ok' : 'warn',
      detail: !p.started
        ? `missing, needed for ${what}`
        : `${p.firstLine || 'runs'}${t.bundled ? '' : ' (from PATH, not the bundled copy)'}`,
      fix: p.started ? undefined : 'Reinstall Filesmith'
    })
  }
  const gs = await deps.probe(deps.ghostscript(), ['--version'])
  add({
    id: 'ghostscript',
    group: 'core',
    status: gs.started ? 'ok' : 'warn',
    detail: gs.started
      ? `version ${gs.firstLine}`
      : 'missing; PDF compress levels other than lossless need it',
    fix: gs.started ? undefined : 'Reinstall Filesmith'
  })
  const so = deps.soffice()
  add({
    id: 'libreoffice',
    group: 'core',
    status: deps.exists(so) ? 'ok' : 'warn',
    detail: deps.exists(so) ? so : 'not found; document conversion needs it',
    fix: deps.exists(so) ? undefined : 'Reinstall Filesmith'
  })
  const re = deps.realesrgan()
  const models = deps.ncnnCount()
  add({
    id: 'realesrgan',
    group: 'core',
    status: deps.exists(re) && models ? 'ok' : 'fail',
    detail: deps.exists(re) ? `${models} models` : 'missing',
    fix: deps.exists(re) && models ? undefined : 'Reinstall Filesmith'
  })
  const rar = deps.rar()
  add({
    id: 'winrar',
    group: 'core',
    status: rar ? 'ok' : 'warn',
    detail: rar ?? 'not installed; only CBR and RAR output need it',
    fix: rar ? undefined : 'Install WinRAR from rarlab.com'
  })

  const gpu = await deps.gpu()
  const cuda = deps.cuda(gpu)
  add({
    id: 'nvidia',
    group: 'gpu',
    status: gpu ? 'ok' : 'skip',
    detail: gpu
      ? `${gpu.name}, ${gpu.vramMb ?? '?'} MB, compute ${gpu.computeCap ?? '?'}, driver ${gpu.driver ?? '?'}`
      : 'no NVIDIA GPU (Real-ESRGAN still runs on any Vulkan GPU)'
  })
  add({
    id: 'cuda-tier',
    group: 'gpu',
    status: cuda.ok ? 'ok' : 'warn',
    detail: cuda.ok ? 'PiD and ComfyUI upscalers can run' : (cuda.reason ?? 'not supported')
  })
  if (o.deep) {
    const s = await deps.deepSmoke()
    add({
      id: 'realesrgan-smoke',
      group: 'gpu',
      status: s.ok ? 'ok' : 'fail',
      detail: s.detail,
      fix: s.ok ? undefined : 'Update your graphics driver (Real-ESRGAN needs Vulkan)'
    })
  }

  const pid = deps.pidInstalled()
  add({
    id: 'pid',
    group: 'upscale',
    status: pid ? 'ok' : cuda.ok ? 'warn' : 'skip',
    detail: pid ? 'installed' : 'not installed',
    fix: !pid && cuda.ok ? 'filesmith setup pid' : undefined
  })
  const comfyPy = deps.comfyPythonReady()
  const spandrel = deps.comfyEngineReady() || comfyPy
  add({
    id: 'spandrel',
    group: 'upscale',
    status: spandrel ? 'ok' : cuda.ok ? 'warn' : 'skip',
    detail: spandrel
      ? `ready (${comfyPy ? 'your ComfyUI Python' : 'Filesmith environment'})`
      : 'not set up',
    fix: !spandrel && cuda.ok ? 'filesmith setup spandrel' : undefined
  })
  const folder = deps.comfyFolder()
  add({
    id: 'comfy-folder',
    group: 'upscale',
    status: folder ? 'ok' : 'warn',
    detail: folder
      ? `${folder}, ${deps.comfyModelCount()} usable upscalers`
      : 'no ComfyUI folder recorded',
    fix: folder ? undefined : SETUP_COMFY
  })

  const uv = await deps.uv()
  add({
    id: 'uv',
    group: 'removebg',
    status: uv ? 'ok' : 'warn',
    detail: uv ?? 'not found; setup downloads one',
    fix: uv ? undefined : 'filesmith setup removebg'
  })
  const rembg = deps.rembgExe()
  const model = deps.rembgModel(BG_DEFAULTS.bgModel)
  add({
    id: 'rembg',
    group: 'removebg',
    status: rembg && model ? 'ok' : 'warn',
    detail:
      rembg && model
        ? `${rembg}, ${BG_DEFAULTS.bgModel} model present`
        : rembg
          ? `${BG_DEFAULTS.bgModel} model missing`
          : 'not installed',
    fix: rembg && model ? undefined : 'filesmith setup removebg'
  })

  const live = await deps.comfyAlive()
  const launchable = deps.comfyLaunchable()
  add({
    id: 'comfyui',
    group: 'generate',
    status: live || launchable ? 'ok' : 'warn',
    detail: live ? `running at ${live}` : launchable ? 'found; starts when needed' : 'not found',
    fix: live || launchable ? undefined : SETUP_COMFY
  })
  const gen = deps.generationModels()
  const runnable = gen.filter((m) => m.runnable).length
  add({
    id: 'gen-models',
    group: 'generate',
    status: runnable ? 'ok' : 'warn',
    detail: `${runnable} of ${gen.length} models ready`,
    fix: runnable ? undefined : gen.length ? 'filesmith formats generate' : SETUP_COMFY
  })
  deps
    .registryWarnings()
    .forEach((w, i) =>
      add({ id: `registry-${i + 1}`, group: 'generate', status: 'warn', detail: w })
    )
  add({
    id: 'channel',
    group: 'generate',
    status: 'skip',
    detail: deps.channelEnabled() ? 'enabled' : 'disabled'
  })

  const ud = deps.userData()
  const writable = deps.writable(ud)
  add({
    id: 'user-data',
    group: 'environment',
    status: writable ? 'ok' : 'fail',
    detail: ud,
    fix: writable ? undefined : `Check the permissions of ${ud}`
  })
  const free = deps.freeBytes(ud)
  add({
    id: 'disk',
    group: 'environment',
    status: free == null || free > 10e9 ? 'ok' : 'warn',
    detail: free == null ? 'unknown' : `${formatBytes(free)} free`
  })
  if (deps.packaged()) {
    const onPath = deps
      .pathEnv()
      .split(';')
      .some((p) => norm(p) === norm(deps.shimDir()))
    add({
      id: 'path',
      group: 'environment',
      status: onPath ? 'ok' : 'warn',
      detail: onPath ? `${deps.shimDir()} is on PATH` : 'filesmith is not on PATH in this terminal',
      fix: onPath
        ? undefined
        : 'Open a new terminal (PATH changes reach new terminals only), or reinstall Filesmith'
    })
    const bundled = deps.bundledVersion()
    add({
      id: 'version',
      group: 'environment',
      status: bundled === deps.version ? 'ok' : 'fail',
      detail: `cli ${deps.version}, app ${bundled ?? 'unknown'}`,
      fix: bundled === deps.version ? undefined : 'Reinstall Filesmith'
    })
  } else {
    add({
      id: 'path',
      group: 'environment',
      status: 'skip',
      detail: 'running from a source checkout'
    })
  }
  add({
    id: 'app',
    group: 'environment',
    status: 'ok',
    detail: (await deps.appRunning())
      ? 'the app is running (AI jobs in both load the GPU twice)'
      : 'the app is not running'
  })
  const locks = deps.liveLocks()
  add({
    id: 'installs',
    group: 'environment',
    status: locks.length ? 'warn' : 'ok',
    detail: locks.length
      ? locks.map((l) => `${l.what} by the ${l.host} (pid ${l.pid})`).join('; ')
      : 'no installs running'
  })
  const proxyGap = (await deps.proxyConfigured()) && !deps.env.HTTPS_PROXY && !deps.env.HTTP_PROXY
  add({
    id: 'proxy',
    group: 'environment',
    status: proxyGap ? 'warn' : 'ok',
    detail: proxyGap
      ? 'Windows uses a proxy but HTTPS_PROXY is not set; setup downloads may fail'
      : 'ok',
    fix: proxyGap ? 'set HTTPS_PROXY=http://<proxy>:<port>' : undefined
  })
  const skill = deps.skill()
  add({
    id: 'skill',
    group: 'environment',
    status: skill.installed && skill.current ? 'ok' : 'warn',
    detail: skill.installed
      ? `Claude skill ${skill.version}${skill.current ? '' : `, older than ${deps.version}`}`
      : 'Claude skill not installed',
    fix: skill.installed && skill.current ? undefined : 'filesmith skill install'
  })

  if (o.verify)
    for (const r of await deps.verify())
      add({
        id: `verify ${r.id}`,
        group: 'verify',
        status: r.ok ? 'ok' : 'fail',
        detail: r.detail,
        fix: r.ok ? undefined : 'filesmith setup remove <tool>, then set it up again'
      })
  return checks
}

export async function runDoctor(
  args: ParsedArgs,
  reporter: Reporter,
  deps: DoctorDeps,
  clock: () => number
): Promise<number> {
  const t0 = clock()
  reporter.emit({
    event: 'run',
    command: 'doctor',
    version: VERSION,
    dryRun: false,
    inputs: 0,
    options: { ...args.values }
  })
  const checks = await collectChecks(deps, {
    deep: args.values.deep === true,
    verify: args.values.verify === true
  })
  let group = ''
  for (const c of checks) {
    if (c.group !== group) {
      group = c.group
      reporter.text(`${group.toUpperCase()}\n`)
    }
    reporter.emit({ event: 'check', ...c })
  }
  const count = (s: Check['status']): number => checks.filter((c) => c.status === s).length
  const exitCode = count('fail') ? 1 : 0
  reporter.emit({
    event: 'summary',
    ok: count('ok') + count('warn'),
    failed: count('fail'),
    skipped: count('skip'),
    canceled: 0,
    inBytes: 0,
    outBytes: 0,
    ms: clock() - t0,
    exitCode
  })
  return exitCode
}
