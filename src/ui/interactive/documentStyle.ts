/**
 * The deck's design, assembled for one run of one miniapp.
 *
 * Three pieces of CSS in one string, in the order a document needs them:
 *
 *  1. `@font-face` rules for the theme's web fonts, with the font files
 *     themselves inlined as `data:` URLs. The frame may not fetch anything —
 *     that is the point of it — so the faces have to arrive *as* the document.
 *     They are fetched once per family per session by `fonts/inlineFaces.ts`,
 *     the same engine and the same cache the headless preview renderer uses,
 *     and by the time anybody presses play they are normally already here: the
 *     surface asks for them when the cover mounts, and the browser has the
 *     files in its own cache from the page's stylesheet anyway.
 *  2. The theme tokens for this slide — see `styleContract.ts`.
 *  3. Slaids' base stylesheet for the contract version the slide names.
 *
 * A family that cannot be fetched is simply left out. The token still names
 * the whole stack, so the app falls back exactly as the deck does — to
 * `'Segoe UI'`, to `system-ui`, to the generic — rather than to Times New
 * Roman. A local font (Calibri, Segoe UI) is not fetched at all, because
 * nothing can fetch one: it is the machine's or it is not, which is the same
 * promise `domain/fonts.ts` makes everywhere else.
 *
 * Nothing here is ever written into the author's file. The style is built at
 * activation and thrown away with the frame, so a recoloured section or a new
 * deck font shows up the next time the app is started, with nothing stored
 * changed and nothing for undo to walk back through.
 */

import { webFontsFor } from '../../domain/fonts'
import { inlineFontFaces, type InlineFontOptions } from '../../fonts/inlineFaces'
import type { InteractiveStyleContract } from '../../domain/constants'
import {
  interactiveBaseStylesheet,
  interactiveThemeCss,
  type InteractiveStyleInput,
} from '../../domain/interactiveStyle'

/** How long to wait for faces before starting the app without them. */
const FONT_DEADLINE_MS = 4000

/**
 * The complete `<style>` text for a run.
 *
 * `fontCss` is whatever was ready — the empty string is a perfectly good
 * answer, and the only difference it makes is which face the fallback stack
 * lands on.
 */
export function interactiveDocumentStyle(
  input: InteractiveStyleInput & { contract: InteractiveStyleContract; fontCss: string },
): string {
  return [input.fontCss, interactiveThemeCss(input), interactiveBaseStylesheet(input.contract)]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The theme's web fonts as faces a sandboxed document can carry.
 *
 * Resolves to `''` rather than rejecting: a miniapp that starts in the
 * fallback face is a miniapp that starts, and the alternative — waiting on a
 * font service before the audience sees anything — is worse on the one
 * occasion it matters.
 */
export async function interactiveFontCss(
  stacks: readonly string[],
  options: InlineFontOptions = {},
): Promise<string> {
  const families = webFontsFor([...stacks])
  // A local font is the machine's or it is not; there is nothing to fetch, and
  // asking would be asking for a file that does not exist.
  if (families.length === 0) return ''
  try {
    const inlined = await inlineFontFaces(families, { timeoutMs: FONT_DEADLINE_MS, ...options })
    return inlined.css
  } catch {
    return ''
  }
}
