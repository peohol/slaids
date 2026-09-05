/**
 * The consent screen, which is the one place a person decides whether an
 * application gets their decks.
 *
 * Everything worth checking here is about the decision rather than about the
 * layout: that the screen names who is asking, that nothing is granted by
 * arriving or by declining, that "already approved" does not ask a second time,
 * and that a request the authorization server does not recognise says so
 * instead of offering a button.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { setSupabaseClient } from '../../supabase/client'
import { OAUTH_AUTHORIZATION_ID_PARAM } from '../../routing'
import { OAuthConsentView } from './OAuthConsentView'

const AUTHORIZATION_ID = 'auth-req-1'
const SEARCH = `?${OAUTH_AUTHORIZATION_ID_PARAM}=${AUTHORIZATION_ID}`

interface OAuthDouble {
  getAuthorizationDetails: ReturnType<typeof vi.fn>
  approveAuthorization: ReturnType<typeof vi.fn>
  denyAuthorization: ReturnType<typeof vi.fn>
}

/** The pending request Supabase would hand this page. */
function pending(scope = 'openid email'): { data: unknown; error: null } {
  return {
    data: {
      authorization_id: AUTHORIZATION_ID,
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      client: { id: 'client-1', name: 'ChatGPT', uri: '', logo_uri: '' },
      user: { id: 'owner-1', email: 'eier@example.com' },
      scope,
    },
    error: null,
  }
}

let container: HTMLDivElement
let root: Root
let oauth: OAuthDouble

beforeEach(() => {
  // React only lets `act` drive a render when the environment says so.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  oauth = {
    getAuthorizationDetails: vi.fn(),
    approveAuthorization: vi.fn(),
    denyAuthorization: vi.fn(),
  }
  setSupabaseClient({ auth: { oauth } } as unknown as SupabaseClient)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setSupabaseClient(null)
})

/** Render and let the effect's promises settle. */
async function show(props: Parameters<typeof OAuthConsentView>[0] = {}): Promise<void> {
  await act(async () => {
    root.render(<OAuthConsentView search={SEARCH} {...props} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function click(testId: string): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  if (!button) throw new Error(`Fant ingen knapp med data-testid="${testId}"`)
  return act(async () => {
    button.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('samtykkesiden', () => {
  it('navngir appen som spør, og hvor den sender deg etterpå', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue(pending())
    await show()

    expect(container.querySelector('[data-testid="oauth-consent-client"]')?.textContent).toBe(
      'ChatGPT',
    )
    expect(container.querySelector('[data-testid="oauth-consent-redirect"]')?.textContent).toContain(
      'chatgpt.com',
    )
    // The scopes as the request named them, verbatim.
    expect(container.querySelector('[data-testid="oauth-consent-scopes"]')?.textContent).toContain(
      'openid',
    )
  })

  it('gir ingenting bare ved å bli åpnet', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue(pending())
    await show()

    expect(oauth.approveAuthorization).not.toHaveBeenCalled()
    expect(oauth.denyAuthorization).not.toHaveBeenCalled()
  })

  it('godkjenner først når noen trykker på det, og sender deg tilbake', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue(pending())
    oauth.approveAuthorization.mockResolvedValue({
      data: { redirect_url: 'https://chatgpt.com/callback?code=abc&state=xyz' },
      error: null,
    })
    const navigate = vi.fn()
    await show({ navigate })
    await click('oauth-consent-approve')

    expect(oauth.approveAuthorization).toHaveBeenCalledWith(AUTHORIZATION_ID, {
      skipBrowserRedirect: true,
    })
    expect(navigate).toHaveBeenCalledWith('https://chatgpt.com/callback?code=abc&state=xyz')
  })

  it('avslår uten å gi noe, og sender deg tilbake med avslaget', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue(pending())
    oauth.denyAuthorization.mockResolvedValue({
      data: { redirect_url: 'https://chatgpt.com/callback?error=access_denied' },
      error: null,
    })
    const navigate = vi.fn()
    await show({ navigate })
    await click('oauth-consent-deny')

    expect(oauth.approveAuthorization).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('https://chatgpt.com/callback?error=access_denied')
  })

  it('spør ikke på nytt når samtykket allerede finnes', async () => {
    // Supabase answers with a redirect instead of a request when the grant is
    // already recorded. Asking again would train people to click through.
    oauth.getAuthorizationDetails.mockResolvedValue({
      data: { redirect_url: 'https://chatgpt.com/callback?code=abc' },
      error: null,
    })
    const navigate = vi.fn()
    await show({ navigate })

    expect(navigate).toHaveBeenCalledWith('https://chatgpt.com/callback?code=abc')
    expect(container.querySelector('[data-testid="oauth-consent"]')).toBeNull()
  })

  it('sier fra når forespørselen ikke finnes, i stedet for å tilby en knapp', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({
      data: null,
      error: { message: 'Authorization request not found' },
    })
    await show()

    expect(container.querySelector('[data-testid="oauth-consent-error"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="oauth-consent-approve"]')).toBeNull()
  })

  it('spør ikke autorisasjonsserveren når adressen ikke bærer en forespørsel', async () => {
    await show({ search: '' })

    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="oauth-consent-empty"]')).not.toBeNull()
  })
})
