export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, CANCELED: 130 } as const

/** Stable error codes (spec 2.6). Adding one is fine; renaming one bumps `v`. */
export type ErrorCode =
  | 'USAGE'
  | 'NOT_FOUND'
  | 'NO_MATCH'
  | 'UNSUPPORTED_KIND'
  | 'SAME_FORMAT'
  | 'OUT_DIR_MISSING'
  | 'TOOL_MISSING'
  | 'SETUP_REQUIRED'
  | 'GPU_UNSUPPORTED'
  | 'RAR_MISSING'
  | 'PASSWORD'
  | 'TOOL_FAILED'
  | 'CANCELED'
  | 'INTERNAL'

/** A run-level failure decided before any file is touched: exit 2. */
export class CliError extends Error {
  readonly code: ErrorCode
  readonly hint?: string
  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.hint = hint
  }
}

/** Bad arguments. `commandPath` picks the usage line printed after it. */
export class UsageError extends CliError {
  readonly commandPath: string[]
  constructor(message: string, commandPath: string[] = [], hint?: string) {
    super('USAGE', message, hint)
    this.name = 'UsageError'
    this.commandPath = commandPath
  }
}

export interface Counts {
  ok: number
  failed: number
  skipped: number
  canceled: number
}

/** Spec 2.7: Ctrl+C wins, then any failure, else success (skips are success). */
export function reduceExit(c: Counts): number {
  if (c.canceled > 0) return EXIT.CANCELED
  if (c.failed > 0) return EXIT.FAILED
  return EXIT.OK
}
