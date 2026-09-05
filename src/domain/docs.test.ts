import { describe, expect, it } from 'vitest'
import { allContent, dropAssetIds, mapPresentationDocs, remapAssetIds } from './docs'
import { createPresentation } from './presentation'
import { createLeaf, createSplit } from './layout'
import {
  containerWithDoc,
  createImage,
  createTitledCard,
  createUntitledCard,
  imagePanelOf,
} from './content'
import { paragraphDoc, plainTextToDoc } from './richdoc'
import type { Presentation } from './types'

function build(): Presentation {
  const base = createPresentation({ title: 'Docs' })
  const titled = createTitledCard('Korttittel')
  const withBody = {
    ...titled,
    body: {
      ...titled.body,
      subfields: [{ ...titled.body.subfields[0], doc: paragraphDoc('body-tekst') }],
    },
  }
  return {
    ...base,
    slides: [
      {
        ...base.slides[0],
        root: createSplit('x', [1, 1], [
          createLeaf(withBody),
          createLeaf(createImage('a1')),
        ]),
      },
    ],
    sandbox: [{ id: 'sb1', content: createUntitledCard(), createdAt: '', note: '' }],
    assets: [
      { id: 'a1', name: 'f.svg', mimeType: 'image/svg+xml', byteSize: 1, width: 1, height: 1, isVector: true },
    ],
  }
}

describe('mapPresentationDocs', () => {
  it('touches every document including titles and the sandbox', () => {
    const presentation = build()
    const mapped = mapPresentationDocs(presentation, () => paragraphDoc('erstattet'))
    const json = JSON.stringify(mapped)
    expect(json).not.toContain('body-tekst')
    expect(json).not.toContain('Korttittel')
    expect(json.match(/erstattet/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('returns the same object when nothing changed', () => {
    const presentation = build()
    expect(mapPresentationDocs(presentation, (doc) => doc)).toBe(presentation)
  })
})

describe('allContent', () => {
  it('collects slide content and sandbox content', () => {
    expect(allContent(build())).toHaveLength(3)
  })
})

describe('remapAssetIds', () => {
  it('rewrites container payload references and asset metadata', () => {
    const remapped = remapAssetIds(build(), new Map([['a1', 'a2']]))
    const json = JSON.stringify(remapped)
    expect(json).toContain('a2')
    expect(json).not.toContain('"assetId":"a1"')
    expect(remapped.assets[0].id).toBe('a2')
  })

  it('rewrites inline image nodes inside documents', () => {
    const base = createPresentation({ title: 'Bilder' })
    const presentation: Presentation = {
      ...base,
      slides: [
        {
          ...base.slides[0],
          root: createLeaf(
            containerWithDoc({
              type: 'doc',
              content: [{ type: 'slaidsImage', attrs: { assetId: 'old', alt: '' } }],
            }),
          ),
        },
      ],
    }
    const remapped = remapAssetIds(presentation, new Map([['old', 'new']]))
    expect(JSON.stringify(remapped)).toContain('"assetId":"new"')
  })

  it('is a no-op for an empty map', () => {
    const presentation = build()
    expect(remapAssetIds(presentation, new Map())).toBe(presentation)
  })
})

describe('dropAssetIds', () => {
  it('tømmer bildesonen uten å kaste kortet, og fjerner filen fra listen', () => {
    const presentation = build()
    const dropped = dropAssetIds(presentation, new Set(['a1']))

    expect(dropped.assets).toEqual([])
    // Precise, because generated ids can contain 'a1' as a substring.
    expect(JSON.stringify(dropped)).not.toContain('"assetId":"a1"')

    // The zone is still a picture zone — with its crop and caption — waiting
    // for a file, which is a state the model already has. Deleting the content
    // would throw away a layout the archive did describe correctly.
    const zone = allContent(dropped).find((content) => content.kind === 'image')
    expect(zone).toBeDefined()
    expect(imagePanelOf(zone!)?.assetId).toBeNull()
  })

  it('tar ut et bilde inne i teksten, siden en blokk uten fil ikke kan tegnes', () => {
    const base = createPresentation({ title: 'Bilder' })
    const presentation: Presentation = {
      ...base,
      slides: [
        {
          ...base.slides[0],
          root: createLeaf(
            containerWithDoc({
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Før figuren' }] },
                { type: 'slaidsImage', attrs: { assetId: 'borte', alt: '' } },
                { type: 'slaidsImage', attrs: { assetId: 'blir', alt: '' } },
              ],
            }),
          ),
        },
      ],
    }

    const dropped = dropAssetIds(presentation, new Set(['borte']))
    const json = JSON.stringify(dropped)
    expect(json).not.toContain('borte')
    expect(json).toContain('"assetId":"blir"')
    expect(json).toContain('Før figuren')
  })

  it('etterlater et tomt avsnitt, ikke et tomt dokument', () => {
    const base = createPresentation({ title: 'Bare figur' })
    const presentation: Presentation = {
      ...base,
      slides: [
        {
          ...base.slides[0],
          root: createLeaf(
            containerWithDoc({
              type: 'doc',
              content: [{ type: 'slaidsImage', attrs: { assetId: 'borte', alt: '' } }],
            }),
          ),
        },
      ],
    }

    const dropped = dropAssetIds(presentation, new Set(['borte']))
    expect(JSON.stringify(dropped)).toContain('{"type":"paragraph"}')
  })

  it('rekker også sandkassen', () => {
    const base = createPresentation({ title: 'Sandkasse' })
    const presentation: Presentation = {
      ...base,
      sandbox: [{ id: 'sb1', content: createImage('borte'), createdAt: '', note: '' }],
      assets: [
        {
          id: 'borte',
          name: 'f.svg',
          mimeType: 'image/svg+xml',
          byteSize: 1,
          width: 1,
          height: 1,
          isVector: true,
        },
      ],
    }

    const dropped = dropAssetIds(presentation, new Set(['borte']))
    expect(JSON.stringify(dropped)).not.toContain('borte')
    expect(dropped.sandbox).toHaveLength(1)
  })

  it('er en no-op for et tomt sett', () => {
    const presentation = build()
    expect(dropAssetIds(presentation, new Set())).toBe(presentation)
  })
})

describe('plainTextToDoc', () => {
  it('splits paragraphs on blank lines and keeps single newlines as breaks', () => {
    const doc = plainTextToDoc('Første avsnitt\nmed brudd\n\nAndre avsnitt')
    expect(doc.content).toHaveLength(2)
    expect(JSON.stringify(doc.content?.[0])).toContain('hardBreak')
  })

  it('returns an empty document for blank input', () => {
    expect(plainTextToDoc('   ')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })
})
