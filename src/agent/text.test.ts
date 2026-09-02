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
import { docCharacterCount, docToPlainText } from '../domain/richdoc'
import type { RichDoc } from '../domain/types'
import {
  blocksToDoc,
  docToBlocks,
  docToTitleSpans,
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
      { type: 'heading', spans: [{ text: 'Overskrift' }], color: '#204060' },
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

  it('avviser en farge som ikke er hex', () => {
    expect(rejects([{ type: 'heading', spans: [], color: 'red' }])).toBe(true)
    expect(rejects([{ type: 'heading', spans: [], color: '#abc' }])).toBe(false)
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
        { type: 'slaidsImage', attrs: { assetId: 'a1' } },
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
})
