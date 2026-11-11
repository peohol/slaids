import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { createPresentation } from '../../domain/presentation'
import { addReference, updateReference } from '../../domain/commands'
import { ok } from '../../domain/result'
import type { Presentation, RichDoc } from '../../domain/types'
import { useEditorStore } from '../../state/store'
import { useReferenceImports } from '../../state/referenceImport'
import { useToasts } from '../../state/toast'
import { bodyExtensions, titleExtensions } from './extensions'
import { trailingReferenceLink } from './ReferenceLinkExtension'

const DOI = 'https://doi.org/10.1234/studie'
const PUBMED = 'https://pubmed.ncbi.nlm.nih.gov/42/'

/** Et svar som kommer først når testen slipper det. */
function deferredFetch(): { release: (body: unknown, status?: number) => void; calls: string[] } {
  const calls: string[] = []
  let resolvers: ((response: Response) => void)[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL) => {
      calls.push(String(url))
      return new Promise<Response>((resolve) => resolvers.push(resolve))
    }),
  )
  return {
    calls,
    release: (body, status = 200) => {
      for (const resolve of resolvers) resolve(new Response(status === 404 ? null : JSON.stringify(body), { status }))
      resolvers = []
    },
  }
}

const crossref = {
  message: { title: ['Studie av søvn'], author: [{ given: 'Anna', family: 'Hansen' }], published: { 'date-parts': [[2023]] } },
}

const mounted: Editor[] = []

function editor(variant: 'body' | 'title' = 'body'): Editor {
  const element = document.createElement('div')
  document.body.append(element)
  const instance = new Editor({
    element,
    extensions: variant === 'body' ? bodyExtensions() : titleExtensions(),
    content: '<p></p>',
  })
  mounted.push(instance)
  return instance
}

function type(instance: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = instance.state.selection
    const view = instance.view
    const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, character, () => view.state.tr))
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
  }
}

function paste(instance: Editor, text: string): boolean {
  const view = instance.view
  const event = { clipboardData: { getData: (kind: string) => (kind === 'text/plain' ? text : '') } } as unknown as ClipboardEvent
  const slice = new Slice(Fragment.from(view.state.schema.text(text)), 0, 0)
  return view.someProp('handlePaste', (handler) => handler(view, event, slice)) ?? false
}

function pressEnter(instance: Editor): void {
  const view = instance.view
  const event = new KeyboardEvent('keydown', { key: 'Enter' })
  view.someProp('handleKeyDown', (handler) => handler(view, event))
}

/** Avsnittene i dokumentet, med citations skrevet som `[id,id]`. */
function lines(instance: Editor): string[] {
  const doc = instance.getJSON() as RichDoc
  return (doc.content ?? []).map((block) =>
    (block.content ?? [])
      .map((node) => (node.type === 'citation' ? `[${(node.attrs?.referenceIds as string[]).join(',')}]` : node.text ?? ''))
      .join(''),
  )
}

const references = (): Presentation['references'] => useEditorStore.getState().presentation?.references ?? []
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  useEditorStore.getState().setPresentation(createPresentation({ title: 'Lenker' }))
  useReferenceImports.setState({ pending: new Set() })
  useToasts.setState({ toasts: [] })
})

