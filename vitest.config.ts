import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Main-process modules import { app } from 'electron' at module scope;
      // this minimal stub lets unit tests load them without a running Electron.
      electron: resolve(__dirname, 'test/mocks/electron.ts')
    }
  },
  test: {
    include: ['test/**/*.test.ts']
  }
})
