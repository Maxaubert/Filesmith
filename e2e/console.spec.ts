import { type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { execFileSync, fork } from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAGICK, MAIN, ROOT, magickEnv, launchApp } from './helpers'

// The in-app console (spec docs/superpowers/specs/2026-10-06-console-design.md)
// against the real built app: one window, a seeded queue so the Files grid has
// rows, and a work folder with real images for the console runs.
let app: ElectronApplication
let page: Page
let userData: string
let work: string

test.beforeAll(async () => {
  test.skip(!existsSync(MAIN) || !existsSync(MAGICK), 'needs `npm run build` and resources/bin')
  userData = mkdtempSync(join(tmpdir(), 'fs-con-ud-'))
  const files = join(userData, 'files')
  mkdirSync(files)
  const items = ['alpha.png', 'bravo.png'].map((name, i) => {
    const path = join(files, name)
    writeFileSync(path, 'not really media')
    return {
      id: `c-${i}`,
      file: { path, name, ext: '.png', kind: 'image', size: 16 },
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

  work = mkdtempSync(join(tmpdir(), 'fs-con-'))
  execFileSync(MAGICK, ['-size', '64x64', 'xc:gray', join(work, 'a.png')], { env: magickEnv })
  // Big noisy images at avif best quality: slow enough that Stop lands mid-run.
  execFileSync(MAGICK, ['-size', '2000x2000', 'plasma:', join(work, 'b0.png')], { env: magickEnv })
  for (let i = 1; i < 40; i++) copyFileSync(join(work, 'b0.png'), join(work, `b${i}.png`))

  app = await launchApp({ FILESMITH_USER_DATA: userData })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await expect(grid().getByRole('row', { name: /alpha/ })).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  if (userData) rmSync(userData, { recursive: true, force: true })
  if (work) rmSync(work, { recursive: true, force: true })
})

const grid = () => page.getByRole('grid', { name: 'Files' })
const nav = () => page.getByRole('navigation', { name: 'Operations' })
const panel = () => page.getByRole('region', { name: 'Console' })
const prompt = () => page.getByRole('textbox', { name: 'filesmith command' })
const conBtn = () =>
  page.getByRole('toolbar', { name: 'File actions' }).getByRole('button', { name: /^Console/ })
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

async function type(line: string): Promise<void> {
  await prompt().fill(line)
  await prompt().press('Enter')
}

test('Ctrl+` and the button toggle the panel; it survives a tab switch', async () => {
  await page.keyboard.press('Control+Backquote')
  await expect(panel()).toBeVisible()
  await expect(prompt()).toBeFocused()
  await nav().getByRole('button', { name: 'Compress' }).click()
  await expect(panel()).toBeVisible()
  await nav().getByRole('button', { name: 'Convert' }).click()
  await expect(panel()).toBeVisible()
  await conBtn().click()
  await expect(panel()).toBeHidden()
  await conBtn().click()
  await expect(panel()).toBeVisible()
})

test('typing in the console never changes the view size or zooms the page', async () => {
  await sizeIs('details')
  await prompt().click()
  for (const key of ['Control+=', 'Control+Shift+Equal', 'Control+-', 'Control+0']) {
    await prompt().press(key)
    await sizeIs('details')
  }
  expect(await zoom()).toBe(1)
  const box = (await panel().boundingBox())!
  await ctrlWheel(box.x + box.width / 2, box.y + box.height / 2, -120)
  await sizeIs('details')
  expect(await zoom()).toBe(1)
  // Control: outside a text field the keys still work.
  await grid().getByRole('row', { name: /alpha/ }).click()
  await page.keyboard.press('Control+=')
  await sizeIs('details-l')
  await page.keyboard.press('Control+0')
  await sizeIs('details')
})

test('cd, a real convert with Show in File Explorer, nothing in the queue', async () => {
  await prompt().click()
  await type(`cd ${work}`)
  await expect(panel().getByText(`Folder is now ${work}.`)).toBeVisible()
  const rowsBefore = await grid().getByRole('row').count()
  await type('convert a.png --to webp')
  await expect(panel().getByText(/^ok\s+a\.png/)).toBeVisible({ timeout: 30_000 })
  await expect(panel().getByText('exit 0', { exact: false })).toBeVisible()
  await expect(panel().getByRole('button', { name: 'Show in File Explorer' })).toBeVisible()
  expect(readdirSync(work)).toContain('a.webp')
  expect(await grid().getByRole('row').count()).toBe(rowsBefore)
})

test('other programs are refused with Open in terminal; main refuses them too', async () => {
  await type('del *.*')
  await expect(panel().getByText('is not a filesmith command.', { exact: false })).toBeVisible()
  await expect(panel().getByRole('button', { name: 'Open in terminal' }).first()).toBeVisible()
  const r = await page.evaluate((w) => window.filesmith.consoleRun('x1', 'calc', w), work)
  expect(r.ok).toBe(false)
  expect(readdirSync(work)).toContain('a.png')
})

test('Tab completes commands and values; Up recalls the last line', async () => {
  await prompt().fill('conv')
  await prompt().press('Tab')
  await expect(prompt()).toHaveValue('convert ')
  await prompt().fill('convert a.png --to w')
  await prompt().press('Tab')
  await expect(page.getByRole('listbox', { name: 'Completions' })).toContainText('webp')
  await prompt().press('Escape')
  await prompt().fill('')
  await prompt().press('ArrowUp')
  await expect(prompt()).toHaveValue('del *.*')
})

// Typing into an open completion list must filter on the new text, not the
// value before the keystroke, and Enter must insert the picked word in place
// of the typed prefix (regression: `c`, Tab, `o`, `n`, Enter gave `cconvert `).
test('console completion follows typing while the list is open', async () => {
  await prompt().fill('')
  await prompt().pressSequentially('c')
  await prompt().press('Tab')
  const list = page.locator('#console-comp')
  await expect(list).toBeVisible()
  await prompt().pressSequentially('on')
  await expect(list).toContainText('convert')
  await expect(list).not.toContainText('clear')
  await prompt().press('Enter')
  await expect(prompt()).toHaveValue('convert ')
  await prompt().fill('')
})

test('Stop cancels a running convert with exit 130', async () => {
  await type('convert b*.png --to avif --quality best')
  const stop = panel().getByRole('button', { name: /^Stop/ })
  await expect(stop).toBeVisible()
  // The running footer keeps its key hints and the head note reads in full (mockup 01 running).
  await expect(panel().locator('.pline .keys')).toBeVisible()
  const note = panel().locator('.chead .note')
  const fits = await note.evaluate((el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    const pad = parseFloat(getComputedStyle(el).paddingLeft) * 2
    return r.getBoundingClientRect().width <= el.getBoundingClientRect().width - pad + 0.01
  })
  expect(fits).toBe(true)
  await stop.click()
  await expect(panel().getByText('exit 130', { exact: false })).toBeVisible({ timeout: 15_000 })
  await expect(stop).toBeHidden()
})

test('a long folder never pushes the prompt out of the panel', async () => {
  const deep = join(
    work,
    'a-rather-long-folder-name-for-the-console-prompt'.repeat(2),
    'x'.repeat(60)
  )
  mkdirSync(deep, { recursive: true })
  await type(`cd ${deep}`)
  await expect(panel().getByText(`Folder is now ${deep}.`)).toBeVisible()
  await expect(prompt()).toBeVisible()
  const pin = (await prompt().boundingBox())!
  const box = (await panel().boundingBox())!
  expect(pin.width).toBeGreaterThanOrEqual(160)
  expect(pin.x + pin.width).toBeLessThanOrEqual(box.x + box.width)

  // The echo line of a run from that folder keeps its exit status inside the panel
  // (the path may pass MAX_PATH for the tools, so any exit code will do).
  const long = `${'a-long-image-name-'.repeat(4)}.png`
  copyFileSync(join(work, 'a.png'), join(deep, long))
  await type(`convert ${long} --to webp --quality balanced`)
  const echo = panel().locator('.ln.cmd').last()
  await expect(echo.locator('.dec')).toContainText(/exit \d/, { timeout: 30_000 })
  const dec = (await echo.locator('.dec').boundingBox())!
  const body = (await panel().locator('.cbody').boundingBox())!
  expect(dec.width).toBeGreaterThan(40)
  expect(dec.x + dec.width).toBeLessThanOrEqual(body.x + body.width)
  // The command wraps rather than leaving the line.
  const tx = (await echo.locator('.tx').boundingBox())!
  expect(tx.x + tx.width).toBeLessThanOrEqual(dec.x)
  await type(`cd ${work}`)
})

test('the sash resizes the panel', async () => {
  const before = (await panel().boundingBox())!.height
  const sash = page.getByRole('separator', { name: 'Resize console' })
  await sash.focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect.poll(async () => (await panel().boundingBox())!.height).toBe(before + 40)
})

test('the forked CLI honours the IPC interrupt (protocol of Task 3)', async () => {
  const cli = join(ROOT, 'out', 'main', 'cli.js')
  const ud = mkdtempSync(join(tmpdir(), 'fs-ud-'))
  const c = fork(cli, ['convert', 'b*.png', '--to', 'avif', '--quality', 'best'], {
    cwd: work,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, FILESMITH_USER_DATA: ud }
  })
  const events: string[] = []
  c.on('message', (m) => events.push(String(m)))
  c.stdout?.resume()
  c.stderr?.resume()
  await new Promise((r) => setTimeout(r, 1500))
  c.send('interrupt')
  const code = await new Promise<number | null>((r) => c.on('close', r))
  rmSync(ud, { recursive: true, force: true })
  expect(code).toBe(130)
  expect(events.join('')).toContain('"event":"canceled"')
})
