// Shared types crossing the main <-> renderer boundary. No Node or DOM imports.

export type ToolId = 'convert' | 'compress' | 'resize' | 'upscale' | 'removebg' | 'pdf'

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'other'

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

/** Free-form per-tool options (e.g. target format, quality, scale, dimensions). */
export type JobOptions = Record<string, string | number | boolean>

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

/** Progress/terminal event streamed back to the renderer for a job. */
export interface JobEvent {
  id: string
  status: JobStatus
  percent?: number // 0..100 when determinable
  message?: string
  outputPath?: string
  error?: string
}

/** A target choice a tool can offer the UI (e.g. "WebP", ".webp"). */
export interface ToolTarget {
  label: string
  ext: string
}
