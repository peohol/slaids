import { describe, expect, it } from 'vitest'
import { looksLikeSvg, sanitizeSvg, SVG_NAMESPACE } from './svg'

/** The shape of an SVG an agent would actually produce. */
const VALID = `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 100 50">
  <rect x="0" y="0" width="100" height="50" fill="#123456" />
  <text x="10" y="30" font-size="12" fill="white">Hei &amp; hallo</text>
</svg>`

function sanitized(markup: string) {
  const result = sanitizeSvg(markup)
  if (!result.ok) throw new Error(`Forventet gyldig SVG, fikk ${result.error.code}: ${result.error.message}`)
  return result.value
}

function rejection(markup: string) {
  const result = sanitizeSvg(markup)
  if (result.ok) throw new Error('Forventet at markupen ble avvist')
  return result.error
}

describe('sanitizeSvg – gyldig markup', () => {
  it('beholder tegneelementer og leser størrelsen fra viewBox', () => {
    const result = sanitized(VALID)
    expect(result.width).toBe(100)
    expect(result.height).toBe(50)
    expect(result.markup).toContain('<rect')
    expect(result.markup).toContain('fill="#123456"')
    expect(result.report.removedElements).toEqual([])
    expect(result.report.removedAttributes).toEqual([])
  })

  it('foretrekker eksplisitt width/height over viewBox', () => {
    const result = sanitized(`<svg viewBox="0 0 10 10" width="200" height="80"><circle r="4"/></svg>`)
    expect(result).toMatchObject({ width: 200, height: 80 })
  })

  it('regner om absolutte enheter, slik at forholdet blir riktig', () => {
    // 2in is 192px, so this is a 2:1 picture. Reading both numbers as user
    // units would call it square and stretch it in whatever zone it gets.
    expect(sanitized('<svg width="2in" height="96px"><rect/></svg>')).toMatchObject({
      width: 192,
      height: 96,
    })
    expect(sanitized('<svg width="72pt" height="1in"><rect/></svg>')).toMatchObject({
      width: 96,
      height: 96,
    })
    const metric = sanitized('<svg width="2.54cm" height="10mm"><rect/></svg>')
    expect(metric.width).toBeCloseTo(96, 9)
    expect(metric.height).toBeCloseTo(96 / 2.54, 9)
  })

  it('faller tilbake på viewBox for enheter uten egen størrelse', () => {
    expect(sanitized('<svg width="10em" height="4em" viewBox="0 0 40 20"><rect/></svg>')).toMatchObject({
      width: 40,
      height: 20,
    })
  })

  it('legger til xmlns når det mangler, slik at filen kan vises i en <img>', () => {
    const result = sanitized('<svg viewBox="0 0 4 2"><rect width="4" height="2"/></svg>')
    expect(result.markup.startsWith(`<svg xmlns="${SVG_NAMESPACE}"`)).toBe(true)
  })

  it('serialiserer på nytt fra treet, med tekst og entiteter escapet', () => {
    const result = sanitized(VALID)
    expect(result.markup).toContain('Hei &amp; hallo')
    // Round trip: what comes out is itself valid input.
    expect(sanitized(result.markup).markup).toBe(result.markup)
  })

  it('godtar det en vanlig agentfigur faktisk bruker', () => {
    const markup = `<svg viewBox="0 0 100 50">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="rgb(10, 20, 30)" stop-opacity="0.5"/>
        </linearGradient>
        <clipPath id="c"><rect width="50" height="50"/></clipPath>
        <filter id="f"><feGaussianBlur stdDeviation="2"/></filter>
      </defs>
      <g transform="translate(10, 5) rotate(15) scale(1.5)" clip-path="url(#c)" filter="url(#f)">
        <rect width="40" height="20" fill="url(#g)" stroke="#123" stroke-width="2" opacity="0.8"/>
        <text x="4" y="12" font-family="Inter, sans-serif" font-size="10" style="fill:rgba(0,0,0,0.6)">
          Figur
        </text>
      </g>
    </svg>`
    const result = sanitized(markup)
    expect(result.report).toEqual({ removedElements: [], removedAttributes: [] })
    expect(result.markup).toContain('url(#g)')
    expect(result.markup).toContain('translate(10, 5) rotate(15) scale(1.5)')
    expect(result.markup).toContain('rgba(0,0,0,0.6)')
  })

  it('godtar parenteser som ikke er funksjonskall, og store bokstaver i dem som er', () => {
    // `Figur (utkast)` is a label, not a call to `Figur()` — CSS reads a
    // function only when the parenthesis follows the name directly.
    const result = sanitized(
      `<svg viewBox="0 0 1 1"><rect aria-label="Figur (utkast)" fill="RGB(1, 2, 3)" transform="TranslateX(2)"/></svg>`,
    )
    expect(result.markup).toContain('Figur (utkast)')
    expect(result.markup).toContain('RGB(1, 2, 3)')
  })

  it('godtar interne referanser og innebygde rasterbilder', () => {
    const markup = `<svg viewBox="0 0 10 10">
      <defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>
      <rect width="10" height="10" fill="url(#g)"/>
      <use href="#g"/>
      <image href="data:image/png;base64,iVBORw0KGgo=" width="2" height="2"/>
    </svg>`
    expect(sanitized(markup).markup).toContain('url(#g)')
  })
})

