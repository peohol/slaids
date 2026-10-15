/**
 * Rendered visual feedback: one page of a deck, as a picture.
 *
 * This is the fifth phase of `IMPLEMENTATION_PLAN.md` §44, and its whole point
 * is the loop structural validation cannot close:
 *
 *   build → validate_slide → render_slide_preview → look → adjust → render again
 *
 * `validate_slide` answers whether a slide is *legal*. It cannot answer whether
 * it is any good — whether the eye lands in the right place, whether a card is
 * dwarfed by the one beside it, whether a figure is cropped in a way the numbers
 * are perfectly happy with. That needs seeing it, and this is what lets an agent
 * see it.
 *
 * Three properties are load-bearing, and each of them is a rule stated
 * elsewhere rather than a choice made here:
 *
 *  - **it is the real renderer.** Not a picture built from the same geometry —
 *    the actual components the editor, presentation mode and the shared view
 *    draw, under the actual stylesheet. `src/render/` holds that, injected
 *    through `AgentContext`, so this operation contains no drawing and no
 *    layout at all. There is no second renderer to drift.
 *  - **it is read-only.** Nothing is saved, so the revision it reports is the
 *    one it read. An agent can therefore render, think, and write against that
 *    same revision without being told its knowledge is stale by its own
 *    screenshot.
 *  - **it is addressed the way everything else is.** A presentation id and a
 *    page id, and a page id that does not exist is the same actionable
 *    `SLIDE_NOT_FOUND` — with the ids that *do* exist — that `inspect_slide`
 *    gives.
 */

import { z } from 'zod'
import { deckPages, type DeckPage } from '../../domain/pages'
import { presentationRevision } from '../../domain/revision'
import { defineOperation, presentationIdSchema, slideIdSchema } from '../operation'
import { loadPresentation } from '../presentation'
import type { AgentImage } from '../image'
import { agentErr, agentOk, type AgentResult } from '../types'

/**
 * How much of the design space a pixel is.
 *
 * The default is `1`: 1600×900, the size the audience sees, and the size a
 * multimodal model gets the most out of. Smaller is there because a picture is
 * tokens — an agent checking a composition it has already looked at once can
 * ask for a quarter of the pixels — and `2` is there for reading a detail that
 * is genuinely small on the slide. Both ends are bounded: an unbounded scale is
 * a way to ask one read-only call to allocate a hundred megabytes.
 */
export const PREVIEW_SCALE_RANGE = { min: 0.1, max: 2 } as const
export const DEFAULT_PREVIEW_SCALE = 1

export interface SlidePreviewView {
  presentationId: string
  /** The page that was drawn, as it was addressed. */
  slideId: string
  /**
   * Which kind of page it turned out to be.
   *
   * A deck is `slides → avledede referansesider`, and only the first group is
   * editable. An agent that rendered a reference slide should see that it is
   * looking at something generated, not something it can go and change.
   */
  pageKind: DeckPage['kind']
  /** The reading this picture shows. Unchanged by rendering — nothing was written. */
  revision: string
  scale: number
  /** Bytes in Agent Core; the response body over REST, an image block over MCP. */
  image: AgentImage
  /**
   * Whether the picture is in the deck's own type.
   *
   * False for both ways it can fail to be: a web font whose faces did not
   * arrive, and a font Slaids cannot fetch at all — a local one a person chose
   * in the editor, which no renderer can be handed. `warnings` names which.
   */
  fontsReady: boolean
  warnings: string[]
}

export const renderSlidePreviewOperation = defineOperation({
  name: 'render_slide_preview',
  summary:
    'Rendre én side av dekket til et PNG-bilde med Slaids’ egen renderer, slik den vises for et publikum, og se på resultatet. Endrer ingenting. Over REST kommer bildet som binær respons (`Content-Type: image/png`); send `Accept: application/json` for konvolutten med bildet som base64. Over MCP kommer det som en image-blokk. `slideId` er en slide – vanlig eller inndeling, forsiden inkludert – eller en avledet referanseside.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    slideId: slideIdSchema.describe(
      'Id-en til siden som skal rendres: en slide fra get_presentation – forsiden er den første – eller id-en til en avledet referanseside.',
    ),
    scale: z
      .number()
      .min(PREVIEW_SCALE_RANGE.min)
      .max(PREVIEW_SCALE_RANGE.max)
      .default(DEFAULT_PREVIEW_SCALE)
      .describe(
        'Piksler per logisk enhet. 1 gir 1600×900, som er størrelsen publikum ser; lavere gir et mindre bilde og færre tokens.',
      ),
  }),
  async run(context, input): Promise<AgentResult<SlidePreviewView>> {
    const renderer = context.preview
    if (!renderer) {
      // Not a failure of the request. The deployment has no renderer wired in,
      // and saying so beats both a 500 and — much worse — a picture drawn by
      // something other than Slaids.
      return agentErr(
        'PREVIEW_UNAVAILABLE',
        'Denne Slaids-installasjonen kan ikke rendre previews. Alt annet i agent-API-et virker som før.',
        { presentationId: input.presentationId, slideId: input.slideId },
      )
    }

    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded
    const presentation = loaded.value

    // The same page list presentation mode and the shared view page through, so
    // the derived reference slides are addressable without a
    // second idea of what a deck contains. The QR page is not in it: it exists
    // only while sharing is on, and `get_sharing` is what answers that.
    const pages = deckPages(presentation)
    const page = pages.find((candidate) => candidate.id === input.slideId)
    if (!page) {
      return agentErr('SLIDE_NOT_FOUND', 'Fant ingen side med den id-en i dekket.', {
        presentationId: presentation.id,
        slideId: input.slideId,
        available: pages.map((candidate) => ({ slideId: candidate.id, pageKind: candidate.kind })),
      })
    }

    const rendered = await renderer({
      presentation,
      page,
      scale: input.scale,
      // The store the deck was just read from, so a preview can never show a
      // file from somewhere this presentation is not.
      assets: context.repository,
    })
    if (!rendered.ok) {
      // The renderer's own code, unchanged: "this installation cannot draw
      // previews" and "it can, and this one broke" are different next moves.
      return agentErr(rendered.error.code, rendered.error.message, {
        presentationId: presentation.id,
        slideId: page.id,
        ...rendered.error.details,
      })
    }

    return agentOk({
      presentationId: presentation.id,
      slideId: page.id,
      pageKind: page.kind,
      // Read, not written: this is the revision the picture shows, and it is
      // still current for the next mutation.
      revision: presentationRevision(presentation),
      scale: input.scale,
      image: rendered.value.image,
      fontsReady: rendered.value.fontsReady,
      warnings: rendered.value.warnings,
    })
  },
})

export const previewOperations = [renderSlidePreviewOperation]
