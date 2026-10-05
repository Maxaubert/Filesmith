import {
  existsSync,
  mkdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  type BigIntStats
} from 'fs'
import { basename, dirname, extname, join } from 'path'
import { dirCandidates, reserveFileInDir } from './output'

// Atomic outputs. A tool never writes the name the user will see: it writes a
// "part" sibling in the same folder (so the final rename stays on one volume)
// and the part is renamed onto the reserved name only once the tool succeeded.
// A failed or canceled job therefore never leaves a half-written file under
// the final name. Even a hard kill leaves at most a `.filesmith-part` file and
// the empty placeholder, and the CLI's watchdog (src/cli/watchdog.ts) removes
// those too.
//
// The final name is still reserved FIRST, exactly as before (an empty
// placeholder made with an exclusive create), so collision names, dry-run
// predictions and concurrent jobs behave as they always did.

/** Marker in every part name; the extension stays LAST because ffmpeg,
 * ImageMagick and mutool pick the output format from it. */
export const PART_MARK = '.filesmith-part'

/**
 * One uncommitted output, as plain data so another process (the watchdog) can
 * clean it up: the part to delete, and the placeholder to delete only while
 * it is still the empty entry this reservation created (same file id, or the
 * same creation time on file systems without ids).
 */
export interface OutputRecord {
  kind: 'file' | 'dir'
  part: string
  final: string
  ino: string
  birth: string
}

/** Told about every reservation and every commit or discard (the CLI forwards
 * them to its watchdog). */
export interface OutputObserver {
  reserved(record: OutputRecord): void
  settled(part: string): void
}
let observer: OutputObserver | null = null
export function setOutputObserver(o: OutputObserver | null): void {
  observer = o
}

function identityOf(path: string): { ino: string; birth: string } {
  try {
    const st: BigIntStats = statSync(path, { bigint: true })
    return { ino: String(st.ino), birth: String(st.birthtimeNs) }
  } catch {
    return { ino: '', birth: '' }
  }
}

/** Is `final` still the empty placeholder `r` created? Never true for a file
 * or folder anyone else made or filled. */
function isOurPlaceholder(r: OutputRecord): boolean {
  if (!r.ino && !r.birth) return false
  try {
    const st = statSync(r.final, { bigint: true })
    const same = r.ino !== '0' ? String(st.ino) === r.ino : String(st.birthtimeNs) === r.birth
    if (!same) return false
    return r.kind === 'file' ? st.isFile() && st.size === 0n : st.isDirectory()
  } catch {
    return false
  }
}

/** Remove an uncommitted output: its part, and its placeholder if still ours.
 * Never throws. Used in-process and by the watchdog after a hard kill. */
export function discardRecord(r: OutputRecord): void {
  try {
    rmSync(r.part, { recursive: r.kind === 'dir', force: true })
  } catch {
    /* best effort: a just-killed tool may still hold it for a moment */
  }
  try {
    if (isOurPlaceholder(r)) {
      if (r.kind === 'dir')
        rmdirSync(r.final) // fails if anything is inside
      else rmSync(r.final, { force: true })
    }
  } catch {
    /* not empty any more: someone else's content now, leave it */
  }
}

/** A free part name next to `final`: `name.filesmith-part.ext`, then
 * `name.filesmith-part-2.ext`, ... A leftover from an earlier crashed run is
 * skipped, never reused or deleted (it is not ours). */
function partFileFor(final: string): string {
  const ext = extname(final)
  const stem = join(dirname(final), basename(final, ext))
  for (let n = 1; ; n++) {
    const cand = `${stem}${PART_MARK}${n === 1 ? '' : `-${n}`}${ext}`
    if (!existsSync(cand)) return cand
  }
}

/** Windows can briefly refuse a rename while an antivirus scanner or the
 * search indexer holds the just-closed file. */
function renameRetrying(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1))
    }
  }
}

/** Everything this process has reserved and not yet committed or discarded,
 * so a process that exits mid-job (a second Ctrl+C) removes ITS OWN parts and
 * placeholders on the way out, and nothing else. */
const live = new Set<Reservation>()
let exitHooked = false

/** Discard every uncommitted reservation of this process (sync; safe in an
 * 'exit' handler). Returns how many were discarded. */
export function discardAllOutputs(): number {
  let n = 0
  for (const r of [...live]) {
    r.discard()
    n++
  }
  return n
}

/** Shared bookkeeping of FileOutput and DirOutput. */
abstract class Reservation {
  protected record: OutputRecord
  private done = false

  protected constructor(kind: OutputRecord['kind'], final: string, part: string) {
    this.record = { kind, part, final, ...identityOf(final) }
    live.add(this)
    if (!exitHooked) {
      exitHooked = true
      process.on('exit', discardAllOutputs)
    }
    observer?.reserved({ ...this.record })
  }

