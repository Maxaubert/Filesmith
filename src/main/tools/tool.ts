import type { FileInfo, JobOptions } from '@shared/types'

/** Runtime context handed to a tool's run(): cancellation + progress reporting. */
export interface ToolContext {
  signal: AbortSignal
  onProgress: (percent: number | undefined, message?: string) => void
}

/** A tool knows how to perform one operation on one file and return the output path. */
export interface ToolModule {
  run(file: FileInfo, options: JobOptions, ctx: ToolContext): Promise<string>
}
