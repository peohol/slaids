/**
 * Where a client goes to find out how to authorise — RFC 9728, and the one
 * document MCP's authorization specification makes mandatory.
 *
 * An MCP server is an OAuth 2.1 *resource server*, and a resource server's job
 * in discovery is small and exact: say what it is called, and say which
 * authorization server can issue tokens for it. Everything else — the
 * authorization endpoint, the token endpoint, PKCE, dynamic client
 * registration, refresh rotation — is the authorization server's own metadata
 * (RFC 8414), published by Supabase at its issuer, and a client that has this
 * document can find all of it without Slaids repeating any of it.
 *
 * Two addresses answer with this document, because a client is allowed to ask
 * for either and MCP requires it to try both in order:
 *
 *   /.well-known/oauth-protected-resource/api/agent/v1/mcp   (path-inserted)
 *   /.well-known/oauth-protected-resource                    (root fallback)
 *
 * Both describe the same resource — the MCP endpoint — and both carry the same
 * `resource` value, because a resource has one identifier and RFC 8707 requires
 * the client's `resource` parameter to be that exact string.
 *
 * ## Why `scopes_supported` is not here
 *
 * It is optional in RFC 9728, and leaving it out is a decision rather than an
 * omission. MCP's scope-selection strategy says a client with no `scope` in the
 * `WWW-Authenticate` challenge requests *every* scope in `scopes_supported` —
 * and Supabase's OAuth server does not support custom scopes yet: its own
 * metadata publishes `openid profile email phone offline_access` and rejects
 * what it does not know. Publishing `presentations:write` here would therefore
 * hand every well-behaved client a scope string that makes the authorization
 * request fail, and the failure would look like Slaids being broken.
 *
 * Slaids' own scopes are still published, in the place a client can act on them
 * without sending them anywhere: each tool's `securitySchemes` and
 * `_meta['slaids/requiredScopes']` in the catalogue, both derived from the
 * operation's `requiredScopes`. The day Supabase issues custom scopes, this
 * field is the one line that changes.
 */

import { protectedResourceMetadataUrl } from '../../routing'
import type { OAuthResourceConfig } from './oauth'
import { AGENT_REALM } from './protocol'
import type { AuthFailure } from './tokens'

/**
 * The document, exactly as RFC 9728 names its fields.
 *
 * `snake_case` because the registry is `snake_case`; a client parses this by
 * field name, so the names are the contract rather than a style choice.
 */
export interface ProtectedResourceMetadata {
  /** The resource's identifier: the canonical MCP URL, with no trailing slash. */
  resource: string
  /** At least one, which MCP requires. Slaids has exactly one: its Supabase project. */
  authorization_servers: string[]
  /** How a token may be presented. Only the header; never a query parameter. */
  bearer_methods_supported: string[]
  resource_name: string
  resource_documentation?: string
}

export interface ResourceMetadataInput {
  canonicalResource: string
  config: OAuthResourceConfig
  documentation?: string
}

export function protectedResourceMetadata(
  input: ResourceMetadataInput,
): ProtectedResourceMetadata {
  return {
    resource: input.canonicalResource,
    authorization_servers: [input.config.issuer],
    // RFC 6750 defines three ways to present a bearer token; two of them —
    // the form body and the query string — are exactly the ways MCP forbids,
    // and a query string is the way that ends up in an access log.
    bearer_methods_supported: ['header'],
    resource_name: 'Slaids',
    ...(input.documentation ? { resource_documentation: input.documentation } : {}),
  }
}

/* ------------------------------------------------------------------ *
 * The challenge
 * ------------------------------------------------------------------ */

export interface ChallengeOptions {
  /** RFC 6750's error code. Omitted when nothing was presented at all. */
  error?: 'invalid_token' | 'insufficient_scope'
  errorDescription?: string
  /** Where this resource's metadata is. Absent when the deployment has no OAuth. */
  resourceMetadataUrl?: string
  /** The scopes a step-up would need. Only ever set for `insufficient_scope`. */
  scope?: readonly string[]
}

