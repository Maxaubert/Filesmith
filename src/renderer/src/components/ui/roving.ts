/** Next index for roving-tabindex groups (tabs, segments, chips). */
export function rovingIndex(
  key: string,
  i: number,
  n: number,
  axis: 'x' | 'y' = 'x'
): number | null {
  if (n <= 0) return null
  const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
  const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
  if (key === back) return (i - 1 + n) % n
  if (key === fwd) return (i + 1) % n
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  return null
}
