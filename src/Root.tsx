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
 */

import App from './App'
import { parseRoute } from './routing'
import { SharedPresentationView } from './ui/share/SharedPresentationView'

export function Root({
  pathname = typeof window === 'undefined' ? '/' : window.location.pathname,
}: {
  /** Injectable for the tests; the browser always supplies its own. */
  pathname?: string
}) {
  const route = parseRoute(pathname)
  if (route.kind === 'shared') return <SharedPresentationView token={route.token} />
  return <App />
}
