import type { FileKind, ToolId } from './types'
import { routeConvert } from './convert'

// The app's navigation model: pick what you want DONE, then drop files. The
// rail is the verb; the file kind is a property of what you dropped, not a
// place you navigate to. Replaces the old category-first catalog, where the
// same verb (Convert) had to exist five times over, once per file type.

export type TabId =
  'convert' | 'compress' | 'resize' | 'upscale' | 'removebg' | 'generate' | 'tools' | 'completed'

export interface Tab {
  id: TabId
  label: string
  /** One line under the title, and on the empty state. */
  desc: string
  color: string
  icon: string
  /** Kinds this verb can act on. Empty means the tab takes no dropped input. */
  kinds: FileKind[]
  tool: ToolId
}

export const TABS: Tab[] = [
  {
    id: 'convert',
    // PDF belongs here: familyFormats unions pdf + document + text into one
    // family, so PDF -> DOCX/TXT/RTF is an ordinary convert.
    label: 'Convert',
    desc: 'Change format',
    color: '#5b5bd6',
    icon: 'convert',
    kinds: ['image', 'video', 'audio', 'document', 'text', 'pdf', 'archive'],
    tool: 'convert'
  },
  {
    id: 'compress',
    label: 'Compress',
    desc: 'Shrink file size',
    color: '#f5920b',
    icon: 'compress',
    kinds: ['image', 'video', 'audio', 'pdf'],
    tool: 'compress'
  },
  {
    id: 'resize',
    label: 'Resize',
    desc: 'Scale by percent or exact size',
    color: '#22b364',
    icon: 'resize',
    kinds: ['image'],
    tool: 'resize'
  },
  {
    id: 'upscale',
    label: 'Upscale',
    desc: 'Enlarge 2x to 4x with AI',
    color: '#8b5cf6',
    icon: 'upscale',
    kinds: ['image'],
    tool: 'upscale'
  },
  {
    id: 'removebg',
    label: 'Remove BG',
    desc: 'Cut the subject out with AI',
    color: '#12b3a6',
    icon: 'removebg',
    kinds: ['image'],
    tool: 'removebg'
  },
  {
    // The one tab with no dropped input: the prompt IS the input.
    id: 'generate',
    label: 'Generate',
    desc: 'Create an image from a text prompt',
    color: '#d6409f',
    icon: 'image',
    kinds: [],
    tool: 'generate'
  },
  {
    // A grid, not a workspace, until a card is picked. `tool` is unused for the
    // grid itself; each card names its own.
    id: 'tools',
    label: 'Tools',
    desc: 'One-off jobs, grouped by what they act on',
    color: '#6e6e73',
    icon: 'tools',
    kinds: [],
    tool: 'pdf'
  }
]

/**
 * Everything Filesmith has produced, in one place. Deliberately NOT in TABS: it
 * is a view rather than a verb, it takes no dropped files, and it is pinned to
 * the bottom of the rail instead of being reorderable with the verbs.
 */
export const COMPLETED_TAB: Tab = {
  id: 'completed',
  label: 'Completed',
  desc: 'Everything Filesmith has produced',
  color: '#22b364',
  icon: 'check',
  kinds: [],
  tool: 'convert'
}

export interface ToolCard {
  id: string
  label: string
  desc: string
  /** Section heading in the Tools grid. */
  group: string
  color: string
  icon: string
  tool: ToolId
  opKey: string
  kinds: FileKind[]
}

// Only the PDF one-offs live here. Anything that produces another FILE from a
// file - archive repack, PDF to CBZ, archive to PDF - is an ordinary Convert
// and belongs on the Convert tab, where a user goes looking for it.
export const TOOL_CARDS: ToolCard[] = [
  {
    id: 'pdf-text',
    label: 'Extract text',
    desc: 'Save the text layer as .txt',
    group: 'PDF',
    color: '#ef4444',
    icon: 'text',
    tool: 'pdf',
    opKey: 'extract-text',
    kinds: ['pdf']
  },
  {
    id: 'pdf-images',
    label: 'Pages to PNG',
    desc: 'Render each page to an image',
    group: 'PDF',
    color: '#ef4444',
    icon: 'image',
    tool: 'pdf',
    opKey: 'pages-to-images',
    kinds: ['pdf']
  },
  {
    id: 'pdf-merge',
    label: 'Merge',
    desc: 'Combine PDFs into one',
    group: 'PDF',
    color: '#ef4444',
    icon: 'merge',
    tool: 'pdf',
    opKey: 'merge',
    kinds: ['pdf']
  },
  {
    id: 'pdf-split',
    label: 'Split',
    desc: 'Keep only the pages you list',
    group: 'PDF',
    color: '#ef4444',
    icon: 'split',
    tool: 'pdf',
    opKey: 'split-range',
    kinds: ['pdf']
  },
  {
    id: 'pdf-burst',
    label: 'Burst',
    desc: 'Save every page separately',
    group: 'PDF',
    color: '#ef4444',
    icon: 'burst',
    tool: 'pdf',
    opKey: 'split-pages',
    kinds: ['pdf']
  },
  {
    id: 'pdf-extract-images',
    label: 'Extract images',
    desc: 'Pull out embedded images',
    group: 'PDF',
    color: '#ef4444',
    icon: 'pull',
    tool: 'pdf',
    opKey: 'extract-images',
    kinds: ['pdf']
  }
]

/**
 * The engine tool (and verb) that actually performs a tab's work for one convert
 * group. The mapping is not 1:1: the Convert tab runs the `convert` tool for
 * images, video, audio and documents, but an archive repack is the `archive`
 * tool with op `repack`. A tool card names its own tool and op outright.
 */
/**
 * The engine tool (and verb) that performs a tab's work. A tool card names its
 * own outright. On the Convert tab the answer depends on the TARGET as well as
 * the source, so `routeConvert` decides: a .cbz to .cb7 is archive/repack, a
 * .pdf to .cbz is archive/from-pdf, and a .png to .webp is the convert tool.
 */
export function engineFor(
  tab: TabId,
  group: string,
  card?: ToolCard | null,
  source?: { kind: FileKind; ext: string },
  targetExt?: string
): { tool: ToolId; op?: string } {
  if (card) return { tool: card.tool, op: card.opKey }
  if (tab === 'convert' && source && targetExt) {
    return routeConvert(source.kind, source.ext, targetExt)
  }
  // No selection yet: name the tab's default tool so the panel has something.
  if (tab === 'convert' && group === 'archive') return { tool: 'archive', op: 'repack' }
  return { tool: tabById(tab).tool }
}

export function tabById(id: TabId): Tab {
  if (id === 'completed') return COMPLETED_TAB
  return TABS.find((t) => t.id === id) ?? TABS[0]
}

export function tabAccepts(id: TabId, kind: FileKind): boolean {
  return tabById(id).kinds.includes(kind)
}

export function toolCardById(id: string): ToolCard | undefined {
  return TOOL_CARDS.find((c) => c.id === id)
}

/** Tool cards in grid order, grouped by their section heading. */
export function toolGroups(): { name: string; cards: ToolCard[] }[] {
  const out: { name: string; cards: ToolCard[] }[] = []
  for (const c of TOOL_CARDS) {
    const g = out.find((x) => x.name === c.group)
    if (g) g.cards.push(c)
    else out.push({ name: c.group, cards: [c] })
  }
  return out
}
