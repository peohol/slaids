import { z } from 'zod'
import type { Reference } from '../domain/types'

type ReferenceMetadata = Omit<Reference, 'id'>

export type ReferenceIdentifier = { kind: 'doi' | 'pmid'; value: string }

/** Vertsnavn der stien er selve identifikatoren. */
const IDENTIFIER_HOSTS: Readonly<Record<string, ReferenceIdentifier['kind']>> = {
  'doi.org': 'doi',
  'dx.doi.org': 'doi',
  'www.doi.org': 'doi',
  'pubmed.ncbi.nlm.nih.gov': 'pmid',
}

/** Den eldre PubMed-adressen, `www.ncbi.nlm.nih.gov/pubmed/<PMID>`. */
const LEGACY_PUBMED_HOSTS = new Set(['www.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov'])

/** En lenke som skrives uten `https://`, men likevel er entydig. */
const SCHEMELESS_LINK = /^(?:(?:www\.|dx\.)?doi\.org|pubmed\.ncbi\.nlm\.nih\.gov|(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed)\//i

export function parseReferenceIdentifier(input: string): ReferenceIdentifier | null {
  let value = input.trim()
  let expectedKind: ReferenceIdentifier['kind'] | undefined
  if (value.length > 512) return null
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const path = decodeURIComponent(url.pathname.slice(1))
      const legacyPubmed = LEGACY_PUBMED_HOSTS.has(url.hostname) ? /^pubmed\/(\d+)\/?$/.exec(path) : null
      expectedKind = legacyPubmed ? 'pmid' : IDENTIFIER_HOSTS[url.hostname]
      if (!expectedKind) return null
      value = legacyPubmed ? legacyPubmed[1] : expectedKind === 'pmid' ? path.replace(/\/$/, '') : path
    } catch {
      return null
    }
  }

  const doi = value.replace(/^doi\s*:\s*/i, '')
  if (
    expectedKind !== 'pmid' &&
    /^10\.\d{4,9}\/\S+$/.test(doi) &&
    !/^10\.\d+\/\.{1,2}$/.test(doi)
  ) {
    return { kind: 'doi', value: doi }
  }

  const pmid = value.replace(/^(?:pmid|pubmed(?:\s*id)?)\s*:\s*/i, '')
  return expectedKind !== 'doi' && /^[1-9]\d{0,8}$/.test(pmid) ? { kind: 'pmid', value: pmid } : null
}

/**
 * En DOI- eller PubMed-*lenke*, ikke en løs identifikator.
 *
 * Brukes der lenken står i vanlig tekst: et tall eller en `10.`-streng midt i en
 * setning er ikke en bestilling av en referanse, men en adresse til doi.org
 * eller PubMed er det. Adressen kan skrives med eller uten `https://`.
 */
export function parseReferenceLink(input: string): ReferenceIdentifier | null {
  const value = input.trim()
  if (/^https?:\/\//i.test(value)) return parseReferenceIdentifier(value)
  return SCHEMELESS_LINK.test(value) ? parseReferenceIdentifier(`https://${value}`) : null
}

/**
 * Det som skiller lenkene i en liste: mellomrom, eller komma og semikolon rett
 * foran neste lenke. Et semikolon inne i en eldre DOI står ikke foran en
 * lenke og skiller derfor ingenting.
 */
const LINK_SEPARATOR = new RegExp(
  `\\s+|[,;](?=https?:\\/\\/|${SCHEMELESS_LINK.source.slice(1)})`,
  'i',
)

/**
 * Alle lenkene i en innlimt tekst, eller `null` hvis teksten er noe annet.
 *
 * Teksten må bestå av lenker og skilletegn alene. Et avsnitt som tilfeldigvis
 * inneholder en lenke, limes inn som det er. Tegnsetting etter den siste
 * lenken – punktumet i «… https://doi.org/10.1234/x.» – hører til setningen og
 * kommer tilbake som `rest`, så den kan stå etter citation-nummeret.
 */
export function parseReferenceLinks(input: string): { identifiers: ReferenceIdentifier[]; rest: string } | null {
  const tokens = input
    .split(LINK_SEPARATOR)
    .filter((token) => token && !/^[,;]+$/.test(token))
  if (tokens.length === 0) return null
  const identifiers: ReferenceIdentifier[] = []
  let rest = ''
  for (const [index, token] of tokens.entries()) {
    // Skilletegnene står mellom lenkene. En eldre DOI kan selv inneholde `;`,
    // så de tas bare i kantene av hver lenke.
    const split = splitTrailingPunctuation(token.replace(/^[,;]+/, ''))
    const last = index === tokens.length - 1
    const identifier = parseReferenceLink(split.link)
    if (!identifier || (!last && !/^[,;]*$/.test(split.rest))) return null
    identifiers.push(identifier)
    if (last) rest = split.rest
  }
  return { identifiers, rest }
}

const TRAILING_PUNCTUATION = /[.,;:!?'"»”’\]}]$/

/**
 * Skiller en lenke i løpende tekst fra tegnsettingen etter den.
 *
 * «… se https://doi.org/10.1/abc). Neste» skal gi lenken uten `).`, men en DOI
 * kan selv inneholde parenteser – `10.1016/S0140-6736(20)30183-5` – så en
 * avsluttende `)` hører til lenken så lenge den lukker en parentes i den.
 */
export function splitTrailingPunctuation(token: string): { link: string; rest: string } {
  let link = token
  for (;;) {
    const last = link.at(-1)
    if (!last) break
    const unbalanced = last === ')' && link.split(')').length > link.split('(').length
    if (!unbalanced && !TRAILING_PUNCTUATION.test(last)) break
    link = link.slice(0, -1)
  }
  return { link, rest: token.slice(link.length) }
}

/** Nøkkelen to referanser til samme verk deler. DOI-er skiller ikke store og små bokstaver. */
export function identifierKey(identifier: ReferenceIdentifier): string {
  return `${identifier.kind}:${identifier.value.toLowerCase()}`
}

/** Lenken en referanse lagres med. */
export function identifierUrl(identifier: ReferenceIdentifier): string {
  return identifier.kind === 'doi' ? doiUrl(identifier.value) : `https://pubmed.ncbi.nlm.nih.gov/${identifier.value}/`
}

function doiUrl(doi: string): string {
  return `https://doi.org/${encodeURIComponent(doi).replace('%2F', '/')}`
}

const crossrefDate = z.object({ 'date-parts': z.array(z.array(z.number().nullable())) }).nullish()
const crossrefResponse = z.object({
  message: z.object({
    title: z.array(z.string()).optional(),
    author: z.array(z.object({
      given: z.string().optional(),
      family: z.string().optional(),
      name: z.string().optional(),
    })).optional(),
    published: crossrefDate,
    issued: crossrefDate,
  }),
})

const dataCiteResponse = z.object({
  data: z.object({
    attributes: z.object({
      titles: z.array(z.object({ title: z.string() })).optional(),
      creators: z.array(z.object({
        name: z.string(),
        familyName: z.string().optional(),
        givenName: z.string().optional(),
      })).optional(),
      publicationYear: z.number().nullish(),
    }),
  }),
})

const europePmcResponse = z.object({
  resultList: z.object({
    result: z.array(z.object({
      id: z.string(),
      source: z.string(),
      doi: z.string().optional(),
      title: z.string().optional(),
      pubYear: z.string().optional(),
      authorString: z.string().optional(),
      authorList: z.object({
        author: z.array(z.object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          fullName: z.string().optional(),
          collectiveName: z.string().optional(),
        })),
      }).optional(),
    })),
  }),
})

