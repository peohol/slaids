/**
 * The agent text format, in both directions.
 *
 * The contract this file defends is narrow and worth stating: an agent writes
 * blocks and reads blocks, and Slaids' stored rich-text format never appears in
 * either. So the tests are about the seam — what a block turns into, what a
 * stored document turns back into, and what the schema refuses before any of
 * that happens.
 */

import { describe, expect, it } from 'vitest'
import { INLINE_IMAGE_DEFAULT_WIDTH_PERCENT } from '../domain/constants'
import { estimateDocHeight } from '../domain/fit'
import { collectCitationIds, docCharacterCount, docToPlainText } from '../domain/richdoc'
import type { AssetRef, RichDoc } from '../domain/types'
import {
  blocksToDoc,
  citedIdsInBlocks,
  docToBlocks,
  docToTitleAlign,
  docToTitleSpans,
  imageAssetIdsInBlocks,
  textBlocksSchema,
  titleSpansSchema,
  titleSpansToDoc,
  type TextBlock,
} from './text'

function roundTrip(blocks: TextBlock[]): unknown {
  return docToBlocks(blocksToDoc(blocks))
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

describe('blokker', () => {
  it('overlever veien inn og ut igjen', () => {
    const blocks: TextBlock[] = [
      { type: 'accent', spans: [{ text: 'Overskrift' }], color: '#204060' },
      { type: 'paragraph', spans: [{ text: 'Et avsnitt.' }], align: 'center' },
      { type: 'quote', spans: [{ text: 'Et sitat.' }] },
      { type: 'bullets', items: [[{ text: 'Første' }], [{ text: 'Andre' }]] },
      { type: 'numbered', items: [[{ text: 'Ett' }], [{ text: 'To' }]] },
    ]
    expect(roundTrip(blocks)).toEqual(blocks)
  })

  it('tar vare på fet, kursiv og de andre markeringene', () => {
    const blocks: TextBlock[] = [
      {
        type: 'paragraph',
        spans: [
          { text: 'fet', bold: true },
          { text: 'kursiv', italic: true },
          { text: 'understreket', underline: true },
          { text: 'gjennomstreket', strike: true },
          { text: 'kode', code: true },
          { text: 'lenke', href: 'https://slaids.example/doc' },
          { lineBreak: true },
          { text: 'etter linjeskiftet' },
        ],
      },
    ]
    expect(roundTrip(blocks)).toEqual(blocks)
  })

  it('bygger et tomt avsnitt av en tom liste', () => {
    expect(blocksToDoc([])).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(blocksToDoc([{ type: 'paragraph', spans: [] }])).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
  })

  it('lager ProseMirror-strukturen Slaids faktisk lagrer', () => {
    // The only place this file looks at the internal shape: it is the thing
    // being translated to, and a change here is a change an agent must not see.
    const doc = blocksToDoc([{ type: 'bullets', items: [[{ text: 'Punkt' }]] }])
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Punkt' }] }],
            },
          ],
        },
      ],
    })
  })
})

/* ------------------------------------------------------------------ *
 * Citations
 * ------------------------------------------------------------------ */

describe('citations', () => {
  it('skriver reference-ID-er, aldri numre', () => {
    const doc = blocksToDoc([
      { type: 'paragraph', spans: [{ text: 'Påstand' }, { citation: ['r1', 'r2'] }] },
    ])
    const paragraph = doc.content?.[0]
    expect(paragraph?.content?.[1]).toEqual({
      type: 'citation',
      attrs: { referenceIds: ['r1', 'r2'] },
    })
    // Nothing in the stored document says what number it will render as.
    expect(JSON.stringify(doc)).not.toContain('label')
  })

  it('slår sammen citations som står inntil hverandre, slik editoren gjør', () => {
    const doc = blocksToDoc([
      {
        type: 'paragraph',
        spans: [{ text: 'Påstand' }, { citation: ['r1'] }, { citation: ['r2'] }],
      },
    ])
    expect(docToBlocks(doc)).toEqual([
      { type: 'paragraph', spans: [{ text: 'Påstand' }, { citation: ['r1', 'r2'] }] },
    ])
  })

  it('teller som innhold når fit måles', () => {
    const withCitation = blocksToDoc([
      { type: 'paragraph', spans: [{ text: 'Tekst' }, { citation: ['r1'] }] },
    ])
    const without = blocksToDoc([{ type: 'paragraph', spans: [{ text: 'Tekst' }] }])
    expect(docCharacterCount(withCitation)).toBeGreaterThan(docCharacterCount(without))
  })
})

