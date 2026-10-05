import { app, ipcMain } from 'electron'
import { fork, spawn } from 'child_process'
import { homedir } from 'os'
import { join, win32 } from 'path'
import type { ConsoleCdResult, ConsoleRunResult } from '@shared/console'
import { isDir, listEntries, resolveCd } from './dirs'
import { startCliRun, type RunDeps, type RunHandle } from './runCli'
import { openTerminal } from './terminal'
import { catalog, validateRun } from './validate'

const deps: RunDeps = {
  fork: (script, argv, opts) => fork(script, argv, opts),
  kill: (pid) =>
    void spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    }),
  later: (fn, ms) => {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  }
}

export function registerConsoleIpc(): { stopAll(): void } {
  const runs = new Map<string, RunHandle>()
  const bySender = new Map<number, string>()

  ipcMain.handle('console:catalog', () => catalog)
  ipcMain.handle(
    'console:run',
    async (e, id: unknown, line: unknown, cwd: unknown): Promise<ConsoleRunResult> => {
      if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || runs.has(id))
        return { ok: false, error: 'Bad run id.' }
      const v = validateRun(line, cwd, isDir)
      if (!v.ok) return v
      if (bySender.has(e.sender.id))
        return { ok: false, error: 'A console command is already running.' }
      const wc = e.sender
      // The program is fixed: this app's own executable running the bundled
      // cli.js. Nothing from the renderer names a program or reaches a shell.
      const h = startCliRun(
        {
          script: join(__dirname, 'cli.js'),
          argv: v.argv,
          cwd: v.cwd,
          emit: (body) => {
            if (!wc.isDestroyed()) wc.send('console:event', { id, ...body })
          }
        },
        deps
      )
      runs.set(id, h)
      bySender.set(wc.id, id)
      try {
        return { ok: true, code: await h.done }
      } finally {
        runs.delete(id)
        bySender.delete(wc.id)
      }
    }
  )
  ipcMain.on('console:cancel', (_e, id: string) => runs.get(id)?.cancel())
  ipcMain.handle('console:dir', (_e, p: string) => (isDir(String(p)) ? p : null))
  ipcMain.handle('console:default-dir', () => {
    const dl = app.getPath('downloads')
    return isDir(dl) ? dl : homedir()
  })
  ipcMain.handle('console:cd', (_e, base: string, arg: string): ConsoleCdResult => {
    const dir = resolveCd(String(base), String(arg), homedir())
    return isDir(dir) ? { ok: true, dir } : { ok: false, error: `cd: ${dir} is not a folder.` }
  })
  ipcMain.handle('console:list', (_e, cwd: string, dir: string, name: string) => {
    const full = win32.resolve(String(cwd), String(dir || '.'))
    return { dir: full, entries: isDir(full) ? listEntries(full, String(name)) : [] }
  })

  // The folder is the only input; the programs (wt.exe, powershell.exe) and the
  // encoded PATH script are fixed by main. spawn without `shell`.
  ipcMain.handle('console:terminal', (_e, dir: unknown) =>
    typeof dir === 'string' && isDir(dir)
      ? openTerminal(dir)
      : { ok: false, error: 'The console folder does not exist.' }
  )

  return {
    stopAll: () => {
      for (const h of runs.values()) {
        h.cancel()
        setTimeout(() => h.kill(), 2000).unref()
      }
    }
  }
}
