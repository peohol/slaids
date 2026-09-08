/** Numbers as the chrome shows them. */

/** `1.2 MB`, `640 kB`, `12 B`: one decimal below ten, none above. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

/** `83 %`, of a whole, never negative and never above the whole. */
export function formatPercent(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
  return `${Math.round(clamped * 100)} %`
}

/** `4000 × 3000 px`. */
export function formatPixels(width: number, height: number): string {
  return `${Math.round(width)} × ${Math.round(height)} px`
}
