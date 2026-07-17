import { join } from 'path'

// PDF-native operations via mutool (MuPDF). Separate from convert (LibreOffice):
// these act on the PDF itself rather than converting to another document format.

export type PdfOp = 'extract-text' | 'pages-to-images' | 'compress'

/** `mutool draw -F txt -o <out.txt> <in.pdf>` — extract the text layer. */
export function buildPdfTextArgs(input: string, output: string): string[] {
  return ['draw', '-F', 'txt', '-o', output, input]
}

/** `mutool draw -F png -r <dpi> -o <dir>/page-%d.png <in.pdf>` — render each page. */
export function buildPdfImagesArgs(input: string, outDir: string, dpi: number): string[] {
  return ['draw', '-F', 'png', '-r', String(dpi), '-o', join(outDir, 'page-%d.png'), input]
}

/** `mutool clean -gggg -z <in> <out>` — garbage-collect + compress streams. */
export function buildPdfCompressArgs(input: string, output: string): string[] {
  return ['clean', '-gggg', '-z', input, output]
}
