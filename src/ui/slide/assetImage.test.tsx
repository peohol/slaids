/**
 * A picture drawn as the whole content of a zone.
 *
 * The markup is deliberately bare: how the picture is sized, aligned, rounded
 * and shadowed lives entirely in `slide.css`, so what the document decides
 * comes down to two class names. That is what lets the editor, the slide, the
 * thumbnails, the offscreen fit measurement and the headless preview draw one
 * picture from one set of rules — rather than five that happen to agree today.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CARD_DROP_SHADOW, CARD_SHADOW } from '../../domain/constants'
import { createContainer } from '../../domain/content'
import { defaultTheme } from '../../domain/presentation'
import { AssetSourceProvider, type AssetUrlSource } from '../../state/assetSource'
import type { ContainerPayload } from '../../domain/types'
import { SlideRenderProvider } from './SlideRenderContext'
import { ZoneContentView } from './ZoneContentView'

const source: AssetUrlSource = {
  id: 'test',
  resolve: () => Promise.resolve(null),
  resolveSync: () => 'blob:figur',
}

/** What a renderer whose document cannot run a script is mounted under. */
const withRatio: AssetUrlSource = { ...source, id: 'test-ratio', aspectRatio: () => 16 / 9 }

function markupFor(payload: ContainerPayload, from: AssetUrlSource = source): string {
  return renderToStaticMarkup(
    <SlideRenderProvider
      value={{
        theme: defaultTheme(),
        numbering: new Map(),
        headingPillColor: '#33475b',
        progress: new Map(),
        isStatic: true,
      }}
    >
      <AssetSourceProvider value={from}>
        <ZoneContentView content={createContainer(payload)} />
      </AssetSourceProvider>
    </SlideRenderProvider>,
  )
}

describe('a picture that fills a zone', () => {
  it('is drawn whole by default, with no modifier at all', () => {
    const html = markupFor({ type: 'asset', assetId: 'a1', fit: 'contain' })
    expect(html).toContain('class="asset-image"')
    expect(html).toContain('zone-content--asset')
  })

  it('says so in a class when it is cropped to the zone', () => {
    const html = markupFor({ type: 'asset', assetId: 'a1', fit: 'cover' })
    expect(html).toContain('asset-image--cover')
  })

  it('is trimmed to the picture once its proportions are known', () => {
    // Which is what a radius and a shadow of its own need: the corners and the
    // outline are then the picture's, not the zone's.
    const framed = markupFor({ type: 'asset', assetId: 'a1', fit: 'contain' }, withRatio)
    expect(framed).toContain('asset-image--framed')
    expect(framed).toContain('--slaids-asset-ratio')
  })

  it('is drawn in the whole zone until they are', () => {
    // The same picture in the same place, in a box that has not been trimmed to
    // it yet — never a picture that is missing or the wrong size.
    const html = markupFor({ type: 'asset', assetId: 'a1', fit: 'contain' })
    expect(html).toContain('class="asset-image"')
    expect(html).not.toContain('asset-image--framed')
  })

  it('needs no box of its own when it fills the zone', () => {
    const html = markupFor({ type: 'asset', assetId: 'a1', fit: 'cover' }, withRatio)
    expect(html).toContain('asset-image--cover')
    expect(html).not.toContain('asset-image--framed')
  })

  it('rounds its corners only when somebody asked it to', () => {
    expect(markupFor({ type: 'asset', assetId: 'a1', fit: 'contain' })).not.toContain(
      'asset-image--rounded',
    )
    expect(
      markupFor({ type: 'asset', assetId: 'a1', fit: 'contain', rounded: true }),
    ).toContain('asset-image--rounded')
  })
})

describe('the card depth', () => {
  it('is one list of layers in two spellings', () => {
    // A picture is only a rectangle when it fills its zone, so its shadow is a
    // filter rather than a box-shadow — but it has to be the *same* shadow, and
    // the only way to keep that true is for both to be derived from one list.
    // Split on the comma between two layers, never on the ones inside `rgba()`.
    const layers = CARD_SHADOW.split(/,\s*(?=0 )/)
    expect(layers.length).toBeGreaterThan(0)
    expect(CARD_DROP_SHADOW.match(/drop-shadow\(/g) ?? []).toHaveLength(layers.length)
    for (const layer of layers) expect(CARD_DROP_SHADOW).toContain(`drop-shadow(${layer})`)
  })
})