afterEach(() => {
  for (const instance of mounted.splice(0)) instance.destroy()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('innlimt DOI- eller PubMed-lenke', () => {
  it('blir straks et citation-nummer festet til ordet foran, og hentes i bakgrunnen', async () => {
    const lookup = deferredFetch()
    const instance = editor()
    type(instance, 'Søvn bedrer læring ')
    expect(paste(instance, ` ${DOI}\n`)).toBe(true)

    const [reference] = references()
    expect(reference).toMatchObject({ title: '', authors: '', year: '', url: DOI })
    expect(lines(instance)).toEqual([`Søvn bedrer læring[${reference.id}]`])
    expect(useReferenceImports.getState().pending.has(reference.id)).toBe(true)
    expect(lookup.calls[0]).toBe('https://api.crossref.org/works/10.1234%2Fstudie')

    // Brukeren skriver videre mens oppslaget pågår.
    type(instance, ' og hukommelse')
    lookup.release(crossref)
    await flush()

    expect(references()).toEqual([{ id: reference.id, title: 'Studie av søvn', authors: 'Hansen, Anna', year: '2023', url: DOI }])
    expect(useReferenceImports.getState().pending.size).toBe(0)
    expect(lines(instance)).toEqual([`Søvn bedrer læring[${reference.id}] og hukommelse`])
  })

  it('setter mellomrom på den andre siden når den limes inn mellom to ord', () => {
    deferredFetch()
    const instance = editor()
    type(instance, 'før etter')
    instance.commands.setTextSelection(5)
    paste(instance, PUBMED)
    const [reference] = references()
    expect(lines(instance)).toEqual([`før[${reference.id}] etter`])
  })

  it('gjør flere lenker til ett citation-nummer, og gjenbruker en referanse som finnes', () => {
    deferredFetch()
    const existing = addReference(useEditorStore.getState().presentation as Presentation, {
      title: 'Kjent',
      authors: '',
      year: '',
      url: 'https://doi.org/10.1234/STUDIE',
    })
    if (!existing.ok) throw new Error('oppsett')
    useEditorStore.getState().setPresentation(existing.value.presentation)

    const instance = editor()
    type(instance, 'Tekst')
    paste(instance, `${DOI}, ${PUBMED}`)
    const [known, created] = references()
    expect(known.id).toBe(existing.value.reference.id)
    expect(references()).toHaveLength(2)
    expect(lines(instance)).toEqual([`Tekst[${known.id},${created.id}]`])
    expect(useReferenceImports.getState().pending).toEqual(new Set([created.id]))
  })

  it('slår seg sammen med et citation-nummer som står rett foran', () => {
    deferredFetch()
    const instance = editor()
    type(instance, 'Tekst ')
    paste(instance, DOI)
    type(instance, ' ')
    paste(instance, PUBMED)
    const ids = references().map(({ id }) => id)
    expect(lines(instance)).toEqual([`Tekst[${ids.join(',')}]`])
  })

  it('lar vanlig tekst og andre lenker være', () => {
    deferredFetch()
    const instance = editor()
    expect(paste(instance, `Se ${DOI}`)).toBe(false)
    expect(paste(instance, 'https://example.com/10.1234/x')).toBe(false)
    expect(paste(instance, '10.1234/studie')).toBe(false)
    expect(references()).toHaveLength(0)
  })

  it('beholder lenken og varsler når oppslaget ikke finner noe', async () => {
    const lookup = deferredFetch()
    const instance = editor()
    paste(instance, DOI)
    lookup.release(null, 404)
    await flush()
    lookup.release(null, 404)
    await flush()
    expect(references()).toMatchObject([{ title: '', url: DOI }])
    expect(useReferenceImports.getState().pending.size).toBe(0)
    expect(useToasts.getState().toasts.map(({ tone }) => tone)).toEqual(['warning'])
  })

  it('overskriver ikke opplysninger brukeren rakk å skrive inn selv', async () => {
    const lookup = deferredFetch()
    const instance = editor()
    paste(instance, DOI)
    const [reference] = references()
    useEditorStore.getState().run('reference-update', (presentation) =>
      updateReference(presentation, reference.id, { ...reference, title: 'Min tittel' }),
    )
    lookup.release(crossref)
    await flush()
    expect(references()).toMatchObject([{ title: 'Min tittel', authors: '' }])
  })
})

describe('skrevet DOI- eller PubMed-lenke', () => {
  it('blir et citation-nummer når den avsluttes med mellomrom, og tegnsetting blir stående', () => {
    deferredFetch()
    const instance = editor()
    type(instance, `Som vist (${PUBMED}). Videre`)
    const [reference] = references()
    expect(lines(instance)).toEqual([`Som vist ([${reference.id}]). Videre`])
  })

  it('festes til ordet foran, og skrivingen fortsetter etter mellomrommet', () => {
    deferredFetch()
    const instance = editor('title')
    type(instance, `Søvn ${DOI} og mer`)
    const [reference] = references()
    expect(lines(instance)).toEqual([`Søvn[${reference.id}] og mer`])
  })

  it('blir et citation-nummer når linjeskiftet avslutter den', () => {
    deferredFetch()
    const instance = editor()
    type(instance, `Søvn ${DOI}`)
    pressEnter(instance)
    const [reference] = references()
    expect(lines(instance)[0]).toBe(`Søvn[${reference.id}]`)
  })

  it('ser bort fra en lenke som ikke slutter ved markøren', () => {
    expect(trailingReferenceLink(`${DOI} og`)).toBeNull()
    expect(trailingReferenceLink(`(${DOI}).`)).toEqual({
      identifier: { kind: 'doi', value: '10.1234/studie' },
      start: 1,
      length: DOI.length,
    })
  })
})

describe('angrehistorikken', () => {
  it('får ikke et eget steg for opplysningene, og et angret steg viser dem også', async () => {
    const lookup = deferredFetch()
    const instance = editor()
    type(instance, 'Tekst ')
    paste(instance, DOI)
    // Skrivingen etterpå er et eget steg (editoren er ikke koblet til lageret her).
    useEditorStore.getState().run('typing:test', (presentation) => ok({ ...presentation, title: 'Skrevet videre' }))
    const past = useEditorStore.getState().past.length
    lookup.release(crossref)
    await flush()
    expect(useEditorStore.getState().past).toHaveLength(past)

    // Tilbake til før skrivingen: referansen er fortsatt der, ferdig utfylt.
    useEditorStore.getState().undo()
    useEditorStore.getState().settleHistory()
    expect(references()).toMatchObject([{ title: 'Studie av søvn' }])
  })
})
