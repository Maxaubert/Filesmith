// The model registry: what a model IS, expressed as data on disk instead of
// TypeScript. Everything here is pure — no fs, no Electron — so both the main
// process and the renderer can use it, and every rule is unit-testable.
//
// Why this exists: a new checkpoint family used to require editing six places in
// compiled code (an arch union, a SUPPORTED allowlist, a hand-written workflow
// graph plus its builder switch, a CLIP-loader table, an extra-nodes table, and a
// companions table) and shipping a release. Model families ship monthly. The
// registry turns all six into one JSON entry that a user can add, and that we can
// update without an app release.

export type RegistryKind = 'generate' | 'upscale' | 'removebg' | 'pid-backbone'
export type ProvenanceSource = 'builtin' | 'channel' | 'user'

export interface Provenance {
  source: ProvenanceSource
  /** Host an artifact came from, shown in the UI so a source is never a mystery. */
  host?: string
  addedAt?: string
}

/**
 * How to recognize a model FROM THE FILE. Never a filename alone — a filename is
 * a hint the user can change, and treating it as identity is what makes a
 * renamed file re-download gigabytes it already has.
 */
export interface DetectSpec {
  /** Substrings matched against modelspec.architecture / architecture metadata. */
  metaArch?: string[]
  /** Tensor-key substring signature: all of `all`, any of `any`, none of `none`. */
  tensorKeys?: { all?: string[]; any?: string[]; none?: string[] }
  /** Inclusive [min, max] byte range, for size-discriminated variants. */
  sizeBytesRange?: [number, number]
  /** ncnn `.param` basename, for the Real-ESRGAN runner. */
  ncnnParamBasename?: string
  /** Advisory only, never sufficient on its own. Case-insensitive regex source. */
  nameHint?: string
}

/** What a probed file looks like, for scoring against a DetectSpec. */
export interface ProbedFile {
  basename: string
  sizeBytes?: number
  metaArch?: string
  tensorKeys?: string[]
}

export interface Capabilities {
  task: 'text-to-image' | 'upscale' | 'remove-background'
  /** Generation limits. Per-arch, replacing a single global clamp. */
  minDim?: number
  maxDim?: number
  dimStep?: number
  sizeBuckets?: [number, number][]
  /** Upscale. */
  scales?: number[]
  inputFormats?: string[]
}

export interface SamplerSpec {
  name: string
  scheduler: string
  steps: number
  cfg: number
  guidance: number
  hasGuidance: boolean
}

export interface Requirements {
  /** Node class names that must exist in this ComfyUI (checked via /object_info). */
  nodes?: string[]
  /** Loader node + the `type` enum value it must accept. */
  clipLoader?: { node: 'CLIPLoader' | 'DualCLIPLoader'; type: string }
  gpu?: { vendor?: 'nvidia' | 'amd' | 'intel' | 'any'; minComputeCap?: number; minVramMb?: number }
  /** Shown when a node/type check fails. */
  minComfyNote?: string
}

export interface DownloadSpec {
  filename: string
  /** Human size for the UI ("4.9 GB"). */
  approxSize: string
  /** Exact size in bytes, when known. */
  bytes?: number
  /**
   * sha256 of the file at `urls[0]`. For Hugging Face this is the git-LFS
   * object id, which IS the content hash — fetched by scripts/registry-hashes.mjs
   * rather than guessed. Absent means the download falls back to
   * trust-on-first-use. It is NOT enforced against a fallback mirror, which may
   * legitimately hold different bytes.
   */
  sha256?: string
  /** Tried in order: a pinned commit revision first, a moving branch last. */
  urls: string[]
}

/** The ComfyUI model subfolders a registry entry may write into. Fixed enum: the
 * moment a manifest is user- or network-editable, `join(root, subdir, filename)`
 * becomes a path-traversal sink. */
export const COMPANION_SUBDIRS = [
  'text_encoders',
  'clip',
  'vae',
  'checkpoints',
  'diffusion_models',
  'unet',
  'upscale_models'
] as const
export type CompanionSubdir = (typeof COMPANION_SUBDIRS)[number]

export interface CompanionSpec {
  role: 'clip' | 'clip2' | 'vae'
  label: string
  subdir: CompanionSubdir
  /** Content-first identification of a file the user may ALREADY own. */
  identify: DetectSpec
  download: DownloadSpec
}

/** A size- or name-selected alternative set of companions (Flux 2's 4B vs 9B). */
export interface CompanionSet {
  id: string
  when?: { minBytes?: number; nameHint?: string }
  companions: CompanionSpec[]
}

/** A workflow node. JSON DATA — parsed, validated, never evaluated. */
export interface WorkflowNode {
  class_type: string
  inputs: Record<string, unknown>
}

export interface WorkflowSpec {
  format: 'comfy-api-v1'
  template: Record<string, WorkflowNode>
}

