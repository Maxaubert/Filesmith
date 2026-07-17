import { basename, extname, join } from 'path'

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
  const profileUrl = 'file:///' + profileDir.replace(/\\/g, '/')
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
