/**
 * Temaeditorens forhåndsvisning: en liten komposisjon tegnet av den ekte
 * rendreren.
 *
 * Det er ikke en etterligning av en slide, men en slide – en vanlig
 * innholdsslide som aldri lagres – tegnet med `SlideView`, slik stage,
 * miniatyrbildene, presentasjonsmodus og headless rendering tegner hver slide.
 * Fonter, størrelser, luft, skygger, aksenter og kortutseende kommer derfor fra
 * nøyaktig de samme reglene, og forhåndsvisningen kan ikke gli fra resultatet.
 * Se § 15.1.
 *
 * Boksen er `BoundedPreview`, så komposisjonen alltid er helt synlig: den
 * krymper med dialogen og vinduet, og verken scroller eller klippes.
 */

import { useMemo, useState } from 'react'
import { createCardBody, createContainer, createTitledCard, createUntitledCard } from '../../domain/content'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { createLeaf, createSplit } from '../../domain/layout'
import { createSlide } from '../../domain/presentation'
import { ACCENT_NODE } from '../../domain/richdoc'
import type { CardBody, ContentSlide, PresentationTheme, RichNode } from '../../domain/types'
import { SlideRenderProvider } from '../slide/SlideRenderContext'
import { SlideView } from '../slide/SlideView'
import { BoundedPreview } from './BoundedPreview'

/** Komposisjonen er en hel slide uten fremdriftsindikator. */
const PREVIEW_SIZE = { width: SLIDE_WIDTH, height: SLIDE_HEIGHT }

/** Ingen fremdriftsindikator: komposisjonen er ikke en side i dekket. */
const PREVIEW_GEOMETRY = { progressHeight: 0 }

/** En blokk midtstilt vannrett. Loddrett midtstilling er feltets (`verticalAlign`). */
function centred(type: string, text: string, attrs: Record<string, unknown> = {}): RichNode {
  return { type, attrs: { ...attrs, textAlign: 'center' }, content: [{ type: 'text', text }] }
}

/** Ett felt med disse blokkene, midtstilt loddrett. */
function centredBody(...blocks: RichNode[]): CardBody {
  const body = createCardBody(1)
  return {
    ...body,
    subfields: [{ ...body.subfields[0], doc: { type: 'doc', content: blocks }, verticalAlign: 'middle' }],
  }
}

/**
 * Komposisjonen: til venstre et kort med tittel, til høyre en sone delt i en
 * beholder over et kort uten tittel. Bygd av domenets egne fabrikker, så den er
 * et gyldig sonetre og tegnes som ethvert annet.
 */
export function themePreviewSlide(): ContentSlide {
  const titled = createTitledCard()
  const card = {
    ...titled,
    title: { type: 'doc' as const, content: [centred('paragraph', 'Tittel')] },
    body: centredBody(
      centred(ACCENT_NODE, 'Aksent', { level: 1 }),
      centred('paragraph', 'Slik ser brødtekst ut.'),
    ),
  }
  const container = createContainer(centredBody(centred('paragraph', 'Her er mer brødtekst.')))
  const untitled = {
    ...createUntitledCard(),
    body: centredBody(centred('paragraph', 'Og her er atter mer brødtekst.')),
  }
  return {
    ...createSlide({ hasTitle: false }),
    root: createSplit('x', [1, 1], [
      createLeaf(card),
      createSplit('y', [1, 1], [createLeaf(container), createLeaf(untitled)]),
    ]),
  }
}

export function ThemePreview({
  theme,
  background,
  accent,
}: {
  theme: PresentationTheme
  /** Forsidens farger: det leseren møter først. */
  background: string
  accent: string
}) {
  // Én komposisjon per åpning av dialogen: id-ene er dens egne og betyr ingenting.
  const [slide] = useState(themePreviewSlide)
  const value = useMemo(
    () => ({
      theme,
      numbering: new Map(),
      sectionColors: new Map([[slide.id, { background, accent }]]),
      progress: new Map(),
      // Statisk: ingen redigeringshjelp, heller ikke merket for forminsket tekst.
      isStatic: true,
    }),
    [theme, slide.id, background, accent],
  )

  return (
    <BoundedPreview size={PREVIEW_SIZE} className="theme-preview" testId="theme-preview">
      {(scale) => (
        <div
          className="theme-preview__drawing"
          inert
          aria-hidden="true"
          style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}
        >
          <div
            style={{
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            <SlideRenderProvider value={value}>
              <SlideView slide={slide} geometryOptions={PREVIEW_GEOMETRY} />
            </SlideRenderProvider>
          </div>
        </div>
      )}
    </BoundedPreview>
  )
}