export interface RegistryEntry {
  id: string
  kind: RegistryKind
  label: string
  /** Picker group heading. */
  group?: string
  provenance: Provenance
  detect?: DetectSpec
  capabilities?: Capabilities
  sampler?: SamplerSpec
  requires?: Requirements
  companions?: CompanionSpec[]
  companionSets?: CompanionSet[]
  /** Graph for a bare diffusion model (UNETLoader + separate encoders/VAE). */
  workflow?: WorkflowSpec
  /** Graph for the same family as an all-in-one single-file checkpoint. */
  checkpointWorkflow?: WorkflowSpec
  /** Graph for the quantized GGUF build. Optional: when absent it is DERIVED
   * from `workflow` by swapping the UNET loader, so a family gets GGUF support
   * for free and an entry only supplies this if its GGUF wiring differs. */
  ggufWorkflow?: WorkflowSpec
  /** Non-downloaded files that must sit beside the runner (ncnn .param/.bin). */
  files?: { path: string; sha256?: string }[]
  /** 'comfy' | 'realesrgan-ncnn' | 'spandrel' | 'rembg' | 'pid'. */
  runner?: string
  /** Package spec for a runner that installs a Python package. */
  engineSpec?: string
  schemaVersion?: number
}

export interface RegistryFile {
  schemaVersion: number
  entries: RegistryEntry[]
}

/** The schema version this build understands. Entries above it are skipped with
 * a note rather than crashing the load — a newer channel pack must never brick
 * an older app. */
export const REGISTRY_SCHEMA_VERSION = 1

// --- merge -----------------------------------------------------------------

/**
 * Merge layers by `id`, later layers winning FIELD BY FIELD. That per-field rule
 * is the whole point of the user layer: `{"id": "flux2", "companions": [...]}`
 * overrides only the companions of the built-in flux2 and inherits its workflow,
 * so a user fixes a dead download URL in thirty seconds without understanding
 * anything else about the entry.
 */
export function mergeRegistry(layers: RegistryFile[]): RegistryEntry[] {
  const byId = new Map<string, RegistryEntry>()
  const order: string[] = []
  for (const layer of layers) {
    for (const e of layer.entries ?? []) {
      if (!e?.id) continue
      const prev = byId.get(e.id)
      if (!prev) order.push(e.id)
      byId.set(e.id, prev ? { ...prev, ...e, provenance: e.provenance ?? prev.provenance } : e)
    }
  }
  return order.map((id) => byId.get(id)!)
}

// --- detection --------------------------------------------------------------

function safeRegExp(source: string): RegExp | null {
  try {
    return new RegExp(source, 'i')
  } catch {
    return null
  }
}

/**
 * Score a probed file against a DetectSpec. 0 = no match. Higher = more evidence.
 * Weighted so that content beats metadata beats size beats the name — a filename
 * can never outvote what the tensors actually say.
 */
export function scoreDetect(d: DetectSpec, probe: ProbedFile): number {
  let score = 0

  if (d.tensorKeys) {
    const keys = probe.tensorKeys
    const { all = [], any = [], none = [] } = d.tensorKeys
    if (!keys && (all.length || any.length)) return 0
    const has = (frag: string): boolean => (keys ?? []).some((k) => k.includes(frag))
    if (none.some(has)) return 0
    if (all.length) {
      if (!all.every(has)) return 0
      score += 100
    }
    if (any.length) {
      if (!any.some(has)) return 0
      score += 60
    }
  }

  if (d.metaArch?.length) {
    const meta = probe.metaArch?.toLowerCase() ?? ''
    if (meta && d.metaArch.some((m) => meta.includes(m.toLowerCase()))) score += 50
    else if (!probe.tensorKeys) return 0
  }

  if (d.sizeBytesRange) {
    const [lo, hi] = d.sizeBytesRange
    if (probe.sizeBytes == null) return score // unknown size is not a rejection
    if (probe.sizeBytes < lo || probe.sizeBytes > hi) return 0
    score += 20
  }

  if (d.ncnnParamBasename) {
    if (probe.basename.replace(/\.param$/i, '').toLowerCase() !== d.ncnnParamBasename.toLowerCase())
      return 0
    score += 100
  }

  if (d.nameHint) {
    const re = safeRegExp(d.nameHint)
    if (re?.test(probe.basename)) score += 5
  }

  return score
}

/** True when a DetectSpec's *name* hint matches — the last-resort signal, used
 * only where no content probe is available (an existing companion on disk). */
export function nameMatches(d: DetectSpec, basename: string): boolean {
  if (!d.nameHint) return false
  return safeRegExp(d.nameHint)?.test(basename) ?? false
}

// --- companion selection ----------------------------------------------------

/**
 * The companion list for a model, choosing between size-discriminated variants.
 * Byte size beats the filename by design (a 9B Flux 2 renamed without a "9b"
 * token still gets the 8B encoder), with the name as the fallback when the size
 * is unknown.
 */
export function selectCompanions(
  entry: RegistryEntry,
  modelName: string,
  sizeBytes?: number
): CompanionSpec[] {
  const sets = entry.companionSets
  if (!sets?.length) return entry.companions ?? []
  for (const s of sets) {
    const w = s.when
    if (!w || (w.minBytes == null && w.nameHint == null)) continue // the default
    if (sizeBytes != null) {
      if (w.minBytes != null && sizeBytes > w.minBytes) return s.companions
    } else if (w.nameHint && (safeRegExp(w.nameHint)?.test(modelName) ?? false)) {
      return s.companions
    }
  }
  const fallback = sets.find((s) => !s.when || (s.when.minBytes == null && s.when.nameHint == null))
  return fallback?.companions ?? sets[sets.length - 1].companions
}

