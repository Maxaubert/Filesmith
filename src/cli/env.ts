import { basename, dirname, join } from 'path'
import type { EngineEnv } from '../main/env'

export interface ProcessFacts {
  execPath: string
  resourcesPath?: string
  env: Record<string, string | undefined>
  homedir: string
  /** The folder holding cli.js (out/main in dev, app.asar/out/main packed). */
  moduleDir: string
}

/** The CLI's engine env (spec 4.2). Pure, so packaged and dev layouts are tested
 * without either being present. */
export function cliEngineEnv(f: ProcessFacts, fetchImpl: EngineEnv['fetch']): EngineEnv {
  const packaged = basename(f.execPath).toLowerCase() === 'filesmith.exe'
  const resourcesDir = packaged
    ? (f.resourcesPath ?? join(dirname(f.execPath), 'resources'))
    : join(f.moduleDir, '..', '..', 'resources')
  const appData = f.env.APPDATA ?? join(f.homedir, 'AppData', 'Roaming')
  return {
    userData: f.env.FILESMITH_USER_DATA || join(appData, 'Filesmith'),
    resourcesDir,
    downloadsDir: join(f.homedir, 'Downloads'),
    fetch: fetchImpl,
    host: 'cli'
  }
}
