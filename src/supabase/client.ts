/**
 * The single Supabase client for the app.
 *
 * Created lazily so that local mode never constructs one, and memoised so the
 * SDK's session handling (persistence across reloads, token refresh) has one
 * owner rather than one per import.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SupabaseConfigurationError, readSupabaseConfigState } from './config'

let client: SupabaseClient | null = null

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Slaids er ikke satt opp mot Supabase i denne bygget.')
    this.name = 'SupabaseNotConfiguredError'
  }
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client
  const state = readSupabaseConfigState()
  // A half-configured build is a mistake with a name; say which half is missing
  // rather than "not set up".
  if (state.kind === 'incomplete') throw new SupabaseConfigurationError(state.missing)
  if (state.kind !== 'configured') throw new SupabaseNotConfiguredError()
  const { config } = state
  client = createClient(config.url, config.publishableKey, {
    auth: {
      // The SDK keeps the session itself, which is what survives a reload.
      persistSession: true,
      autoRefreshToken: true,
      // Slaids has no redirect-based sign-in, so there is never a session in the URL.
      detectSessionInUrl: false,
    },
  })
  return client
}

/** Test seam: replace or clear the memoised client. */
export function setSupabaseClient(next: SupabaseClient | null): void {
  client = next
}
