import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForImages } from '../src/main/generate/comfy'

const base = 'http://127.0.0.1:8188'
const ok = (body: unknown): Response => ({ ok: true, json: async () => body }) as Response

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('waitForImages', () => {
  it('rejects at once when the workflow failed, with the detail', async () => {
    const fetchMock = vi.fn(async () =>
      ok({
        p1: {
          status: {
            status_str: 'error',
            messages: [['execution_error', { exception_message: 'Out of memory' }]]
          }
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = waitForImages(base, 'p1')
    const assertion = expect(p).rejects.toThrow(/error running the workflow. Out of memory/)
    await vi.advanceTimersByTimeAsync(10)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the plain message when there are no details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ p1: { status: { status_str: 'error' } } }))
    )
    const assertion = expect(waitForImages(base, 'p1')).rejects.toThrow(
      'ComfyUI reported an error running the workflow.'
    )
    await vi.advanceTimersByTimeAsync(10)
    await assertion
  })

  it('treats a network error as transient and then resolves', async () => {
    const img = { filename: 'a.png', subfolder: '', type: 'output' }
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(ok({ p1: { outputs: { 9: { images: [img] } } } }))
    vi.stubGlobal('fetch', fetchMock)
    const p = waitForImages(base, 'p1')
    await vi.advanceTimersByTimeAsync(1500)
    await expect(p).resolves.toEqual([img])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects when the signal is aborted', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const ac = new AbortController()
    ac.abort()
    await expect(waitForImages(base, 'p1', ac.signal)).rejects.toThrow('Generation cancelled')
  })

  it('ignores images that are not of type output', async () => {
    const out = { filename: 'o.png', subfolder: '', type: 'output' }
    const tmp = { filename: 't.png', subfolder: '', type: 'temp' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ p1: { outputs: { 1: { images: [tmp] }, 2: { images: [out] } } } }))
    )
    const p = waitForImages(base, 'p1')
    await vi.advanceTimersByTimeAsync(10)
    await expect(p).resolves.toEqual([out])
  })
})
