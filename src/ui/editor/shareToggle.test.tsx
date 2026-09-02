/**
 * The `Del` control.
 *
 * The rule under test is that the switch only ever shows what the server has
 * confirmed: it is inert until the stored state has been read, it does not flip
 * while a publish is in flight, and in local mode it says why it cannot be used
 * instead of quietly pretending to work.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { currentShareUrl } from '../../state/sharing'
import { TooltipProvider } from '../components/Tooltip'
import { ShareToggle, type ShareToggleProps } from './ShareToggle'

const TOKEN = '3f2a1b0c-1111-4222-8333-444455556666'

function renderWith(props: Partial<ShareToggleProps>): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ShareToggle
        status="ready"
        shared={false}
        busy={false}
        error={null}
        link={null}
        onToggle={() => {}}
        {...props}
      />
    </TooltipProvider>,
  )
}

describe('ShareToggle', () => {
  it('er av og trykkbar når presentasjonen ikke er delt', () => {
    const markup = renderWith({ status: 'ready', shared: false, link: null })
    expect(markup).toContain('data-state="off"')
    expect(markup).not.toContain('disabled')
    expect(markup).not.toContain('copy-share-link')
  })

  it('er på og tilbyr lenken når presentasjonen er delt', () => {
    const markup = renderWith({ status: 'ready', shared: true, link: `/s/${TOKEN}` })
    expect(markup).toContain('data-state="on"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('data-testid="copy-share-link"')
  })

  it('viser ingen påstand før servertilstanden er lest', () => {
    const markup = renderWith({ status: 'loading' })
    expect(markup).toContain('data-state="off"')
    expect(markup).toContain('disabled')
    // Og ingen lenke å kopiere, siden det ikke finnes noen ennå.
    expect(markup).not.toContain('copy-share-link')
  })

  it('lar seg ikke trykke mens en publisering pågår', () => {
    const markup = renderWith({ status: 'ready', shared: false, busy: true })
    expect(markup).toContain('data-state="busy"')
    expect(markup).toContain('disabled')
    expect(markup).toContain('aria-busy="true"')
  })

  it('er avslått og forklart i lokal modus', () => {
    const markup = renderWith({ status: 'unsupported' })
    expect(markup).toContain('data-state="unsupported"')
    expect(markup).toContain('disabled')
    expect(markup).not.toContain('copy-share-link')
  })
})

describe('delingslenken', () => {
  it('finnes bare mens delingen er aktiv', () => {
    expect(currentShareUrl({ shared: true, token: TOKEN })).toBe(
      `${window.location.origin}/s/${TOKEN}`,
    )
    expect(currentShareUrl({ shared: false, token: TOKEN })).toBeNull()
    expect(currentShareUrl({ shared: true, token: null })).toBeNull()
  })
})
