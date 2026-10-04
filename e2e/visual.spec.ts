import { _electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAGICK, MAIN, ROOT, magickEnv } from './helpers'

// Screenshots for the owner's side-by-side with the signed-off mockup. No pixel
// assertions (spec 7.3): the shots are evidence, not a gate.
const SHOTS = join(ROOT, 'docs', 'mockups', 'terminal-v5', 'shots')
let app: ElectronApplication
let page: Page
let userData: string
let files: string

const NAMES = [
  'IMG_2041.heic',
  'beach-panorama.png',
  'scan_0007.tiff',
  'portrait.jpg',
  'diagram.png',
  'IMG_2042.heic'
]

function make(name: string, size: string): string {
  const p = join(files, name)
  // A noisy image so sizes look realistic; HEIC names get JPG bytes, which the
  // bundled magick always encodes.
  execFileSync(MAGICK, ['-size', size, 'plasma:', p], { env: magickEnv })
  return p
}

type SeedFile = { path: string; name: string; ext: string; kind: string; size: number }

function info(p: string): SeedFile {
  const name = p.split(/[\\/]/).pop() as string
  return { path: p, name, ext: '.' + name.split('.').pop(), kind: 'image', size: statSync(p).size }
}

test.beforeAll(async () => {
  // Opt-in: the shots are tracked files, so a routine `npm run test:e2e` must not rewrite them.
  test.skip(
    !process.env['FILESMITH_SHOTS'],
    'set FILESMITH_SHOTS=1 to capture the redesign screenshots'
  )
  test.skip(!existsSync(MAIN) || !existsSync(MAGICK), 'needs `npm run build` and resources/bin')
  userData = mkdtempSync(join(tmpdir(), 'filesmith-visual-'))
  files = join(userData, 'files')
  mkdirSync(files)
  const paths = NAMES.map((n, i) =>
    make(
      n.endsWith('.heic') ? n.replace('.heic', '.jpg') : n,
      i === 2 ? '6000x4000' : i === 1 ? '3000x2000' : '1600x1200'
    )
  )
  const outs = [make('IMG_2041.webp', '800x600'), make('beach-panorama.webp', '1200x800')]
  const item = (i: number, over: Record<string, unknown>): Record<string, unknown> => ({
    id: `seed-${i}`,
    file: info(paths[i]),
    thumb: null,
    status: 'ready',
    percent: 0,
    ...over
  })
  const done = (i: number, out: string): Record<string, unknown> =>
    item(i, {
      status: 'done',
      percent: 100,
      outputPath: out,
      outputSize: statSync(out).size,
      runOptions: { format: '.webp', quality: 'balanced' }
    })
  const session = {
    version: 2,
    lastTool: null,
    options: { 'convert:image': { format: '.webp', quality: 'balanced' } },
    genResults: [],
    queues: {
      convert: {
        items: [
          done(0, outs[0]),
          done(1, outs[1]),
          item(2, {}),
          item(3, {}),
          item(4, {}),
          item(5, {
            status: 'failed',
            error: 'Unsupported compression in this TIFF variant. Convert it to PNG first.'
          })
        ]
      }
    }
  }
  writeFileSync(join(userData, 'session.json'), JSON.stringify(session))
  app = await _electron.launch({
    args: [ROOT],
    env: { ...process.env, FILESMITH_USER_DATA: userData }
  })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await expect(
    page.getByRole('grid', { name: 'Files' }).getByRole('row', { name: /portrait/ })
  ).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  if (userData) rmSync(userData, { recursive: true, force: true })
})

test('capture the redesign next to the mockup', async () => {
  // Select one row, as the mockup does, then start a real job on another so a
  // running row with NN%(Ns) is on screen. The status reads `NN%`; the result
  // cell's signed estimate (`-98%`) must not match.
  await page.getByRole('row', { name: /beach-panorama/ }).click()
  await page.evaluate(
    ({ input }) =>
      window.filesmith.runJob({
        id: 'seed-2',
        tool: 'resize',
        input,
        options: { mode: 'percent', percent: 300 } as never
      }),
    { input: join(files, NAMES[2]) }
  )
  await expect(page.getByRole('row', { name: /scan_0007/ }).getByText(/^\d[\d.]*%/)).toBeVisible({
    timeout: 20_000
  })
  await page.screenshot({ path: join(SHOTS, 'impl-10-s2.png') })

  await page
    .getByRole('navigation', { name: 'Operations' })
    .getByRole('button', { name: /sidebar/ })
    .click()
  // Wait out the width transition so the shot shows the settled 48px rail.
  await expect
    .poll(
      async () => (await page.getByRole('navigation', { name: 'Operations' }).boundingBox())?.width
    )
    .toBe(48)
  await page.screenshot({ path: join(SHOTS, 'impl-collapsed.png') })
  await page.keyboard.press('Control+B')

  await page.getByRole('tab', { name: 'Preview' }).click()
  await page.screenshot({ path: join(SHOTS, 'impl-preview.png') })
  await page.getByRole('tab', { name: 'Info' }).click()
  await page.screenshot({ path: join(SHOTS, 'impl-info.png') })
  await page.getByRole('tab', { name: 'Options' }).click()

  const nav = page.getByRole('navigation', { name: 'Operations' })
  for (const [label, file] of [
    ['Compress', 'impl-empty.png'],
    ['Generate', 'impl-generate.png'],
    ['Tools', 'impl-tools.png'],
    ['Completed', 'impl-completed.png'],
    ['Settings', 'impl-settings.png']
  ]) {
    await nav.getByRole('button', { name: label }).click()
    await page.screenshot({ path: join(SHOTS, file) })
  }
})
