/** A checkpoint whose name marks it as restoration/refiner/inpaint: a valid
 * model but not text-to-image, so we never auto-select it as the default. */
export function isRestoreName(label: string): boolean {
  return /supir|refiner|inpaint|upscal|controlnet/i.test(label)
}
