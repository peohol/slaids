/**
 * A shared deck, as an anonymous visitor sees it.
 *
 * This and `SharedFolderView` are the whole public surface of Slaids, and the
 * folder view plays its decks through `SharedDeck` here. It mounts no editor, no toolbar,
 * no filmstrip, no inspector, no status bar and no library — not hidden, not
 * disabled, simply never imported into this tree. There is no route from here
 * back into the workspace, and nothing here asks for a session.
 *
 * What it does mount is `PresentationPlayer`, exactly as the owner's own
 * presentation mode does, wrapped in the public asset source so every picture
 * comes through the share endpoint rather than the authenticated repository.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  deckAddressKey,
  fetchSharedSnapshot,
  type SharedDeckAddress,
  type SharedDeckOutcome,
} from '../../sharing/shareClient'
import { shareUrl } from '../../routing'
import { AssetSourceProvider } from '../../state/assetSource'
import { useSharedAssetSource } from '../../state/assetSources'
import { PresentationPlayer } from '../present/PresentationPlayer'

/**
 * The answer, keyed by the address it answers for.
 *
 * Derived rather than reset: a new address makes the previous answer
 * irrelevant the moment it renders, with no effect in between that could show
 * one deck's result under another deck's address.
 */
type LoadedDeck = { key: string; outcome: SharedDeckOutcome }

/**
 * Two things the page has to say about its own address, because the address is
 * the whole access control.
 *
 *  - `noindex, nofollow`: a secret link a crawler has found is not a secret
 *    link. `vercel.json` sets the same thing as a response header on `/s/`, so
 *    the very first HTML is covered before any of this runs; this is the
 *    defence that survives being served from somewhere else.
 *  - `no-referrer`: the token is in the path, so it must never travel in a
 *    `Referer`. Modern browsers already withhold the path cross-origin, and
 *    every link in a slide is `rel="noreferrer"` — this is the belt to those
 *    braces, and costs a shared deck nothing.
 */
export function useLinkPrivacyMeta(): void {
  useEffect(() => {
    const tags = (
      [
        ['robots', 'noindex, nofollow'],
        ['referrer', 'no-referrer'],
      ] as const
    ).map(([name, content]) => {
      const meta = document.createElement('meta')
      meta.name = name
      meta.content = content
      document.head.appendChild(meta)
      return meta
    })
    return () => tags.forEach((meta) => meta.remove())
  }, [])
}

/**
 * One answer for every dead link.
 *
 * A wrong address, a share that has been turned off and a presentation that has
 * been deleted look the same from out here — and so does an address that cannot
 * be a token at all, which is why this is a component rather than a branch.
 */
export function SharedLinkNotFound({ what = 'presentasjonen' }: { what?: string }) {
  return (
    <div className="shared shared--message" data-testid="shared-not-found">
      <div className="shared__card">
        <h1 className="shared__title">Slaids</h1>
        <p>Denne delingslenken er ikke aktiv.</p>
        <p className="hint">
          Lenken kan være skrevet feil eller ufullstendig, eller den som eier {what} kan ha slått
          av delingen. Be om en ny lenke.
        </p>
      </div>
    </div>
  )
}

/** Something the page has to say instead of showing a deck, with a way back when there is one. */
export function SharedMessage({
  testId,
  children,
  onBack,
}: {
  testId: string
  children: ReactNode
  onBack?: (() => void) | null
}) {
  return (
    <div className="shared shared--message" data-testid={testId}>
      <div className="shared__card">
        <h1 className="shared__title">Slaids</h1>
        {children}
        {onBack && (
          <button type="button" className="btn" onClick={onBack} data-testid="shared-back">
            Tilbake til mappen
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * One published deck, playing. Mounted only once there is an address worth
 * asking about, so a malformed link never becomes a request to the share
 * endpoint.
 *
 * `onExit` is where a viewer goes back to — the folder the deck was opened
 * from — or `null` for a deck shared on its own, which has nowhere to go back
 * to. `qrUrl` is what the derived QR page points at, and only a deck shared on
 * its own has one: it is the link to *that* deck.
 */
export function SharedDeck({
  address,
  qrUrl,
  onExit,
}: {
  address: SharedDeckAddress
  qrUrl: string | null
  onExit: (() => void) | null
}) {
  const key = deckAddressKey(address)
  const [loaded, setLoaded] = useState<LoadedDeck | null>(null)
  const assetSource = useSharedAssetSource(address)

  useEffect(() => {
    const controller = new AbortController()
    void fetchSharedSnapshot(address, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return
      setLoaded({ key: deckAddressKey(address), outcome })
    })
    return () => controller.abort()
  }, [address])

  const outcome = loaded && loaded.key === key ? loaded.outcome : null
  const title = outcome?.kind === 'ok' ? outcome.value.title : null

  useEffect(() => {
    if (!title) return
    document.title = `${title} – Slaids`
  }, [title])

  if (!outcome) {
    return (
      <div className="shared shared--message" data-testid="shared-loading">
        <p className="hint">Henter presentasjonen …</p>
      </div>
    )
  }

  if (outcome.kind === 'not-found') {
    if (!onExit) return <SharedLinkNotFound />
    return (
      <SharedMessage testId="shared-not-found" onBack={onExit}>
        <p>Denne presentasjonen er ikke lenger delt.</p>
      </SharedMessage>
    )
  }

  if (outcome.kind === 'unavailable') {
    return (
      <SharedMessage testId="shared-unavailable" onBack={onExit}>
        <p role="alert">{outcome.message}</p>
      </SharedMessage>
    )
  }

  return (
    <div className="shared" data-testid="shared-view">
      <AssetSourceProvider value={assetSource}>
        <PresentationPlayer
          deck={outcome.value}
          citationStyle={outcome.value.citationStyle}
          shareUrl={qrUrl}
          startIndex={0}
          onExit={onExit}
        />
      </AssetSourceProvider>
    </div>
  )
}

/** A deck shared on its own, at `/s/<token>`. */
function SharedPresentation({ token }: { token: string }) {
  const address = useMemo<SharedDeckAddress>(() => ({ kind: 'presentation', token }), [token])
  return (
    <SharedDeck
      address={address}
      // The QR page points at the page it is on, so a photograph of a
      // screen is enough to open the deck on another device.
      qrUrl={shareUrl(window.location.origin, token)}
      onExit={null}
    />
  )
}

export function SharedPresentationView({ token }: { token: string | null }) {
  useLinkPrivacyMeta()
  // An address under `/s/` that cannot be a token is answered here and now.
  // Asking the server about it would tell it nothing it could act on, and would
  // turn a typo into a request that looks like a guess at somebody's link.
  if (!token) return <SharedLinkNotFound />
  return <SharedPresentation token={token} />
}
