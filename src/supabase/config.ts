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
 * Only the publishable (anon) key ever reaches the browser. A service-role key
 * would bypass RLS and must never be part of a frontend build.
 */

export interface SupabaseConfig {
  url: string
  publishableKey: string
}

function readEnv(key: string): string {
  const env = import.meta.env as Record<string, unknown> | undefined
  const value = env?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Read the configuration, or `null` when the app is not configured for
 * Supabase. Both variables must be present: a half-configured build would fail
 * later, in the middle of a save, instead of here.
 */
export function readSupabaseConfig(): SupabaseConfig | null {
  const url = readEnv('VITE_SUPABASE_URL')
  const publishableKey = readEnv('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (!url || !publishableKey) return null
  return { url, publishableKey }
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseConfig() !== null
}
