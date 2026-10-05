import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIN, launchApp } from './helpers'

// Typing into an open completion list must filter on the new text, not the
// value before the keystroke, and Enter must insert the picked word in place
// of the typed prefix (regression: `c`, Tab, `o`, `n`, Enter gave `cconvert `).
test('console completion follows typing while the list is open', async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  const userData = mkdtempSync(join(tmpdir(), 'fs-ud-'))
  const app = await launchApp({ FILESMITH_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible()
    await page.keyboard.press('Control+Backquote')
    const prompt = page.getByRole('textbox', { name: 'filesmith command' })
    await expect(prompt).toBeFocused()
    await prompt.pressSequentially('c')
    await prompt.press('Tab')
    const list = page.locator('#console-comp')
    await expect(list).toBeVisible()
    await prompt.pressSequentially('on')
    await expect(list).toContainText('convert')
    await expect(list).not.toContainText('clear')
    await prompt.press('Enter')
    await expect(prompt).toHaveValue('convert ')
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
