import { closeSync, openSync, readSync, statSync } from 'fs'
import type { SafetensorsHeader } from './archScan'

/**
 * Read a GGUF file's header well enough to classify its architecture.
 *
 * GGUF is the quantized single-file container from the llama.cpp world, reused
 * for diffusion models (a 24 GB Flux becomes ~7 GB at Q4, which is the only way
 * it fits on a smaller card). Its tensor NAMES are the same ones the safetensors
 * build uses, so once they are extracted, `classifyArch` identifies the family
 * with no new rules — which is the point: identification stays content-based.
 *
 * Layout (v2/v3, little-endian):
 *   magic "GGUF" u32 | version u32 | tensor_count u64 | kv_count u64
 *   kv_count x { key: str, type: u32, value: <type> }
 *   tensor_count x { name: str, n_dims: u32, dims: u64[n_dims], type: u32, offset: u64 }
 * where str = u64 length + that many UTF-8 bytes.
 *
 * We read forward through the KV block only to skip it, then take the tensor
 * names. Nothing is loaded beyond the header, and the read is hard-capped —
 * an LLM GGUF's tokenizer array alone can be tens of MB, and a hostile or
 * corrupt length field must not make us allocate the machine.
 */

const MAX_HEADER_BYTES = 64 * 1024 * 1024
const CHUNK = 1 << 20 // 1 MB

/** A forward-only reader over a file, refilling a bounded buffer as it goes. */
class Cursor {
  private buf = Buffer.alloc(0)
  private pos = 0
  /** Absolute bytes consumed, for the overall cap. */
  private consumed = 0

  constructor(
    private fd: number,
    private size: number
  ) {}

  /** Ensure `n` bytes are available from the current position. */
  private need(n: number): void {
    if (this.pos + n <= this.buf.length) return
    // Retire the consumed prefix FIRST: `at` must be computed from the updated
    // `consumed`, or every refill after the first re-reads from the wrong file
    // offset (the old code parsed a 50 KB header fine and lost the identical
    // header the moment it crossed 1 MB).
    const keep = this.buf.subarray(this.pos)
    this.consumed += this.pos
    this.pos = 0
    if (this.consumed + keep.length + n > MAX_HEADER_BYTES) throw new Error('gguf header too large')
    const want = Math.max(CHUNK, n)
    const next = Buffer.alloc(want)
    const at = this.consumed + keep.length
    if (at >= this.size) throw new Error('gguf truncated')
    const got = readSync(this.fd, next, 0, Math.min(want, this.size - at), at)
    if (got <= 0) throw new Error('gguf truncated')
    this.buf = Buffer.concat([keep, next.subarray(0, got)])
    if (this.buf.length < n) throw new Error('gguf truncated')
  }

  u32(): number {
    this.need(4)
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }

  u64(): number {
    this.need(8)
    const v = this.buf.readBigUInt64LE(this.pos)
    this.pos += 8
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('gguf value out of range')
    return Number(v)
  }

  skip(n: number): void {
    if (n < 0) throw new Error('gguf negative skip')
    // Skipping past the buffer is normal for a large array value; refill instead
    // of materializing bytes we are going to discard.
    let left = n
    while (left > 0) {
      const step = Math.min(left, CHUNK)
      this.need(step)
      this.pos += step
      left -= step
    }
  }

  str(): string {
    const len = this.u64()
    if (len > 1 << 20) throw new Error('gguf string too long')
    this.need(len)
    const s = this.buf.subarray(this.pos, this.pos + len).toString('utf-8')
    this.pos += len
    return s
  }
}

/** Fixed byte widths for the scalar GGUF value types (index = type id). */
const SCALAR_WIDTH: Record<number, number> = {
  0: 1, // uint8
  1: 1, // int8
  2: 2, // uint16
  3: 2, // int16
  4: 4, // uint32
  5: 4, // int32
  6: 4, // float32
  7: 1, // bool
  10: 8, // uint64
  11: 8, // int64
  12: 8 // float64
}
const T_STRING = 8
const T_ARRAY = 9

/** Consume one KV value of the given type, keeping strings we care about. */
function skipValue(c: Cursor, type: number): string | null {
  if (type === T_STRING) return c.str()
  if (type === T_ARRAY) {
    const inner = c.u32()
    const count = c.u64()
    if (inner === T_STRING) {
      for (let i = 0; i < count; i += 1) c.str()
    } else if (inner === T_ARRAY) {
      throw new Error('gguf nested array') // not produced in practice
    } else {
      const w = SCALAR_WIDTH[inner]
      if (w == null) throw new Error(`gguf unknown array type ${inner}`)
      c.skip(w * count)
    }
    return null
  }
  const w = SCALAR_WIDTH[type]
  if (w == null) throw new Error(`gguf unknown type ${type}`)
  c.skip(w)
  return null
}

/**
 * Tensor names + the string metadata of a GGUF file, in the same shape
 * `classifyArch` already consumes for safetensors. Returns null on any failure
 * — an unreadable file simply stays unrecognized, exactly as before.
 */
export function readGgufHeader(path: string): SafetensorsHeader | null {
  let fd: number | null = null
  try {
    const size = statSync(path).size
    if (size < 24) return null
    fd = openSync(path, 'r')
    const c = new Cursor(fd, size)

    if (c.u32() !== 0x46554747) return null // "GGUF" little-endian
    const version = c.u32()
    // v1 used 32-bit lengths throughout and is effectively extinct; refusing it
    // is safer than mis-parsing it into plausible-looking garbage.
    if (version < 2 || version > 3) return null
    const tensorCount = c.u64()
    const kvCount = c.u64()
    if (tensorCount > 100_000 || kvCount > 100_000) return null

    const metadata: Record<string, string> = {}
    for (let i = 0; i < kvCount; i += 1) {
      const key = c.str()
      const type = c.u32()
      const val = skipValue(c, type)
      if (val != null) metadata[key] = val
    }

    const keys: string[] = []
    for (let i = 0; i < tensorCount; i += 1) {
      keys.push(c.str())
      const nDims = c.u32()
      if (nDims > 8) return null
      c.skip(8 * nDims) // dims
      c.u32() // ggml type
      c.u64() // offset
    }

    // `general.architecture` is what city96's diffusion GGUFs record ("flux",
    // "sd3", …). Surfaced under the key classifyArch already looks at, so the
    // declared architecture is preferred over tensor guessing when present.
    if (metadata['general.architecture'] && !metadata['architecture'])
      metadata['architecture'] = metadata['general.architecture']

    return { keys, metadata }
  } catch {
    return null
  } finally {
    if (fd != null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}