describe('sanitizeSvg – utrygg markup avvises', () => {
  it('avviser <script>', () => {
    expect(rejection(`<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>`).code).toBe('UNSAFE_SVG')
  })

  it('avviser hendelsesattributter', () => {
    expect(rejection(`<svg viewBox="0 0 1 1"><rect onload="alert(1)" width="1" height="1"/></svg>`).code).toBe(
      'UNSAFE_SVG',
    )
    expect(rejection(`<svg viewBox="0 0 1 1" onclick="alert(1)"/>`).code).toBe('UNSAFE_SVG')
  })

  it('avviser <foreignObject>, som smugler inn HTML', () => {
    expect(
      rejection(`<svg viewBox="0 0 1 1"><foreignObject><b>hei</b></foreignObject></svg>`).code,
    ).toBe('UNSAFE_SVG')
  })

  it('avviser javascript:-lenker', () => {
    expect(rejection(`<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"><rect/></a></svg>`).code).toBe(
      'UNSAFE_SVG',
    )
  })

  it('avviser referanser ut av dokumentet', () => {
    expect(
      rejection(`<svg viewBox="0 0 1 1"><image href="https://example.com/spor.png"/></svg>`).code,
    ).toBe('UNSAFE_SVG')
    expect(
      rejection(`<svg viewBox="0 0 1 1"><rect fill="url(https://example.com/a.svg#x)"/></svg>`).code,
    ).toBe('UNSAFE_SVG')
  })

  it('avviser en url() i anførselstegn som inneholder en sluttparentes', () => {
    // The target contains `)`, so a pattern that stops at the first one never
    // sees the reference at all — and letting it through is the whole risk.
    expect(
      rejection(`<svg viewBox="0 0 1 1"><rect fill="url('https://a.example/x)y')"/></svg>`).code,
    ).toBe('UNSAFE_SVG')
    expect(
      rejection(`<svg viewBox="0 0 1 1"><rect style="fill:url(&quot;https://a.example/x)y&quot;)"/></svg>`)
        .code,
    ).toBe('UNSAFE_SVG')
  })

  it('avviser en url() som ikke er avsluttet, i stedet for å hoppe over den', () => {
    expect(rejection(`<svg viewBox="0 0 1 1"><rect fill="url('https://a.example/x"/></svg>`).code).toBe(
      'UNSAFE_SVG',
    )
  })

  it('godtar en intern referanse i anførselstegn', () => {
    expect(sanitized(`<svg viewBox="0 0 1 1"><rect fill="url('#g')"/></svg>`).markup).toContain(
      "url('#g')",
    )
  })

  it('avviser CSS-escapes, som kan skrive url() uten bokstavene i url', () => {
    // `\75 rl(...)` is `url(...)` to a CSS parser and something else entirely to
    // anything looking for the letters. The escape mechanism is refused whole.
    expect(
      rejection(`<svg viewBox="0 0 1 1"><rect fill="\\75 rl('https://a.example/x')"/></svg>`).code,
    ).toBe('UNSAFE_SVG')
    expect(
      rejection(`<svg viewBox="0 0 1 1"><rect style="fill:\\75 rl(#g)"/></svg>`).code,
    ).toBe('UNSAFE_SVG')
  })

  it('avviser CSS-funksjoner som henter noe uten å bruke url()', () => {
    // `image-set()` takes a bare string, so a url()-scanner never sees it.
    expect(
      rejection(
        `<svg viewBox="0 0 1 1"><rect style="fill:image-set(&quot;https://a.example/x.png&quot; 1x)"/></svg>`,
      ).code,
    ).toBe('UNSAFE_SVG')
    expect(
      rejection(`<svg viewBox="0 0 1 1"><rect fill="image(&quot;https://a.example/x.png&quot;)"/></svg>`)
        .code,
    ).toBe('UNSAFE_SVG')
    expect(
      rejection(`<svg viewBox="0 0 1 1"><rect style="fill:cross-fade(url(#a), url(#b))"/></svg>`).code,
    ).toBe('UNSAFE_SVG')
  })

  it('avviser <style>, som ikke kan valideres uten en CSS-parser', () => {
    const error = rejection(
      `<svg viewBox="0 0 1 1"><style>rect { fill: red }</style><rect width="1" height="1"/></svg>`,
    )
    expect(error.code).toBe('INVALID_SVG')
    expect(error.message).toContain('presentasjonsattributter')
  })

  it('avviser egne entiteter, som er hvordan en SVG blir en entitetsbombe', () => {
    const bomb = `<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa">]><svg viewBox="0 0 1 1"><text>&a;</text></svg>`
    expect(rejection(bomb).code).toBe('UNSAFE_SVG')
  })

  it('avviser et fremmed navnerom på roten', () => {
    expect(rejection(`<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 1 1"/>`).code).toBe(
      'UNSAFE_SVG',
    )
  })
})