/* ------------------------------------------------------------------ *
 * Inline pictures
 * ------------------------------------------------------------------ */

/** A file as the presentation holds it: measured from the bitstream, 2:1. */
const WIDE: AssetRef = {
  id: 'as_wide',
  name: 'figur.png',
  mimeType: 'image/png',
  byteSize: 1024,
  width: 800,
  height: 400,
  isVector: false,
}

/** A file that never got a size — an SVG that declared none. */
const SIZELESS: AssetRef = { ...WIDE, id: 'as_sizeless', width: 0, height: 0 }

describe('bilder inne i teksten', () => {
  it('blir noden Slaids faktisk lagrer, med filens egne proporsjoner', () => {
    // The second place this file looks at the internal shape, and for the same
    // reason as the first: it is what is being translated to. The aspect is not
    // something the caller sent — it is the stored file's own width over its
    // height, which is what makes the measured height the drawn height.
    const doc = blocksToDoc(
      [{ type: 'image', assetId: WIDE.id, alt: 'Et diagram', widthPercent: 60, align: 'center' }],
      [WIDE],
    )
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'slaidsImage',
          attrs: {
            assetId: 'as_wide',
            alt: 'Et diagram',
            widthPercent: 60,
            aspect: 2,
            textAlign: 'center',
          },
        },
      ],
    })
    // And never the bytes.
    expect(JSON.stringify(doc)).not.toContain('base64')
  })

  it('leses tilbake som den samme blokken', () => {
    const blocks: TextBlock[] = [
      { type: 'image', assetId: WIDE.id, alt: 'Et diagram', widthPercent: 60, align: 'center' },
    ]
    expect(docToBlocks(blocksToDoc(blocks, [WIDE]))).toEqual(blocks)
    // The proportions stay out of the contract: they are the file's, and
    // `list_assets` is where an agent reads them.
    expect(JSON.stringify(docToBlocks(blocksToDoc(blocks, [WIDE])))).not.toContain('aspect')
  })

  it('overlever tekst før og etter seg', () => {
    const blocks: TextBlock[] = [
      { type: 'paragraph', spans: [{ text: 'Over bildet.' }] },
      { type: 'image', assetId: WIDE.id, widthPercent: 50 },
      { type: 'paragraph', spans: [{ text: 'Under bildet.' }] },
    ]
    expect(docToBlocks(blocksToDoc(blocks, [WIDE]))).toEqual(blocks)
  })

  it('står side om side med citations og formattert tekst', () => {
    const blocks: TextBlock[] = [
      { type: 'accent', spans: [{ text: 'Funn' }] },
      {
        type: 'paragraph',
        spans: [{ text: 'Målingen', bold: true }, { text: ' viser dette' }, { citation: ['r1'] }],
      },
      { type: 'image', assetId: WIDE.id, alt: 'Måling', widthPercent: 75 },
      { type: 'bullets', items: [[{ text: 'Punkt' }, { citation: ['r2'] }]] },
    ]
    const doc = blocksToDoc(blocks, [WIDE])
    expect(docToBlocks(doc)).toEqual(blocks)
    // A picture is not a citation and does not disturb the numbering.
    expect(collectCitationIds(doc)).toEqual(['r1', 'r2'])
  })

  it('får standardbredden når kalleren ikke sier noe, og leser den tilbake', () => {
    const parsed = textBlocksSchema.parse([{ type: 'image', assetId: WIDE.id }])
    expect(docToBlocks(blocksToDoc(parsed, [WIDE]))).toEqual([
      { type: 'image', assetId: WIDE.id, widthPercent: INLINE_IMAGE_DEFAULT_WIDTH_PERCENT },
    ])
  })

  it('faller tilbake på stilarkets forhold når filen ikke har en størrelse', () => {
    const blocks: TextBlock[] = [{ type: 'image', assetId: SIZELESS.id, widthPercent: 50 }]
    const doc = blocksToDoc(blocks, [SIZELESS])
    expect(doc.content?.[0].attrs?.aspect).toBeUndefined()
    // Still a picture an agent can read back and send again.
    expect(docToBlocks(doc)).toEqual(blocks)
  })

  it('navngir filene den viser, slik en kaller kan sjekke dem først', () => {
    const blocks: TextBlock[] = [
      { type: 'paragraph', spans: [{ text: 'Tekst' }] },
      { type: 'image', assetId: 'as_1', widthPercent: 50 },
      { type: 'image', assetId: 'as_2', widthPercent: 50 },
    ]
    expect(imageAssetIdsInBlocks(blocks)).toEqual(['as_1', 'as_2'])
    // A picture cites nothing, and asking does not throw on a block with no spans.
    expect(citedIdsInBlocks(blocks)).toEqual([])
  })

  it('teller som innhold når fit måles, med filens egne proporsjoner', () => {
    const COLUMN = 600
    const paragraph: TextBlock = { type: 'paragraph', spans: [{ text: 'Tekst' }] }
    const picture = (asset: AssetRef): TextBlock => ({
      type: 'image',
      assetId: asset.id,
      widthPercent: 50,
    })
    const tall: AssetRef = { ...WIDE, id: 'as_tall', width: 400, height: 800 }

    const text = estimateDocHeight(blocksToDoc([paragraph]), COLUMN)
    const wide = estimateDocHeight(blocksToDoc([paragraph, picture(WIDE)], [WIDE]), COLUMN)
    const high = estimateDocHeight(blocksToDoc([paragraph, picture(tall)], [tall]), COLUMN)

    expect(wide).toBeGreaterThan(text)
    // Half the column is 300 wide, which is 150 tall at 2:1 and 600 tall at
    // 1:2 — the file's own ratio, not an assumed one. Everything else about
    // the two documents is identical, so the difference is the picture's.
    //
    // Measured without a field around the flow, so this is the height a figure
    // *wants*. What it is actually drawn at is that or the height of its field,
    // whichever is smaller — see `estimateDocHeight` and the browser comparison
    // in `src/render/fitParity.test.ts`.
    expect(high - wide).toBeCloseTo(450, 6)
  })
})

