/**
 * SVG as a first-class agent format.
 *
 * An agent can hand Slaids vector markup instead of a rendered picture, so this
 * module is the door that markup comes through — and the only one. It parses
 * the markup itself rather than leaning on a DOM: the same rules have to hold
 * in the browser, in a test runner and in whatever process ends up serving the
 * REST/MCP transport later, and `DOMParser` is not available in all three.
 *
 * Two things make this safe to store:
 *
 *  1. **Allowlist, not blocklist.** Elements and attributes that are not
 *     recognised are dropped, and the result is reported, so nothing unknown
 *     survives by being spelled in a way this file failed to anticipate.
 *  2. **Re-serialisation.** What gets stored is built from the parsed tree, not
 *     from the caller's string with pieces cut out of it. Anything the parser
 *     did not understand cannot make it into the file.
 *
 * Anything that looks like an attempt to execute code or reach the network is
 * rejected rather than quietly stripped: an agent that sent a `<script>` should
 * be told, not silently handed a different picture than it asked for.
 *
 * Rendering is unchanged by any of this — a stored SVG is still shown through
 * `<img>` and a Blob URL, never injected as markup — so this is defence in
 * depth, not the only line of defence.
 */

import { err, ok, type Result } from './result'

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
export const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
export const SVG_MIME_TYPE = 'image/svg+xml'

/** Bounds on the work one document may cost us. Neither is a stylistic rule. */
const MAX_DEPTH = 64
const MAX_ELEMENTS = 20_000

/* ------------------------------------------------------------------ *
 * Policy tables
 * ------------------------------------------------------------------ */

/**
 * Elements that carry or embed executable content. Their presence is a
 * decision by whoever wrote the markup, so it is answered with a refusal.
 */
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'handler',
  'annotation-xml',
  'html',
  'head',
  'body',
  'link',
  'meta',
  'base',
])

/**
 * Everything Slaids is willing to draw. Case-sensitive, as SVG names are.
 *
 * `<style>` is deliberately absent, so it is dropped and reported like any
 * other element this file cannot vouch for. A CSS document cannot be validated
 * to the standard the rest of this holds without a real CSS parser: `url` can
 * be written with escapes so the letters never appear, and functions like
 * `image-set()` carry a URL as a plain string with no `url()` around it.
 * Dropping it keeps a real-world export — Illustrator, Inkscape, matplotlib and
 * D3 all emit one — storable, and `report.removedElements` says it happened, so
 * a figure that comes back unstyled is never a silent surprise. Styling that
 * has to survive belongs in presentation attributes or `style="…"`, which are
 * validated one value at a time.
 */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'a',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'image',
  'marker',
  'clipPath',
  'mask',
  'pattern',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
])

/** Attributes Slaids is willing to keep, by exact name. */
const ALLOWED_ATTRIBUTES = new Set([
  // identity, grouping and transforms
  'id',
  'class',
  'style',
  'transform',
  'transform-origin',
  'lang',
  'xml:lang',
  'xml:space',
  'role',
  'aria-label',
  'aria-hidden',
  // root
  'xmlns',
  'xmlns:xlink',
  'version',
  'viewBox',
  'preserveAspectRatio',
  // painting
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'color',
  'opacity',
  'display',
  'visibility',
  'overflow',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'paint-order',
  'shape-rendering',
  'image-rendering',
  'text-rendering',
  'vector-effect',
  'mix-blend-mode',
  'isolation',
  'pointer-events',
  // geometry
  'd',
  'x',
  'y',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'pathLength',
  // text
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'word-spacing',
  'text-anchor',
  'text-decoration',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'direction',
  'unicode-bidi',
  'white-space',
  'writing-mode',
  'dx',
  'dy',
  'rotate',
  'textLength',
  'lengthAdjust',
  'startOffset',
  'side',
  'spacing',
  'method',
  // references
  'href',
  'xlink:href',
  // gradients, patterns, markers, clips and masks
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'fx',
  'fy',
  'fr',
  'offset',
  'stop-color',
  'stop-opacity',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'orient',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  // filters
  'filterUnits',
  'primitiveUnits',
  'in',
  'in2',
  'result',
  'mode',
  'type',
  'values',
  'operator',
  'radius',
  'stdDeviation',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'surfaceScale',
  'specularConstant',
  'specularExponent',
  'diffuseConstant',
  'kernelMatrix',
  'kernelUnitLength',
  'order',
  'divisor',
  'bias',
  'targetX',
  'targetY',
  'edgeMode',
  'preserveAlpha',
  'xChannelSelector',
  'yChannelSelector',
  'scale',
  'baseFrequency',
  'numOctaves',
  'seed',
  'stitchTiles',
  'tableValues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'azimuth',
  'elevation',
  'pointsAtX',
  'pointsAtY',
  'pointsAtZ',
  'limitingConeAngle',
  'z',
])

