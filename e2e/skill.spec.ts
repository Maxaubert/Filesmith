import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIN, ROOT, launchApp } from './helpers'

// The Settings button (M10) against a throwaway home folder: homedir() follows
// USERPROFILE on Windows, so the real ~/.claude is never touched.
test('Settings installs the Claude skill and shows its version', async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  const profile = mkdtempSync(join(tmpdir(), 'fs-profile-'))
  // Windows resolves the Downloads known folder under USERPROFILE and fails
  // when it is missing, which makes app.getPath('downloads') throw at startup.
  mkdirSync(join(profile, 'Downloads'))
  const userData = mkdtempSync(join(tmpdir(), 'fs-ud-'))
  const version = (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string }
  ).version
  const app = await launchApp({ USERPROFILE: profile, FILESMITH_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    await page
      .getByRole('navigation', { name: 'Operations' })
      .getByRole('button', { name: 'Settings' })
      .click()
    await expect(page.getByText('Not installed')).toBeVisible()
    await page.getByRole('button', { name: 'Install Claude skill' }).click()
    await expect(page.getByText(`Installed ${version}`)).toBeVisible()
    expect(existsSync(join(profile, '.claude', 'skills', 'filesmith', 'SKILL.md'))).toBe(true)
    if (process.env.FILESMITH_SHOTS)
      await page.screenshot({ path: join(ROOT, 'docs', 'mockups', 'cli-settings-skill.png') })
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})
