/** PDF av dekkets egne sidekomponenter, tegnet i brukerens nettleser. */

import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { deckAssetIds } from '../../domain/commands/assets'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { webFontFaces, webFontsFor } from '../../domain/fonts'
import { deckLogoLayout } from '../../domain/logo'
import { deckPages, deckProgress, deckSectionColors, pageSlide, type DeckPage } from '../../domain/pages'
import { citationLabelsFor } from '../../domain/references'
import type { Presentation } from '../../domain/types'
import { inlineFontFaces } from '../../fonts/inlineFaces'
import type { SlaidsRepository } from '../../persistence/repository'
import { AssetSourceProvider, type AssetUrlSource } from '../../state/assetSource'
import { DeckPageView } from '../slide/DeckPageView'
import { SlideRenderProvider } from '../slide/SlideRenderContext'

export interface PresentationPdfOptions {
  /** Brukeren hvis visningsvalg eksporten skal følge. Lokalt lager bruker null. */
  ownerId?: string | null
  onProgress?: (completedPages: number, totalPages: number) => void
}

/**
 * Returnerer en ferdig PDF uten å endre eller publisere presentasjonen.
 * Én side og ett lerret om gangen begrenser minnebruken for store dekk.
 * Miniapper tegnes bare som forsider av den vanlige DeckPageView-komponenten.
 */
