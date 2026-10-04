import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, extname, join, resolve } from 'path'
import { BG_DEFAULTS } from '@shared/removebg'
import { formatBytes } from '@shared/compress'
import { JobQueue } from '../main/jobQueue'
import { fileInfoFromPath } from '../main/fileInfo'
import {
  realesrganDir,
  resolveGhostscript,
  resolveRar,
  resolveRealesrgan,
  resolveSoffice,
  resolveTool
} from '../main/toolResolver'
import { run } from '../main/run'
import { findUvAsync } from '../main/uv'
import { findComfyLaunch, firstLiveComfy } from '../main/generate/comfy'
import { loadRegistry } from '../main/registry/load'
import { channelEnabled } from '../main/registry/channel'
import { expectedHash } from '../main/net/integrity'
import { mergeComfyStore, readComfyStore, usableComfyModels } from '../main/comfy/store'
import { cudaTierSupport, detectNvidia } from '../main/pid/gpu'
import { comfyEngineReady, pidInstalled, pidRoot } from '../main/pid/paths'
import { installComfyEngine, installPid, pidWeightFiles } from '../main/pid/install'
import { clearComfyPythonCache, comfyPythonReady } from '../main/comfy/pythonEnv'
import { scanComfy } from '../main/comfy/discover'
import { downloadCompanions } from '../main/generate/companions'
import { listNcnnModels, userNcnnDir } from '../main/tools/ncnnModels'
import {
  installedRembgExe,
  rembgModelDir,
  rembgModelFile,
  rembgModelPresent,
  rembgToolDir
} from '../main/rembg/paths'
import { hashFile, setupRembg } from '../main/rembg/setup'
import { isStale, readLock } from '../main/locks'
import { folderStats, freeBytesAt, moveToRecycleBin, tooBigForRecycleBin } from '../main/recycle'
import { engineEnv, resourcePath } from '../main/env'
import { defaultReadinessDeps, removebgReadiness, upscaleReadiness } from '../main/tools/readiness'
import {
  comfyGenerationAvailable,
  generateImages,
  registryArchInfo,
  registryDimCaps,
  scanGenerationModels,
  stopComfyServer
} from '../main/generate'
import type { DoctorDeps } from './commands/doctor'
import type { FileCommandDeps } from './commands/files'
import type { FormatsDeps } from './commands/formats'
import type { GenerateDeps } from './commands/generate'
import type { SetupDeps } from './commands/setup'
import { UsageError } from './exit'
import { pathState } from './inputs'
import type { CliDeps } from './main'
import { statOutput } from './runner'
import { VERSION } from './version'

/** comfy:<model file name, stem or path> -> comfy:<absolute path> (spec 3.4). */
export function resolveUpscaleModel(value: string): string {
  if (!value.startsWith('comfy:')) return value
  const want = value.slice('comfy:'.length)
  const models = usableComfyModels()
  const lower = want.toLowerCase()
  const hit =
    models.find((m) => m.path.toLowerCase() === resolve(want).toLowerCase()) ??
    models.find(
      (m) =>
        basename(m.path).toLowerCase() === lower ||
        basename(m.path, extname(m.path)).toLowerCase() === lower
    )
  if (!hit)
    throw new UsageError(
      `No scanned ComfyUI upscaler matches "${want}". See: filesmith formats upscale`,
      ['upscale'],
      models.length
        ? 'filesmith formats upscale'
        : 'filesmith setup spandrel --comfy "<ComfyUI folder>"'
    )
  return `comfy:${hit.path}`
}

export function defaultFileDeps(): FileCommandDeps {
  return {
    // allowDownload false: a job that would fetch a model or runtime fails with
    // "Run: filesmith setup <tool>" instead (spec M5).
    queue: (emit) => new JobQueue(emit, undefined, { allowDownload: false }),
    hasRar: () => resolveRar() != null,
    readiness: async (id, options) =>
      id === 'upscale'
        ? upscaleReadiness(options, defaultReadinessDeps)
        : id === 'removebg'
          ? removebgReadiness(options, defaultReadinessDeps)
          : { ok: true },
    resolveUpscaleModel,
    fileInfo: fileInfoFromPath,
    statOutput,
    pathState,
    mkdirp: (p) => {
      mkdirSync(p, { recursive: true })
    }
  }
}

