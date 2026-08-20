import { defineConfig } from '@playwright/test'

// End-to-end tests drive the REAL built app through Electron (_electron.launch)
// — the preload contract, IPC wiring and engine that 300+ unit tests cannot
// touch. Run `npm run build` first (the specs launch out/main/index.js).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  // One app instance at a time: the app holds a single-instance lock, and the
  // suites share the bundled binaries.
  workers: 1,
  reporter: [['list']]
})
