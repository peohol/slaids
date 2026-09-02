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

/** Everything Slaids is willing to draw. Case-sensitive, as SVG names are. */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'a',
  'title',
  'desc',
  'style',
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

/** `url(...)` targets, so each one can be checked on its own. */
const URL_FUNCTION = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi

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
      children.push(local === 'style' ? { text: checkStyleSheet(child.text) } : child)
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
  if (DANGEROUS_VALUE.test(value)) {
    throw unsafe(`Verdien til «${name}» peker på noe som ville blitt kjørt eller hentet.`)
  }

  checkUrlFunctions(name, value)
  if (name === 'href' || name === 'xlink:href') checkReference(name, value)

  return [name, value]
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

/** Every `url(...)` in a value must point inside this document. */
function checkUrlFunctions(name: string, value: string): void {
  for (const match of value.matchAll(URL_FUNCTION)) {
    const target = match[2].trim()
    if (!target.startsWith('#')) {
      throw unsafe(`«${name}» henter noe utenfor dokumentet: ${target || 'tom url()'}.`)
    }
  }
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

/** CSS inside `<style>` gets the same treatment as a style attribute. */
function checkStyleSheet(css: string): string {
  if (DANGEROUS_VALUE.test(css)) {
    throw unsafe('CSS-en i <style> henter eller kjører noe utenfor dokumentet.')
  }
  checkUrlFunctions('style', css)
  return css
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

/** A length in user units. Percentages have no intrinsic size and yield null. */
function parseLength(raw: string | null): number | null {
  if (raw === null) return null
  const match = /^\s*(-?[0-9]*\.?[0-9]+)\s*(px|pt|cm|mm|in|pc)?\s*$/i.exec(raw)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
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
