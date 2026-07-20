import type { FileInfo, JobOptions } from '@shared/types'

/** Runtime context handed to a tool's run(): cancellation + progress reporting. */
export interface ToolContext {
  signal: AbortSignal
  /** `etaSec` is seconds remaining, when the tool can estimate it. */
  onProgress: (percent: number | undefined, message?: string, etaSec?: number | null) => void
}

/** A tool knows how to perform one operation on one file and return the output path. */
export interface ToolModule {
  run(file: FileInfo, options: JobOptions, ctx: ToolContext): Promise<string>
}
