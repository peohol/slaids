import { z } from 'zod'
import type { Reference } from '../domain/types'

type ReferenceMetadata = Omit<Reference, 'id'>

type ReferenceIdentifier = { kind: 'doi' | 'pmid'; value: string }

export function parseReferenceIdentifier(input: string): ReferenceIdentifier | null {
  let value = input.trim()
  let expectedKind: ReferenceIdentifier['kind'] | undefined
  if (value.length > 512) return null
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const path = decodeURIComponent(url.pathname.slice(1))
      if (url.hostname === 'doi.org' || url.hostname === 'dx.doi.org') {
        expectedKind = 'doi'
        value = path
      } else if (url.hostname === 'pubmed.ncbi.nlm.nih.gov') {
        expectedKind = 'pmid'
        value = path.replace(/\/$/, '')
      } else {
        return null
      }
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
  const url = `https://doi.org/${resolverPath}`
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
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
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
