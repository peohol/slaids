/**
 * Where the Supabase session is kept in this browser.
 *
 * «Hold meg innlogget på denne enheten» is a choice of storage, not of
 * session lifetime: Supabase refreshes the session the same way either way.
 *
 *  - `device` keeps it in `localStorage`, which outlives closing the browser.
 *  - `tab` keeps it in `sessionStorage`, which the browser drops when the tab
 *    (and the browser session) ends.
 *
 * One adapter, handed to the one Supabase client, so there is never a second
 * client with an opinion of its own. A write goes to the chosen storage and is
 * removed from the other, so a session is only ever in one place — a new
 * sign-in can therefore never leave a previous user's session behind in the
 * storage it did not choose. Removal clears both.
 *
 * The choice is made at sign-in (`setPersistence`). After a reload nobody has
 * chosen anything, so the adapter reads where the session actually is: this
 * tab's own `sessionStorage` first, then `localStorage`, and keeps writing
 * there. That makes the choice durable without a preference of its own that
 * could drift away from where the session really lives.
 */

import type { SupportedStorage } from '@supabase/supabase-js'

export type AuthPersistence = 'device' | 'tab'

/** The two Web Storage areas, injectable for the tests. */
export interface AuthStorageAreas {
  device: Storage | null
  tab: Storage | null
}

export interface AuthSessionStorage extends SupportedStorage {
  /** Where the next session goes. Called right before a sign-in. */
  setPersistence(persistence: AuthPersistence): void
  /** Which storage is in use, `null` until a session has been read or chosen. */
  persistence(): AuthPersistence | null
  /** Forget the choice; used after sign-out so the next sign-in chooses afresh. */
  reset(): void
}

const OTHER: Record<AuthPersistence, AuthPersistence> = { device: 'tab', tab: 'device' }

/** Storage access throws in some private modes and with blocked site data. */
function attempt<T>(action: () => T, fallback: T): T {
  try {
    return action()
  } catch {
    return fallback
  }
}

function browserAreas(): AuthStorageAreas {
  return {
    device: attempt(() => globalThis.localStorage ?? null, null),
    tab: attempt(() => globalThis.sessionStorage ?? null, null),
  }
}

export function createAuthStorage(areas: AuthStorageAreas = browserAreas()): AuthSessionStorage {
  let chosen: AuthPersistence | null = null

  const read = (persistence: AuthPersistence, key: string): string | null =>
    attempt(() => areas[persistence]?.getItem(key) ?? null, null)
  const remove = (persistence: AuthPersistence, key: string): void =>
    attempt(() => areas[persistence]?.removeItem(key), undefined)

  return {
    getItem(key) {
      if (chosen) return read(chosen, key)
      // Nothing chosen yet in this page: follow the session to where it is.
      // The tab's own storage first — it can only hold a session this tab
      // signed in with.
      for (const persistence of ['tab', 'device'] as const) {
        const value = read(persistence, key)
        if (value !== null) {
          chosen = persistence
          return value
        }
      }
      return null
    },
    setItem(key, value) {
      // A write with no choice made (there is no sign-in path that does this)
      // stays in the tab: the shorter-lived storage is the safe default.
      const target = chosen ?? 'tab'
      attempt(() => areas[target]?.setItem(key, value), undefined)
      remove(OTHER[target], key)
    },
    removeItem(key) {
      remove('device', key)
      remove('tab', key)
    },
    setPersistence(persistence) {
      chosen = persistence
    },
    persistence: () => chosen,
    reset() {
      chosen = null
    },
  }
}

/** The adapter the app's Supabase client uses. */
export const authSessionStorage: AuthSessionStorage = createAuthStorage()
