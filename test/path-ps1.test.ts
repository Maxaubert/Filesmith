import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { resolve } from 'path'

// Runs the real script against a throwaway HKCU key, never HKCU\Environment.
const SCRIPT = resolve(__dirname, '..', 'resources', 'cli', 'path.ps1')
const KEY = `Software\\FilesmithTest\\Env-${process.pid}`
const REG = `HKCU\\${KEY}`
const ps = (action: string, dir: string): void => {
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    SCRIPT,
    action,
    dir,
    '-Key',
    KEY
  ])
}
const read = (): string => {
  const out = execFileSync('reg', ['query', REG, '/v', 'Path']).toString()
  return /Path\s+REG_EXPAND_SZ\s+(.*)/.exec(out)?.[1]?.trim() ?? `not expand_sz: ${out}`
}

afterAll(() => {
  if (process.platform === 'win32')
    spawnSync('reg', ['delete', 'HKCU\\Software\\FilesmithTest', '/f'])
})

describe.skipIf(process.platform !== 'win32')('path.ps1', () => {
  it('adds once, keeps %VARS% unexpanded and REG_EXPAND_SZ, removes cleanly', () => {
    execFileSync('reg', [
      'add',
      REG,
      '/v',
      'Path',
      '/t',
      'REG_EXPAND_SZ',
      '/d',
      '%USERPROFILE%\\bin;C:\\Other',
      '/f'
    ])
    ps('add', 'C:\\Apps\\Filesmith\\resources\\cli')
    ps('add', 'c:\\apps\\filesmith\\resources\\cli\\')
    expect(read()).toBe('%USERPROFILE%\\bin;C:\\Other;C:\\Apps\\Filesmith\\resources\\cli')
    ps('remove', 'C:\\APPS\\Filesmith\\resources\\cli')
    expect(read()).toBe('%USERPROFILE%\\bin;C:\\Other')
    ps('remove', 'C:\\Apps\\Filesmith\\resources\\cli')
    expect(read()).toBe('%USERPROFILE%\\bin;C:\\Other')
  })

  it('creates the value when the user has no PATH of their own yet', () => {
    spawnSync('reg', ['delete', REG, '/v', 'Path', '/f'])
    ps('add', 'D:\\F\\resources\\cli')
    expect(read()).toBe('D:\\F\\resources\\cli')
  })
})