/* ------------------------------------------------------------------ *
 * What the schema refuses
 * ------------------------------------------------------------------ */

describe('skjemaet', () => {
  const rejects = (blocks: unknown): boolean => !textBlocksSchema.safeParse(blocks).success

  it('avviser blokktyper som ikke finnes', () => {
    expect(rejects([{ type: 'markdown', text: '# nei' }])).toBe(true)
    expect(rejects([{ type: 'table', rows: [] }])).toBe(true)
  })

  it('avviser felter som ikke er en del av kontrakten', () => {
    // Strict objects, so a misspelling is an error rather than a field that
    // silently does nothing.
    expect(rejects([{ type: 'paragraph', spans: [{ text: 'Hei', fontSize: 40 }] }])).toBe(true)
    expect(rejects([{ type: 'paragraph', spans: [{ text: 'Hei' }], colour: '#fff' }])).toBe(true)
  })

  it('avviser tom tekst i en span, og tomme lister', () => {
    expect(rejects([{ type: 'paragraph', spans: [{ text: '' }] }])).toBe(true)
    expect(rejects([{ type: 'bullets', items: [] }])).toBe(true)
  })

  it('avviser en lenke som ikke er http, https eller mailto', () => {
    // A document written through this path can never carry an executable URL,
    // because such a URL is not a value the schema accepts.
    expect(rejects([{ type: 'paragraph', spans: [{ text: 'x', href: 'javascript:alert(1)' }] }])).toBe(
      true,
    )
    expect(rejects([{ type: 'paragraph', spans: [{ text: 'x', href: 'data:text/html,<b>' }] }])).toBe(
      true,
    )
    expect(rejects([{ type: 'paragraph', spans: [{ text: 'x', href: 'https://ok.example' }] }])).toBe(
      false,
    )
  })

  it('avviser et bilde uten fil, og alt som ligner på bytes i teksten', () => {
    expect(rejects([{ type: 'image' }])).toBe(true)
    expect(rejects([{ type: 'image', assetId: '' }])).toBe(true)
    // There is one way to refer to a file, and it is an id. Bytes belong in
    // `upload_asset`, and a URL would be a second, unvalidated asset model.
    expect(rejects([{ type: 'image', data: 'iVBORw0KGgo=' }])).toBe(true)
    expect(rejects([{ type: 'image', assetId: 'as_1', url: 'https://x.example/a.png' }])).toBe(true)
    // Nor may a caller state the proportions: those come from the stored file.
    expect(rejects([{ type: 'image', assetId: 'as_1', aspect: 3 }])).toBe(true)
    expect(rejects([{ type: 'image', assetId: 'as_1' }])).toBe(false)
  })

  it('avviser en bildebredde utenfor det en kolonne er', () => {
    expect(rejects([{ type: 'image', assetId: 'as_1', widthPercent: 0 }])).toBe(true)
    expect(rejects([{ type: 'image', assetId: 'as_1', widthPercent: 120 }])).toBe(true)
    expect(rejects([{ type: 'image', assetId: 'as_1', widthPercent: 42.5 }])).toBe(true)
    expect(rejects([{ type: 'image', assetId: 'as_1', widthPercent: 100 }])).toBe(false)
  })

  it('avviser en farge som ikke er hex', () => {
    expect(rejects([{ type: 'accent', spans: [], color: 'red' }])).toBe(true)
    expect(rejects([{ type: 'accent', spans: [], color: '#abc' }])).toBe(false)
  })

  it('lar en overskrift på en slide bare være tekst og citations', () => {
    expect(titleSpansSchema.safeParse([{ text: 'Tittel' }]).success).toBe(true)
    expect(titleSpansSchema.safeParse([{ citation: ['r1'] }]).success).toBe(true)
    // No emphasis, no line breaks: that restriction is what makes the title
    // zone geometrically deterministic.
    expect(titleSpansSchema.safeParse([{ text: 'Tittel', bold: true }]).success).toBe(false)
    expect(titleSpansSchema.safeParse([{ lineBreak: true }]).success).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * Reading what the format cannot write
 * ------------------------------------------------------------------ */

describe('innhold formatet ikke kan uttrykke', () => {
  it('rapporteres som unsupported med teksten sin, ikke stille borte', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Vanlig' }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Celle' }] }],
                },
              ],
            },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'kode()' }] },
        // A picture with no file behind it: the format has an `image` block, but
        // not one that can name nothing, so this stays something an agent is
        // told about rather than something it is handed an id for.
        { type: 'slaidsImage', attrs: { alt: 'Uten fil' } },
      ],
    }

    const blocks = docToBlocks(doc)
    expect(blocks[0]).toEqual({ type: 'paragraph', spans: [{ text: 'Vanlig' }] })
    expect(blocks.slice(1)).toEqual([
      { type: 'unsupported', node: 'table', text: 'Celle' },
      { type: 'unsupported', node: 'codeBlock', text: 'kode()' },
      { type: 'unsupported', node: 'slaidsImage', text: '' },
    ])
    // And it is not something an agent may send back.
    expect(textBlocksSchema.safeParse(blocks).success).toBe(false)
  })

  it('rapporterer en nøstet liste som unsupported i stedet for å miste halve den', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Ytre' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Indre' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const [block] = docToBlocks(doc)
    expect(block).toMatchObject({ type: 'unsupported', node: 'bulletList' })
    expect((block as { text: string }).text).toContain('Indre')
  })

  it('deler et sitat med flere avsnitt i ett sitat per avsnitt', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Første' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Andre' }] },
          ],
        },
      ],
    }
    expect(docToBlocks(doc)).toEqual([
      { type: 'quote', spans: [{ text: 'Første' }] },
      { type: 'quote', spans: [{ text: 'Andre' }] },
    ])
  })

  it('dropper en lenke med et protokoll formatet ikke kan skrive, men beholder teksten', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Klikk', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] },
          ],
        },
      ],
    }
    expect(docToBlocks(doc)).toEqual([{ type: 'paragraph', spans: [{ text: 'Klikk' }] }])
  })
})

