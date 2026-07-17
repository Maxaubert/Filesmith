import { join } from 'path'

// PDF-native operations via mutool (MuPDF). Separate from convert (LibreOffice):
// these act on the PDF itself rather than converting to another document format.

export type PdfOp =
  | 'extract-text'
  | 'pages-to-images'
  | 'compress'
  | 'merge'
  | 'split-range'
  | 'split-pages'
  | 'extract-images'

/** `mutool draw -F txt -o <out.txt> <in.pdf>` — extract the text layer. */
export function buildPdfTextArgs(input: string, output: string): string[] {
  return ['draw', '-F', 'txt', '-o', output, input]
}

/** `mutool merge -o <out.pdf> <in1> <in2> …` — concatenate PDFs in order. */
export function buildPdfMergeArgs(inputs: string[], output: string): string[] {
  return ['merge', '-o', output, ...inputs]
}

/** `mutool clean <in.pdf> <out.pdf> <pages>` — keep only the given pages/ranges
 * (also used to pull a single page N when splitting into individual files). */
export function buildPdfPagesArgs(input: string, output: string, pages: string): string[] {
  return ['clean', input, output, pages]
}

/** `mutool info <in.pdf>` — used to read the page count before a burst split. */
export function buildPdfInfoArgs(input: string): string[] {
  return ['info', input]
}

/** `mutool extract <in.pdf>` — dump embedded images/fonts into the CWD, so the
 * caller runs it with cwd set to a fresh output folder. */
export function buildPdfExtractArgs(input: string): string[] {
  return ['extract', input]
}

/** Page count from `mutool info` stdout (the "Pages: N" line); 0 if not found. */
export function parsePdfPageCount(stdout: string): number {
  const m = /Pages:\s*(\d+)/i.exec(stdout)
  return m ? Number(m[1]) : 0
}

/** Sanitize a user page-range string to mutool's `N` / `N-M` / comma-list form.
 * Strips whitespace; returns null if nothing valid remains (so the UI/engine can
 * reject an empty or malformed range instead of handing mutool garbage). */
export function normalizePageRange(input: string): string | null {
  const cleaned = input.replace(/\s+/g, '')
  if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(cleaned)) return null
  return cleaned
}

/** `mutool draw -F png -r <dpi> -o <dir>/page-%d.png <in.pdf>` — render each page. */
export function buildPdfImagesArgs(input: string, outDir: string, dpi: number): string[] {
  return ['draw', '-F', 'png', '-r', String(dpi), '-o', join(outDir, 'page-%d.png'), input]
}

/** `mutool clean -gggg -z <in> <out>` — garbage-collect + compress streams. */
export function buildPdfCompressArgs(input: string, output: string): string[] {
  return ['clean', '-gggg', '-z', input, output]
}
