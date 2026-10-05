import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Main-process modules import { app } from 'electron' at module scope;
      // this minimal stub lets unit tests load them without a running Electron.
      electron: resolve(__dirname, 'test/mocks/electron.ts')
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup/engineEnv.ts']
  }
})
