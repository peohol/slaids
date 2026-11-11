import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  identifierKey,
  identifierUrl,
  lookupReferenceMetadata,
  parseReferenceIdentifier,
  parseReferenceLink,
  parseReferenceLinks,
  splitTrailingPunctuation,
} from './referenceMetadata'

describe('parseReferenceLink', () => {
  it.each([
    ['https://doi.org/10.1234/abc', { kind: 'doi', value: '10.1234/abc' }],
    ['http://dx.doi.org/10.1234/abc', { kind: 'doi', value: '10.1234/abc' }],
    ['https://www.doi.org/10.1234/abc', { kind: 'doi', value: '10.1234/abc' }],
    ['doi.org/10.1234/abc', { kind: 'doi', value: '10.1234/abc' }],
    ['https://pubmed.ncbi.nlm.nih.gov/12345678/', { kind: 'pmid', value: '12345678' }],
    ['https://pubmed.ncbi.nlm.nih.gov/12345678/?from=search', { kind: 'pmid', value: '12345678' }],
    ['pubmed.ncbi.nlm.nih.gov/12345678', { kind: 'pmid', value: '12345678' }],
    ['https://www.ncbi.nlm.nih.gov/pubmed/12345678', { kind: 'pmid', value: '12345678' }],
    ['www.ncbi.nlm.nih.gov/pubmed/12345678/', { kind: 'pmid', value: '12345678' }],
  ])('kjenner igjen %s', (link, expected) => {
    expect(parseReferenceLink(link)).toEqual(expected)
  })

  it.each([
    '10.1234/abc',
    'doi:10.1234/abc',
    '12345678',
    'PMID: 12345678',
    'https://example.com/10.1234/abc',
    'https://pubmed.ncbi.nlm.nih.gov/ikke-et-tall/',
    'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/',
    'https://doi.org/',
  ])('godtar ikke %s som lenke', (text) => {
    expect(parseReferenceLink(text)).toBeNull()
  })

  it('lar referansedialogen fortsatt ta imot løse identifikatorer og den eldre PubMed-adressen', () => {
    expect(parseReferenceIdentifier('10.1234/abc')).toEqual({ kind: 'doi', value: '10.1234/abc' })
    expect(parseReferenceIdentifier('https://www.ncbi.nlm.nih.gov/pubmed/42')).toEqual({ kind: 'pmid', value: '42' })
  })
})

describe('parseReferenceLinks', () => {
  it('tar imot flere lenker skilt med mellomrom, komma, semikolon eller linjeskift', () => {
    expect(
      parseReferenceLinks(' https://doi.org/10.1000/a,\nhttps://pubmed.ncbi.nlm.nih.gov/7/ ; doi.org/10.2000/b '),
    ).toEqual([
      { kind: 'doi', value: '10.1000/a' },
      { kind: 'pmid', value: '7' },
      { kind: 'doi', value: '10.2000/b' },
    ])
  })

  it('beholder semikolon inne i en eldre DOI', () => {
    expect(parseReferenceLinks('https://doi.org/10.1002/(SICI)1097-4636(199709)36:3<347::AID-JBM10>3.0.CO;2-B')).toEqual([
      { kind: 'doi', value: '10.1002/(SICI)1097-4636(199709)36:3<347::AID-JBM10>3.0.CO;2-B' },
    ])
  })

  it('lar tekst med noe annet enn lenker være', () => {
    expect(parseReferenceLinks('Se https://doi.org/10.1000/a')).toBeNull()
    expect(parseReferenceLinks('   ')).toBeNull()
  })
})

describe('splitTrailingPunctuation', () => {
  it('skiller ut tegnsetting etter lenken', () => {
    expect(splitTrailingPunctuation('https://doi.org/10.1000/abc.')).toEqual({ link: 'https://doi.org/10.1000/abc', rest: '.' })
    expect(splitTrailingPunctuation('https://doi.org/10.1000/abc),')).toEqual({ link: 'https://doi.org/10.1000/abc', rest: '),' })
  })

  it('beholder parenteser som hører til selve DOI-en', () => {
    const doi = 'https://doi.org/10.1016/S0140-6736(20)30183-5'
    expect(splitTrailingPunctuation(doi)).toEqual({ link: doi, rest: '' })
    expect(splitTrailingPunctuation('https://doi.org/10.1000/a(b)')).toEqual({ link: 'https://doi.org/10.1000/a(b)', rest: '' })
    expect(splitTrailingPunctuation('https://doi.org/10.1000/a(b))')).toEqual({ link: 'https://doi.org/10.1000/a(b)', rest: ')' })
  })
})

describe('identifierKey og identifierUrl', () => {
  it('ser bort fra store og små bokstaver i DOI-er', () => {
    expect(identifierKey({ kind: 'doi', value: '10.1000/ABC' })).toBe(identifierKey({ kind: 'doi', value: '10.1000/abc' }))
  })

  it('lager lenkene referansene lagres med, og som leses tilbake til samme identifikator', () => {
    for (const identifier of [
      { kind: 'doi', value: '10.1016/S0140-6736(20)30183-5' },
      { kind: 'pmid', value: '12345678' },
    ] as const) {
      expect(parseReferenceIdentifier(identifierUrl(identifier))).toEqual(identifier)
    }
  })
})

describe('lookupReferenceMetadata for PubMed-ID', () => {
  afterEach(() => vi.unstubAllGlobals())

  const respond = (article: Record<string, unknown>): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ resultList: { result: [{ id: '42', source: 'MED', title: 'Artikkel', ...article }] } })),
      ),
    )
  }

  it('lagrer DOI-lenken når PubMed kjenner artikkelens DOI', async () => {
    respond({ doi: '10.1234/Studie' })
    const metadata = await lookupReferenceMetadata({ kind: 'pmid', value: '42' }, new AbortController().signal)
    expect(metadata?.url).toBe('https://doi.org/10.1234/Studie')
  })

  it('lenker til PubMed-posten når artikkelen ikke har noen DOI', async () => {
    respond({})
    const metadata = await lookupReferenceMetadata({ kind: 'pmid', value: '42' }, new AbortController().signal)
    expect(metadata?.url).toBe('https://pubmed.ncbi.nlm.nih.gov/42/')
  })
})