/**
 * Data URLs a reference may point at.
 *
 * Raster only: a nested `data:image/svg+xml` would be a second document with a
 * second set of rules, and one document is enough.
 */
const ALLOWED_DATA_URL = /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]*$/i

/** Anything in a value that would fetch or run something. */
const DANGEROUS_VALUE = /(javascript:|vbscript:|expression\s*\(|-moz-binding|@import|behavior\s*:)/i

/** Where a `url(` function starts. Its target is read by hand — see below. */
const URL_FUNCTION_START = /url\(/gi

/**
 * The CSS functions a value may call.
 *
 * An allowlist rather than a search for dangerous names, because the dangerous
 * set is open-ended: `image-set()`, `image()`, `cross-fade()`, `element()` and
 * whatever CSS adds next can all name an external resource, and several do it
 * with a bare string instead of `url()`. Anything not on this list is refused,
 * so a new CSS function cannot become a new hole by default.
 */
const ALLOWED_CSS_FUNCTIONS = new Set([
  // Written lowercase; the check lowercases the name it finds.
  // references into this document
  'url',
  // colour
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  // arithmetic and custom properties
  'calc',
  'min',
  'max',
  'clamp',
  'var',
  // basic shapes, for clip-path and friends
  'polygon',
  'circle',
  'ellipse',
  'inset',
  'rect',
  'xywh',
  'path',
  // filter shorthands
  'blur',
  'brightness',
  'contrast',
  'drop-shadow',
  'grayscale',
  'hue-rotate',
  'invert',
  'saturate',
  'sepia',
  // transforms
  'matrix',
  'matrix3d',
  'translate',
  'translatex',
  'translatey',
  'translate3d',
  'scale',
  'scalex',
  'scaley',
  'scale3d',
  'rotate',
  'rotatex',
  'rotatey',
  'rotatez',
  'rotate3d',
  'skew',
  'skewx',
  'skewy',
  'perspective',
])

/**
 * Attributes whose value is text or a name, never a CSS value.
 *
 * Nothing parses these as CSS, so reading them as CSS produces only false
 * refusals: `aria-label="Figur f(x)"` is a label, not a call to `f()`.
 */
const TEXT_VALUED_ATTRIBUTES = new Set([
  'aria-label',
  'aria-hidden',
  'role',
  'lang',
  'xml:lang',
  'xml:space',
  'id',
  'class',
])

/**
 * `ident(` — every function call in a value, whatever it turns out to be.
 *
 * No whitespace before the parenthesis, because CSS itself only reads a
 * function token when the `(` follows the name directly: `Figur (utkast)` in a
 * label is text, not a call to `Figur()`.
 */
const CSS_FUNCTION_CALL = /([A-Za-z_][A-Za-z0-9_-]*)\(/g

/* ------------------------------------------------------------------ *
 * Parsed shape
 * ------------------------------------------------------------------ */

interface SvgElementNode {
  name: string
  attributes: [string, string][]
  children: SvgNode[]
}

type SvgNode = SvgElementNode | { text: string }

function isElement(node: SvgNode): node is SvgElementNode {
  return 'name' in node
}

/** What the sanitiser dropped, so a caller can say so instead of guessing. */
export interface SvgSanitizeReport {
  removedElements: string[]
  removedAttributes: string[]
}

export interface SanitizedSvg {
  /** Re-serialised markup: this, and never the input, is what gets stored. */
  markup: string
  width: number
  height: number
  report: SvgSanitizeReport
}

class SvgRejection extends Error {
  constructor(
    readonly code: 'INVALID_SVG' | 'UNSAFE_SVG',
    message: string,
  ) {
    super(message)
    this.name = 'SvgRejection'
  }
}

const invalid = (message: string) => new SvgRejection('INVALID_SVG', message)
const unsafe = (message: string) => new SvgRejection('UNSAFE_SVG', message)

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */

/**
 * Validate, clean and re-serialise SVG markup.
 *
 * Fails with `INVALID_SVG` when the input is not a well-formed SVG document,
 * and with `UNSAFE_SVG` when it is well-formed but contains something that
 * would execute or fetch. Everything else is dropped and reported.
 */
export function sanitizeSvg(markup: string): Result<SanitizedSvg> {
  if (typeof markup !== 'string' || markup.trim().length === 0) {
    return err('INVALID_SVG', 'SVG-markupen er tom.')
  }

  const report: SvgSanitizeReport = { removedElements: [], removedAttributes: [] }
  try {
    const root = parseDocument(markup)
    if (localName(root.name) !== 'svg') {
      return err('INVALID_SVG', 'Rotelementet må være <svg>.')
    }

    const clean = cleanElement(root, report)
    if (!clean) return err('INVALID_SVG', 'Rotelementet må være <svg>.')

    withRootNamespace(clean)
    const size = resolveSize(clean)
    if (!size) {
      return err(
        'INVALID_SVG',
        'SVG-en må ha en viewBox eller width/height, ellers har den ikke noe kjent størrelsesforhold.',
      )
    }

    return ok({ markup: serialize(clean), width: size.width, height: size.height, report })
  } catch (error) {
    if (error instanceof SvgRejection) return err(error.code, error.message)
    throw error
  }
}

/** Is this string plausibly an SVG document at all? Cheap pre-check only. */
export function looksLikeSvg(markup: string): boolean {
  return /<svg[\s>/]/i.test(markup)
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

const NAME_START = /[A-Za-z_]/
const NAME_CHAR = /[-A-Za-z0-9_:.]/

function parseDocument(source: string): SvgElementNode {
  let index = 0
  let elements = 0
  const stack: SvgElementNode[] = []
  let root: SvgElementNode | null = null

  const push = (element: SvgElementNode): void => {
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(element)
    else if (root) throw invalid('Markupen har mer enn ett rotelement.')
    else root = element
  }

  while (index < source.length) {
    const next = source.indexOf('<', index)
    if (next < 0) {
      addText(stack, source.slice(index))
      break
    }
    if (next > index) addText(stack, source.slice(index, next))

    if (source.startsWith('<!--', next)) {
      const end = source.indexOf('-->', next + 4)
      if (end < 0) throw invalid('En kommentar er ikke avsluttet.')
      index = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', next)) {
      const end = source.indexOf(']]>', next + 9)
      if (end < 0) throw invalid('En CDATA-seksjon er ikke avsluttet.')
      addRawText(stack, source.slice(next + 9, end))
      index = end + 3
      continue
    }
    if (source.startsWith('<?', next)) {
      const end = source.indexOf('?>', next + 2)
      if (end < 0) throw invalid('En prosesseringsinstruksjon er ikke avsluttet.')
      index = end + 2
      continue
    }
    if (source.startsWith('<!', next)) {
      index = skipDoctype(source, next)
      continue
    }

    if (source.startsWith('</', next)) {
      const end = source.indexOf('>', next)
      if (end < 0) throw invalid('En sluttag er ikke avsluttet.')
      const name = source.slice(next + 2, end).trim()
      const open = stack.pop()
      if (!open || open.name !== name) {
        throw invalid(`Sluttagen </${name}> stemmer ikke med starttagen.`)
      }
      index = end + 1
      continue
    }

    const parsed = parseStartTag(source, next)
    elements += 1
    if (elements > MAX_ELEMENTS) throw invalid('SVG-en har for mange elementer.')
    push(parsed.element)
    if (!parsed.selfClosing) {
      stack.push(parsed.element)
      if (stack.length > MAX_DEPTH) throw invalid('SVG-en er nestet for dypt.')
    }
    index = parsed.end
  }

  if (stack.length > 0) throw invalid(`Elementet <${stack[stack.length - 1].name}> er ikke lukket.`)
  if (!root) throw invalid('Fant ingen elementer i markupen.')
  return root
}

/**
 * A doctype is dropped, but only after checking that it carries no internal
 * subset: `<!DOCTYPE svg [ <!ENTITY …> ]>` is how an SVG is turned into an
 * entity-expansion attack, and there is no legitimate use for one here.
 */
function skipDoctype(source: string, start: number): number {
  const end = source.indexOf('>', start)
  if (end < 0) throw invalid('En deklarasjon er ikke avsluttet.')
  const text = source.slice(start, end)
  if (text.includes('[') || /entity/i.test(text)) {
    throw unsafe('Doctype med egne entiteter er ikke tillatt.')
  }
  return end + 1
}

function parseStartTag(
  source: string,
  start: number,
): { element: SvgElementNode; selfClosing: boolean; end: number } {
  let index = start + 1
  if (!NAME_START.test(source[index] ?? '')) throw invalid('Ugyldig elementnavn.')
  let name = ''
  while (index < source.length && NAME_CHAR.test(source[index])) {
    name += source[index]
    index += 1
  }

  const attributes: [string, string][] = []
  const seen = new Set<string>()
  for (;;) {
    while (index < source.length && /\s/.test(source[index])) index += 1
    if (index >= source.length) throw invalid(`Starttagen <${name}> er ikke avsluttet.`)

    if (source.startsWith('/>', index)) {
      return { element: { name, attributes, children: [] }, selfClosing: true, end: index + 2 }
    }
    if (source[index] === '>') {
      return { element: { name, attributes, children: [] }, selfClosing: false, end: index + 1 }
    }

    if (!NAME_START.test(source[index])) throw invalid(`Ugyldig attributt i <${name}>.`)
    let attribute = ''
    while (index < source.length && NAME_CHAR.test(source[index])) {
      attribute += source[index]
      index += 1
    }
    while (index < source.length && /\s/.test(source[index])) index += 1
    if (source[index] !== '=') throw invalid(`Attributtet «${attribute}» mangler en verdi.`)
    index += 1
    while (index < source.length && /\s/.test(source[index])) index += 1

    const quote = source[index]
    if (quote !== '"' && quote !== "'") {
      throw invalid(`Verdien til «${attribute}» må stå i anførselstegn.`)
    }
    const close = source.indexOf(quote, index + 1)
    if (close < 0) throw invalid(`Verdien til «${attribute}» er ikke avsluttet.`)
    const value = decodeEntities(source.slice(index + 1, close))
    index = close + 1

    if (seen.has(attribute)) throw invalid(`Attributtet «${attribute}» er oppgitt flere ganger.`)
    seen.add(attribute)
    attributes.push([attribute, value])
  }
}

function addText(stack: SvgElementNode[], raw: string): void {
  addRawText(stack, decodeEntities(raw))
}

function addRawText(stack: SvgElementNode[], text: string): void {
  const parent = stack[stack.length - 1]
  if (!parent) {
    // Only whitespace may sit outside the root element.
    if (text.trim().length > 0) throw invalid('Det står tekst utenfor rotelementet.')
    return
  }
  parent.children.push({ text })
}

/**
 * The five XML entities and numeric character references, and nothing else.
 *
 * Refusing unknown entity names is what makes an entity-expansion document
 * impossible rather than merely unlikely.
 */
function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw
  return raw.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (!match.endsWith(';')) throw invalid('En entitet mangler semikolon.')
    const lower = body.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        throw invalid('En tegnreferanse er ugyldig.')
      }
      return String.fromCodePoint(code)
    }
    throw invalid(`Entiteten «&${body};» er ikke tillatt.`)
  })
}

