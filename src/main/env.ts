import { join } from 'path'

/**
 * Everything the engine needs from its host, in one place (spec 4.2, M1).
 *
 * The app sets it from Electron (`app.getPath`, `net.fetch`); the command line
 * sets it from plain Node, where `electron.app` does not exist. No engine module
 * may import 'electron' itself: a test walks the CLI's import graph.
 */
export interface EngineEnv {
  /** %APPDATA%\Filesmith, shared by the app and the CLI. */
  userData: string
  /** The folder holding bin/, libreoffice/, ghostscript/, realesrgan/, registry/ ... */
  resourcesDir: string
  /** The app's Generate output folder. */
  downloadsDir: string
  /** Electron's net.fetch in the app (system proxy, Windows trust store); Node's
   * fetch in the CLI (the shims add --use-system-ca and NODE_USE_ENV_PROXY=1). */
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  host: 'app' | 'cli'
}

let current: EngineEnv | null = null

export function setEngineEnv(e: EngineEnv): void {
  current = e
}

export function engineEnv(): EngineEnv {
  if (!current) throw new Error('engine env not configured')
  return current
}

export function resourcePath(...parts: string[]): string {
  return join(engineEnv().resourcesDir, ...parts)
}

export function userDataPath(...parts: string[]): string {
  return join(engineEnv().userData, ...parts)
}

/** Tests only: simulate a host that forgot to configure the engine. */
export function resetEngineEnvForTests(): void {
  current = null
}
