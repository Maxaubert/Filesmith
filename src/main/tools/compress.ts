// Pure CaesiumCLT argument builder. No Electron. The runner (registry.ts) writes
// into a temp dir and then moves the single result to a collision-safe name,
// because CaesiumCLT mirrors the input filename into its -o directory.

export function buildCompressArgs(input: string, outDir: string, quality: number): string[] {
  return ['-q', String(quality), '-o', outDir, input]
}
