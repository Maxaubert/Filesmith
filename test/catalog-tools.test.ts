import { describe, expect, it } from 'vitest'
import { OPERATIONS } from '../src/shared/catalog'
import { getTool } from '../src/main/tools/registry'

// TOOLS in tools/registry.ts is a Partial<Record<ToolId, ToolModule>>, which
// removes the compiler's exhaustiveness check: a renamed or added ToolId
// compiles fine and fails at runtime with "Unknown tool: X". This walks the
// UI's own catalog and asserts every operation resolves to an engine module.
//
// 'generate' is the one deliberate exemption: generation runs on its own
// generate:* IPC path (see App.tsx's early return), not through the job queue.
const QUEUE_EXEMPT = new Set(['generate'])

describe('catalog <-> engine registry', () => {
  it('every catalog operation maps to an implemented tool module', () => {
    for (const ops of Object.values(OPERATIONS)) {
      for (const op of ops) {
        if (QUEUE_EXEMPT.has(op.tool)) continue
        expect(getTool(op.tool), `tool '${op.tool}' (operation '${op.id}')`).toBeDefined()
      }
    }
  })
})
