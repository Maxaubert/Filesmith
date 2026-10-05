import { resolve } from 'path'
import { BG_DEFAULTS } from '@shared/removebg'
import { formatBytes } from '@shared/compress'
import type { ComfyModel } from '@shared/comfy'
import type { GenModel } from '@shared/genArch'
import type { CompanionProgress } from '../../main/generate/companions'
import type { InstallOpts, InstallProgress } from '../../main/uvInstall'
import type { Reporter } from '../events'
import { CliError, EXIT, UsageError } from '../exit'
import type { PathState } from '../options'
import type { ParsedArgs } from '../parse'
import { classifyError } from '../runner'
import { VERSION } from '../version'

export interface SetupDeps {
  cuda(): Promise<{ ok: boolean; reason?: string }>
  pidInstalled(): boolean
  installPid(onProgress: InstallProgress, opts: InstallOpts): Promise<void>
  comfyReady(): boolean
  installComfyEngine(onProgress: InstallProgress, opts: InstallOpts): Promise<void>
  setComfy(patch: { folder?: string; serverUrl?: string }): void
  scanComfy(folder: string): Promise<ComfyModel[]>
  generationModels(): GenModel[]
  rembgReady(model: string): boolean
  setupRembg(model: string, onProgress: InstallProgress, opts: InstallOpts): Promise<void>
  downloadCompanions(
    model: string,
    onProgress: (p: CompanionProgress) => void,
    opts: InstallOpts
  ): Promise<void>
  ncnnModels(): { name: string; label: string; user: boolean }[]
  userNcnnDir(): string
  pathState(p: string): PathState
  removeTool(
    target: 'pid' | 'removebg',
    o: { permanent: boolean; dryRun: boolean }
  ): Promise<string>
  freeBytes(): number | null
  userData(): string
}

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(h: unknown): void
}
const REAL_TIMERS: Timers = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (h) => clearInterval(h as ReturnType<typeof setInterval>)
}

const ALIASES: Record<string, string> = {
  'remove-bg': 'removebg',
  'upscale-advanced': 'pid',
  'upscale-comfy': 'spandrel'
}
const TOOLS = 'removebg, pid, spandrel, comfy, generate, realesrgan, remove <tool>'
const PID_BYTES = 6_100_000_000

/** Installer progress -> `step` events with bytes and ETA, plus a heartbeat
 * every 5 s while a step has no percentage (spec 5.3), so an agent never
 * mistakes a 3 GB pip install for a hang. */
export class StepReporter {
  private step = ''
  private pct: number | null = null
  private since = 0
  private first: { t: number; got: number } | null = null
  private timer: unknown = null

  constructor(
    private readonly reporter: Reporter,
    private readonly clock: () => number,
    private readonly timers: Timers = REAL_TIMERS
  ) {}

  onProgress: InstallProgress = (step, pct) => {
    if (step !== this.step) {
      this.step = step
      this.since = this.clock()
      this.first = null
    }
    this.pct = pct
    this.reporter.emit({ event: 'step', step, pct })
    if (pct === null && this.timer === null)
      this.timer = this.timers.set(
        () =>
          this.reporter.emit({
            event: 'heartbeat',
            step: this.step,
            elapsedSec: Math.round((this.clock() - this.since) / 1000)
          }),
        5000
      )
    else if (pct !== null) this.stop()
  }

  onBytes = (got: number, total: number): void => {
    const t = this.clock()
    if (!this.first) this.first = { t, got }
    const secs = (t - this.first.t) / 1000
    const speed = secs > 0 ? (got - this.first.got) / secs : 0
    this.reporter.emit({
      event: 'step',
      step: this.step,
      pct: total ? Math.min(99, Math.round((got / total) * 100)) : this.pct,
      bytes: got,
      totalBytes: total || undefined,
      etaSec: speed > 0 && total > got ? Math.round((total - got) / speed) : undefined
    })
  }

  stop(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
  }
}

