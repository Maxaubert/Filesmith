import { existsSync } from 'fs'
import { join } from 'path'
import { userDataPath } from '../env'

// rembg as an explicit, detectable install (spec M6). It used to run through
// `uv tool run`, which installs ~84 packages and then the model on first use,
// invisibly; "ready" could not be known, so the CLI could not refuse.

const EXE = process.platform === 'win32' ? '.exe' : ''

/** A RANGE, not an exact pin: the floor keeps the numba/Python-3.13 fix, the
 * ceiling keeps a major release from changing the CLI under us. */
export const REMBG_SPEC = 'rembg[cli,cpu]>=2.0.75,<3'

/** Our own uv tool dir, so the install never touches the user's uv tools. */
export function rembgToolDir(): string {
  return userDataPath('uv-tools')
}

export function rembgExe(): string {
  return join(rembgToolDir(), 'rembg', 'Scripts', 'rembg' + EXE)
}

/** Where `uv tool install rembg` put it before 0.6.0 (uv's default dir). */
export function legacyRembgExe(): string {
  return join(process.env.APPDATA ?? '', 'uv', 'tools', 'rembg', 'Scripts', 'rembg' + EXE)
}

/** The pinned model folder (U2NET_HOME), shared by the app and the CLI. */
export function rembgModelDir(): string {
  return userDataPath('models', 'rembg')
}

/** The flat `<U2NET_HOME>/<session name>.onnx`. Every rembg 2.x reads it, so
 * it is where a reused model is copied. Observed 2026-10-05: rembg 2.0.85
 * DOWNLOADS into `<U2NET_HOME>/models/<name>/<name>.onnx` instead (see
 * rembgModelNestedFile), while 2.0.75 (pre-0.6 installs) reads only this one. */
export function rembgModelFile(model: string): string {
  return join(rembgModelDir(), `${model}.onnx`)
}

/** Where rembg 2.0.85 and later save a downloaded model (`model_dir()`). */
export function rembgModelNestedFile(model: string): string {
  return join(rembgModelDir(), 'models', model, `${model}.onnx`)
}

/** The model file rembg will load, in either layout, or null. */
export function existingRembgModelFile(model: string): string | null {
  for (const p of [rembgModelFile(model), rembgModelNestedFile(model)]) if (existsSync(p)) return p
  return null
}

export function installedRembgExe(): string | null {
  for (const p of [rembgExe(), legacyRembgExe()]) if (existsSync(p)) return p
  return null
}

export function rembgModelPresent(model: string): boolean {
  return existingRembgModelFile(model) != null
}

export function rembgEnv(): NodeJS.ProcessEnv {
  return { ...process.env, U2NET_HOME: rembgModelDir() }
}