export async function exportPresentationPdf(
  repository: SlaidsRepository,
  presentationId: string,
  options: PresentationPdfOptions = {},
): Promise<Blob> {
  const [presentation, settings] = await Promise.all([
    repository.loadPresentation(presentationId),
    repository.getUserSettings(options.ownerId ?? null),
  ])
  const pages = deckPages(presentation, { citationStyle: settings.citationStyle })
  if (pages.length === 0) throw new Error('Presentasjonen har ingen sider å eksportere.')
  options.onProgress?.(0, pages.length)

  const families = webFontsFor([
    presentation.theme.headingFontFamily,
    presentation.theme.bodyFontFamily,
  ])
  const fonts = await inlineFontFaces(families)
  if (fonts.missing.length > 0) {
    throw new Error(`Kunne ikke laste skrifttypene ${fonts.missing.join(', ')}. Prøv igjen når du er tilkoblet nettet.`)
  }

  // Flaten må ha vanlig layout og synlighet for å kunne fotograferes. Den står
  // utenfor skjermen og kan ikke få tastaturfokus eller fange brukerens klikk.
  const host = document.createElement('div')
  host.setAttribute('data-slaids-pdf', '')
  host.setAttribute('aria-hidden', 'true')
  host.inert = true
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${SLIDE_WIDTH}px`,
    height: `${SLIDE_HEIGHT}px`,
    pointerEvents: 'none',
  })
  const styles = document.createElement('style')
  styles.textContent = `${fonts.css}\n[data-slaids-pdf] * { transition: none !important; animation: none !important; }`
  const stage = document.createElement('div')
  Object.assign(stage.style, { width: `${SLIDE_WIDTH}px`, height: `${SLIDE_HEIGHT}px` })
  host.append(styles, stage)
  document.body.append(host)
  const root = createRoot(stage)

  try {
    await waitForFonts(families)
    const colors = deckSectionColors(pages)
    const renderValue = {
      theme: presentation.theme,
      ...citationLabelsFor(presentation, settings.citationStyle),
      sectionColors: colors,
      progress: deckProgress(pages, settings.includeReferencesInProgress),
      logo: deckLogoLayout(presentation),
      isStatic: true,
    }
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'px',
      format: [SLIDE_WIDTH, SLIDE_HEIGHT],
      hotfixes: ['px_scaling'],
      compress: true,
    })
    pdf.setProperties({ title: presentation.title, creator: 'Slaids' })

    for (const [index, page] of pages.entries()) {
      const assets = await pageAssets(repository, presentation, page)
      flushSync(() => {
        root.render(
          <AssetSourceProvider value={assets}>
            <SlideRenderProvider value={renderValue}>
              <DeckPageView key={page.id} page={page} />
            </SlideRenderProvider>
          </AssetSourceProvider>,
        )
      })
      // Bilder finnes synkront i første render; decode venter på selve pikslene.
      await Promise.all([...stage.querySelectorAll('img')].map(waitForImage))
      await document.fonts.ready
      // Tilpasningen av soner og titler reagerer på bilder og fonter i neste
      // bildeframe. Den påfølgende framen gir React tid til å tegne svaret.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })

      const canvas = await toCanvas(stage, {
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        pixelRatio: 2,
        fontEmbedCSS: [fonts.css, exactFontSizes(stage)].filter(Boolean).join('\n'),
        // Alle bilder er allerede hentet gjennom brukerens repository. En
        // manglende fil avvises før rasteriseringen, aldri som et tomt felt.
        backgroundColor: colors.get(page.id)?.background,
      })
      try {
        if (index > 0) pdf.addPage([SLIDE_WIDTH, SLIDE_HEIGHT], 'landscape')
        pdf.addImage(canvas, 'PNG', 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT, undefined, 'FAST')
      } finally {
        canvas.width = 0
        canvas.height = 0
      }
      options.onProgress?.(index + 1, pages.length)
    }
    return pdf.output('blob')
  } finally {
    root.unmount()
    host.remove()
  }
}

/**
 * html-to-image runder skriftstørrelser når den kopierer beregnede stiler.
 * Bevar nettleserens faktiske mål med regler som settes inn etter kopieringen,
 * slik at tekst og tilpasningen som allerede er målt, beholder samme størrelse.
 */
function exactFontSizes(stage: HTMLElement): string {
  const sizes = new Map<string, string>()
  for (const element of [stage, ...stage.querySelectorAll('*')]) {
    const size = getComputedStyle(element).fontSize
    if (!size) continue
    let id = sizes.get(size)
    if (id === undefined) {
      id = String(sizes.size)
      sizes.set(size, id)
    }
    element.setAttribute('data-slaids-pdf-font', id)
  }
  return [...sizes].map(([size, id]) =>
    `[data-slaids-pdf-font="${id}"] { font-size: ${size} !important; }`,
  ).join('\n')
}

async function waitForFonts(families: readonly string[]): Promise<void> {
  const specs = families.flatMap((family) =>
    webFontFaces(family).flatMap((face) =>
      face.weights.map((weight) => `${weight} 16px "${face.family}"`),
    ),
  )
  await Promise.all(specs.map((spec) => document.fonts.load(spec)))
  if (specs.some((spec) => !document.fonts.check(spec))) {
    throw new Error('Skrifttypene er ikke klare. Prøv PDF-eksporten igjen.')
  }
}

async function pageAssets(
  repository: SlaidsRepository,
  presentation: Presentation,
  page: DeckPage,
): Promise<AssetUrlSource> {
  const slide = pageSlide(page)
  const urls = new Map<string, string>()
  if (slide) {
    for (const assetId of deckAssetIds({ theme: presentation.theme, slides: [slide] })) {
      const stored = await repository.getAsset(assetId)
      if (!stored) throw new Error(`Filen «${assetId}» mangler. PDF-en ble ikke eksportert.`)
      const blob = new Blob([stored.blob], { type: stored.ref.mimeType })
      urls.set(assetId, await dataUrl(blob))
    }
  }
  return {
    id: `pdf:${page.id}`,
    resolveSync: (assetId) => urls.get(assetId) ?? null,
    resolve: (assetId) => Promise.resolve(urls.has(assetId) ? { url: urls.get(assetId)! } : null),
  }
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Kunne ikke lese bildefilen.'))
    reader.readAsDataURL(blob)
  })
}

async function waitForImage(image: HTMLImageElement): Promise<void> {
  try {
    await image.decode()
  } catch {
    throw new Error('Et bilde kunne ikke tegnes. PDF-en ble ikke eksportert.')
  }
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error('Et bilde er tomt. PDF-en ble ikke eksportert.')
  }
}
