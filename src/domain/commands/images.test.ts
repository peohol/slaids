/**
 * Pictures as content: the crop, the caption, and what a conversion carries.
 *
 * A picture filling a zone is cropped to it by definition, so it can never
 * overflow — which makes the caption the only thing here the fit gate has an
 * opinion about, and the conversions the only place content can be lost. Both
 * are pinned down below.
 */

import { describe, expect, it } from 'vitest'
import {
  captionPositionsFor,
  createContainer,
  createImage,
  createTitledCard,
  createTitledImageCard,
  createUntitledCard,
  imagePanelOf,
} from '../content'
import {
  convertContentKind,
  setCardColor,
  setImageAsset,
  setImageCaption,
  setImageFocus,
} from './content'
import { estimateFitChecker, estimateTitleFitChecker } from '../fit'
import { createPresentation } from '../presentation'
import { createLeaf } from '../layout'
import { collectCitationIds, docToPlainText, paragraphDoc, titleDoc } from '../richdoc'
import type { AssetRef, Presentation, ZoneContent } from '../types'

const checkers = { fits: estimateFitChecker, fitsTitle: estimateTitleFitChecker }

const asset: AssetRef = {
  id: 'a1',
  name: 'bilde.png',
  mimeType: 'image/png',
  byteSize: 10,
  width: 800,
  height: 300,
  isVector: false,
}

function deckWith(content: ZoneContent): Presentation {
  const base = createPresentation({ title: 'Bilder' })
  const slide = base.slides[0]
  return {
    ...base,
    assets: [asset],
    slides: [{ ...slide, title: null, root: createLeaf(content) }],
  }
}

function target(presentation: Presentation) {
  return { slideId: presentation.slides[0].id, nodeId: presentation.slides[0].root.id }
}

function contentOf(presentation: Presentation): ZoneContent {
  const root = presentation.slides[0].root
  if (root.kind !== 'leaf' || !root.content) throw new Error('forventet innhold')
  return root.content
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: { code: string } }): T {
  if (!result.ok) throw new Error(`uventet feil: ${result.error?.code}`)
  return result.value as T
}

