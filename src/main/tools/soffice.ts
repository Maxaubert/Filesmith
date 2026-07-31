import { basename, extname, join } from 'path'
import { pathToFileURL } from 'url'

// LibreOffice (soffice) headless conversion. soffice writes the result into an
// --outdir under `<name>.<targetext>`, so callers convert into a temp dir and
// copy the single result to a collision-safe name next to the source.

/** The --convert-to filter token for a target extension. Bare ext works for
 * most; plain text needs the explicit Text filter. */
export function sofficeFilter(targetExt: string): string {
  const e = targetExt.replace(/^\./, '').toLowerCase()
  // Force UTF-8 on text export — the default Text filter falls back to the
  // system codepage and garbles non-ASCII (e.g. æøå) for some sources (markdown).
  if (e === 'txt') return 'txt:Text (encoded):UTF8'
  return e
}

/**
 * `soffice --headless --norestore -env:UserInstallation=<profile> --convert-to
 * <filter> --outdir <dir> <input>`. The isolated profile lets conversions run
 * even while a LibreOffice window is open (no single-instance lock).
 */
export function buildSofficeArgs(
  input: string,
  outdir: string,
  profileDir: string,
  targetExt: string
): string[] {
  // MUST be percent-encoded. A raw splice leaves spaces literal, and soffice
  // then dies with a C++ exception and an EMPTY stderr (no diagnostic at all) —
  // which happens to every user whose account name has a space, since the
  // profile is created under %TEMP%. A `#` makes it hang instead.
  const profileUrl = pathToFileURL(profileDir).href
  return [
    '--headless',
    '--invisible',
    '--nodefault',
    '--nolockcheck',
    '--nologo',
    '--norestore',
    '--nofirststartwizard',
    `-env:UserInstallation=${profileUrl}`,
    '--convert-to',
    sofficeFilter(targetExt),
    '--outdir',
    outdir,
    input
  ]
}

/** The path LibreOffice writes for a given input + target inside outdir. */
export function sofficeOutputPath(input: string, outdir: string, targetExt: string): string {
  const name = basename(input, extname(input))
  const e = targetExt.startsWith('.') ? targetExt : '.' + targetExt
  return join(outdir, name + e)
}