export async function runSetup(
  args: ParsedArgs,
  cwd: string,
  reporter: Reporter,
  deps: SetupDeps,
  signal: AbortSignal,
  clock: () => number,
  timers: Timers = REAL_TIMERS
): Promise<number> {
  const t0 = clock()
  const v = args.values
  const words = args.positionals.map((w) => w.toLowerCase())
  const tool = words[0] ? (ALIASES[words[0]] ?? words[0]) : undefined
  const finish = (exitCode: number): number => {
    reporter.emit({
      event: 'summary',
      ok: exitCode === 0 ? 1 : 0,
      failed: exitCode === 1 ? 1 : 0,
      skipped: 0,
      canceled: exitCode === 130 ? 1 : 0,
      inBytes: 0,
      outBytes: 0,
      ms: clock() - t0,
      exitCode
    })
    return exitCode
  }

  if (!tool) {
    const gpu = await deps.cuda()
    const gen = deps.generationModels()
    const rows: [string, boolean, string, string][] = [
      [
        'removebg',
        deps.rembgReady(BG_DEFAULTS.bgModel),
        'background removal',
        'filesmith setup removebg'
      ],
      [
        'pid',
        deps.pidInstalled(),
        gpu.ok ? 'PiD upscaler (NVIDIA)' : (gpu.reason ?? 'needs an NVIDIA GPU'),
        'filesmith setup pid'
      ],
      [
        'spandrel',
        deps.comfyReady(),
        'ComfyUI upscale models (NVIDIA)',
        'filesmith setup spandrel'
      ],
      ['realesrgan', deps.ncnnModels().length > 0, 'bundled upscaler', 'filesmith doctor'],
      [
        'generate',
        gen.some((m) => m.runnable),
        `${gen.filter((m) => m.runnable).length} of ${gen.length} generation models ready`,
        gen.length
          ? 'filesmith formats generate'
          : 'filesmith setup comfy --folder "<ComfyUI folder>"'
      ]
    ]
    for (const [id, ok, detail, fix] of rows)
      reporter.emit({
        event: 'check',
        id,
        group: 'setup',
        status: ok ? 'ok' : 'warn',
        detail: ok ? `ready, ${detail}` : `not set up, ${detail}`,
        fix: ok ? undefined : fix
      })
    return EXIT.OK
  }
  if (![...TOOLS.split(', ').map((t) => t.split(' ')[0])].includes(tool))
    throw new UsageError(`Unknown setup tool: ${tool}. Tools: ${TOOLS}.`, ['setup'])

  reporter.emit({
    event: 'run',
    command: `setup ${[tool, ...words.slice(1)].join(' ')}`,
    version: VERSION,
    dryRun: args.dryRun,
    inputs: 0,
    options: { ...v }
  })
  const steps = new StepReporter(reporter, clock, timers)
  const opts: InstallOpts = { signal, onBytes: steps.onBytes }
  const free = deps.freeBytes()
  const freeText = free == null ? 'free space unknown' : `${formatBytes(free)} free`
  const plan = (lines: [string, string][]): number => {
    for (const [step, detail] of lines) reporter.emit({ event: 'step', step, pct: null, detail })
    return finish(EXIT.OK)
  }
  const already = (name: string, path?: string): number => {
    reporter.emit({ event: 'done', tool: name, path, alreadyDone: true })
    return finish(EXIT.OK)
  }
  const attempt = async (
    name: string,
    path: string | undefined,
    fn: () => Promise<void>
  ): Promise<number> => {
    try {
      await fn()
      steps.stop()
      reporter.emit({ event: 'done', tool: name, path, alreadyDone: false })
      return finish(EXIT.OK)
    } catch (e) {
      steps.stop()
      if (signal.aborted) {
        reporter.emit({
          event: 'error',
          code: 'CANCELED',
          message: 'Setup canceled. Run the same command again to resume.'
        })
        return finish(EXIT.CANCELED)
      }
      const message = e instanceof Error ? e.message : String(e)
      reporter.emit({ event: 'error', code: classifyError(message).code, message })
      return finish(EXIT.FAILED)
    }
  }
  const gpuGate = async (): Promise<void> => {
    const g = await deps.cuda()
    if (!g.ok)
      throw new CliError('GPU_UNSUPPORTED', g.reason ?? 'This GPU cannot run the CUDA engine.')
  }
  const ENGINE_PLAN: [string, string][] = [
    ['GPU', 'NVIDIA with CUDA compute capability 7.5+ and driver 525+: ok'],
    ['Python env', 'Python 3.12 with PyTorch (CUDA 12.8) via uv, about 3 GB'],
    ['Disk', freeText]
  ]

  switch (tool) {
    case 'realesrgan': {
      for (const m of deps.ncnnModels())
        reporter.emit({
          event: 'step',
          step: m.name,
          pct: null,
          detail: `${m.label}${m.user ? ', added by you' : ''}`
        })
      reporter.emit({
        event: 'step',
        step: 'Your own models',
        pct: null,
        detail: `drop a .param/.bin pair into ${deps.userNcnnDir()}`
      })
      return already('realesrgan', deps.userNcnnDir())
    }
    case 'removebg': {
      const model = BG_DEFAULTS.bgModel
      if (deps.rembgReady(model)) return already('removebg')
      if (args.dryRun)
        return plan([
          [
            'uv',
            'use an installed uv 0.11.28+, else download uv 0.11.30 from github.com/astral-sh/uv'
          ],
          [
            'rembg',
            'uv tool install rembg[cli,cpu]>=2.0.75,<3 (Python 3.11, CPU only, no GPU needed)'
          ],
          ['Model', `${model}, about 1 GB, into ${resolve(deps.userData(), 'models', 'rembg')}`],
          ['Disk', freeText]
        ])
      return attempt('removebg', undefined, () => deps.setupRembg(model, steps.onProgress, opts))
    }
    case 'pid': {
      await gpuGate()
      if (deps.pidInstalled()) return already('pid')
      if (args.dryRun)
        return plan([
          ...ENGINE_PLAN.slice(0, 2),
          ['Source', 'github.com/nv-tlabs/PiD at a pinned commit'],
          [
            'Weights',
            'huggingface.co/nvidia/PiD, about 3 GB (reused from your ComfyUI when found)'
          ],
          ['Disk', `needs about ${formatBytes(PID_BYTES)}, ${freeText}`]
        ])
      return attempt('pid', undefined, () => deps.installPid(steps.onProgress, opts))
    }
    case 'spandrel': {
      await gpuGate()
      const folder = typeof v.comfy === 'string' ? resolve(cwd, v.comfy) : undefined
      if (folder && deps.pathState(folder) !== 'dir')
        throw new UsageError(`--comfy must be a folder: ${folder}`, ['setup'])
      const ready = deps.comfyReady()
      if (ready && !folder) return already('spandrel')
      if (args.dryRun)
        return plan([
          ...(ready
            ? []
            : [...ENGINE_PLAN, ['spandrel', 'the model loader, a few MB'] as [string, string]]),
          ...(folder
            ? [
                ['ComfyUI folder', `record ${folder} and scan its upscale models`] as [
                  string,
                  string
                ]
              ]
            : [])
        ])
      return attempt('spandrel', folder, async () => {
        if (!ready) await deps.installComfyEngine(steps.onProgress, opts)
        if (!folder) return
        steps.onProgress('Scanning ComfyUI upscale models', null)
        deps.setComfy({ folder })
        for (const m of await deps.scanComfy(folder))
          reporter.emit({
            event: 'step',
            step: m.name,
            pct: null,
            detail: `${m.badge}${m.reason ? `: ${m.reason}` : ''}`
          })
      })
    }
    case 'comfy': {
      const folder = typeof v.folder === 'string' ? resolve(cwd, v.folder) : undefined
      const url = typeof v.url === 'string' ? v.url.replace(/\/+$/, '') : undefined
      if (!folder && !url)
        throw new UsageError(
          'filesmith setup comfy needs --folder <ComfyUI folder> or --url <http://host:port>.',
          ['setup']
        )
      if (folder && deps.pathState(folder) !== 'dir')
        throw new UsageError(`--folder must be a folder: ${folder}`, ['setup'])
      if (url && !/^https?:\/\/[^\s/]+/i.test(url))
        throw new UsageError('--url must look like http://127.0.0.1:8188', ['setup'])
      if (args.dryRun)
        return plan([
          ...(folder ? [['ComfyUI folder', `record ${folder}`] as [string, string]] : []),
          ...(url ? [['ComfyUI server', `record ${url}`] as [string, string]] : []),
          ['Downloads', 'none; ComfyUI itself comes from comfy.org']
        ])
      deps.setComfy({ ...(folder ? { folder } : {}), ...(url ? { serverUrl: url } : {}) })
      const gen = deps.generationModels()
      reporter.emit({
        event: 'step',
        step: 'Generation models',
        pct: null,
        detail: `${gen.filter((m) => m.runnable).length} of ${gen.length} ready to run`
      })
      reporter.emit({ event: 'done', tool: 'comfy', path: folder ?? url, alreadyDone: false })
      return finish(EXIT.OK)
    }
    case 'generate': {
      const name = typeof v.model === 'string' ? v.model : undefined
      if (!name)
        throw new UsageError(
          'filesmith setup generate needs --model <name>. See: filesmith formats generate',
          ['setup']
        )
      const model = deps
        .generationModels()
        .find((m) => [m.name, m.label].some((x) => x.toLowerCase() === name.toLowerCase()))
      if (!model)
        throw new UsageError(
          `No generation model named "${name}". See: filesmith formats generate`,
          ['setup']
        )
      const missing = model.missing ?? []
      if (!missing.length) return already('generate', model.name)
      if (args.dryRun)
        return plan([
          ...missing.map((f): [string, string] => [
            f.label,
            `${f.filename}, ${f.approxSize}, from ${f.url}${f.sha256 ? ', sha256 checked' : ''}`
          ]),
          [
            'Disk',
            `${freeText} on the Filesmith data drive (files go into your ComfyUI models folder)`
          ]
        ])
      return attempt('generate', model.name, () =>
        deps.downloadCompanions(
          model.name,
          (p) => steps.onProgress(`Downloading ${p.label} (${p.index}/${p.total})`, p.pct),
          opts
        )
      )
    }
    case 'remove': {
      const sub = words[1] ? (ALIASES[words[1]] ?? words[1]) : undefined
      if (sub !== 'pid' && sub !== 'spandrel' && sub !== 'removebg')
        throw new UsageError('filesmith setup remove needs pid, spandrel or removebg.', ['setup'])
      const target = sub === 'removebg' ? 'removebg' : 'pid'
      if (target === 'pid')
        reporter.emit({
          event: 'warning',
          code: 'SHARED_ENV',
          message:
            'PiD and the ComfyUI upscaler engine share one Python environment; removing it removes both.'
        })
      const o = { permanent: v.permanent === true, dryRun: args.dryRun }
      if (args.dryRun) return plan([[`Remove ${sub}`, await deps.removeTool(target, o)]])
      return attempt(`remove ${sub}`, undefined, async () => {
        steps.onProgress(`Removed ${await deps.removeTool(target, o)}`, 100)
      })
    }
  }
  throw new UsageError(`Unknown setup tool: ${tool}. Tools: ${TOOLS}.`, ['setup'])
}