describe('a picture panel', () => {
  it('starts centred, with no file and no caption', () => {
    const panel = imagePanelOf(createImage())
    expect(panel).toEqual({ assetId: null, focus: { x: 0.5, y: 0.5 }, caption: null })
  })

  it('takes a file the presentation has, and refuses one it does not', () => {
    const presentation = deckWith(createImage())
    const filled = unwrap(setImageAsset(presentation, { ...target(presentation), assetId: 'a1' }))
    expect(imagePanelOf(contentOf(filled))?.assetId).toBe('a1')

    const missing = setImageAsset(presentation, { ...target(presentation), assetId: 'a_borte' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('ASSET_NOT_FOUND')
  })

  it('clamps a crop that runs past the edge of the file rather than refusing it', () => {
    // A drag that overshoots means «all the way», not «invalid».
    const presentation = deckWith(createImage('a1'))
    const moved = unwrap(
      setImageFocus(presentation, { ...target(presentation), focus: { x: 4, y: -2 } }),
    )
    expect(imagePanelOf(contentOf(moved))?.focus).toEqual({ x: 1, y: 0 })
  })

  it('keeps the crop when the file is swapped', () => {
    // The crop is a fraction rather than a pixel offset, so it survives a file
    // of different proportions — and a swap is «this picture instead», not
    // «start over».
    const presentation = deckWith(createImage('a1'))
    const moved = unwrap(
      setImageFocus(presentation, { ...target(presentation), focus: { x: 0.2, y: 0.8 } }),
    )
    const swapped = unwrap(setImageAsset(moved, { ...target(moved), assetId: 'a1' }))
    expect(imagePanelOf(contentOf(swapped))?.focus).toEqual({ x: 0.2, y: 0.8 })
  })
})

describe('a caption', () => {
  it('may hang from the ceiling of a picture, but not of a titled image card', () => {
    expect(captionPositionsFor('image')).toEqual(['top', 'middle', 'bottom'])
    // The header is already along the top edge; a second panel of the same
    // shape under it would read as a paler second header.
    expect(captionPositionsFor('titled-image-card')).toEqual(['middle', 'bottom'])

    const card = deckWith(createTitledImageCard('a1'))
    const refused = setImageCaption(card, { ...target(card), position: 'top' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('INVALID_ARGUMENT')
  })

  it('starts with no colour of its own, so it follows the cover', () => {
    const presentation = deckWith(createImage('a1'))
    const added = unwrap(setImageCaption(presentation, { ...target(presentation), position: 'bottom' }))
    expect(imagePanelOf(contentOf(added))?.caption).toMatchObject({
      position: 'bottom',
      color: null,
    })
  })

  it('is removed outright rather than left behind empty', () => {
    const presentation = deckWith(createImage('a1'))
    const added = unwrap(setImageCaption(presentation, { ...target(presentation), position: 'middle' }))
    const removed = unwrap(setImageCaption(added, { ...target(added), remove: true }))
    expect(imagePanelOf(contentOf(removed))?.caption).toBeNull()
  })

  it('is refused when it is longer than the picture is tall', () => {
    const presentation = deckWith(createImage('a1'))
    const refused = setImageCaption(presentation, {
      ...target(presentation),
      position: 'bottom',
      doc: titleDoc('ord '.repeat(4000)),
      ...checkers,
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('CONTENT_DOES_NOT_FIT')
  })

  it('counts as text this zone shows, so a citation in it is found', () => {
    const presentation = deckWith(createImage('a1'))
    const added = unwrap(
      setImageCaption(presentation, {
        ...target(presentation),
        position: 'bottom',
        doc: titleDoc('Bildetekst'),
      }),
    )
    const caption = imagePanelOf(contentOf(added))?.caption
    expect(caption && docToPlainText(caption.doc)).toBe('Bildetekst')
  })
})

describe('a card header', () => {
  it('is the same header on both titled kinds, colour and inheritance alike', () => {
    // The inspector offers the picker for both, so the command has to answer
    // for both — otherwise every colour click on a picture card is a refusal.
    const presentation = deckWith(createTitledImageCard('a1', 'Overskrift'))
    const coloured = unwrap(
      setCardColor(presentation, { ...target(presentation), color: '#112233' }),
    )
    const card = contentOf(coloured)
    expect(card.kind === 'titled-image-card' && card.headerColor).toBe('#112233')

    const inherited = unwrap(setCardColor(coloured, { ...target(coloured), color: null }))
    const back = contentOf(inherited)
    expect(back.kind === 'titled-image-card' && back.headerColor).toBeNull()
  })

  it('is refused on content that has no panel to colour', () => {
    const presentation = deckWith(createImage('a1'))
    const refused = setCardColor(presentation, { ...target(presentation), color: '#112233' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('INVALID_CONTENT')
  })
})

describe('converting to and from a picture', () => {
  it('carries the picture into a card as an inline figure, and the caption as text', () => {
    const source = createImage('a1')
    const withCaption: ZoneContent = {
      ...source,
      image: { ...source.image, caption: { doc: titleDoc('Fjord'), position: 'bottom', color: null } },
    }
    const converted = convertContentKind(withCaption, 'container')
    expect(converted.kind).toBe('container')
    const json = JSON.stringify(converted)
    expect(json).toContain('a1')
    expect(json).toContain('Fjord')
  })

  it('carries a card into a picture: the first figure becomes the picture, the text the caption', () => {
    const card = createUntitledCard()
    const withFigure: ZoneContent = {
      ...card,
      body: {
        ...card.body,
        subfields: [
          {
            ...card.body.subfields[0],
            doc: {
              type: 'doc',
              content: [
                { type: 'slaidsImage', attrs: { assetId: 'a1' } },
                { type: 'paragraph', content: [{ type: 'text', text: 'En bildetekst' }] },
              ],
            },
          },
        ],
      },
    }
    const converted = convertContentKind(withFigure, 'image')
    if (converted.kind !== 'image') throw new Error('forventet et bilde')
    expect(converted.image.assetId).toBe('a1')
    expect(converted.image.caption && docToPlainText(converted.image.caption.doc)).toBe(
      'En bildetekst',
    )
  })

  it('keeps the title and its colour between the two titled kinds', () => {
    const card = createTitledCard('Overskrift', '#112233')
    const converted = convertContentKind(card, 'titled-image-card')
    if (converted.kind !== 'titled-image-card') throw new Error('forventet et bildekort')
    expect(docToPlainText(converted.title)).toBe('Overskrift')
    expect(converted.headerColor).toBe('#112233')
  })

  it('keeps the crop and the caption between the two picture kinds', () => {
    const source = createImage('a1')
    const framed: ZoneContent = {
      ...source,
      image: {
        assetId: 'a1',
        focus: { x: 0.1, y: 0.9 },
        caption: { doc: titleDoc('Utsnitt'), position: 'middle', color: '#445566' },
      },
    }
    const converted = convertContentKind(framed, 'titled-image-card')
    if (converted.kind !== 'titled-image-card') throw new Error('forventet et bildekort')
    expect(converted.image).toEqual(framed.image)
  })

  it('keeps the card title when a titled image card already has a caption', () => {
    // The title panel goes away, so the title has nowhere left to be but the
    // caption — and a caption that was already there is not a reason to drop it.
    const source = createTitledImageCard('a1', 'Overskrift')
    const withCaption: ZoneContent = {
      ...source,
      image: {
        ...source.image,
        caption: { doc: titleDoc('Fjord'), position: 'bottom', color: null },
      },
    }
    const converted = convertContentKind(withCaption, 'image')
    if (converted.kind !== 'image') throw new Error('forventet et bilde')
    const text = docToPlainText(converted.image.caption?.doc ?? null)
    expect(text).toContain('Overskrift')
    expect(text).toContain('Fjord')
  })

  it('keeps citations when text becomes a caption', () => {
    // A citation is not characters. Flattening it away would delete a
    // reference's first occurrence and renumber every label after it, on
    // slides nobody touched.
    const card = createUntitledCard()
    const citing: ZoneContent = {
      ...card,
      body: {
        ...card.body,
        subfields: [
          {
            ...card.body.subfields[0],
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Se ' },
                    { type: 'citation', attrs: { referenceIds: ['r1'] } },
                  ],
                },
              ],
            },
          },
        ],
      },
    }
    const converted = convertContentKind(citing, 'image')
    if (converted.kind !== 'image') throw new Error('forventet et bilde')
    expect(collectCitationIds(converted.image.caption?.doc ?? null)).toEqual(['r1'])
  })

  it('says a titled card\'s title once, not twice', () => {
    const card = createTitledCard('Overskrift')
    const withBody: ZoneContent = {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc('Brødtekst') }],
      },
    }
    const converted = convertContentKind(withBody, 'image')
    if (converted.kind !== 'image') throw new Error('forventet et bilde')
    const text = docToPlainText(converted.image.caption?.doc ?? null)
    expect(text.match(/Overskrift/g)).toHaveLength(1)
    expect(text).toContain('Brødtekst')
  })

  it('loses nothing when a text card becomes a picture and comes back', () => {
    const container = createContainer()
    const withText: ZoneContent = {
      ...container,
      body: {
        ...container.body,
        subfields: [{ ...container.body.subfields[0], doc: paragraphDoc('Kort tekst') }],
      },
    }
    const asImage = convertContentKind(withText, 'image')
    const back = convertContentKind(asImage, 'container')
    expect(JSON.stringify(back)).toContain('Kort tekst')
  })
})
