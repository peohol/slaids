/**
 * The one screen Slaids has to draw for OAuth, and the reason is worth stating.
 *
 * Supabase Auth is the authorization server: it validates the request, issues
 * the code, mints the tokens and rotates the refresh tokens. What it deliberately
 * does *not* do is decide what the consent screen says. That is the
 * application's, because it is the only part of the flow that is about *this*
 * product — which decks, whose account, what an approval actually lets the
 * other application do. So Supabase sends the user here with an
 * `authorization_id`, and this page answers it.
 *
 * Three properties it has to have, and each one is a way the screen could
 * otherwise be worse than useless:
 *
 *  - **It is behind `AuthGate`.** Approving an authorization is the account
 *    holder's act. A consent screen a stranger could reach is a consent screen
 *    that grants somebody else's data, and the gate is already the check for
 *    "is this an active Slaids user" — the same access list the server
 *    enforces. Signing in happens in place, at this address, so the request
 *    is still here when the code has been accepted.
 *  - **It names the application asking, not a generic "an app".** The whole
 *    value of a consent screen is that the user can recognise, or fail to
 *    recognise, who is asking. The name and the redirect address both come from
 *    the authorization request rather than from anything this page assumes.
 *  - **Denying is as easy as approving, and is the default outcome.** Nothing is
 *    granted by arriving here, closing the tab grants nothing, and the two
 *    buttons are the same size.
 *
 * There is no state of our own to keep. `getAuthorizationDetails` is the whole
 * of what is known, and it has two shapes: a pending request to show, or — when
 * the user has approved this client before — a redirect to follow immediately,
 * which is Supabase saying the consent already exists.
 */

import { useCallback, useEffect, useState } from 'react'
import { OAUTH_AUTHORIZATION_ID_PARAM } from '../../routing'
import { getSupabaseClient } from '../../supabase/client'

/** What the screen is showing right now. One value, so no two can disagree. */
type ConsentState =
  | { kind: 'loading' }
  /** No `authorization_id` at all: somebody opened the address directly. */
  | { kind: 'no-request' }
  | { kind: 'failed'; message: string }
  | {
      kind: 'asking'
      authorizationId: string
      clientName: string
      redirectUri: string
      scopes: string[]
    }
  | { kind: 'deciding' }

/**
 * The scopes as the request names them, for display.
 *
 * Space-separated in the authorization request, which is OAuth's own encoding.
 * They are shown verbatim rather than translated: the point of the list is that
 * it is the same list the authorization server recorded, and a friendly
 * rewriting here would be this page describing a grant it does not make.
 */