/** RFC 7235 quoted-string: a backslash escapes the next character. */
function quote(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

/**
 * One `WWW-Authenticate: Bearer …` value.
 *
 * The `realm` is first because RFC 6750 puts it first, and `resource_metadata`
 * is the parameter RFC 9728 §5.1 adds — the one an MCP client reads to find the
 * document above. It is only present when there is a document to point at: a
 * deployment with no OAuth configured has no authorization server to send
 * anybody to, and a challenge that named one anyway would send every client on
 * a discovery round trip that ends in a 404.
 *
 * No `error` when nothing was presented. RFC 6750 §3.1 is explicit about that:
 * a request that carried no authentication information has not made an error
 * yet, and an `invalid_token` there tells a client its (absent) token was
 * rejected.
 */
export function bearerChallenge(realm: string, options: ChallengeOptions = {}): string {
  const parameters = [
    `realm=${quote(realm)}`,
    ...(options.error ? [`error=${quote(options.error)}`] : []),
    ...(options.errorDescription ? [`error_description=${quote(options.errorDescription)}`] : []),
    ...(options.scope && options.scope.length > 0 ? [`scope=${quote(options.scope.join(' '))}`] : []),
    ...(options.resourceMetadataUrl
      ? [`resource_metadata=${quote(options.resourceMetadataUrl)}`]
      : []),
  ]
  return `Bearer ${parameters.join(', ')}`
}

/* ------------------------------------------------------------------ *
 * Which deployment this is
 * ------------------------------------------------------------------ */

/**
 * The origin the metadata and the challenge speak about.
 *
 * A pinned origin wins, and a deployment that has one should set it: the
 * resource identifier is a *fixed* string in OAuth, and reading it off the
 * request means a host header decides what Slaids calls itself.
 *
 * Without one it is derived from the request, which is right far more often
 * than it looks: `slaids.no` answers `308` to `www.slaids.no`, so the request
 * that arrives here already carries the canonical host, and a preview
 * deployment describes itself rather than production. The forwarded headers are
 * read first because a platform rewrite is what `request.url` reflects
 * otherwise — and only the first value of each, since a chain of proxies
 * appends.
 */
export function resourceOrigin(request: Request, pinned?: string | null): string {
  if (pinned) return pinned.replace(/\/+$/, '')
  const host = first(request.headers.get('x-forwarded-host'))
  if (host) return `${first(request.headers.get('x-forwarded-proto')) ?? 'https'}://${host}`
  return new URL(request.url).origin
}

function first(header: string | null): string | null {
  const value = header?.split(',')[0]?.trim()
  return value && value.length > 0 ? value : null
}

/**
 * Where to tell a client this resource's metadata is, or `undefined` when there
 * is nothing to tell it.
 *
 * The `undefined` is the point: `resource_metadata` must only appear in a
 * challenge when the document exists, and a deployment with no OAuth configured
 * publishes none.
 */
export function resourceMetadataUrlFor(
  request: Request,
  deployment: { oauth?: OAuthResourceConfig; publicOrigin?: string | null },
): string | undefined {
  if (!deployment.oauth) return undefined
  return protectedResourceMetadataUrl(resourceOrigin(request, deployment.publicOrigin))
}

/**
 * The challenge this deployment answers a refusal with.
 *
 * One function, so REST and MCP cannot describe the same deployment
 * differently — and it lives here rather than in either transport for exactly
 * that reason: a copy in the router and a copy in the MCP endpoint is two
 * descriptions of one deployment, and a probe that could tell them apart.
 *
 * `missing` carries no `error` — RFC 6750 §3.1: a request with no
 * authentication information has not made an error yet — and everything else is
 * `invalid_token`, which is the one word a client needs in order to know that
 * refreshing is the next move rather than giving up.
 */
export function challengeFor(
  deployment: { oauth?: OAuthResourceConfig; publicOrigin?: string | null },
  request: Request,
  reason: AuthFailure,
): string {
  const resourceMetadataUrl = resourceMetadataUrlFor(request, deployment)
  return bearerChallenge(AGENT_REALM, {
    ...(reason === 'missing' ? {} : { error: 'invalid_token' as const }),
    ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
  })
}
