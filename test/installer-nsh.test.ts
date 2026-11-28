import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// NSIS does not compile here, so these are text checks on the installer script.
const DIR = join(__dirname, '../build/installer')
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8').replace(/\r\n/g, '\n')

function body(src: string, start: RegExp, end: RegExp): string {
  const from = src.search(start)
  expect(from).toBeGreaterThanOrEqual(0)
  const rest = src.slice(from)
  const to = rest.search(end)
  expect(to).toBeGreaterThan(0)
  return rest.slice(0, to)
}

describe('installer: filesmithOwnFolder', () => {
  const fn = body(read('pages.nsh'), /^Function filesmithOwnFolder$/m, /^FunctionEnd$/m)

  it('keeps a folder that already holds a Filesmith install', () => {
    expect(fn).toMatch(/\$\{FileExists\} "\$INSTDIR\\\$\{PRODUCT_FILENAME\}\.exe"/)
    expect(fn).toMatch(/\$\{FileExists\} "\$INSTDIR\\Uninstall \$\{PRODUCT_FILENAME\}\.exe"/)
  })

  it('only takes a folder named Filesmith as is when it is empty', () => {
    expect(fn).toMatch(/FindFirst \$0 \$1 "\$INSTDIR\\\*\.\*"/)
    expect(fn).toMatch(/FindNext \$0 \$1/)
    expect(fn).toMatch(/FindClose \$0/)
    expect(fn).toContain('$1 != "."')
    expect(fn).toContain('$1 != ".."')
  })

  it('matches a whole last segment, not a bare suffix', () => {
    expect(fn).toContain('${If} $1 == "\\${APP_FILENAME}"')
    expect(fn).not.toContain('${If} $1 != "${APP_FILENAME}"')
  })

  it('restores every register it pushes', () => {
    const pushes = fn.match(/^\s*Push (\$\w+)/gm)?.map((l) => l.trim().slice(5)) ?? []
    const pops = fn.match(/^\s*Pop (\$\w+)/gm)?.map((l) => l.trim().slice(4)) ?? []
    expect(pushes.length).toBeGreaterThan(0)
    expect(pops).toEqual([...pushes].reverse())
  })
})

describe('installer: PATH macros', () => {
  const src = read('path.nsh')

  for (const name of ['filesmithPathAdd', 'filesmithPathRemove']) {
    it(`${name} checks the nsExec result`, () => {
      const mac = body(src, new RegExp(`^!macro ${name}$`, 'm'), /^!macroend$/m)
      expect(mac).toMatch(/nsExec::ExecToLog[^\n]*\n\s*Pop \$0\n\s*\$\{If\} \$0 != "0"/)
      expect(mac).toContain('DetailPrint')
      expect(mac).toContain('WM_SETTINGCHANGE')
    })
  }

  it('tells the user how to add the folder by hand, unless silent', () => {
    const add = body(src, /^!macro filesmithPathAdd$/m, /^!macroend$/m)
    expect(add).toMatch(/\$\{IfNot\} \$\{Silent\}\n\s*MessageBox MB_OK\|MB_ICONEXCLAMATION/)
    expect(add).toContain('$INSTDIR\\resources\\cli"')
    expect(add).not.toMatch(/\bAbort\b/)
  })

  it('never shows a message box on uninstall', () => {
    const rm = body(src, /^!macro filesmithPathRemove$/m, /^!macroend$/m)
    expect(rm).not.toContain('MessageBox')
  })
})
