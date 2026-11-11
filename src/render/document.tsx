/**
 * One page of a deck as a complete, self-contained HTML document.
 *
 * This is the whole of the preview's "renderer", and the point is how little of
 * it there is. The markup comes from `DeckPageView` — the same component
 * presentation mode, the shared view and the filmstrip draw — inside the same
 * `SlideRenderProvider` `PresentationPlayer` builds, under the app's own
 * stylesheets. There is no geometry here, no typography, no fit rule and no
 * layout: those live where they already lived, and a change to any of them
 * changes the preview without anybody editing this file.
 *
 * What this file *does* own is the page around the slide, which the browser
 * normally gets from `index.html` and `main.tsx`:
 *
 *  - the two stylesheets, inlined (`styles.ts`);
 *  - the web fonts the theme names, already fetched and embedded by
 *    `fonts.ts` — so the page loads nothing over the network, which is both
 *    twelve seconds a picture and one fewer thing that can be unreachable from
 *    a serverless container. A family that could not be fetched is linked
 *    instead, as a backstop;
 *  - a viewport-sized frame at the logical 1600×900, with no transform.
 *    Scaling is the rasterizer's `deviceScaleFactor`, so layout happens at the
 *    exact size the design space is defined in and only the sampling changes —
 *    a CSS transform would instead lay the slide out at one size and stretch
 *    the result, which is not what an audience sees.
 *
 * Nothing in the document runs, and in the ordinary case it fetches nothing
 * either: there is no script tag, the slide is static markup, the fonts are
 * embedded and a stored SVG is drawn through an `<img>` from a `data:` URL,
 * exactly as in the app — so it cannot execute either. See `domain/svg.ts` for
 * the sanitisation it has already been through.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_BACKGROUND_COLOR, SLIDE_HEIGHT, SLIDE_WIDTH } from '../domain/constants'
import { googleFontsHref } from '../domain/fonts'
import { deckPages, deckProgress, deckSectionColors, type DeckPage } from '../domain/pages'
import { computeReferenceNumbering } from '../domain/references'
import type { Presentation } from '../domain/types'
import { AssetSourceProvider, type AssetUrlSource } from '../state/assetSource'
import { DeckPageView } from '../ui/slide/DeckPageView'
import { SlideRenderProvider } from '../ui/slide/SlideRenderContext'
import { previewFontFamilies, type PreviewFonts } from './fonts'
import { PREVIEW_STYLESHEETS } from './styles'

export interface PreviewDocumentRequest {
  presentation: Presentation
  /** Eierens visningsvalg når dokumentet rendres utenfor editoren. */
  includeReferencesInProgress?: boolean
  page: DeckPage
  /** Already resolved; see `assets.ts` for why it has to be synchronous. */
  assets: AssetUrlSource
  /**
   * The theme's faces, already fetched.
   *
   * Omitted means "link them all", which is what the app does and what the
   * document tests read: the embedding is an optimisation of *where* the bytes
   * come from, not a change to which faces the page uses.
   */
  fonts?: PreviewFonts
}

export interface PreviewDocument {
  html: string
  /** The logical size the document lays out at, before any device scaling. */
  width: number
  height: number
  /** Web-font families the page is waiting for, for the rasterizer to confirm. */
  fontFamilies: string[]
}

/**
 * The frame, and only the frame.
 *
 * Everything here is either something `index.html` does (no margin, one box) or
 * something a screenshot needs (no scrollbars, and a ground in the deck's own
 * background so a subpixel edge blends with the colour it blends with on
 * screen). It comes after the app's sheets so it wins over `global.css`'s
 * chrome background, which is the app's dark shell rather than anything a slide
 * sits on.
 */
function frameCss(backgroundColor: string): string {
  return `
html, body {
  margin: 0;
  padding: 0;
  width: ${SLIDE_WIDTH}px;
  height: ${SLIDE_HEIGHT}px;
  overflow: hidden;
  background: ${backgroundColor};
}
.slaids-preview {
  position: relative;
  width: ${SLIDE_WIDTH}px;
  height: ${SLIDE_HEIGHT}px;
  overflow: hidden;
}`
}

export function previewDocument(request: PreviewDocumentRequest): PreviewDocument {
  const { presentation, page, assets } = request
  const { theme } = presentation
  const pages = deckPages(presentation)
  const background =
    deckSectionColors(pages).get(page.id)?.background ?? DEFAULT_BACKGROUND_COLOR
  const fonts = request.fonts ?? {
    css: '',
    linkFamilies: previewFontFamilies(theme),
    families: previewFontFamilies(theme),
  }

  const markup = renderToStaticMarkup(
    <AssetSourceProvider value={assets}>
      <SlideRenderProvider
        value={{
          theme,
          // Derived from the whole deck, exactly as when it is presented: a
          // citation's number comes from where it is first used, so a preview
          // built with an empty numbering would draw pills the audience never
          // sees — or none at all.
          numbering: computeReferenceNumbering(presentation),
          // Both derived from the same page list the page itself came out of —
          // see `operations/preview.ts` — so a preview draws the indicator and
          // the section colours the audience sees on that page.
          sectionColors: deckSectionColors(pages),
          progress: deckProgress(
            pages,
            request.includeReferencesInProgress ?? presentation.includeReferencesInProgress,
          ),
          isStatic: true,
        }}
      >
        <DeckPageView page={page} />
      </SlideRenderProvider>
    </AssetSourceProvider>,
  )

  const fontLinks = fonts.linkFamilies.length
    ? [
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
        ...fonts.linkFamilies.map(
          (family) => `<link rel="stylesheet" href="${googleFontsHref(family)}">`,
        ),
      ].join('\n')
    : ''

  // The faces first: a `@font-face` has to be known before the rules that use
  // the family, and the app's own sheets are those rules.
  const styles = [fonts.css, ...PREVIEW_STYLESHEETS, frameCss(background)]
    .filter((css) => css.length > 0)
    .map((css) => `<style>${css}</style>`)
    .join('\n')

  const html = `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8">
${fontLinks}
${styles}
</head>
<body>
<div class="slaids-preview" data-page-kind="${page.kind}">${markup}</div>
</body>
</html>`

  return { html, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, fontFamilies: fonts.families }
}