/* ------------------------------------------------------------------ *
 * Cleaning
 * ------------------------------------------------------------------ */

/** `null` means the element itself is dropped, subtree and all. */
function cleanElement(element: SvgElementNode, report: SvgSanitizeReport): SvgElementNode | null {
  const local = localName(element.name)
  if (FORBIDDEN_ELEMENTS.has(local.toLowerCase())) {
    throw unsafe(`Elementet <${element.name}> er ikke tillatt i en SVG som lagres i Slaids.`)
  }
  if (!ALLOWED_ELEMENTS.has(local)) {
    record(report.removedElements, element.name)
    return null
  }

  const attributes: [string, string][] = []
  for (const [name, value] of element.attributes) {
    const kept = cleanAttribute(local, name, value, report)
    if (kept) attributes.push(kept)
  }

  const children: SvgNode[] = []
  for (const child of element.children) {
    if (!isElement(child)) {
      children.push(child)
      continue
    }
    const cleaned = cleanElement(child, report)
    if (cleaned) children.push(cleaned)
  }

  return { name: local, attributes, children }
}

function cleanAttribute(
  elementName: string,
  name: string,
  value: string,
  report: SvgSanitizeReport,
): [string, string] | null {
  if (/^on/i.test(name)) {
    throw unsafe(`Hendelsesattributtet «${name}» er ikke tillatt.`)
  }
  if (name === 'xmlns' || name.startsWith('xmlns:')) {
    return cleanNamespace(name, value, report)
  }
  if (!ALLOWED_ATTRIBUTES.has(name)) {
    record(report.removedAttributes, `${elementName}@${name}`)
    return null
  }
  checkValue(name, value)
  if (name === 'href' || name === 'xlink:href') checkReference(name, value)

  return [name, value]
}