export function defaultGenerateDeps(): GenerateDeps {
  return {
    scan: () => scanGenerationModels(),
    archInfo: () => registryArchInfo(),
    dimCaps: () => registryDimCaps(),
    available: () => comfyGenerationAvailable(),
    generate: (opts, onImage, onProgress, onStatus, signal) =>
      generateImages(opts, onImage, onProgress, onStatus, signal),
    stop: () => stopComfyServer(),
    pathState,
    mkdirp: (p) => {
      mkdirSync(p, { recursive: true })
    },
    outSize: (p) => statOutput(p).outSize
  }
}

async function removeTool(
  target: 'pid' | 'removebg',
  o: { permanent: boolean; dryRun: boolean }
): Promise<string> {
  const lock = readLock(target === 'pid' ? 'pid-env' : 'rembg')
  if (lock && !isStale(lock))
    throw new Error(
      `Another Filesmith (${lock.host}, pid ${lock.pid}) is installing right now. Wait for it to finish.`
    )
  const paths = (
    target === 'pid' ? [pidRoot()] : [join(rembgToolDir(), 'rembg'), rembgModelDir()]
  ).filter((p) => existsSync(p))
  if (!paths.length) return 'nothing, it is not installed'
  const items = paths.map((p) => ({ p, ...folderStats(p) }))
  const desc = items.map((i) => `${i.p} (${formatBytes(i.bytes)})`).join(', ')
  const big = items.filter(tooBigForRecycleBin)
  if (o.dryRun)
    return big.length && !o.permanent
      ? `${desc}; too large for the Recycle Bin, needs --permanent`
      : desc
  if (big.length && !o.permanent)
    throw new Error(
      `${big[0].p} is ${formatBytes(big[0].bytes)}, too large for the Recycle Bin. Run again with --permanent to delete it for good.`
    )
  for (const i of items) {
    if (tooBigForRecycleBin(i)) rmSync(i.p, { recursive: true, force: true })
    else await moveToRecycleBin(i.p)
  }
  return desc
}

export function defaultSetupDeps(): SetupDeps {
  return {
    cuda: async () => cudaTierSupport(await detectNvidia()),
    pidInstalled: () => pidInstalled('flux'),
    installPid: (p, o) => installPid('flux', p, o),
    comfyReady: () => comfyEngineReady() || comfyPythonReady(),
    installComfyEngine: (p, o) => installComfyEngine(p, o),
    setComfy: (patch) => {
      mergeComfyStore(patch)
      clearComfyPythonCache()
    },
    scanComfy: async (folder) => {
      const models = await scanComfy(folder)
      mergeComfyStore({ folder, models })
      return models
    },
    generationModels: () => scanGenerationModels().models,
    rembgReady: (m) => installedRembgExe() != null && rembgModelPresent(m),
    setupRembg,
    downloadCompanions,
    ncnnModels: () => listNcnnModels().map((m) => ({ name: m.name, label: m.label, user: m.user })),
    userNcnnDir,
    pathState,
    removeTool,
    freeBytes: () => freeBytesAt(engineEnv().userData),
    userData: () => engineEnv().userData
  }
}

export function defaultFormatsDeps(): FormatsDeps {
  return {
    hasRar: () => resolveRar() != null,
    ncnnModels: () => listNcnnModels().map((m) => ({ name: m.name, label: m.label, user: m.user })),
    comfyModels: () => usableComfyModels(),
    comfyReady: () => comfyEngineReady() || comfyPythonReady(),
    pidInstalled: () => pidInstalled('flux'),
    cudaOk: async () => cudaTierSupport(await detectNvidia()).ok,
    rembgReady: () => installedRembgExe() != null && rembgModelPresent(BG_DEFAULTS.bgModel),
    generationModels: () => scanGenerationModels().models
  }
}

const packaged = (): boolean => basename(process.execPath).toLowerCase() === 'filesmith.exe'

async function probe(
  cmd: string,
  args: string[]
): Promise<{ started: boolean; firstLine: string }> {
  try {
    const r = await run(cmd, args)
    return {
      started: true,
      firstLine: (r.stdout || r.stderr).trim().split(/\r?\n/)[0]?.slice(0, 60) ?? ''
    }
  } catch {
    return { started: false, firstLine: '' }
  }
}

