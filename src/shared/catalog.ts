import type { FileKind, ToolId } from './types'

// The app's navigation model: pick a FILE TYPE, then pick an OPERATION, then
// work in a screen that does exactly that one operation on exactly that one file
// type. Categories are what a user has; operations are what they want done.
//
// An operation is not the same thing as a ToolId. The PDF tool carries six
// distinct verbs behind an `op` option (merge, burst, …) and every one of them
// deserves its own card, while "Compress" maps to the compress tool under four
// different categories. This table is the mapping between the two.

export type CategoryId = 'images' | 'video' | 'audio' | 'pdf' | 'documents'

export interface Category {
  id: CategoryId
  label: string
  /** The file kinds this category accepts. */
  kinds: FileKind[]
  color: string
  icon: string
}

export const CATEGORIES: Category[] = [
  { id: 'images', label: 'Images', kinds: ['image'], color: '#5b5bd6', icon: 'image' },
  { id: 'video', label: 'Video', kinds: ['video'], color: '#e0483d', icon: 'video' },
  { id: 'audio', label: 'Audio', kinds: ['audio'], color: '#f5920b', icon: 'audio' },
  { id: 'pdf', label: 'PDF', kinds: ['pdf'], color: '#ef4444', icon: 'pdf' },
  {
    id: 'documents',
    label: 'Documents',
    kinds: ['document', 'text'],
    color: '#12b3a6',
    icon: 'doc'
  }
]

export interface Operation {
  /** Unique within its category. */
  id: string
  label: string
  /** One line, shown under the label on the operation card. */
  desc: string
  color: string
  icon: string
  /** The engine tool that performs it. */
  tool: ToolId
  /** For the PDF tool, the `op` option this card stands for. */
  opKey?: string
}

const CONVERT = (desc: string): Operation => ({
  id: 'convert',
  label: 'Convert',
  desc,
  color: '#5b5bd6',
  icon: 'convert',
  tool: 'convert'
})
const COMPRESS = (desc: string): Operation => ({
  id: 'compress',
  label: 'Compress',
  desc,
  color: '#f5920b',
  icon: 'compress',
  tool: 'compress'
})

export const OPERATIONS: Record<CategoryId, Operation[]> = {
  images: [
    CONVERT('Change format (PNG, WebP, AVIF)'),
    COMPRESS('Shrink file size'),
    {
      id: 'resize',
      label: 'Resize',
      desc: 'Scale by percent or exact size',
      color: '#22b364',
      icon: 'resize',
      tool: 'resize'
    },
    {
      id: 'upscale',
      label: 'Image Upscale',
      desc: 'Enlarge 2x to 4x with AI',
      color: '#8b5cf6',
      icon: 'upscale',
      tool: 'upscale'
    },
    {
      id: 'removebg',
      label: 'Remove Background',
      desc: 'Cut the subject out',
      color: '#12b3a6',
      icon: 'removebg',
      tool: 'removebg'
    }
  ],
  video: [CONVERT('Change container or codec'), COMPRESS('Shrink file size')],
  audio: [CONVERT('Change format (MP3, AAC, Opus)'), COMPRESS('Shrink file size')],
  pdf: [
    {
      id: 'extract-text',
      label: 'Extract text',
      desc: 'Save the text layer as .txt',
      color: '#ef4444',
      icon: 'text',
      tool: 'pdf',
      opKey: 'extract-text'
    },
    {
      id: 'pages-to-images',
      label: 'Pages to PNG',
      desc: 'Render each page to an image',
      color: '#5b5bd6',
      icon: 'image',
      tool: 'pdf',
      opKey: 'pages-to-images'
    },
    {
      id: 'merge',
      label: 'Merge',
      desc: 'Combine PDFs into one',
      color: '#12b3a6',
      icon: 'convert',
      tool: 'pdf',
      opKey: 'merge'
    },
    {
      id: 'split-range',
      label: 'Split',
      desc: 'Keep only the pages you list',
      color: '#22b364',
      icon: 'resize',
      tool: 'pdf',
      opKey: 'split-range'
    },
    {
      id: 'split-pages',
      label: 'Burst',
      desc: 'Save every page separately',
      color: '#8b5cf6',
      icon: 'upscale',
      tool: 'pdf',
      opKey: 'split-pages'
    },
    {
      id: 'extract-images',
      label: 'Extract images',
      desc: 'Pull out embedded images',
      color: '#e0483d',
      icon: 'removebg',
      tool: 'pdf',
      opKey: 'extract-images'
    },
    COMPRESS('Shrink file size')
  ],
  documents: [CONVERT('Convert to PDF, DOCX, TXT')]
}

/** Every workspace is one (category, operation) pair, and that pair is its key. */
export type WorkspaceKey = string
export const workspaceKey = (c: CategoryId, o: string): WorkspaceKey => `${c}:${o}`

export function categoryOf(id: CategoryId): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]
}

export function operationsFor(id: CategoryId): Operation[] {
  return OPERATIONS[id] ?? []
}

export function findOperation(c: CategoryId, opId: string): Operation | undefined {
  return operationsFor(c).find((o) => o.id === opId)
}

/** The operation a category opens on. There is no in-between screen, so every
 * category needs a sensible landing operation: the first one listed. */
export function defaultOperation(c: CategoryId): string {
  return operationsFor(c)[0]?.id ?? ''
}

/** True when a file belongs in this category (drives the type-locked drop zone). */
export function acceptsKind(c: CategoryId, kind: FileKind): boolean {
  return categoryOf(c).kinds.includes(kind)
}

/** The category a dropped file belongs to, or null if nothing handles it. */
export function categoryForKind(kind: FileKind): CategoryId | null {
  return CATEGORIES.find((c) => c.kinds.includes(kind))?.id ?? null
}