/**
 * One attribute value, read as the CSS it may be.
 *
 * Three rules, in order of how much they rule out:
 *
 *  1. Nothing that names a scheme or an at-rule that fetches or runs.
 *  2. No backslash. A CSS escape lets `url(` be written without those letters
 *     (`\75 rl(…)`), so any pattern that looks for the name loses. No SVG a
 *     figure needs contains one, so the whole escape mechanism is refused
 *     rather than unescaped and re-checked.
 *  3. Every function call must be one this file knows, and a `url()` must point
 *     inside this document.
 */
function checkValue(name: string, value: string): void {
  if (DANGEROUS_VALUE.test(value)) {
    throw unsafe(`Verdien til «${name}» peker på noe som ville blitt kjørt eller hentet.`)
  }
  if (TEXT_VALUED_ATTRIBUTES.has(name)) return
  if (value.includes('\\')) {
    throw unsafe(`Verdien til «${name}» bruker CSS-escapes, som ikke er tillatt.`)
  }

  for (const match of value.matchAll(CSS_FUNCTION_CALL)) {
    // CSS function names are case-insensitive, so the comparison is too:
    // `RGB(…)` is legal and `IMAGE-SET(…)` must not slip through on spelling.
    if (!ALLOWED_CSS_FUNCTIONS.has(match[1].toLowerCase())) {
      throw unsafe(`Funksjonen «${match[1]}()» i «${name}» er ikke tillatt.`)
    }
  }
  checkUrlFunctions(name, value)
}

