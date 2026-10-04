import { _electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIN, ROOT } from './helpers'

// The files table's right-click menu and the one-file inspector panes, on a
// seeded session. Nothing here deletes a file: Delete is only opened and
// cancelled, so the test never touches the Recycle Bin.
let app: ElectronApplication
let page: Page
let userData: string

const NAMES = ['alpha.png', 'bravo.png', 'charlie.png']

test.beforeAll(async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  userData = mkdtempSync(join(tmpdir(), 'filesmith-menu-'))
  const files = join(userData, 'files')
  mkdirSync(files)
  const items = NAMES.map((name, i) => {
    const path = join(files, name)
    writeFileSync(path, 'not really a png')
    return {
      id: `m-${i}`,
      file: { path, name, ext: '.png', kind: 'image', size: 16 },
      thumb: null,
      status: i === 2 ? 'failed' : 'ready',
      percent: 0,
      ...(i === 2 ? { error: 'Broken' } : {})
    }
  })
  const session = {
    version: 2,
    lastTool: null,
    options: {},
    genResults: [],
    queues: { convert: { items } }
  }
  writeFileSync(join(userData, 'session.json'), JSON.stringify(session))
  app = await _electron.launch({
    args: [ROOT],
    env: { ...process.env, FILESMITH_USER_DATA: userData }
  })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await expect(row('alpha')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  if (userData) rmSync(userData, { recursive: true, force: true })
})

const row = (name: string) =>
  page.getByRole('grid', { name: 'Files' }).getByRole('row', { name: new RegExp(name) })
const menu = () => page.getByRole('menu')
const item = (name: string | RegExp) => menu().getByRole('menuitem', { name })

test('right-clicking an unselected row selects it and opens its menu', async () => {
  await row('bravo').click({ button: 'right' })
  await expect(row('bravo')).toHaveAttribute('aria-selected', 'true')
  await expect(item('Show in File Explorer')).toBeEnabled()
  await expect(item('Remove from list')).toBeEnabled()
  await expect(item('Delete file')).toBeEnabled()
  await expect(item('Retry')).toBeDisabled()
  await expect(item('Stop')).toBeDisabled()
  // Keyboard: focus starts on the first entry and arrows walk the live ones.
  await expect(item('Open')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item('Show in File Explorer')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
})

test('a multi-selection menu counts, and Preview and Info show no single file', async () => {
  await row('alpha').click()
  await row('charlie').click({ modifiers: ['Shift'] })
  await row('bravo').click({ button: 'right' })
  await expect(item('Remove 3 from list')).toBeVisible()
  await expect(item('Delete 3 files')).toBeVisible()
  await expect(item('Open')).toBeDisabled()
  await expect(item('Show in File Explorer')).toBeDisabled()
  await expect(item('Retry')).toBeEnabled()
  // Delete asks first, names the count and the Recycle Bin; cancel leaves all.
  await item('Delete 3 files').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg).toContainText('Delete 3 files?')
  await expect(dlg).toContainText('Recycle Bin')
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(row('alpha')).toBeVisible()

  await page.getByRole('tab', { name: 'Preview' }).click()
  await expect(page.getByText('Select one file to preview')).toBeVisible()
  await page.getByRole('tab', { name: 'Info' }).click()
  await expect(page.getByText('Select one file to see its info')).toBeVisible()
  await page.getByRole('tab', { name: 'Options' }).click()
})

test('Remove from list asks first; the Delete key opens the same confirm', async () => {
  await row('charlie').click()
  await row('charlie').press('Delete')
  const dlg = page.getByRole('dialog')
  await expect(dlg).toContainText('Remove this file from the list?')
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(row('charlie')).toBeVisible()

  await row('charlie').click({ button: 'right' })
  await item('Remove from list').click()
  await dlg.getByRole('button', { name: 'Remove' }).click()
  await expect(row('charlie')).toHaveCount(0)
  // The file on disk is untouched.
  expect(existsSync(join(userData, 'files', 'charlie.png'))).toBe(true)
})
