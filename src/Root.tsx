/**
 * The one fork in the application.
 *
 * `/s/<token>` is public and everything else is private, and this is where that
 * is decided — above `AuthGate`, above the store, above every component that
 * assumes a signed-in owner. A shared deck therefore does not "skip" the gate;
 * it is rendered by a tree the gate was never part of.
 *
 * The route is read once, at mount. Slaids has no client-side navigation
 * between the two: a share link is opened, and the workspace is left by closing
 * it. Adding a router for a single boundary would be more machinery than the
 * boundary is worth, and less obvious to check.
 *
 * The OAuth consent screen is the third address, and it sits on the *private*
 * side deliberately: approving an application's access to the owner's decks is
 * the owner's act, so it goes behind the same gate the workspace does. It is
 * not the workspace, though — it must not mount the library, the editor or
 * anything that starts loading decks, because a consent screen has one job and
 * a user arrives at it mid-flow from somewhere else.
 */

import App, { PrivatePage } from './App'
import { parseRoute } from './routing'
import { OAuthConsentView } from './ui/auth/OAuthConsentView'
import { SharedPresentationView } from './ui/share/SharedPresentationView'

export function Root({
  pathname = typeof window === 'undefined' ? '/' : window.location.pathname,
}: {
  /** Injectable for the tests; the browser always supplies its own. */
  pathname?: string
}) {
  const route = parseRoute(pathname)
  if (route.kind === 'shared') return <SharedPresentationView token={route.token} />
  if (route.kind === 'oauth-consent') {
    return (
      <PrivatePage>
        <OAuthConsentView />
      </PrivatePage>
    )
  }
  return <App />
}
