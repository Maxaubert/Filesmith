import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { importGraph } from './helpers/importGraph'

describe('CLI import graph', () => {
  it('nothing reachable from the CLI entry imports electron', () => {
    const { externals, files } = importGraph(resolve(__dirname, '..', 'src', 'cli', 'bootstrap.ts'))
    expect([...externals]).not.toContain('electron')
    for (const banned of ['index.ts', 'ipc.ts', 'session.ts', 'thumbnail.ts'])
      expect(
        files.some((f) => f.endsWith(`src\\main\\${banned}`) || f.endsWith(`src/main/${banned}`)),
        banned
      ).toBe(false)
  })
})
