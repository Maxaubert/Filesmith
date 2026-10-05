import { createHash } from 'crypto'
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { run } from '../run'
import { withFileLock } from '../locks'
import { recordHash } from '../net/integrity'
import { ensureUv, type InstallOpts, type InstallProgress } from '../uvInstall'
import {
  REMBG_SPEC,
  existingRembgModelFile,
  installedRembgExe,
  rembgEnv,
  rembgExe,
  rembgModelDir,
  rembgModelFile,
  rembgModelPresent,
  rembgToolDir
} from './paths'

/** A 1x1 PNG: the warm-up input that makes rembg fetch its model. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

const lastLine = (s: string): string => s.trim().split('\n').pop()?.trim() ?? ''

/** Where pre-0.6 `uv tool run rembg` left its models: the user's own
 * U2NET_HOME, else rembg's defaults (`~/.u2net` up to 2.0.8x, `~/.rembg` after),
 * each in the flat and the per-model layout. Returns the first that exists, else
 * the first candidate. Reusing that file saves an existing user a second
 * download of about 1 GB. */
export function legacyRembgModelFile(model: string, env = process.env, home = homedir()): string {
  const homes = env.U2NET_HOME
    ? [env.U2NET_HOME]
    : [join(home, '.u2net'), env.REMBG_HOME || join(home, '.rembg')]
  const f = `${model}.onnx`
  const candidates = homes.flatMap((h) => [join(h, f), join(h, 'models', model, f)])
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

/**
 * One-time background-removal setup (spec 5.3, M6): uv (bootstrapped when
 * absent), `uv tool install` of rembg into our own tool dir, then a 1x1 warm-up
 * run with U2NET_HOME pinned so the model lands in a known file we can check
 * and hash. Idempotent; one setup per machine at a time.
 */
export async function setupRembg(
  model: string,
  onProgress: InstallProgress,
  opts: InstallOpts = {}
): Promise<void> {
  await withFileLock(
    'rembg',
    'background removal',
    async () => {
      if (!installedRembgExe()) {
        const uv = await ensureUv(onProgress, opts)
        onProgress('Installing the background-removal engine (rembg)', null)
        const res = await run(uv, ['tool', 'install', '--python', '3.11', REMBG_SPEC], {
          signal: opts.signal,
          env: {
            ...process.env,
            UV_TOOL_DIR: rembgToolDir(),
            UV_TOOL_BIN_DIR: join(rembgToolDir(), 'bin')
          }
        })
        if (res.code !== 0) throw new Error(`rembg install failed: ${lastLine(res.stderr)}`)
        if (!existsSync(rembgExe()))
          throw new Error('rembg install finished but rembg.exe is missing.')
      }
      const legacy = legacyRembgModelFile(model)
      if (!rembgModelPresent(model) && legacy !== rembgModelFile(model) && existsSync(legacy)) {
        mkdirSync(rembgModelDir(), { recursive: true })
        onProgress(`Reusing the ${model} model already on this PC`, null)
        const part = `${rembgModelFile(model)}.${process.pid}.tmp`
        copyFileSync(legacy, part)
        renameSync(part, rembgModelFile(model))
      }
      if (!rembgModelPresent(model)) {
        mkdirSync(rembgModelDir(), { recursive: true })
        const tmp = mkdtempSync(join(tmpdir(), 'filesmith-rembg-'))
        const step = `Downloading the ${model} model`
        try {
          const src = join(tmp, 'in.png')
          writeFileSync(src, TINY_PNG)
          onProgress(step, null)
          const res = await run(
            installedRembgExe() as string,
            ['i', '-m', model, src, join(tmp, 'out.png')],
            {
              signal: opts.signal,
              env: rembgEnv(),
              // pooch draws a tqdm bar: "  42%|####      |"
              onStderr: (s) => {
                const m = /(\d{1,3})%\|/.exec(s)
                if (m) onProgress(step, Number(m[1]))
              }
            }
          )
          if (res.code !== 0 || !rembgModelPresent(model))
            throw new Error(`The ${model} model could not be downloaded: ${lastLine(res.stderr)}`)
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
        const file = existingRembgModelFile(model) as string
        recordHash(`rembg-model:${model}`, await hashFile(file), statSync(file).size)
      }
      onProgress('Ready', 100)
    },
    {
      signal: opts.signal,
      onWait: () => onProgress('Waiting for another Filesmith to finish setting up', null)
    }
  )
}
