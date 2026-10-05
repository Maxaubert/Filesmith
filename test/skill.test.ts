import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { installSkill, skillCommand, skillStatus, skillTargetDir } from '../src/main/skill'
import { COMMANDS } from '../src/cli/catalog'

const SRC = resolve(__dirname, '..', 'resources', 'skill', 'filesmith')
let home: string
const trashed: string[] = []
const env = (over = {}) => ({
  home,
  version: '0.6.0',
  command: 'C:/F/resources/cli/filesmith',
  sourceDir: SRC,
  trash: async (p: string) => void trashed.push(p),
  ...over
})
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'fs-home-'))
  trashed.length = 0
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('skill', () => {
  it('installs into ~/.claude/skills/filesmith with the version and command filled in', async () => {
    const r = await installSkill(env())
    expect(r).toMatchObject({
      path: skillTargetDir(home),
      updated: false,
      changed: ['SKILL.md', 'reference.md']
    })
    const text = readFileSync(join(skillTargetDir(home), 'SKILL.md'), 'utf-8')
    expect(text).toContain('filesmith-version: 0.6.0')
    expect(text).toContain('C:/F/resources/cli/filesmith')
    expect(text).not.toContain('{{')
    expect(skillStatus(home, '0.6.0')).toMatchObject({
      installed: true,
      version: '0.6.0',
      current: true
    })
  })

  it('updating replaces only its own files, trashing the old copies, and keeps foreign files', async () => {
    await installSkill(env({ version: '0.5.9' }))
    writeFileSync(join(skillTargetDir(home), 'notes.md'), 'mine')
    const r = await installSkill(env())
    expect(r).toMatchObject({ updated: true, previousVersion: '0.5.9' })
    expect(trashed.map((p) => p.split(/[\\/]/).pop())).toContain('SKILL.md')
    expect(readFileSync(join(skillTargetDir(home), 'notes.md'), 'utf-8')).toBe('mine')
  })

  it('a dry run changes nothing; an up-to-date install changes nothing', async () => {
    const dry = await installSkill(env({ dryRun: true }))
    expect(dry.changed).toEqual(['SKILL.md', 'reference.md'])
    expect(existsSync(skillTargetDir(home))).toBe(false)
    await installSkill(env())
    expect((await installSkill(env())).changed).toEqual([])
  })

  it('status of a missing or older skill', () => {
    expect(skillStatus(home, '0.6.0')).toMatchObject({
      installed: false,
      version: null,
      current: false
    })
    mkdirSync(skillTargetDir(home), { recursive: true })
    writeFileSync(join(skillTargetDir(home), 'SKILL.md'), '---\nfilesmith-version: 0.5.0\n---\n')
    expect(skillStatus(home, '0.6.0')).toMatchObject({
      installed: true,
      version: '0.5.0',
      current: false
    })
  })

  it('the command is the sh shim when packaged, node + cli.js in dev', () => {
    expect(skillCommand(true, 'C:\\P\\Filesmith\\resources')).toBe(
      'C:/P/Filesmith/resources/cli/filesmith'
    )
    expect(skillCommand(false, 'D:\\repo\\resources')).toBe('node D:/repo/out/main/cli.js')
  })

  it('reference.md names every command and every flag (drift guard)', () => {
    const ref = readFileSync(join(SRC, 'reference.md'), 'utf-8')
    for (const c of COMMANDS) {
      expect(ref, c.id).toContain(c.path[c.path.length - 1])
      for (const f of c.flags) expect(ref, `${c.id} --${f.name}`).toContain(`--${f.name}`)
    }
  })

  it('the skill frontmatter starts with name and a "Use when" description', () => {
    const md = readFileSync(join(SRC, 'SKILL.md'), 'utf-8')
    expect(md).toMatch(/^---\nname: filesmith\ndescription: Use when /)
  })
})
