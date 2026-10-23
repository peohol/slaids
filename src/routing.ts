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

/**
 * A shared folder's address is `/s/f/<token>`: under the same public prefix,
 * so it inherits everything the prefix already guarantees — the SPA rewrite,
 * the `noindex` and `no-referrer` headers, and that it can never land on the
 * owner's sign-in.
 */
export const FOLDER_SHARE_SEGMENT = 'f'

/**
 * The agent REST API, versioned from the first day.
 *
 * It lives here with the other addresses rather than in `src/server/`, for the
 * same reason `SHARE_PATH_PREFIX` does: an address is a fact about the app that
 * several places need — the handler that routes it, the Vercel rewrite that has
 * to *not* swallow it, and the token screen that tells the owner where to point
 * an agent. A constant the browser can read without importing the server is the
 * difference between one fact and two.
 */
export const AGENT_API_VERSION = 'v1'
export const AGENT_API_BASE_PATH = `/api/agent/${AGENT_API_VERSION}`

/**
 * The MCP endpoint, under the same version prefix as everything else.
 *
 * One address, because that is what Streamable HTTP is: a single URL a client
 * posts JSON-RPC to. It sits under `AGENT_API_BASE_PATH` rather than beside it
 * so the existing rewrite already carries it, the existing function already
 * answers it, and the existing token is already the credential — MCP is a second
 * way to say the same things, not a second deployment.
 */
export const AGENT_MCP_PATH = `${AGENT_API_BASE_PATH}/mcp`

/**
 * The query parameter the host hands the rest of the path over in.
 *
 * The API is one static function at `AGENT_API_BASE_PATH`, and everything
 * deeper reaches it through an explicit rewrite in `vercel.json`. A rewrite
 * cannot carry extra path segments into a static function, so it carries them
 * as a parameter instead — that is Vercel's own behaviour for a `:param*`
 * source, not a trick: the platform appends the captured segments to the
 * destination's query string.
 *
 * The name is deliberately not a word an operation could ever use for a field
 * of its own, because `parseOperationInput` reads the query string as input
 * for a raw binary upload. `agentApiUrl` removes it again before anything sees
 * it, so the parameter exists between the edge and the router and nowhere else.
 *
 * It lives here, next to the address it completes, so that the rewrite, the
 * router and the test that checks they agree all read the same string.
 */
export const AGENT_API_PATH_PARAM = '__slaidsPath'

/**
 * The address the caller actually asked for.
 *
 * A host that routed the request straight to the function is already right, and
 * the URL passes through untouched. A host that could only route the base path
 * hands the rest over in `AGENT_API_PATH_PARAM`, and this is where the address
 * is made whole again — before routing, so `/operations/<name>` is one thing
 * the router understands rather than two things it has to know about.
 *
 * Pure, and total: an empty or missing parameter is the base path, which is
 * what a rewrite that matched nothing after the version prefix means.
 */
export function agentApiUrl(requested: URL): URL {
  if (!requested.searchParams.has(AGENT_API_PATH_PARAM)) return requested

  const forwarded = requested.searchParams.get(AGENT_API_PATH_PARAM) ?? ''
  const url = new URL(requested)
  url.searchParams.delete(AGENT_API_PATH_PARAM)
  const suffix = forwarded.replace(/^\/+/, '')
  url.pathname = suffix ? `${AGENT_API_BASE_PATH}/${suffix}` : AGENT_API_BASE_PATH
  return url
}

/**
 * Where the OAuth consent screen lives.
 *
 * Supabase Auth is the authorization server, but the *consent* — the screen
 * that says which application is asking and what it is asking for — is the
 * application's own. Supabase sends the user here with an `authorization_id`,
 * and the page approves or denies it through the SDK. There is nothing to
 * decide about the path except that it has to match what the project is
 * configured with, so it is written down once, here with the other addresses.
 *
 * It is a *private* page, unlike `/s/`: approving an authorization is something
 * only the signed-in owner may do, so it mounts behind `AuthGate` like the
 * workspace does.
 */
export const OAUTH_CONSENT_PATH = '/oauth/consent'

/** The query parameter Supabase Auth hands the pending authorization over in. */
export const OAUTH_AUTHORIZATION_ID_PARAM = 'authorization_id'

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
  /** A shared folder's address; `token` is `null` for the same reason. */
  | { kind: 'shared-folder'; token: string | null }
  /**
   * The OAuth consent screen. Private, and behind the same gate the workspace
   * is: only the owner may approve an application's access to their decks.
   */
  | { kind: 'oauth-consent' }

/** Whether this path is under the share namespace at all. */
function isSharePath(pathname: string): boolean {
  return pathname === SHARE_PATH_ROOT || pathname.startsWith(SHARE_PATH_PREFIX)
}

export function parseRoute(pathname: string): AppRoute {
  if ((pathname.replace(/\/+$/, '') || '/') === OAUTH_CONSENT_PATH) {
    return { kind: 'oauth-consent' }
  }
  if (!isSharePath(pathname)) return { kind: 'workspace' }
  // A trailing slash is the same page; anything deeper is not a token.
  const rest = pathname.slice(SHARE_PATH_PREFIX.length).replace(/\/+$/, '')
  const [first, ...deeper] = rest.split('/')
  if (first === FOLDER_SHARE_SEGMENT) {
    const token = deeper.join('/')
    return { kind: 'shared-folder', token: isShareToken(token) ? token.toLowerCase() : null }
  }
  return { kind: 'shared', token: isShareToken(rest) ? rest.toLowerCase() : null }
}

export function isShareToken(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

/** The address to hand out. Built from the origin the editor is served from. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${SHARE_PATH_PREFIX}${token}`
}

/** A shared folder's address to hand out, built the same way. */
export function folderShareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${SHARE_PATH_PREFIX}${FOLDER_SHARE_SEGMENT}/${token}`
}

/**
 * The canonical address of the MCP endpoint, as a client must name it.
 *
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) and Resource Indicators
 * (RFC 8707) both identify a resource by a URI, and MCP requires the two to be
 * the same string: the `resource` a client sends in its authorization request,
 * the `resource` the metadata document publishes, and the address the client
 * then posts to. So it is built here, from the one path constant above, rather
 * than written out anywhere.
 *
 * `origin` decides which deployment this is. It matters that it is the origin a
 * client actually reached: `slaids.no` answers `308` to `www.slaids.no`, and a
 * metadata document that named the apex would send a client to an address that
 * redirects — which drops `Authorization` on the way, by the Fetch standard's
 * own rule. See `scripts/mcp-smoke.mjs`, where that cost a whole debugging
 * session once already.
 */
export function canonicalMcpUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${AGENT_MCP_PATH}`
}

/**
 * Where a protected resource publishes its metadata.
 *
 * RFC 9728 §3.1 builds the address by *inserting* the well-known segment
 * between the host and the resource's own path — `/.well-known/oauth-protected-resource/api/agent/v1/mcp`
 * for a resource at `/api/agent/v1/mcp` — rather than appending it, so one host
 * can describe several resources. MCP's authorization specification names the
 * same construction, and says a client must also fall back to the bare
 * `/.well-known/oauth-protected-resource` at the root. Slaids answers both, with
 * the same document, because a client is allowed to ask for either.
 */
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'
export const MCP_PROTECTED_RESOURCE_METADATA_PATH = `${PROTECTED_RESOURCE_METADATA_PATH}${AGENT_MCP_PATH}`

/** The metadata address a client is pointed at from a `WWW-Authenticate` challenge. */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${MCP_PROTECTED_RESOURCE_METADATA_PATH}`
}