describe('sanitizeSvg – ugyldig markup avvises', () => {
  it('avviser noe som ikke er SVG', () => {
    expect(rejection('<html><body>hei</body></html>').code).toBe('INVALID_SVG')
    expect(rejection('bare tekst').code).toBe('INVALID_SVG')
    expect(rejection('   ').code).toBe('INVALID_SVG')
  })

  it('avviser tagger som ikke er lukket', () => {
    expect(rejection('<svg viewBox="0 0 1 1"><rect>').code).toBe('INVALID_SVG')
    expect(rejection('<svg viewBox="0 0 1 1"><rect/></svgg>').code).toBe('INVALID_SVG')
  })

  it('avviser en SVG uten kjent størrelsesforhold', () => {
    expect(rejection('<svg><rect width="1" height="1"/></svg>').code).toBe('INVALID_SVG')
    expect(rejection('<svg width="100%" height="100%"><rect/></svg>').code).toBe('INVALID_SVG')
  })

  it('avviser ukjente entiteter', () => {
    expect(rejection('<svg viewBox="0 0 1 1"><text>&nbsp;</text></svg>').code).toBe('INVALID_SVG')
  })
})

describe('sanitizeSvg – fjerning', () => {
  it('fjerner ukjente elementer og rapporterer dem', () => {
    const result = sanitized(`<svg viewBox="0 0 1 1"><rect width="1" height="1"/><blink/></svg>`)
    expect(result.markup).not.toContain('blink')
    expect(result.markup).toContain('<rect')
    expect(result.report.removedElements).toEqual(['blink'])
  })

  it('fjerner ukjente attributter og rapporterer dem', () => {
    const result = sanitized(`<svg viewBox="0 0 1 1"><rect width="1" height="1" data-spor="ja"/></svg>`)
    expect(result.markup).not.toContain('data-spor')
    expect(result.report.removedAttributes).toEqual(['rect@data-spor'])
  })

  it('fjerner kommentarer og prosesseringsinstruksjoner', () => {
    const result = sanitized(
      `<?xml version="1.0"?><!-- laget av en agent --><svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>`,
    )
    expect(result.markup).not.toContain('<!--')
    expect(result.markup).not.toContain('<?xml')
  })

  it('normaliserer svg:-prefikset', () => {
    const result = sanitized(`<svg:svg viewBox="0 0 1 1"><svg:rect width="1" height="1"/></svg:svg>`)
    expect(result.markup).toContain('<rect')
    expect(result.markup).not.toContain('svg:rect')
  })
})

describe('looksLikeSvg', () => {
  it('kjenner igjen markup uten å validere den', () => {
    expect(looksLikeSvg('<svg viewBox="0 0 1 1"/>')).toBe(true)
    expect(looksLikeSvg('<div/>')).toBe(false)
  })
})
