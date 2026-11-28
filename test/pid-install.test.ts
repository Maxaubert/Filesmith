import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { InstallLock, replaceRepoKeeping, restoreKept } from '../src/main/pid/install'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'fs-pid-install-'))
  dirs.push(d)
  return d
}

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const CKPT = join('checkpoints', 'flux', 'model_ema_bf16.pth')
const PY = join('.venv', 'Scripts', 'python.exe')

/** An old repo with weights + venv, and freshly extracted source beside it. */
function layout(): { repo: string; src: string; hold: string } {
  const root = tmp()
  const repo = join(root, 'repo')
  const src = join(root, 'extract', 'PiD-new')
  put(join(repo, 'old.py'), 'old')
  put(join(repo, CKPT), 'weights')
  put(join(repo, PY), 'python')
  put(join(src, 'new.py'), 'new')
  return { repo, src, hold: join(root, 'keep') }
}

describe('replaceRepoKeeping (re-vendor keeps weights and venv)', () => {
  it('swaps the source and keeps checkpoints and .venv', () => {
    const { repo, src, hold } = layout()
    replaceRepoKeeping(repo, src, hold)
    expect(existsSync(join(repo, 'new.py'))).toBe(true)
    expect(existsSync(join(repo, 'old.py'))).toBe(false)
    expect(readFileSync(join(repo, CKPT), 'utf-8')).toBe('weights')
    expect(readFileSync(join(repo, PY), 'utf-8')).toBe('python')
    expect(existsSync(hold)).toBe(false)
  })

  it("prefers the user's copy over a checkpoints folder in the new source", () => {
    const { repo, src, hold } = layout()
    put(join(src, 'checkpoints', 'README.md'), 'placeholder')
    replaceRepoKeeping(repo, src, hold)
    expect(readFileSync(join(repo, CKPT), 'utf-8')).toBe('weights')
    expect(existsSync(join(repo, 'checkpoints', 'README.md'))).toBe(false)
  })

  it('restores the weights when the swap fails after the old repo is removed', () => {
    const { repo, hold } = layout()
    const missing = join(dirname(repo), 'extract', 'does-not-exist')
    expect(() => replaceRepoKeeping(repo, missing, hold)).toThrow()
    expect(readFileSync(join(repo, CKPT), 'utf-8')).toBe('weights')
    expect(readFileSync(join(repo, PY), 'utf-8')).toBe('python')
    expect(existsSync(hold)).toBe(false)
  })
})

describe('restoreKept (hold left by a crashed run)', () => {
  it('moves a leftover hold back into a missing repo', () => {
    const root = tmp()
    const repo = join(root, 'repo')
    const hold = join(root, 'keep')
    put(join(hold, CKPT), 'weights')
    put(join(hold, PY), 'python')
    restoreKept(repo, hold, false)
    expect(readFileSync(join(repo, CKPT), 'utf-8')).toBe('weights')
    expect(readFileSync(join(repo, PY), 'utf-8')).toBe('python')
    expect(existsSync(hold)).toBe(false)
  })

  it('never overwrites non-empty checkpoints in the repo with the held copy', () => {
    const root = tmp()
    const repo = join(root, 'repo')
    const hold = join(root, 'keep')
    put(join(repo, CKPT), 'newer')
    put(join(hold, CKPT), 'older')
    put(join(hold, 'checkpoints', 'ae.safetensors'), 'vae')
    restoreKept(repo, hold, false)
    expect(readFileSync(join(repo, CKPT), 'utf-8')).toBe('newer')
    // A file only the held copy had is merged in, not lost.
    expect(readFileSync(join(repo, 'checkpoints', 'ae.safetensors'), 'utf-8')).toBe('vae')
    expect(existsSync(hold)).toBe(false)
  })

  it('is a no-op without a hold', () => {
    const root = tmp()
    restoreKept(join(root, 'repo'), join(root, 'keep'), false)
    expect(existsSync(join(root, 'repo'))).toBe(false)
  })
})

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('InstallLock', () => {
  it('joins a running install of the same kind (inner runs once)', async () => {
    const lock = new InstallLock()
    const gate = deferred()
    let runs = 0
    const inner = async (): Promise<void> => {
      runs++
      await gate.promise
    }
    const a = lock.run('pid', inner)
    const b = lock.run('pid', inner)
    expect(b).toBe(a)
    gate.resolve()
    await Promise.all([a, b])
    expect(runs).toBe(1)
    expect(lock.busy).toBe(false)
  })

  it('runs a different kind after the first settles, with its own steps', async () => {
    const lock = new InstallLock()
    const gate = deferred()
    const order: string[] = []
    let waited = 0
    const a = lock.run('pid', async () => {
      order.push('pid start')
      await gate.promise
      order.push('pid end')
    })
    const b = lock.run('comfy', async () => void order.push('comfy'), { onWait: () => waited++ })
    expect(waited).toBe(1)
    await tick()
    expect(order).toEqual(['pid start'])
    expect(lock.busy).toBe(true)
    gate.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['pid start', 'pid end', 'comfy'])
    expect(lock.busy).toBe(false)
  })

  it('still runs the second kind when the first rejects', async () => {
    const lock = new InstallLock()
    const gate = deferred()
    let comfyRan = false
    const a = lock.run('pid', () => gate.promise)
    const b = lock.run('comfy', async () => {
      comfyRan = true
    })
    gate.reject(new Error('download failed'))
    await expect(a).rejects.toThrow('download failed')
    await b
    expect(comfyRan).toBe(true)
  })

  it('rejects a waiting caller on abort without running its inner', async () => {
    const lock = new InstallLock()
    const gate = deferred()
    const ac = new AbortController()
    let comfyRan = false
    const a = lock.run('pid', () => gate.promise)
    const b = lock.run(
      'comfy',
      async () => {
        comfyRan = true
      },
      { signal: ac.signal }
    )
    ac.abort(new Error('cancelled'))
    await expect(b).rejects.toThrow('cancelled')
    // The first install is still running, so the lock stays busy.
    expect(lock.busy).toBe(true)
    gate.resolve()
    await a
    expect(comfyRan).toBe(false)
    expect(lock.busy).toBe(false)
  })
})
