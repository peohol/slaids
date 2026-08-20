/**
 * Non-critical UI preferences. These live in localStorage on purpose: window
 * positions and toggles are local, disposable and must never end up in the
 * presentation document.
 */

const PREFIX = 'slaids.ui.'

export interface WindowGeometry {
  x: number
  y: number
  width: number
  height: number
}

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage may be unavailable or full; UI preferences are not worth failing over.
  }
}

export const DEFAULT_IDEAS_GEOMETRY: WindowGeometry = { x: 80, y: 120, width: 360, height: 460 }

export const DEFAULT_SANDBOX_GEOMETRY: WindowGeometry = {
  x: 480,
  y: 160,
  width: 380,
  height: 420,
}