/* ------------------------------------------------------------------ *
 * Titles
 * ------------------------------------------------------------------ */

describe('overskrifter', () => {
  it('er ett avsnitt, og leses tilbake som spans', () => {
    const doc = titleSpansToDoc([{ text: 'Innledning' }, { citation: ['r1'] }])
    expect(doc.content).toHaveLength(1)
    expect(doc.content?.[0].type).toBe('paragraph')
    expect(docToTitleSpans(doc)).toEqual([{ text: 'Innledning' }, { citation: ['r1'] }])
    expect(docToPlainText(doc)).toBe('Innledning')
  })

  it('blir tom når det ikke er noen spans', () => {
    expect(docToTitleSpans(titleSpansToDoc([]))).toEqual([])
  })

  it('bærer justeringen sin, så en omskriving ikke stiller den tilbake', () => {
    const centered = titleSpansToDoc([{ text: 'Midtstilt' }], 'center')
    expect(docToTitleAlign(centered)).toBe('center')
    // Rewriting the words while passing the alignment back keeps the line where
    // it was; passing nothing is what would have left-aligned it.
    expect(docToTitleAlign(titleSpansToDoc([{ text: 'Ny tekst' }], docToTitleAlign(centered)))).toBe(
      'center',
    )
    expect(docToTitleAlign(titleSpansToDoc([{ text: 'Ny tekst' }]))).toBeUndefined()
  })
})