function scopesOf(scope: string | undefined): string[] {
  return (scope ?? '').split(/\s+/).filter((entry) => entry.length > 0)
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * Leaving, for real.
 *
 * Defined once at module scope rather than inline as a default, and that is not
 * tidiness: a new function on every render would be a new `useEffect`
 * dependency on every render, and the effect below sets state — so the page
 * would fetch the authorization request in a loop until something gave out.
 */
function goTo(url: string): void {
  window.location.href = url
}

export function OAuthConsentView({
  search = typeof window === 'undefined' ? '' : window.location.search,
  /** Injectable for the tests; the browser always navigates for real. */
  navigate = goTo,
}: {
  search?: string
  navigate?: (url: string) => void
} = {}) {
  const authorizationId = new URLSearchParams(search).get(OAUTH_AUTHORIZATION_ID_PARAM)
  // "There is no request" is not a state anything has to reach — it is what the
  // address says, and the address does not change without a reload. Deriving it
  // here rather than setting it from the effect keeps the effect for the one
  // thing it is for: asking the authorization server.
  const [state, setState] = useState<ConsentState>(() =>
    authorizationId ? { kind: 'loading' } : { kind: 'no-request' },
  )

  useEffect(() => {
    if (!authorizationId) return
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await getSupabaseClient().auth.oauth.getAuthorizationDetails(
          authorizationId,
        )
        if (cancelled) return
        if (error || !data) {
          setState({
            kind: 'failed',
            message: error?.message ?? 'Forespørselen finnes ikke, eller den er utløpt.',
          })
          return
        }
        // Already approved once: the authorization server has the grant, and
        // the only thing left is to send the user back with the code.
        if (!('authorization_id' in data)) {
          navigate(data.redirect_url)
          return
        }
        setState({
          kind: 'asking',
          authorizationId: data.authorization_id,
          // `name` is what the client registered itself as — dynamically, in
          // ChatGPT's case — so it is the one string on this screen the user has
          // to read critically. It is shown as text and never as markup.
          clientName: data.client.name,
          redirectUri: data.redirect_uri,
          scopes: scopesOf(data.scope),
        })
      } catch (error) {
        if (!cancelled) {
          setState({ kind: 'failed', message: messageOf(error, 'Kunne ikke hente forespørselen.') })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authorizationId, navigate])

  const decide = useCallback(
    (approve: boolean) => {
      if (!authorizationId) return
      setState({ kind: 'deciding' })
      void (async () => {
        try {
          const oauth = getSupabaseClient().auth.oauth
          // `skipBrowserRedirect` so the navigation is this page's own act
          // rather than the SDK's: one place decides where the user goes, and a
          // test can watch it happen.
          const { data, error } = approve
            ? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
            : await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
          if (error || !data) {
            setState({
              kind: 'failed',
              message: error?.message ?? 'Kunne ikke svare på forespørselen.',
            })
            return
          }
          navigate(data.redirect_url)
        } catch (error) {
          setState({ kind: 'failed', message: messageOf(error, 'Kunne ikke svare på forespørselen.') })
        }
      })()
    },
    [authorizationId, navigate],
  )

  if (state.kind === 'loading' || state.kind === 'deciding') {
    return (
      <div className="auth" data-testid="oauth-consent-loading">
        <p className="hint">{state.kind === 'loading' ? 'Henter forespørselen …' : 'Sender deg videre …'}</p>
      </div>
    )
  }

  if (state.kind === 'no-request') {
    return (
      <div className="auth" data-testid="oauth-consent-empty">
        <div className="auth__card">
          <h1 className="auth__title">Slaids</h1>
          <p className="hint">
            Denne siden vises når en app ber om tilgang til presentasjonene dine. Det er ingen
            forespørsel å svare på akkurat nå.
          </p>
        </div>
      </div>
    )
  }

  if (state.kind === 'failed') {
    return (
      <div className="auth" data-testid="oauth-consent-error">
        <div className="auth__card">
          <h1 className="auth__title">Slaids</h1>
          <p className="error-text" role="alert">
            {state.message}
          </p>
          <p className="hint">Be appen om å prøve på nytt.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth" data-testid="oauth-consent">
      <div className="auth__card">
        <h1 className="auth__title">Slaids</h1>
        <p className="auth__subtitle">
          <strong data-testid="oauth-consent-client">{state.clientName}</strong> ber om tilgang til
          presentasjonene dine.
        </p>

        <p className="hint">
          Appen får jobbe med dekkene dine på dine vegne: lese dem, lage og endre slides og laste
          opp bilder. Den får ikke publisere noe på en offentlig lenke, og den ser bare dine egne
          presentasjoner.
        </p>

        {state.scopes.length > 0 && (
          <ul className="hint" data-testid="oauth-consent-scopes">
            {state.scopes.map((scope) => (
              <li key={scope}>{scope}</li>
            ))}
          </ul>
        )}

        <p className="hint">
          Etterpå sendes du tilbake til <code data-testid="oauth-consent-redirect">{state.redirectUri}</code>.
        </p>

        <div className="auth__actions">
          <button
            type="button"
            className="btn btn--primary auth__submit"
            onClick={() => decide(true)}
            data-testid="oauth-consent-approve"
          >
            Gi tilgang
          </button>
          <button
            type="button"
            className="btn auth__submit"
            onClick={() => decide(false)}
            data-testid="oauth-consent-deny"
          >
            Avbryt
          </button>
        </div>
      </div>
    </div>
  )
}
