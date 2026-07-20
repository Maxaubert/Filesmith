// Shared types crossing the main <-> renderer boundary. No Node or DOM imports.

export type ToolId = 'convert' | 'compress' | 'resize' | 'upscale' | 'removebg' | 'pdf'

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'text' | 'other'

/** A file the user has added, as the renderer knows it. */
export interface FileInfo {
  path: string
  name: string
  ext: string // lowercased, leading dot, e.g. ".png"
  kind: FileKind
  size: number
}

/** One unit of work: run one tool on one input file with options. */
export interface JobRequest {
  id: string
  tool: ToolId
  input: string // absolute source path
  options: JobOptions
}

/** Free-form per-tool options (e.g. target format, quality, scale, dimensions).
 * String arrays carry ordered path lists (PDF merge's inputs). */
export type JobOptions = Record<string, string | number | boolean | string[]>

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

/** Progress/terminal event streamed back to the renderer for a job. */
export interface JobEvent {
  id: string
  status: JobStatus
  percent?: number // 0..100 when determinable
  /** Seconds remaining, when the tool can estimate it. A long encode sits below
   * 1% for minutes, so the time left is what tells the user it's alive. */
  etaSec?: number
  message?: string
  outputPath?: string
  /** Size in bytes of the produced file (so the UI can show the result size
   * and the reduction vs the source). Absent for directory outputs. */
  outputSize?: number
  error?: string
}

/** A target choice a tool can offer the UI (e.g. "WebP", ".webp"). */
export interface ToolTarget {
  label: string
  ext: string
}

/** One file shown in the preview window. */
export interface PreviewItem {
  path: string
  name: string
  kind: FileKind
  size?: number
  thumb?: string | null
}

/** The set of files handed to the preview window, plus which one to show first. */
export interface PreviewPayload {
  files: PreviewItem[]
  index: number
}