export function defaultDoctorDeps(): DoctorDeps {
  return {
    tool: (name) => {
      const path = resolveTool(name)
      return { path, bundled: path !== name }
    },
    probe,
    ghostscript: resolveGhostscript,
    soffice: resolveSoffice,
    rar: resolveRar,
    realesrgan: resolveRealesrgan,
    ncnnCount: () => listNcnnModels().length,
    exists: existsSync,
    gpu: detectNvidia,
    cuda: (gpu) => cudaTierSupport(gpu),
    pidInstalled: () => pidInstalled('flux'),
    comfyEngineReady,
    comfyPythonReady,
    comfyFolder: () => readComfyStore()?.folder || null,
    comfyModelCount: () => usableComfyModels().length,
    uv: findUvAsync,
    rembgExe: installedRembgExe,
    rembgModel: rembgModelPresent,
    comfyAlive: firstLiveComfy,
    comfyLaunchable: () => findComfyLaunch() != null,
    generationModels: () => scanGenerationModels().models,
    registryWarnings: () => loadRegistry().warnings,
    channelEnabled,
    userData: () => engineEnv().userData,
    writable: (dir) => {
      try {
        mkdirSync(dir, { recursive: true })
        const probeFile = join(dir, `.doctor-${process.pid}`)
        writeFileSync(probeFile, '')
        rmSync(probeFile, { force: true })
        return true
      } catch {
        return false
      }
    },
    freeBytes: freeBytesAt,
    packaged,
    shimDir: () => resourcePath('cli'),
    pathEnv: () => process.env.PATH ?? '',
    appRunning: async () => {
      try {
        const r = await run('tasklist', ['/FI', 'IMAGENAME eq Filesmith.exe', '/FO', 'CSV', '/NH'])
        return r.stdout
          .split(/\r?\n/)
          .map((l) => /^"Filesmith\.exe","(\d+)"/i.exec(l)?.[1])
          .some((pid) => pid && Number(pid) !== process.pid)
      } catch {
        return false
      }
    },
    liveLocks: () =>
      ['pid-env', 'rembg', 'companions']
        .map((n) => readLock(n))
        .filter((l): l is NonNullable<typeof l> => l != null && !isStale(l)),
    proxyConfigured: async () => {
      try {
        const r = await run('reg', [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
          '/v',
          'ProxyEnable'
        ])
        return /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(r.stdout)
      } catch {
        return false
      }
    },
    env: process.env,
    version: VERSION,
    bundledVersion: () => {
      try {
        return (
          JSON.parse(readFileSync(resourcePath('app.asar', 'package.json'), 'utf-8')) as {
            version: string
          }
        ).version
      } catch {
        return null
      }
    },
    deepSmoke: async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'filesmith-doctor-'))
      try {
        const src = join(tmp, 'in.png')
        const out = join(tmp, 'out.png')
        await run(resolveTool('magick'), ['-size', '4x4', 'xc:white', src])
        const r = await run(resolveRealesrgan(), [
          '-i',
          src,
          '-o',
          out,
          '-s',
          '4',
          '-n',
          'realesrgan-x4plus',
          '-m',
          join(realesrganDir(), 'models')
        ])
        return existsSync(out)
          ? { ok: true, detail: 'a 4x4 image upscaled on the GPU' }
          : { ok: false, detail: (r.stderr.trim().split('\n').pop() ?? '').slice(0, 70) }
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    },
    verify: async () => {
      const items = [
        ...pidWeightFiles('flux').map((f) => ({
          id: `pid ${basename(f.path)}`,
          path: f.path,
          key: f.url
        })),
        {
          id: `rembg ${BG_DEFAULTS.bgModel}`,
          path: rembgModelFile(BG_DEFAULTS.bgModel),
          key: `rembg-model:${BG_DEFAULTS.bgModel}`
        }
      ].filter((i) => existsSync(i.path))
      const out: { id: string; ok: boolean; detail: string }[] = []
      for (const i of items) {
        const want = expectedHash(i.key)
        if (!want) {
          out.push({ id: i.id, ok: true, detail: 'no hash on record to compare with' })
          continue
        }
        const got = await hashFile(i.path)
        out.push({
          id: i.id,
          ok: got === want,
          detail:
            got === want
              ? 'sha256 matches'
              : `sha256 differs from the record (${got.slice(0, 12)}...)`
        })
      }
      return out
    }
  }
}

export function defaultDeps(): CliDeps {
  return {
    clock: Date.now,
    files: defaultFileDeps(),
    generate: defaultGenerateDeps(),
    setup: defaultSetupDeps(),
    formats: defaultFormatsDeps(),
    doctor: defaultDoctorDeps()
  }
}
