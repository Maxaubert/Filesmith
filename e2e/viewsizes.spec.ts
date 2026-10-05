import { _electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { FFMPEG, MAGICK, MAIN, ROOT, magickEnv } from './helpers'

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

const ORDER = ['details', 'details-l', 'tiles', 'medium', 'large', 'xl']
/** Reach any size from the keyboard: back to Details, then Ctrl+= per step. */
async function goTo(size: string): Promise<void> {
  await page.keyboard.press('Control+0')
  for (let i = 0; i < ORDER.indexOf(size); i++) await page.keyboard.press('Control+=')
  await sizeIs(size)
}

test('the View menu lists three plain sizes and picks one', async () => {
  await sizeIs('details')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Details')
  // No glyph in front of the label on the button, only the chevron after it.
  await expect(viewBtn().locator('svg')).toHaveCount(1)
  await viewBtn().click()
  const menu = page.getByRole('menu', { name: 'View' })
  const items = menu.getByRole('menuitemradio')
  await expect(items).toHaveText(['Details', 'Tiles', 'Extra large icons'])
  // No shortcuts, no Reset row, no hint rows; only the check mark glyph per entry.
  await expect(menu.getByRole('menuitem')).toHaveCount(0)
  await expect(menu.getByRole('separator')).toHaveCount(0)
  await expect(menu).not.toContainText('Ctrl')
  for (let i = 0; i < 3; i++) await expect(items.nth(i).locator('svg')).toHaveCount(1)
  await expect(items.first()).toHaveAttribute('aria-checked', 'true')
  await expect(items.first()).toBeFocused()
  await items.nth(2).click()
  await expect(menu).toHaveCount(0)
  await sizeIs('xl')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Extra large icons')
  // Group headers stay, one per convert group.
  await expect(grid().getByRole('gridcell', { name: /IMAGES/ })).toBeVisible()
  await expect(grid().getByRole('gridcell', { name: /VIDEO/ })).toBeVisible()
  await viewBtn().click()
  await items.nth(1).click()
  await sizeIs('tiles')
  await page.keyboard.press('Control+0')
  await sizeIs('details')
})

test('Ctrl+wheel reaches the sizes the menu does not list', async () => {
  const g = (await grid().boundingBox())!
  for (const s of ['details-l', 'tiles', 'medium']) {
    await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, -100)
    await sizeIs(s)
  }
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Medium icons')
  await expect(viewBtn()).toContainText('Medium icons')
  // The menu has no entry for Medium: nothing is checked, focus lands on the first.
  await viewBtn().click()
  const items = page.getByRole('menu', { name: 'View' }).getByRole('menuitemradio')
  await expect(items).toHaveCount(3)
  await expect(page.locator('.viewmenu [aria-checked="true"]')).toHaveCount(0)
  await expect(items.first()).toBeFocused()
  await page.keyboard.press('Escape')
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, -100)
  await sizeIs('large')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Large icons')
  expect(await zoom()).toBe(1)
  await page.keyboard.press('Control+0')
})

test('Ctrl+wheel over the list steps the size; over the inspector it does nothing', async () => {
  const g = (await grid().boundingBox())!
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, -100)
  await sizeIs('details-l')
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, -100)
  await sizeIs('tiles')
  await ctrlWheel(g.x + g.width / 2, g.y + g.height / 2, 100)
  await sizeIs('details-l')
  const insp = (await page.locator('.insp').boundingBox())!
  await ctrlWheel(insp.x + insp.width / 2, insp.y + insp.height / 2, -100)
  await sizeIs('details-l')
  expect(await zoom()).toBe(1)
  await page.keyboard.press('Control+0')
})

test('Ctrl+= / Ctrl+- / Ctrl+0 step the size without zooming the page', async () => {
  await page.keyboard.press('Control+=')
  await sizeIs('details-l')
  await page.keyboard.press('Control+=')
  await sizeIs('tiles')
  await page.keyboard.press('Control+-')
  await sizeIs('details-l')
  await goTo('xl')
  await page.keyboard.press('Control+=')
  await sizeIs('xl')
  await page.keyboard.press('Control+0')
  await sizeIs('details')
  await page.keyboard.press('Control+-')
  await sizeIs('details')
  expect(await zoom()).toBe(1)
})

