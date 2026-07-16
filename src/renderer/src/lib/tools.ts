import type { ToolId } from '@shared/types'
import type { IconName } from '../components/Icon'

export interface ToolMeta {
  id: ToolId
  label: string
  color: string
  icon: IconName
  /** Present-tense verb for the primary button, e.g. "Convert". */
  verb: string
  /** Short line under the page heading. */
  blurb: string
}

export const TOOLS: ToolMeta[] = [
  {
    id: 'convert',
    label: 'Convert',
    color: '#5b5bd6',
    icon: 'convert',
    verb: 'Convert',
    blurb: 'Change image formats. Originals are never overwritten.'
  },
  {
    id: 'compress',
    label: 'Compress',
    color: '#f5920b',
    icon: 'compress',
    verb: 'Compress',
    blurb: 'Shrink image file size. Originals are kept.'
  },
  {
    id: 'resize',
    label: 'Resize',
    color: '#22b364',
    icon: 'resize',
    verb: 'Resize',
    blurb: 'Scale images by percentage or exact dimensions.'
  },
  {
    id: 'upscale',
    label: 'Upscale',
    color: '#8b5cf6',
    icon: 'upscale',
    verb: 'Upscale',
    blurb: 'AI super-resolution.'
  },
  {
    id: 'removebg',
    label: 'Remove BG',
    color: '#12b3a6',
    icon: 'removebg',
    verb: 'Remove background',
    blurb: 'Cut out the background of an image.'
  },
  {
    id: 'pdf',
    label: 'PDF',
    color: '#ef4444',
    icon: 'pdf',
    verb: 'Run',
    blurb: 'Extract text, images, or compress PDFs.'
  }
]

/** Tools with a working engine in phase 1. The rest render as "soon". */
export const ENABLED_TOOLS: ToolId[] = ['convert', 'compress', 'resize']

export function toolMeta(id: ToolId): ToolMeta {
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0]
}