// --- workflow instantiation -------------------------------------------------

/**
 * Substitute `${name}` placeholders in a workflow template.
 *
 * A value that is EXACTLY one placeholder becomes the raw value, so `"${seed}"`
 * yields a number and not the string "123456" (ComfyUI rejects a string where it
 * wants an int). Anything else interpolates as text. Unknown placeholders are
 * left untouched rather than turning into "undefined".
 *
 * This is data substitution and nothing else: no eval, no Function, no require.
 * The result is only ever POSTed to a loopback ComfyUI.
 */
export function instantiateWorkflow(
  spec: WorkflowSpec,
  vars: Record<string, string | number>
): Record<string, WorkflowNode> {
  const subst = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = /^\$\{([a-zA-Z0-9_]+)\}$/.exec(v)
      if (whole) return whole[1] in vars ? vars[whole[1]] : v
      return v.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (m, k: string) =>
        k in vars ? String(vars[k]) : m
      )
    }
    if (Array.isArray(v)) return v.map(subst)
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, subst(x)]))
    return v
  }
  const out: Record<string, WorkflowNode> = {}
  for (const [id, node] of Object.entries(spec.template))
    out[id] = {
      class_type: node.class_type,
      inputs: subst(node.inputs) as Record<string, unknown>
    }
  return out
}

/** Every `${placeholder}` a template references, for validation. */
export function workflowPlaceholders(spec: WorkflowSpec): string[] {
  const found = new Set<string>()
  const walk = (v: unknown): void => {
    if (typeof v === 'string') for (const m of v.matchAll(/\$\{([a-zA-Z0-9_]+)\}/g)) found.add(m[1])
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v as object).forEach(walk)
  }
  for (const node of Object.values(spec.template)) walk(node.inputs)
  return [...found]
}

// --- validation -------------------------------------------------------------

/** Placeholders the app knows how to supply. A template naming anything else is
 * rejected at load, so a bad entry fails loudly at load rather than mysteriously
 * at generation time. */
export const KNOWN_PLACEHOLDERS = [
  'unet',
  'clip',
  'clip2',
  'vae',
  'model',
  'prompt',
  'negative',
  'seed',
  'steps',
  'cfg',
  'guidance',
  'sampler',
  'scheduler',
  'width',
  'height',
  'batch',
  'prefix'
]

const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/

/**
 * Validate one entry. Returns the problems found; an empty array means usable.
 * These are not style checks — `subdir` and `filename` become
 * `join(root, subdir, filename)` in the companion downloader, so the moment the
 * manifest is user- or network-supplied they are a traversal sink. Enforced once,
 * here, before any entry is trusted.
 */
export function validateEntry(e: RegistryEntry): string[] {
  const errs: string[] = []
  if (!e.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(e.id)) errs.push(`bad id "${e.id}"`)
  if (!e.kind) errs.push(`${e.id}: missing kind`)
  if (!e.label) errs.push(`${e.id}: missing label`)

  const checkCompanion = (c: CompanionSpec): void => {
    if (!COMPANION_SUBDIRS.includes(c.subdir))
      errs.push(`${e.id}: companion subdir "${c.subdir}" is not allowed`)
    const f = c.download?.filename ?? ''
    if (!SAFE_FILENAME.test(f) || f === '.' || f === '..')
      errs.push(`${e.id}: companion filename "${f}" must be a plain name (no separators, no "..")`)
    for (const u of c.download?.urls ?? []) {
      let parsed: URL | null = null
      try {
        parsed = new URL(u)
      } catch {
        /* reported below */
      }
      if (!parsed || parsed.protocol !== 'https:')
        errs.push(`${e.id}: download URL must be https: (${u})`)
    }
    if (!(c.download?.urls ?? []).length) errs.push(`${e.id}: companion "${c.label}" has no URL`)
  }
  for (const c of e.companions ?? []) checkCompanion(c)
  for (const s of e.companionSets ?? []) for (const c of s.companions ?? []) checkCompanion(c)

  for (const wf of [e.workflow, e.checkpointWorkflow, e.ggufWorkflow]) {
    if (!wf) continue
    if (wf.format !== 'comfy-api-v1') errs.push(`${e.id}: unknown workflow format "${wf.format}"`)
    for (const [nid, node] of Object.entries(wf.template ?? {})) {
      if (!node || typeof node.class_type !== 'string' || typeof node.inputs !== 'object')
        errs.push(`${e.id}: workflow node "${nid}" is not {class_type, inputs}`)
    }
    for (const p of workflowPlaceholders(wf))
      if (!KNOWN_PLACEHOLDERS.includes(p)) errs.push(`${e.id}: unknown placeholder \${${p}}`)
  }
  return errs
}
