/** Why Generate cannot run yet, or null when a model is there. Unknown status
 * (the scan has not answered) is not a reason: never block on a guess. */
export function genBlockReason(
  status: { models: unknown[]; comfyFolder?: string | null } | null
): string | null {
  if (!status || status.models.length > 0) return null
  return status.comfyFolder
    ? 'Add an image model to generate'
    : 'Choose your ComfyUI folder to generate'
}

/** Count line for the Generate toolbar, like the file count on other tabs. */
export function genCountLabel(running: boolean, results: number): string {
  if (running) return 'Generating'
  return `${results} image${results === 1 ? '' : 's'}`
}
