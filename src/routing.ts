/**
 * What a URL means, in one place.
 *
 * Slaids has exactly two kinds of page, and the difference between them is not
 * cosmetic — it is who is allowed to be there:
 *
 *  - the **workspace**, which is the library and the editor, behind `AuthGate`;
 *  - a **shared deck** at `/s/<token>`, which anybody with the link may read
 *    and which must never mount a private component, ask for a session, or
 *    touch the authenticated repository.
 *
 * That is too little to justify a router. It is not too little to justify a
 * single tested function: the rule "this path is public" is the one piece of
 * routing that has to be exactly right, so it is pure, it is here, and it is
 * the only thing `Root` consults.
 */

/** The public prefix. Also what the Vercel rewrite has to send to `index.html`. */
export const SHARE_PATH_PREFIX = '/s/'

/**
 * A token is a v4 UUID. Checking the shape here means a typo in an address bar
 * becomes a local "unknown link" rather than a request to the share endpoint.
 */
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AppRoute = { kind: 'workspace' } | { kind: 'shared'; token: string }

export function parseRoute(pathname: string): AppRoute {
  if (!pathname.startsWith(SHARE_PATH_PREFIX)) return { kind: 'workspace' }
  // A trailing slash is the same page; anything deeper is not a share link.
  const rest = pathname.slice(SHARE_PATH_PREFIX.length).replace(/\/+$/, '')
  if (!TOKEN_PATTERN.test(rest)) return { kind: 'workspace' }
  return { kind: 'shared', token: rest.toLowerCase() }
}

export function isShareToken(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

/** The address to hand out. Built from the origin the editor is served from. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${SHARE_PATH_PREFIX}${token}`
}
