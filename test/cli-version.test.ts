import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/cli/version'

describe('VERSION', () => {
  it('is the package.json version, injected at build time', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
      version: string
    }
    expect(VERSION).toBe(pkg.version)
  })
})