/**
 * Namespaces are how markup from another language is smuggled in, so only the
 * two that belong in an SVG survive, and only with their real values.
 */
function cleanNamespace(
  name: string,
  value: string,
  report: SvgSanitizeReport,
): [string, string] | null {
  if (name === 'xmlns') {
    if (value !== SVG_NAMESPACE) throw unsafe('Rotelementet må bruke SVG-navnerommet.')
    return [name, value]
  }
  if (name === 'xmlns:xlink') {
    if (value !== XLINK_NAMESPACE) throw unsafe('xmlns:xlink må peke på xlink-navnerommet.')
    return [name, value]
  }
  record(report.removedAttributes, `@${name}`)
  return null
}

/**
 * Every `url(...)` in a value must point inside this document.
 *
 * Read by hand rather than by one regular expression, because a quoted target
 * may contain the closing parenthesis — `url('https://a.example/x)y')` — and a
 * pattern that stops at the first `)` simply fails to match it, which would let
 * the reference through instead of rejecting it. A `url(` this cannot read to
 * the end is refused rather than skipped.
 */
function checkUrlFunctions(name: string, value: string): void {
  for (const match of value.matchAll(URL_FUNCTION_START)) {
    const target = readUrlTarget(name, value, (match.index ?? 0) + match[0].length)
    if (!target.startsWith('#')) {
      throw unsafe(`«${name}» henter noe utenfor dokumentet: ${target || 'tom url()'}.`)
    }
  }
}

