/**
 * Supabase configuration.
 *
 * Slaids runs in one of two modes, decided once, at startup, by whether the
 * build was given Supabase credentials:
 *
 *  - **Supabase mode** – the production setup. Sign-in is required and every
 *    presentation, template, folder and asset lives in Supabase.
 *  - **Local mode** – no Supabase credentials, so the app behaves exactly as it
 *    did before: Dexie/IndexedDB, no sign-in. This is for local development and
 *    the test suites, *not* a fallback for a Supabase that happens to be down.
 *
 * A build with only one of the two variables is neither: it is a deployment
 * mistake, and it stops the app rather than picking a mode. Falling back to
 * IndexedDB there would mean production quietly saving into a browser store
 * nobody knows to look in.
 *
 * Only the publishable (anon) key ever reaches the browser. A service-role key
 * would bypass RLS and must never be part of a frontend build.
 */

export const SUPABASE_URL_VAR = 'VITE_SUPABASE_URL'
export const SUPABASE_PUBLISHABLE_KEY_VAR = 'VITE_SUPABASE_PUBLISHABLE_KEY'

export interface SupabaseConfig {
  url: string
  publishableKey: string
}

export type SupabaseConfigState =
  /** Both variables are present: Supabase mode. */
  | { kind: 'configured'; config: SupabaseConfig }
  /** Neither variable is present: local mode. */
  | { kind: 'absent' }
  /** Exactly one is present, which is a deployment mistake, not a mode. */
  | { kind: 'incomplete'; missing: string[] }

/** A build that is half configured for Supabase. */
export class SupabaseConfigurationError extends Error {
  readonly missing: readonly string[]

  constructor(missing: readonly string[]) {
    super(describeIncompleteConfig(missing))
    this.name = 'SupabaseConfigurationError'
    this.missing = missing
  }
}

export function describeIncompleteConfig(missing: readonly string[]): string {
  return (
    `Slaids er delvis satt opp mot Supabase: ${missing.join(' og ')} mangler. ` +
    'Sett variabelen i miljøet og bygg på nytt. Slaids lagrer ikke lokalt i ' +
    'mellomtiden – da ville produksjonsdata havnet i nettleseren uten at noen visste det.'
  )
}

function readEnv(key: string): string {
  const env = import.meta.env as Record<string, unknown> | undefined
  const value = env?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function readSupabaseConfigState(): SupabaseConfigState {
  const url = readEnv(SUPABASE_URL_VAR)
  const publishableKey = readEnv(SUPABASE_PUBLISHABLE_KEY_VAR)
  if (url && publishableKey) return { kind: 'configured', config: { url, publishableKey } }
  if (!url && !publishableKey) return { kind: 'absent' }
  return {
    kind: 'incomplete',
    missing: [
      ...(url ? [] : [SUPABASE_URL_VAR]),
      ...(publishableKey ? [] : [SUPABASE_PUBLISHABLE_KEY_VAR]),
    ],
  }
}

/** The configuration, or `null` when the build is not fully configured. */
export function readSupabaseConfig(): SupabaseConfig | null {
  const state = readSupabaseConfigState()
  return state.kind === 'configured' ? state.config : null
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseConfigState().kind === 'configured'
}
