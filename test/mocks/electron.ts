import { join } from 'path'
import { tmpdir } from 'os'

// Minimal electron stand-in so unit tests can load main-process modules
// (tools/registry.ts and friends) that import { app } at module scope. Only
// the surface those modules touch at LOAD time is provided; anything that
// would actually need a running Electron throws, which is the correct signal
// that a unit test is reaching too far.

// One userData root per test process: vitest runs files in parallel workers,
// and a shared root let registry-hardening's user fragment leak into
// registry.test.ts's "loads with no warnings" check (an intermittent failure).
const userDataRoot = join(tmpdir(), `filesmith-test-userdata-${process.pid}`)

export const app = {
  isPackaged: false,
  getAppPath: (): string => process.cwd(),
  getPath: (name: string): string => join(userDataRoot, name)
}

export const nativeImage = {
  createThumbnailFromPath: async (): Promise<never> => {
    throw new Error('nativeImage is not available in unit tests')
  }
}

export default { app, nativeImage }
