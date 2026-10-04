import type { CommandSpec } from './catalog'
import { findCommand } from './catalog'
import { runFileCommand, type FileCommandDeps } from './commands/files'
import { JsonReporter, type Reporter } from './events'
import { CliError, EXIT, UsageError } from './exit'
import { renderGroupHelp, renderHelp, renderRootHelp, usageLine } from './help'
import { HumanReporter } from './human'
import type { CliIO } from './io'
import { detectJson, parseArgv, type ParsedArgs } from './parse'
import { VERSION } from './version'

export interface CliDeps {
  clock: () => number
  files: FileCommandDeps
}

async function dispatch(
  args: ParsedArgs,
  io: CliIO,
  reporter: Reporter,
  deps: CliDeps
): Promise<number> {
  const cmd = args.command as CommandSpec
  switch (cmd.id) {
    default:
      return runFileCommand(args, io, reporter, deps.files, deps.clock)
  }
}

/** The one terminal line in JSON mode (spec 2.6) when nothing was counted. */
function emptySummary(reporter: Reporter, exitCode: number): void {
  reporter.emit({
    event: 'summary',
    ok: 0,
    failed: 0,
    skipped: 0,
    canceled: 0,
    inBytes: 0,
    outBytes: 0,
    ms: 0,
    exitCode
  })
}

function failure(e: unknown, io: CliIO, reporter: Reporter, json: boolean): number {
  if (e instanceof CliError) {
    const exitCode = e.code === 'CANCELED' ? EXIT.CANCELED : EXIT.USAGE
    reporter.emit({ event: 'error', code: e.code, message: e.message, hint: e.hint })
    if (e instanceof UsageError && !json) {
      const cmd = findCommand(e.commandPath)
      const where = e.commandPath.length ? `${e.commandPath.join(' ')} ` : ''
      io.stderr.write(
        `${cmd ? usageLine(cmd) : 'Usage: filesmith <command> [options]'}\nRun 'filesmith ${where}--help' for details.\n`
      )
    }
    if (json) emptySummary(reporter, exitCode)
    return exitCode
  }
  reporter.emit({
    event: 'error',
    code: 'INTERNAL',
    message: e instanceof Error ? e.message : String(e)
  })
  io.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
  if (json) emptySummary(reporter, EXIT.FAILED)
  return EXIT.FAILED
}

/** The whole CLI as a function of its I/O (spec 4.3). */
export async function main(io: CliIO, deps: CliDeps): Promise<number> {
  const json = detectJson(io.argv)
  const reporter: Reporter = json
    ? new JsonReporter(io.stdout)
    : new HumanReporter(io.stdout, io.stderr, {
        color: io.stdoutTTY && !io.env.NO_COLOR,
        stderrTTY: io.stderrTTY
      })
  try {
    const args = parseArgv(io.argv)
    if (args.kind === 'version') {
      reporter.emit({ event: 'version', version: VERSION })
      return EXIT.OK
    }
    if (args.kind === 'help') {
      io.stdout.write(
        args.command
          ? renderHelp(args.command)
          : args.group
            ? renderGroupHelp(args.group)
            : renderRootHelp()
      )
      return EXIT.OK
    }
    return await dispatch(args, io, reporter, deps)
  } catch (e) {
    return failure(e, io, reporter, json)
  } finally {
    reporter.close()
  }
}
