import { basename } from 'path'
import type { FileInfo, JobOptions } from '@shared/types'
import { planOutput } from '../main/tools/plan'
import type { CommandId } from './catalog'
import { UsageError } from './exit'
import type { BuiltOptions } from './options'
import { planJobs, type PlanEnv, type PlanResult, type PlannedJob } from './plan'

/** `filesmith pdf <tool>` (spec 3.7). Merge is one job over every input in
 * argument order; the rest are one job per file. */
export function planPdfJobs(
  id: CommandId,
  files: FileInfo[],
  built: BuiltOptions,
  env: PlanEnv
): PlanResult {
  if (id !== 'pdf merge') return planJobs(id, files, built, env)
  const others = files.filter((f) => f.kind !== 'pdf')
  if (others.length)
    throw new UsageError(
      `pdf merge takes only PDFs: ${others.map((f) => basename(f.path)).join(', ')}.`,
      ['pdf', 'merge']
    )
  if (files.length < 2) throw new UsageError('pdf merge needs at least two PDFs.', ['pdf', 'merge'])
  const paths = files.map((f) => f.path)
  const options: JobOptions = {
    op: 'merge',
    mergeInputs: paths,
    ...(env.outDir ? { outDir: env.outDir } : {})
  }
  const job: PlannedJob = {
    id: '1',
    input: paths[0],
    inputs: paths,
    inSize: files.reduce((a, f) => a + f.size, 0),
    tool: 'pdf',
    op: 'pdf/merge',
    options,
    output: planOutput('pdf', files[0], options, env.outDir, new Set()),
    state: 'ready'
  }
  return { jobs: [job], warnings: [] }
}
