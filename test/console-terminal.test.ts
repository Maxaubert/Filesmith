import { describe, expect, it } from 'vitest'
import { devShimText, encodePs, pathScript, terminalLaunch } from '../src/main/console/terminal'

const decode = (b64: string): string => Buffer.from(b64, 'base64').toString('utf16le')

describe('terminal launch', () => {
  it('puts the CLI folder first on PATH inside PowerShell, quotes doubled', () => {
    expect(pathScript('C:\\Program Files\\Filesmith\\resources\\cli')).toBe(
      "$env:Path = 'C:\\Program Files\\Filesmith\\resources\\cli;' + $env:Path"
    )
    expect(pathScript("D:\\O'Neil\\cli")).toContain("'D:\\O''Neil\\cli;'")
    expect(decode(encodePs('$x = 1'))).toBe('$x = 1')
  })
  it('Windows Terminal: a new window in the folder, ; escaped', () => {
    const l = terminalLaunch('D:\\a;b', 'C:\\cli', true)
    expect(l.cmd).toBe('wt.exe')
    expect(l.args.slice(0, 4)).toEqual(['-w', 'new', '-d', 'D:\\a\\;b'])
    expect(l.args.slice(4, 8)).toEqual(['powershell.exe', '-NoExit', '-NoLogo', '-EncodedCommand'])
    expect(decode(l.args[8])).toBe(pathScript('C:\\cli'))
    expect(l.args.join(' ')).not.toMatch(/(^|[^\\]);/)
  })
  it('fallback: PowerShell with the folder as cwd', () => {
    const l = terminalLaunch('D:\\Photos', 'C:\\cli', false)
    expect(l).toEqual({
      cmd: 'powershell.exe',
      args: ['-NoExit', '-NoLogo', '-EncodedCommand', encodePs(pathScript('C:\\cli'))],
      cwd: 'D:\\Photos'
    })
  })
  it('dev shim runs the dev Electron as Node on cli.js', () => {
    expect(devShimText('X:\\e\\electron.exe', 'X:\\out\\main\\cli.js')).toBe(
      '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"X:\\e\\electron.exe" "X:\\out\\main\\cli.js" %*\r\nexit /b %ERRORLEVEL%\r\n'
    )
    expect(devShimText('X:\\100%\\electron.exe', 'X:\\c.js')).toContain('"X:\\100%%\\electron.exe"')
  })
})
