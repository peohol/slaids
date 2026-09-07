/**
 * The door a miniapp file comes through.
 *
 * Everything here is about bytes and text: which names are accepted, how the
 * bytes are decoded, and how the size is measured. Nothing here says anything
 * about what the file does when it runs — that is the browser's boundary, and
 * `src/ui/interactive/sandboxDocument.test.ts` states it as data while the
 * Playwright security spec measures it.
 */

import { describe, expect, it } from 'vitest'
import { MAX_INTERACTIVE_HTML_BYTES, MAX_INTERACTIVE_HTML_TOTAL_BYTES } from './constants'
import {
  INTERACTIVE_NAME_MAX_LENGTH,
  acceptInteractiveFile,
  acceptInteractiveHtml,
  decodeInteractiveHtml,
  formatByteSize,
  hasInteractiveExtension,
  interactiveBudgetRefusal,
  interactiveHtmlBytesIn,
  normalizeInteractiveName,
  suggestedInteractiveName,
  utf8ByteLength,
} from './interactive'
import { createInteractiveSlide, createPresentation } from './presentation'
import type { Result } from './result'
import { htmlOfBytes, interactiveAt } from './testDecks'
import type { Presentation } from './types'

const APP = '<!doctype html><html><body><button>Tell</button></body></html>'

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Avvist: ${result.error.code}`)
  return result.value
}

function refusal<T>(result: Result<T>) {
  if (result.ok) throw new Error('Forventet en avvisning.')
  return result.error
}

function deckWith(...sizes: number[]): Presentation {
  const presentation = createPresentation({ title: 'Budsjett' })
  return {
    ...presentation,
    slides: [
      ...presentation.slides,
      ...sizes.map((size, index) =>
        createInteractiveSlide({
          name: `App ${index}`,
          fileName: `app-${index}.html`,
          html: htmlOfBytes(size),
        }),
      ),
    ],
  }
}

describe('utf8ByteLength', () => {
  it('teller byte, ikke UTF-16-enheter', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('æøå')).toBe(6)
    expect(utf8ByteLength('日本')).toBe(6)
    // A surrogate pair is two UTF-16 units and four bytes.
    expect('🙂'.length).toBe(2)
    expect(utf8ByteLength('🙂')).toBe(4)
  })
})

describe('filnavnet', () => {
  it('må slutte på .html, uansett hvordan endelsen er skrevet', () => {
    expect(hasInteractiveExtension('app.html')).toBe(true)
    expect(hasInteractiveExtension('APP.HTML')).toBe(true)
    expect(hasInteractiveExtension('Quiz.Html')).toBe(true)
    expect(hasInteractiveExtension('app.htm')).toBe(false)
    expect(hasInteractiveExtension('app.html.txt')).toBe(false)
    expect(hasInteractiveExtension('app')).toBe(false)
  })

  it('foreslår navnet uten filendelsen', () => {
    expect(suggestedInteractiveName('Quiz om budsjettet.html')).toBe('Quiz om budsjettet')
    expect(suggestedInteractiveName('TELLER.HTML')).toBe('TELLER')
    expect(suggestedInteractiveName('  spill.html  ')).toBe('spill')
  })

  it('faller tilbake når det ikke er noe igjen av navnet', () => {
    expect(suggestedInteractiveName('.html')).toBe('.html')
    expect(suggestedInteractiveName('   ')).toBe('Miniapp')
    expect(suggestedInteractiveName('a'.repeat(300) + '.html')).toHaveLength(
      INTERACTIVE_NAME_MAX_LENGTH,
    )
  })

  it('avviser en fil som ikke er .html før den leses', () => {
    const error = refusal(acceptInteractiveFile({ fileName: 'bilde.png', bytes: bytes(APP) }))
    expect(error.code).toBe('INVALID_INTERACTIVE_FILE')
    expect(error.message).toContain('.html')
    expect(refusal(acceptInteractiveHtml({ fileName: 'app.svg', html: APP })).code).toBe(
      'INVALID_INTERACTIVE_FILE',
    )
  })

  it('godtar endelsen i alle bokstavvarianter, og beholder navnet som tekst', () => {
    const accepted = unwrap(acceptInteractiveFile({ fileName: 'QUIZ.HTML', bytes: bytes(APP) }))
    expect(accepted.fileName).toBe('QUIZ.HTML')
    expect(accepted.html).toBe(APP)
    expect(accepted.byteSize).toBe(utf8ByteLength(APP))
  })
})

describe('navn', () => {
  it('trimmes og må ha innhold', () => {
    expect(unwrap(normalizeInteractiveName('  Quiz  '))).toBe('Quiz')
    expect(refusal(normalizeInteractiveName('   ')).code).toBe('INVALID_ARGUMENT')
    expect(refusal(normalizeInteractiveName('')).code).toBe('INVALID_ARGUMENT')
  })

  it('har en øvre lengde', () => {
    expect(unwrap(normalizeInteractiveName('x'.repeat(INTERACTIVE_NAME_MAX_LENGTH)))).toHaveLength(
      INTERACTIVE_NAME_MAX_LENGTH,
    )
    expect(refusal(normalizeInteractiveName('x'.repeat(INTERACTIVE_NAME_MAX_LENGTH + 1))).code).toBe(
      'INVALID_ARGUMENT',
    )
  })

  it('sier hva som ble avvist', () => {
    expect(refusal(normalizeInteractiveName('', 'Filnavnet')).message).toContain('Filnavnet')
  })
})

describe('innholdet', () => {
  it('avviser en tom fil', () => {
    expect(refusal(acceptInteractiveFile({ fileName: 'a.html', bytes: bytes('') })).code).toBe(
      'INVALID_INTERACTIVE_FILE',
    )
    expect(refusal(acceptInteractiveHtml({ fileName: 'a.html', html: '  \n\t ' })).code).toBe(
      'INVALID_INTERACTIVE_FILE',
    )
  })

  it('avviser tekst uten et eneste element', () => {
    const error = refusal(acceptInteractiveHtml({ fileName: 'notat.html', html: 'Bare tekst.' }))
    expect(error.code).toBe('INVALID_INTERACTIVE_FILE')
    expect(error.message).toContain('ingen elementer')
  })

  it('godtar et dokument som begynner med en kommentar eller doctype', () => {
    expect(acceptInteractiveHtml({ fileName: 'a.html', html: '<!-- hei --><p>x</p>' }).ok).toBe(true)
    expect(acceptInteractiveHtml({ fileName: 'a.html', html: '<!DOCTYPE html><p>x</p>' }).ok).toBe(
      true,
    )
    expect(acceptInteractiveHtml({ fileName: 'a.html', html: '<P>x</P>' }).ok).toBe(true)
  })

  it('avviser binærdata som tilfeldigvis lar seg dekode', () => {
    const error = refusal(acceptInteractiveHtml({ fileName: 'a.html', html: '<p>x</p>\u0000' }))
    expect(error.code).toBe('INVALID_INTERACTIVE_FILE')
    expect(error.message).toContain('binærdata')
  })
})

describe('dekoding', () => {
  it('leser UTF-8 og beholder hvert tegn', () => {
    const html = '<p>Blåbærsyltetøy 🙂 日本</p>'
    expect(unwrap(decodeInteractiveHtml(bytes(html)))).toBe(html)
  })

  it('hopper over et UTF-8-merke, og måler størrelsen uten det', () => {
    const html = '<p>x</p>'
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(html)])
    expect(unwrap(decodeInteractiveHtml(withBom))).toBe(html)
    const accepted = unwrap(acceptInteractiveFile({ fileName: 'a.html', bytes: withBom }))
    expect(accepted.html).toBe(html)
    expect(accepted.byteSize).toBe(withBom.byteLength - 3)
  })

  it('avviser UTF-16 ved navn i stedet for å lese det som tull', () => {
    for (const mark of [
      [0xff, 0xfe],
      [0xfe, 0xff],
    ]) {
      const error = refusal(decodeInteractiveHtml(new Uint8Array([...mark, 0x3c, 0x00])))
      expect(error.code).toBe('INVALID_INTERACTIVE_FILE')
      expect(error.message).toContain('UTF-16')
    }
  })

  it('avviser tekst som ikke er gyldig UTF-8, med beskjed om hva som fikser det', () => {
    // Latin-1 «ø» is a lone 0xf8, which is not a UTF-8 lead byte.
    const latin1 = new Uint8Array([0x3c, 0x70, 0x3e, 0xf8, 0x3c, 0x2f, 0x70, 0x3e])
    const error = refusal(acceptInteractiveFile({ fileName: 'a.html', bytes: latin1 }))
    expect(error.code).toBe('INVALID_INTERACTIVE_FILE')
    expect(error.message).toContain('UTF-8')
  })
})

describe('størrelsesgrensen', () => {
  it('slipper gjennom en fil på nøyaktig grensen', () => {
    const html = htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES)
    expect(utf8ByteLength(html)).toBe(MAX_INTERACTIVE_HTML_BYTES)
    expect(acceptInteractiveHtml({ fileName: 'a.html', html }).ok).toBe(true)
  })

  it('avviser én byte over, med tallene i feilen', () => {
    const html = htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES + 1)
    const error = refusal(acceptInteractiveHtml({ fileName: 'a.html', html }))
    expect(error.code).toBe('INTERACTIVE_HTML_TOO_LARGE')
    expect(error.message).toContain(formatByteSize(MAX_INTERACTIVE_HTML_BYTES))
  })

  it('måler i byte av UTF-8, ikke i tegn', () => {
    // Fewer characters than the limit, more bytes than it: what `length`
    // would have let through.
    const html = htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES + 3, 'æ')
    expect(html.length).toBeLessThan(MAX_INTERACTIVE_HTML_BYTES)
    expect(refusal(acceptInteractiveHtml({ fileName: 'a.html', html })).code).toBe(
      'INTERACTIVE_HTML_TOO_LARGE',
    )
  })

  it('avviser en for stor fil før den dekodes', () => {
    const oversized = new Uint8Array(MAX_INTERACTIVE_HTML_BYTES + 1).fill(0x61)
    expect(refusal(acceptInteractiveFile({ fileName: 'a.html', bytes: oversized })).code).toBe(
      'INTERACTIVE_HTML_TOO_LARGE',
    )
  })
})

describe('budsjettet for hele dekket', () => {
  it('summerer bare de interaktive slidene', () => {
    expect(interactiveHtmlBytesIn(deckWith())).toBe(0)
    expect(interactiveHtmlBytesIn(deckWith(100, 250))).toBe(350)
  })

  it('kan holde én slide utenfor, for den som skal byttes ut', () => {
    const presentation = deckWith(100, 250)
    const second = interactiveAt(presentation, 3)
    expect(interactiveHtmlBytesIn(presentation, { excludingSlideId: second.id })).toBe(100)
  })

  it('sier ja så lenge det er plass, og nei med tallene når det ikke er det', () => {
    const presentation = deckWith(MAX_INTERACTIVE_HTML_TOTAL_BYTES - 10)
    expect(interactiveBudgetRefusal(presentation, 10)).toBeNull()
    const over = interactiveBudgetRefusal(presentation, 11)
    if (!over || over.ok) throw new Error('Forventet en avvisning.')
    expect(over.error.code).toBe('INTERACTIVE_BUDGET_EXCEEDED')
    expect(over.error.details).toMatchObject({
      byteSize: 11,
      heldByteSize: MAX_INTERACTIVE_HTML_TOTAL_BYTES - 10,
      maxTotalByteSize: MAX_INTERACTIVE_HTML_TOTAL_BYTES,
    })
  })

  it('er større enn grensen for én fil, så én lovlig fil alltid får plass i et tomt dekk', () => {
    expect(MAX_INTERACTIVE_HTML_TOTAL_BYTES).toBeGreaterThanOrEqual(MAX_INTERACTIVE_HTML_BYTES)
    expect(interactiveBudgetRefusal(deckWith(), MAX_INTERACTIVE_HTML_BYTES)).toBeNull()
  })
})

describe('formatByteSize', () => {
  it('skriver størrelser slik dialogen viser dem', () => {
    expect(formatByteSize(0)).toBe('0 byte')
    expect(formatByteSize(512)).toBe('512 byte')
    expect(formatByteSize(1024)).toBe('1 kB')
    expect(formatByteSize(1536)).toBe('1,5 kB')
    expect(formatByteSize(2 * 1024 * 1024)).toBe('2 MB')
    expect(formatByteSize(2.25 * 1024 * 1024)).toBe('2,3 MB')
  })
})
