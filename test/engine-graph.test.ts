import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { importGraph } from './helpers/importGraph'

// The CLI runs as plain Node, where require('electron') is a path string and
// every app/net call throws. These are the engine roots the CLI will import.
const ROOTS = [
  'src/main/env.ts',
  'src/main/boot.ts',
  'src/main/jobQueue.ts',
  'src/main/generate/index.ts',
  'src/main/pid/install.ts',
  'src/main/comfy/discover.ts',
  'src/main/toolResolver.ts'
]

describe('engine import graph', () => {
  for (const root of ROOTS)
    it(`${root} never reaches electron`, () => {
      const { externals } = importGraph(resolve(__dirname, '..', root))
      expect([...externals]).not.toContain('electron')
    })
})