function plainText(value = ''): string {
  // Et template-element tolker HTML-entiteter uten å kjøre eller laste inn innhold.
  const template = document.createElement('template')
  template.innerHTML = value
  return (template.content.textContent ?? '').trim()
}

function authorName(family?: string, given?: string, fallback = ''): string {
  return [family, given].filter(Boolean).join(', ') || fallback
}

function authorList(names: string[] = []): string {
  return names.map(plainText).filter(Boolean).join('; ')
}

async function requestJson(url: string | URL, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Oppslagstjenesten svarte med en feil.')
  return response.json() as Promise<unknown>
}

async function lookupDoi(doi: string, signal: AbortSignal): Promise<ReferenceMetadata | null> {
  const encoded = encodeURIComponent(doi)
  const resolverPath = encoded.replace('%2F', '/')
  const url = doiUrl(doi)
  const crossref = await requestJson(`https://api.crossref.org/works/${encoded}`, signal)
  if (crossref !== null) {
    const { message } = crossrefResponse.parse(crossref)
    const year = message.published?.['date-parts'][0]?.[0] ?? message.issued?.['date-parts'][0]?.[0]
    return {
      title: plainText(message.title?.[0]),
      authors: authorList(message.author?.map(({ family, given, name }) => authorName(family, given, name))),
      year: year == null ? '' : String(year),
      url,
    }
  }

  const dataCite = await requestJson(`https://api.datacite.org/dois/${resolverPath}`, signal)
  if (dataCite === null) return null
  const { attributes } = dataCiteResponse.parse(dataCite).data
  return {
    title: plainText(attributes.titles?.[0]?.title),
    authors: authorList(attributes.creators?.map(
      ({ familyName, givenName, name }) => authorName(familyName, givenName, name),
    )),
    year: attributes.publicationYear == null ? '' : String(attributes.publicationYear),
    url,
  }
}

async function lookupPmid(pmid: string, signal: AbortSignal): Promise<ReferenceMetadata | null> {
  const search = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search')
  search.search = new URLSearchParams({
    query: `EXT_ID:${pmid} AND SRC:MED`,
    format: 'json',
    resultType: 'core',
  }).toString()
  const response = await requestJson(search, signal)
  if (response === null) return null
  const { result } = europePmcResponse.parse(response).resultList
  const article = result.find(({ id, source }) => id === pmid && source === 'MED')
  if (!article) return null
  const authors = article.authorList?.author.map(
    ({ lastName, firstName, fullName, collectiveName }) =>
      collectiveName || authorName(lastName, firstName, fullName),
  )
  return {
    title: plainText(article.title),
    authors: authorList(authors) || plainText(article.authorString),
    year: article.pubYear ?? '',
    // DOI-lenken er den varige adressen til selve artikkelen, så den brukes når
    // PubMed kjenner den. Ellers lenkes det til PubMed-posten.
    url: identifierUrl(article.doi?.trim() ? { kind: 'doi', value: article.doi.trim() } : { kind: 'pmid', value: pmid }),
  }
}

export function lookupReferenceMetadata(
  identifier: ReferenceIdentifier,
  signal: AbortSignal,
): Promise<ReferenceMetadata | null> {
  const timedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  return identifier.kind === 'doi'
    ? lookupDoi(identifier.value, timedSignal)
    : lookupPmid(identifier.value, timedSignal)
}
