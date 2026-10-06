import { type ElectronApplication, type Locator, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIN, launchApp } from './helpers'

// UI behaviour the unit suite cannot reach: the sidebar, the inspector tabs and
// the empty workspace. A private userData keeps the user's real session and
// sidebar preference out of it.
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  userData = mkdtempSync(join(tmpdir(), 'filesmith-ui-'))
  app = await launchApp({ FILESMITH_USER_DATA: userData })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
})

test.afterAll(async () => {
  await app?.close()
  if (userData) rmSync(userData, { recursive: true, force: true })
})

const sidebar = (p: Page): Locator => p.getByRole('navigation', { name: 'Operations' })
const sidebarToggle = (p: Page): Locator => sidebar(p).getByRole('button', { name: /sidebar/ })

test('the app is dark and square', async () => {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(10, 10, 10)')
  const radius = await page.getByTestId('run').evaluate((el) => getComputedStyle(el).borderRadius)
  expect(radius).toBe('0px')
})

test('the sidebar collapses with its toggle and Ctrl+B, and remembers it', async () => {
  const toggle = sidebarToggle(page)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  // Tooltips only where the label is hidden: none while expanded, the label when collapsed.
  const settings = sidebar(page).getByRole('button', { name: 'Settings' })
  await expect(settings).not.toHaveAttribute('title')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(48)
  await expect(settings).toHaveAttribute('title', 'Settings')
  await page.reload()
  await expect(sidebarToggle(page)).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Control+B')
  await expect(sidebarToggle(page)).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(208)
})

test('inspector tabs switch with a click and the arrow keys', async () => {
  const tabs = page.getByRole('tablist', { name: 'Inspector' })
  const options = tabs.getByRole('tab', { name: 'Options' })
  const preview = tabs.getByRole('tab', { name: 'Preview' })
  const info = tabs.getByRole('tab', { name: 'Info' })
  await preview.click()
  await expect(preview).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(info).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(options).toHaveAttribute('aria-selected', 'true')
  // Switching tab must not shift the row: the bold width is reserved.
  const before = await options.boundingBox()
  await info.click()
  expect((await options.boundingBox())?.width).toBe(before?.width)
  await options.click()
})

test('an empty workspace offers Add files and a disabled Run', async () => {
  await expect(page.getByText('No files yet')).toBeVisible()
  await expect(
    page.getByRole('grid', { name: 'Files' }).getByRole('button', { name: 'Add files' })
  ).toBeVisible()
  await expect(page.getByTestId('run')).toBeDisabled()
  await expect(page.getByText('no files', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Totals' })).toHaveCount(0)
  await expect(
    page.getByRole('toolbar', { name: 'Console strip' }).getByRole('button', { name: /^Console/ })
  ).toBeVisible()
  // The button already reads "Console Ctrl+`": no tooltip repeating it.
  await expect(
    page.getByRole('toolbar', { name: 'Console strip' }).getByRole('button', { name: /^Console/ })
  ).not.toHaveAttribute('title')
  // Open, the console panel replaces the strip; its head is only the close X.
  const strip = page.getByRole('toolbar', { name: 'Console strip' })
  const panel = page.getByRole('region', { name: 'Console' })
  await strip.getByRole('button', { name: /^Console/ }).click()
  await expect(panel).toBeVisible()
  await expect(strip).toBeHidden()
  await expect(panel.locator('.chead').getByRole('button')).toHaveCount(2)
  await panel.getByRole('button', { name: 'Minimise console' }).click()
  await expect(panel).toBeHidden()
  await expect(strip).toBeVisible()
})

test('the toolbar is Add files and the View menu; row actions live in the right-click menu', async () => {
  const bar = page.getByRole('toolbar', { name: 'File actions' })
  const names = await bar
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim()))
  expect(names).toEqual(['Add files', 'View: Details'])
  await expect(page.getByTestId('stop')).toHaveCount(0)
})
