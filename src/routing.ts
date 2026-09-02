/**
 * What a URL means, in one place.
 *
 * Slaids has exactly two kinds of page, and the difference between them is not
 * cosmetic — it is who is allowed to be there:
 *
 *  - the **workspace**, which is the library and the editor, behind `AuthGate`;
 *  - a **shared deck** under `/s/`, which anybody with the link may read and
 *    which must never mount a private component, ask for a session, or touch
 *    the authenticated repository.
 *
 * The boundary is the *path*, not the token. Everything under `/s/` stays on
 * the public side even when the token is malformed — a link that was truncated
 * in a chat message, or typed with a character missing, belongs to whoever was
 * sent it, and they must get "this link is not active" rather than the owner's
 * sign-in screen. A token that cannot be right is answered locally, so a
 * mistyped address never becomes a request to the share endpoint either.
 *
 * That is too little to justify a router. It is not too little to justify a
 * single tested function: the rule "this path is public" is the one piece of
 * routing that has to be exactly right, so it is pure, it is here, and it is
 * the only thing `Root` consults.
 */

/** The public prefix. Also what the Vercel rewrite has to send to `index.html`. */
export const SHARE_PATH_PREFIX = '/s/'

/** `/s` with nothing after it is a share link someone cut short, not a page. */
const SHARE_PATH_ROOT = '/s'

/**
 * A token is a v4 UUID. Checking the shape here is what lets a malformed
 * address be answered without asking the server about it.
 */
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AppRoute =
  | { kind: 'workspace' }
  /**
   * A share address. `token` is `null` when what follows `/s/` cannot be a
   * token — still the public side, just with nothing to fetch.
   */
  | { kind: 'shared'; token: string | null }

/** Whether this path is under the share namespace at all. */
function isSharePath(pathname: string): boolean {
  return pathname === SHARE_PATH_ROOT || pathname.startsWith(SHARE_PATH_PREFIX)
}

export function parseRoute(pathname: string): AppRoute {
  if (!isSharePath(pathname)) return { kind: 'workspace' }
  // A trailing slash is the same page; anything deeper is not a token.
  const rest = pathname.slice(SHARE_PATH_PREFIX.length).replace(/\/+$/, '')
  return { kind: 'shared', token: isShareToken(rest) ? rest.toLowerCase() : null }
}

export function isShareToken(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

/** The address to hand out. Built from the origin the editor is served from. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${SHARE_PATH_PREFIX}${token}`
}
