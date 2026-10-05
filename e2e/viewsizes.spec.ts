import { _electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIN, ROOT } from './helpers'

// View sizes (spec docs/superpowers/specs/2026-10-05-view-sizes-design.md) on a
// seeded session: four images and a video, so there are two group headers.
let app: ElectronApplication
let page: Page
let userData: string

const FILES: [string, string, string][] = [
  ['alpha.png', '.png', 'image'],
  ['bravo.png', '.png', 'image'],
  ['charlie.png', '.png', 'image'],
  ['delta.png', '.png', 'image'],
  ['clip.mp4', '.mp4', 'video']
]

test.beforeAll(async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  userData = mkdtempSync(join(tmpdir(), 'filesmith-view-'))
  const dir = join(userData, 'files')
  mkdirSync(dir)
  const items = FILES.map(([name, ext, kind], i) => {
    const path = join(dir, name)
    writeFileSync(path, 'not really media')
    return {
      id: `v-${i}`,
      file: { path, name, ext, kind, size: 16 },
      thumb: null,
      status: 'ready',
      percent: 0
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

const grid = () => page.getByRole('grid', { name: 'Files' })
const row = (name: string) => grid().getByRole('row', { name: new RegExp(name) })
const viewBtn = () => page.getByRole('button', { name: /^View: / })
const sizeIs = (s: string) => expect(grid()).toHaveAttribute('data-size', s)
const zoom = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())

async function ctrlWheel(x: number, y: number, dy: number): Promise<void> {
  await page.mouse.move(x, y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, dy)
  await page.keyboard.up('Control')
  // One step per 90ms at most: let the next notch count.
  await page.waitForTimeout(150)
}

test('the View menu lists the five sizes and picks one', async () => {
  await sizeIs('details')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Details')
  await viewBtn().click()
  const menu = page.getByRole('menu', { name: 'View' })
  const items = menu.getByRole('menuitemradio')
  await expect(items).toHaveText([
    /Details\s*Ctrl\+Shift\+1/,
    /Tiles\s*Ctrl\+Shift\+2/,
    /Medium icons\s*Ctrl\+Shift\+3/,
    /Large icons\s*Ctrl\+Shift\+4/,
    /Extra large icons\s*Ctrl\+Shift\+5/
  ])
  await expect(items.first()).toHaveAttribute('aria-checked', 'true')
  await expect(items.first()).toBeFocused()
  await items.nth(3).click()
  await expect(menu).toHaveCount(0)
  await sizeIs('large')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Large icons')
  // Group headers stay, one per convert group.
  await expect(grid().getByRole('gridcell', { name: /IMAGES/ })).toBeVisible()
  await expect(grid().getByRole('gridcell', { name: /VIDEO/ })).toBeVisible()
  await page.keyboard.press('Control+0')
  await sizeIs('details')
})

test('Ctrl+wheel over the list steps the size; over the inspector it does nothing', async () => {
  const g = (await grid().boundingBox())!
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, -100)
  await sizeIs('tiles')
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, -100)
  await sizeIs('medium')
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, 100)
  await sizeIs('tiles')
  const insp = (await page.locator('.insp').boundingBox())!
  await ctrlWheel(insp.x + insp.width / 2, insp.y + insp.height / 2, -100)
  await sizeIs('tiles')
  expect(await zoom()).toBe(1)
  await page.keyboard.press('Control+0')
})

test('keyboard shortcuts change the size without zooming the page', async () => {
  await page.keyboard.press('Control+Shift+Digit2')
  await sizeIs('tiles')
  await page.keyboard.press('Control+=')
  await sizeIs('medium')
  await page.keyboard.press('Control+-')
  await sizeIs('tiles')
  await page.keyboard.press('Control+Shift+Digit5')
  await sizeIs('xl')
  await page.keyboard.press('Control+=')
  await sizeIs('xl')
  await page.keyboard.press('Control+0')
  await sizeIs('details')
  await page.keyboard.press('Control+-')
  await sizeIs('details')
  expect(await zoom()).toBe(1)
})

test('a size change keeps focus on the same item', async () => {
  await row('bravo').click()
  await page.keyboard.press('Control+Shift+Digit3')
  await sizeIs('medium')
  await expect(page.locator('[data-id="v-1"]')).toBeFocused()
  await page.keyboard.press('Control+0')
  await expect(page.locator('[data-id="v-1"]')).toBeFocused()
})

test('selection, the right-click menu and arrow keys work in an icon grid', async () => {
  await page.keyboard.press('Control+Shift+Digit3')
  await row('alpha').click()
  await row('charlie').click({ modifiers: ['Shift'] })
  for (const n of ['alpha', 'bravo', 'charlie'])
    await expect(row(n)).toHaveAttribute('aria-selected', 'true')
  await expect(row('delta')).toHaveAttribute('aria-selected', 'false')
  await row('bravo').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Remove 3 from list' })).toBeVisible()
  await page.keyboard.press('Escape')
  // One-group rule: Ctrl+click on the video moves the selection to it.
  await row('clip').click({ modifiers: ['Control'] })
  await expect(row('clip')).toHaveAttribute('aria-selected', 'true')
  await expect(row('alpha')).toHaveAttribute('aria-selected', 'false')
  // Arrow keys walk the grid.
  await row('alpha').click()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-id="v-1"]')).toBeFocused()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(row('charlie')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+0')
})

test('the chosen size survives a reload', async () => {
  await page.keyboard.press('Control+Shift+Digit4')
  await sizeIs('large')
  await page.reload()
  await expect(row('alpha')).toBeVisible()
  await sizeIs('large')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Large icons')
  await page.keyboard.press('Control+0')
})
