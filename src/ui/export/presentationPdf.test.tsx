import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toCanvas } from 'html-to-image'
import { createImage, createUntitledCard } from '../../domain/content'
import { fontStackFor } from '../../domain/fonts'
import { createLeaf } from '../../domain/layout'
import { createPresentation } from '../../domain/presentation'
import { contentAt } from '../../domain/testDecks'
import { realImageBase64 } from '../../domain/testImages'
import type { Presentation } from '../../domain/types'
import { DEFAULT_USER_SETTINGS } from '../../domain/userSettings'
import { inlineFontFaces } from '../../fonts/inlineFaces'
import type { SlaidsRepository } from '../../persistence/repository'
import { exportPresentationPdf } from './presentationPdf'

// Her brukes en ekte PNG og ekte PDF-skriving, mens selve DOM-fotograferingen
// erstattes fordi jsdom ikke tegner. Nettlesertesten kontrollerer nedlastingen.
vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }))
vi.mock('../../fonts/inlineFaces', () => ({ inlineFontFaces: vi.fn() }))

function deck(): Presentation {
  return createPresentation({
    title: 'PDF-test',
    theme: { headingFontFamily: fontStackFor('system'), bodyFontFamily: fontStackFor('system') },
  })
}

function repository(presentation = deck()) {
  const methods = {
    loadPresentation: vi.fn().mockResolvedValue(presentation),
    getUserSettings: vi.fn().mockResolvedValue(DEFAULT_USER_SETTINGS),
    getAsset: vi.fn().mockResolvedValue(null),
  }
  return { methods, value: methods as unknown as SlaidsRepository }
}

beforeEach(() => {
  vi.mocked(inlineFontFaces).mockResolvedValue({ css: '', missing: [] })
  vi.mocked(toCanvas).mockImplementation(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 3
    canvas.height = 2
    canvas.toDataURL = () => `data:image/png;base64,${realImageBase64.png}`
    return canvas
  })
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve(), load: vi.fn().mockResolvedValue([]), check: () => true },
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  )
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
})

afterEach(() => {
  expect(document.querySelector('[data-slaids-pdf]')).toBeNull()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('PDF-eksport', () => {
  it('skriver én 16:9-side per dekkside, henter riktige eierinnstillinger og rydder flaten', async () => {
    const store = repository()
    const progress = vi.fn()
    const canvases: HTMLCanvasElement[] = []
    const photograph = vi.mocked(toCanvas).getMockImplementation()!
    vi.mocked(toCanvas).mockImplementation(async (node, options) => {
      expect(node.querySelector('.deck-page')).not.toBeNull()
      const canvas = await photograph(node, options)
      canvases.push(canvas)
      return canvas
    })

    const result = await exportPresentationPdf(store.value, 'dekk', {
      ownerId: 'eier',
      onProgress: progress,
    })
    const pdf = new TextDecoder().decode(await result.arrayBuffer())
    expect(result.type).toBe('application/pdf')
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2)
    expect(pdf.match(/\/MediaBox \[0 0 1200\. 675\.\]/g)).toHaveLength(2)
    expect(store.methods.getUserSettings).toHaveBeenCalledWith('eier')
    expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]])
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
  })

  it('tegner brukerens forfatter–år-henvisning og teller referansesiden med når det er valgt', async () => {
    const presentation = deck()
    const card = createUntitledCard()
    card.body.subfields[0].doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Påstand' },
        { type: 'citation', attrs: { referenceIds: ['r1'] } },
      ] }],
    }
    contentAt(presentation, 1).root = createLeaf(card)
    presentation.references = [{ id: 'r1', title: 'Kilde', authors: 'Hansen', year: '2026', url: '' }]
    const store = repository(presentation)
    store.methods.getUserSettings.mockResolvedValue({
      ...DEFAULT_USER_SETTINGS,
      citationStyle: 'author-year',
      includeReferencesInProgress: true,
    })
    const photograph = vi.mocked(toCanvas).getMockImplementation()!
    const text: string[] = []
    const progress: string[] = []
    vi.mocked(toCanvas).mockImplementation(async (node, options) => {
      text.push(node.textContent ?? '')
      progress.push(node.querySelector<HTMLElement>('.slide-progress__fill')?.style.width ?? '')
      return photograph(node, options)
    })

    await exportPresentationPdf(store.value, 'dekk')
    expect(text).toHaveLength(3)
    expect(text[1]).toContain('Hansen, 2026')
    expect(text[2]).toContain('Kilde')
    expect(progress).toEqual(['', '50%', '100%'])
  })

  it('bevarer nøyaktige beregnede skriftstørrelser også med desimaler', async () => {
    const presentation = deck()
    presentation.theme.fontScale = 1.137
    const store = repository(presentation)
    // Brøkstørrelser oppstår blant annet i relative tekststiler og når en
    // tittel settes mindre. En eksplisitt stil gjør dette målbart i jsdom,
    // som ikke beregner rendererens calc-uttrykk med CSS-variabler.
    const stylesheet = document.createElement('style')
    stylesheet.textContent = '[data-slaids-pdf] .rd-p { font-size: 23.375px; }'
    document.head.append(stylesheet)
    const photograph = vi.mocked(toCanvas).getMockImplementation()!
    let fractionalSeen = false
    vi.mocked(toCanvas).mockImplementation(async (node, options) => {
      const mappings = new Map<string, string>()
      for (const element of [node, ...node.querySelectorAll('*')]) {
        const size = getComputedStyle(element).fontSize
        if (!size) continue
        const id = element.getAttribute('data-slaids-pdf-font')
        expect(id).not.toBeNull()
        if (mappings.has(size)) expect(id).toBe(mappings.get(size))
        mappings.set(size, id!)
        expect(options?.fontEmbedCSS).toContain(
          `[data-slaids-pdf-font="${id}"] { font-size: ${size} !important; }`,
        )
        if (size === '23.375px') fractionalSeen = true
      }
      return photograph(node, options)
    })

    try {
      await exportPresentationPdf(store.value, 'dekk')
      expect(fractionalSeen).toBe(true)
    } finally {
      stylesheet.remove()
    }
  })

  it('rydder montert DOM når en side ikke kan rasteriseres og returnerer ingen delvis PDF', async () => {
    const store = repository()
    vi.mocked(toCanvas).mockRejectedValue(new Error('Rasterisering feilet'))
    await expect(exportPresentationPdf(store.value, 'dekk')).rejects.toThrow('Rasterisering feilet')
    expect(store.methods.getUserSettings).toHaveBeenCalledWith(null)
  })

  it('avviser en manglende bildefil og rydder også når forrige side allerede er tegnet', async () => {
    const presentation = deck()
    const slide = contentAt(presentation, 1)
    if (slide.root.kind !== 'leaf') throw new Error('Forventet tom rotsone.')
    slide.root.content = createImage('a_mangler')
    const store = repository(presentation)
    await expect(exportPresentationPdf(store.value, 'dekk')).rejects.toThrow('a_mangler')
    expect(toCanvas).toHaveBeenCalledTimes(1)
    expect(store.methods.getAsset).toHaveBeenCalledWith('a_mangler')
  })

  it('avviser utilgjengelige webfonter før noen side eksporteres', async () => {
    const store = repository()
    vi.mocked(inlineFontFaces).mockResolvedValue({ css: '', missing: ['Quicksand'] })
    await expect(exportPresentationPdf(store.value, 'dekk')).rejects.toThrow('Quicksand')
    expect(toCanvas).not.toHaveBeenCalled()
  })
})
