import { describe, expect, it } from 'vitest'
import { TABS, TOOL_CARDS, engineFor } from '@shared/tabs'
import { getTool } from '../src/main/tools/registry'

// TOOLS in tools/registry.ts is a Partial<Record<ToolId, ToolModule>>, which
// removes the compiler's exhaustiveness check: a renamed or added ToolId
// compiles fine and fails at runtime with "Unknown tool: X". This walks the
// UI's own navigation model and asserts every route resolves to an engine
// module. Replaces the old catalog <-> registry check.
//
// 'generate' is the one deliberate exemption: generation runs on its own
// generate:* IPC path (see App.tsx's early return), not through the job queue.
const QUEUE_EXEMPT = new Set(['generate'])

describe('tabs <-> engine registry', () => {
  it('every verb resolves to an implemented tool module, for every kind it takes', () => {
    for (const tab of TABS) {
      if (tab.id === 'tools') continue // the grid itself runs nothing
      for (const kind of tab.kinds.length ? tab.kinds : (['image'] as const)) {
        // The Convert tab routes archives to a different engine than images, so
        // resolve per group rather than trusting tab.tool.
        const group = kind === 'archive' ? 'archive' : kind
        const { tool } = engineFor(tab.id, group)
        if (QUEUE_EXEMPT.has(tool)) continue
        expect(getTool(tool), `tool '${tool}' (tab '${tab.id}', kind '${kind}')`).toBeDefined()
      }
    }
  })

  it('every tool card resolves to an implemented tool module', () => {
    for (const c of TOOL_CARDS) {
      expect(getTool(c.tool), `tool '${c.tool}' (card '${c.id}')`).toBeDefined()
    }
  })
})