test('there are no per-size shortcuts', async () => {
  for (const d of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']) {
    await page.keyboard.press(`Control+Shift+${d}`)
    await sizeIs('details')
  }
  await goTo('tiles')
  await page.keyboard.press('Control+Shift+Digit1')
  await sizeIs('tiles')
  await page.keyboard.press('Control+0')
  expect(await zoom()).toBe(1)
})

test('a size change keeps focus on the same item', async () => {
  await row('bravo').click()
  await goTo('medium')
  await expect(page.locator('[data-id="v-1"]')).toBeFocused()
  await page.keyboard.press('Control+0')
  await expect(page.locator('[data-id="v-1"]')).toBeFocused()
})

test('selection, the right-click menu and arrow keys work in an icon grid', async () => {
  await goTo('medium')
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
  await goTo('large')
  await page.reload()
  await expect(row('alpha')).toBeVisible()
  await sizeIs('large')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Large icons')
  await page.keyboard.press('Control+0')
})

test('Large details is the Details table with taller rows and a bigger thumb', async () => {
  const geom = () =>
    row('alpha').evaluate((r) => ({
      h: r.getBoundingClientRect().height,
      thumb: r.querySelector('.thumb')!.getBoundingClientRect().width,
      name: parseFloat(getComputedStyle(r.querySelector('.name')!).fontSize),
      cols: getComputedStyle(r).gridTemplateColumns
    }))
  await sizeIs('details')
  const small = await geom()
  await goTo('details-l')
  await expect(viewBtn()).toHaveAttribute('aria-label', 'View: Large details')
  const big = await geom()
  expect(small.h).toBe(32)
  expect(big.h).toBe(44)
  expect(big.thumb).toBe(32)
  expect(big.name).toBeGreaterThan(small.name)
  // Same columns, same head and the column-aligned totals.
  expect(big.cols).toBe(small.cols)
  await expect(grid().getByRole('columnheader', { name: 'name' })).toBeVisible()
  await expect(grid().locator('.totals.flat')).toHaveCount(0)
  // Up/Down still walk the rows; right-click still opens the row menu.
  await row('alpha').click()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-id="v-1"]')).toBeFocused()
  await row('bravo').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: /Remove/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+0')
})

test('big thumbnail buckets really are big, for an image and a video', async () => {
  test.skip(!existsSync(MAGICK) || !existsSync(FFMPEG), 'needs resources/bin')
  const dir = join(userData, 'big')
  mkdirSync(dir, { recursive: true })
  const img = join(dir, 'photo.png')
  const vid = join(dir, 'clip.mp4')
  execFileSync(MAGICK, ['-size', '2400x1600', 'plasma:', img], { env: magickEnv })
  execFileSync(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1920x1080:rate=25:duration=2',
    '-pix_fmt',
    'yuv420p',
    vid
  ])
  const dims = (path: string, size: number, kind: string, fit?: 'cover'): Promise<number[]> =>
    page.evaluate(
      async ({ path, size, kind, fit }) => {
        const url = await window.filesmith.thumbnail(path, size, kind as never, fit)
        if (!url) return [0, 0]
        const im = new Image()
        im.src = url
        await im.decode()
        return [im.naturalWidth, im.naturalHeight]
      },
      { path, size, kind, fit }
    )
  // The Windows shell tends to cap at 256; the tool fallback must make up the rest.
  expect(Math.max(...(await dims(img, 768, 'image')))).toBeGreaterThanOrEqual(766)
  expect(Math.max(...(await dims(vid, 768, 'video')))).toBeGreaterThanOrEqual(766)
  // Cards crop to a square, so their thumbnails fill: the SHORT side reaches the bucket.
  expect(Math.min(...(await dims(img, 768, 'image', 'cover')))).toBeGreaterThanOrEqual(766)
  expect(Math.min(...(await dims(vid, 768, 'video', 'cover')))).toBeGreaterThanOrEqual(766)
  // The 128px one every item gets stays small.
  expect(Math.max(...(await dims(img, 128, 'image')))).toBeLessThanOrEqual(128)
})