  /** Where the tool writes. Same folder (and for files, extension) as the final name. */
  get part(): string {
    return this.record.part
  }

  /** The reserved final name (an empty placeholder until commit). */
  get path(): string {
    return this.record.final
  }

  /** Point the reservation at a newly reserved final name. */
  protected retarget(final: string): void {
    this.record = { ...this.record, final, ...identityOf(final) }
    observer?.reserved({ ...this.record })
  }

  protected ours(): boolean {
    return isOurPlaceholder(this.record)
  }

  protected abstract swapIn(): void

  /**
   * Move the finished part onto the reserved name and return the path the
   * output now has. Replaces nothing but our own untouched placeholder: if
   * anything else has taken the name meanwhile, the output goes to the next
   * free collision name instead. Throws (after discarding) if the tool left no
   * part.
   */
  commit(): string {
    if (this.done) return this.record.final
    if (!existsSync(this.record.part)) {
      this.discard()
      throw new Error('The tool reported success but wrote no output')
    }
    try {
      this.swapIn()
    } catch (e) {
      this.discard()
      throw e
    }
    this.settle()
    return this.record.final
  }

  /** Remove the part and our placeholder. Idempotent and never throws. */
  discard(): void {
    if (this.done) return
    this.settle()
    discardRecord(this.record)
  }

  private settle(): void {
    this.done = true
    live.delete(this)
    observer?.settled(this.record.part)
  }
}

export class FileOutput extends Reservation {
  constructor(
    private readonly dir: string,
    private readonly name: string,
    private readonly ext: string,
    private readonly tag: string
  ) {
    const final = reserveFileInDir(dir, name, ext, tag)
    super('file', final, partFileFor(final))
  }

  protected swapIn(): void {
    // A rename replaces the destination, so it only ever lands on our own
    // empty placeholder; a name someone else has written gets a new one.
    if (!this.ours()) this.retarget(reserveFileInDir(this.dir, this.name, this.ext, this.tag))
    renameRetrying(this.part, this.path)
  }
}

/** Atomic output next to the source (or in `outDir`), named like reserveOutPath. */
export function reserveOutput(
  sourcePath: string,
  ext: string,
  tag: string,
  outDir?: string
): FileOutput {
  return new FileOutput(
    outDir ?? dirname(sourcePath),
    basename(sourcePath, extname(sourcePath)),
    ext,
    tag
  )
}

/** Atomic output with an explicit folder and base name (generate). */
export function reserveOutputInDir(
  dir: string,
  name: string,
  ext: string,
  tag: string
): FileOutput {
  return new FileOutput(dir, name, ext, tag)
}

/** Exclusive mkdir of the first free candidate: the folder equivalent of the
 * file placeholder. */
function claimDir(dir: string, base: string): string {
  for (const cand of dirCandidates(dir, base)) {
    try {
      mkdirSync(cand)
      return cand
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error('unreachable')
}

/** Exclusive mkdir of a free `<final>.filesmith-part` folder. */
function claimPartDir(final: string): string {
  for (let n = 1; ; n++) {
    const cand = `${final}${PART_MARK}${n === 1 ? '' : `-${n}`}`
    try {
      mkdirSync(cand)
      return cand
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        try {
          rmdirSync(final)
        } catch {
          /* best effort */
        }
        throw err
      }
    }
  }
}

/**
 * A folder output (split, burst, pages, extracted): the final folder name is
 * reserved as an empty folder, the tool fills a `<name>.filesmith-part`
 * sibling folder, and commit swaps it in. Like FileOutput, a failed or
 * canceled job leaves neither folder behind.
 */
export class DirOutput extends Reservation {
  constructor(
    private readonly dir: string,
    private readonly base: string
  ) {
    const final = claimDir(dir, base)
    super('dir', final, claimPartDir(final))
  }

  protected swapIn(): void {
    for (let attempt = 0; ; attempt++) {
      if (this.ours()) {
        try {
          rmdirSync(this.path) // fails if anything was put inside it
        } catch {
          /* not empty any more: not ours to remove, take another name */
        }
      }
      if (existsSync(this.path)) {
        this.retarget(claimDir(this.dir, this.base))
        continue
      }
      try {
        // A folder rename never replaces an existing entry on Windows, so a
        // name taken in the instant since the check fails here and retries.
        renameRetrying(this.part, this.path)
        return
      } catch (e) {
        if (attempt >= 5) throw e
      }
    }
  }
}

/** Atomic folder output, named like uniqueOutDir (`base`, `base (2)`, ...). */
export function reserveOutputDir(dir: string, base: string): DirOutput {
  return new DirOutput(dir, base)
}
