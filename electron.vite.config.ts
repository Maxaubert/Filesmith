import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

// Electron's Chromium always reads woff2, so the woff fallback in the Fontsource
// CSS only adds files to the installer. Only the fallback is removed: every
// face and unicode subset stays, so file names in any shipped script still use
// IBM Plex. Fails the build if a Fontsource update changes the CSS shape.
function woff2Only(): Plugin {
  return {
    name: 'filesmith:woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/@fontsource\/.+\.css$/.test(id.split('?')[0])) return null
      const out = code.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, '')
      if (/\.woff\b|format\('woff'\)/.test(out)) this.error(`woff fallback left in ${id}`)
      return { code: out, map: null }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The command line (spec 4.1). Runs as plain Node under
          // ELECTRON_RUN_AS_NODE, so nothing it reaches may import electron.
          cli: resolve(__dirname, 'src/cli/bootstrap.ts'),
          // Cleans up after a CLI that was killed outright (src/cli/watchdog.ts).
          cliWatchdog: resolve(__dirname, 'src/cli/watchdog.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [woff2Only(), react(), tailwindcss()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
})
