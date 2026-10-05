import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIN, ROOT, launchApp } from './helpers'

// Generate with nothing set up: a fresh userData and a throwaway home folder
// (homedir() follows USERPROFILE, so ComfyUI discovery under the real profile
// finds nothing). The tab must explain itself instead of showing an empty
// model control and a silently disabled Generate.
const SHOTS = join(ROOT, 'docs', 'mockups', 'generate-empty')

test('Generate without a model shows one next step and says why it cannot run', async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  const profile = mkdtempSync(join(tmpdir(), 'fs-profile-'))
  mkdirSync(join(profile, 'Downloads'))
  const userData = mkdtempSync(join(tmpdir(), 'fs-ud-'))
  const app = await launchApp({ USERPROFILE: profile, FILESMITH_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
    const nav = page.getByRole('navigation', { name: 'Operations' })
    await nav.getByRole('button', { name: 'Generate' }).click()
    const insp = page.getByRole('complementary', { name: 'Inspector' })
    await expect(insp.getByText('No image model yet')).toBeVisible()
    await expect(page.getByTestId('run')).toBeDisabled()
    await expect(insp.getByText('Choose your ComfyUI folder to generate')).toBeVisible()
    // A prompt alone does not turn it on: there is still nothing to run with.
    const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true })
    await prompt.fill('a lighthouse at dusk')
    await expect(page.getByTestId('run')).toBeDisabled()
    await prompt.fill('')
    // The toolbar row stays (it lines up with the inspector tabs) but holds no
    // Generate button: Run lives in the inspector footer only.
    const bar = page.getByRole('toolbar', { name: 'Generate actions' })
    await expect(bar.getByRole('button')).toHaveCount(0)
    if (process.env['FILESMITH_SHOTS']) {
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: join(SHOTS, 'after.png') })
      await nav.getByRole('button', { name: 'Settings' }).click()
      await expect(page.getByText('Not set')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Choose folder' })).toBeVisible()
      await page.screenshot({ path: join(SHOTS, 'settings.png') })
    }
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})
