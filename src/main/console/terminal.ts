import { app } from 'electron'
import { spawn } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

// Open in terminal (spec 9.6): Windows Terminal if it starts, else PowerShell,
// in the console's folder, with the filesmith shim folder first on PATH. PATH
// is set inside the shell because a running Windows Terminal ignores the
// caller's environment for new windows.

export const encodePs = (script: string): string =>
  Buffer.from(script, 'utf16le').toString('base64')

export const pathScript = (cliDir: string): string =>
  `$env:Path = '${cliDir.replace(/'/g, "''")};' + $env:Path`

export interface Launch {
  cmd: string
  args: string[]
  cwd?: string
}

export function terminalLaunch(dir: string, cliDir: string, wt: boolean): Launch {
  const ps = ['-NoExit', '-NoLogo', '-EncodedCommand', encodePs(pathScript(cliDir))]
  return wt
    ? {
        cmd: 'wt.exe',
        args: ['-w', 'new', '-d', dir.replace(/;/g, '\\;'), 'powershell.exe', ...ps]
      }
    : { cmd: 'powershell.exe', args: ps, cwd: dir }
}

// cmd expands %...% inside a .cmd file even in quotes, so a literal % in a
// path (a known gotcha on this machine) is doubled.
const cmdLit = (p: string): string => p.replace(/%/g, '%%')
export const devShimText = (execPath: string, cliJs: string): string =>
  `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${cmdLit(execPath)}" "${cmdLit(cliJs)}" %*\r\nexit /b %ERRORLEVEL%\r\n`

/** Packaged: resources\cli (the installer's shims). Dev: an app-owned shim. */
function cliDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'cli')
  const dir = join(app.getPath('userData'), 'dev-cli')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'filesmith.cmd'),
    devShimText(process.execPath, join(__dirname, 'cli.js'))
  )
  return dir
}

function start(l: Launch): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn(l.cmd, l.args, {
      cwd: l.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    c.once('error', () => resolve(false))
    c.once('spawn', () => {
      c.unref()
      resolve(true)
    })
  })
}

export async function openTerminal(dir: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const bin = cliDir()
    if (await start(terminalLaunch(dir, bin, true))) return { ok: true }
    if (await start(terminalLaunch(dir, bin, false))) return { ok: true }
    return { ok: false, error: 'Neither Windows Terminal nor PowerShell could be started.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