/** The target of one `url(`, starting just after the parenthesis. */
function readUrlTarget(name: string, value: string, start: number): string {
  let index = start
  while (index < value.length && /\s/.test(value[index])) index += 1

  const quote = value[index]
  if (quote === '"' || quote === "'") {
    const close = value.indexOf(quote, index + 1)
    if (close < 0) throw unsafe(`«${name}» har en url() som ikke er avsluttet.`)
    const target = value.slice(index + 1, close).trim()
    index = close + 1
    while (index < value.length && /\s/.test(value[index])) index += 1
    if (value[index] !== ')') throw unsafe(`«${name}» har en url() som ikke er avsluttet.`)
    return target
  }

  const close = value.indexOf(')', index)
  if (close < 0) throw unsafe(`«${name}» har en url() som ikke er avsluttet.`)
  return value.slice(index, close).trim()
}

/** A reference is either into this document or an inline raster image. */
function checkReference(name: string, value: string): void {
  const target = value.trim()
  if (target.startsWith('#')) return
  if (ALLOWED_DATA_URL.test(target)) return
  throw unsafe(
    `«${name}» må peke på et id-anker i samme fil eller på et innebygd rasterbilde, ikke «${target}».`,
  )
}

function localName(name: string): string {
  const colon = name.indexOf(':')
  if (colon < 0) return name
  // `<svg:rect>` is the same element as `<rect>`; any other prefix belongs to
  // another language and falls through to the allowlist, which drops it.
  return name.slice(0, colon) === 'svg' ? name.slice(colon + 1) : name
}

function record(list: string[], entry: string): void {
  if (!list.includes(entry)) list.push(entry)
}

/* ------------------------------------------------------------------ *
 * Size and serialisation
 * ------------------------------------------------------------------ */

function withRootNamespace(root: SvgElementNode): void {
  if (!root.attributes.some(([name]) => name === 'xmlns')) {
    // Without this an `<img src="blob:…">` renders nothing at all, so it is
    // added rather than demanded of the caller.
    root.attributes.unshift(['xmlns', SVG_NAMESPACE])
  }
}

function attributeOf(element: SvgElementNode, name: string): string | null {
  return element.attributes.find(([key]) => key === name)?.[1] ?? null
}

/**
 * Absolute CSS lengths in px, which is the unit user units are drawn in.
 *
 * The unit is converted rather than ignored: `width="2in" height="96px"` is a
 * 2:1 picture, and reading both numbers as user units would call it square and
 * stretch it into whatever zone it was given.
 */
const CSS_PX_PER_UNIT: Record<string, number> = {
  px: 1,
  in: 96,
  pt: 96 / 72,
  pc: 96 / 6,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
}

/**
 * A length in px. Percentages and font-relative units have no intrinsic size of
 * their own, so they yield null and the viewBox decides instead.
 */
function parseLength(raw: string | null): number | null {
  if (raw === null) return null
  const match = /^\s*(-?[0-9]*\.?[0-9]+)\s*([a-z]*)\s*$/i.exec(raw)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = match[2].toLowerCase()
  const scale = unit === '' ? 1 : CSS_PX_PER_UNIT[unit]
  return scale ? value * scale : null
}

/**
 * The size the picture will be drawn at.
 *
 * An explicit width and height win; otherwise the viewBox decides, which is the
 * usual case for generated markup. A document with neither is refused by the
 * caller: Slaids lays out pictures by their aspect ratio, and one without a
 * known ratio would be placed by guesswork.
 */
function resolveSize(root: SvgElementNode): { width: number; height: number } | null {
  const width = parseLength(attributeOf(root, 'width'))
  const height = parseLength(attributeOf(root, 'height'))
  if (width && height) return { width, height }

  const viewBox = attributeOf(root, 'viewBox')
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((part) => Number.isFinite(part))) {
      const [, , boxWidth, boxHeight] = parts
      if (boxWidth > 0 && boxHeight > 0) return { width: boxWidth, height: boxHeight }
    }
  }
  return null
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function serialize(element: SvgElementNode): string {
  const attributes = element.attributes
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('')
  if (element.children.length === 0) return `<${element.name}${attributes}/>`
  const inner = element.children
    .map((child) => (isElement(child) ? serialize(child) : escapeText(child.text)))
    .join('')
  return `<${element.name}${attributes}>${inner}</${element.name}>`
}
