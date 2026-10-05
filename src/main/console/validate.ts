import { classifyLine, cliVerbs, refusalText } from '@shared/consoleLine'
import { COMMANDS } from '../../cli/catalog'
import { buildConsoleCatalog } from './catalog'

export const catalog = buildConsoleCatalog(COMMANDS)
const verbs = cliVerbs(catalog)

/** The same check the renderer makes, again before anything starts (spec 10). */
// IPC arguments are untrusted: anything but plain strings is refused, the
// line is classified from scratch (never an argv from the renderer), and the
// folder must be an existing absolute directory.
export function validateRun(
  line: unknown,
  cwd: unknown,
  dirOk: (p: string) => boolean
): { ok: true; argv: string[]; cwd: string } | { ok: false; error: string } {
  if (typeof line !== 'string' || typeof cwd !== 'string')
    return { ok: false, error: 'Not a filesmith command.' }
  const k = classifyLine(line, verbs)
  if (k.kind === 'refuse') return { ok: false, error: refusalText(k) }
  if (k.kind !== 'cli') return { ok: false, error: 'Not a filesmith command.' }
  if (!dirOk(cwd)) return { ok: false, error: 'The console folder does not exist.' }
  return { ok: true, argv: k.argv, cwd }
}
