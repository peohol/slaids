/**
 * Agent Core: the transport-independent surface an agent drives Slaids through.
 *
 * Nothing in here knows about a model, a vendor or a protocol — the whole layer
 * is plain functions over the domain commands, so a REST route, an MCP server
 * or a script all get the same behaviour and the same typed errors. See
 * `IMPLEMENTATION_PLAN.md` §44 for the contract this implements, including the
 * image policy: Slaids never generates a picture, it stores one an agent
 * already has (`upload_asset`) or vector markup an agent wrote
 * (`create_svg_asset`).
 *
 * `render_slide_preview` is not an exception to that. It photographs a slide
 * that already exists, with Slaids' own renderer, so an agent can look at what
 * it built — and even that renderer is injected (`preview.ts`), because it is
 * React and a browser, and this layer is required to work without either.
 */

export * from './types'
export * from './binary'
export * from './image'
export * from './preview'
export * from './operation'
export * from './presentation'
export * from './text'
export * from './assetStore'
export * from './registry'
export * from './operations/assets'
export * from './operations/content'
export * from './operations/deck'
export * from './operations/interactive'
export * from './operations/layout'
export * from './operations/library'
export * from './operations/preview'
export * from './operations/references'
export * from './operations/sandbox'
export * from './operations/sharing'
export * from './operations/slides'
export * from './operations/theme'
export * from './operations/validation'
