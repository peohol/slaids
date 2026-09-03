/**
 * A shared deck, as an anonymous visitor sees it.
 *
 * This is the whole public surface of Slaids. It mounts no editor, no toolbar,
 * no filmstrip, no inspector, no status bar and no library — not hidden, not
 * disabled, simply never imported into this tree. There is no route from here
 * back into the workspace, and nothing here asks for a session.
 *
 * What it does mount is `PresentationPlayer`, exactly as the owner's own
 * presentation mode does, wrapped in the public asset source so every picture
 * comes through the share endpoint rather than the authenticated repository.
 */

import { useEffect, useState } from 'react'
import { fetchSharedSnapshot, type SharedDeckOutcome } from '../../sharing/shareClient'
import { shareUrl } from '../../routing'
import { AssetSourceProvider } from '../../state/assetSource'
import { useSharedAssetSource } from '../../state/assetSources'
import { PresentationPlayer } from '../present/PresentationPlayer'

/**
 * The answer, keyed by the token it answers for.
 *
 * Derived rather than reset: a new token makes the previous answer irrelevant
 * the moment it renders, with no effect in between that could show one deck's
 * result under another deck's address.
 */
type LoadedDeck = { token: string; outcome: SharedDeckOutcome }

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
function useLinkPrivacyMeta(): void {
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
function SharedLinkNotFound() {
  return (
    <div className="shared shared--message" data-testid="shared-not-found">
      <div className="shared__card">
        <h1 className="shared__title">Slaids</h1>
        <p>Denne delingslenken er ikke aktiv.</p>
        <p className="hint">
          Lenken kan være skrevet feil eller ufullstendig, eller den som eier presentasjonen kan
          ha slått av delingen. Be om en ny lenke.
        </p>
      </div>
    </div>
  )
}

/**
 * The deck itself. Mounted only once there is a token worth asking about, so a
 * malformed address never becomes a request to the share endpoint.
 */
function SharedDeck({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<LoadedDeck | null>(null)
  const assetSource = useSharedAssetSource(token)

  useEffect(() => {
    const controller = new AbortController()
    void fetchSharedSnapshot(token, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return
      setLoaded({ token, outcome })
    })
    return () => controller.abort()
  }, [token])

  const outcome = loaded && loaded.token === token ? loaded.outcome : null
  const title = outcome?.kind === 'ok' ? outcome.snapshot.title : null

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

  if (outcome.kind === 'not-found') return <SharedLinkNotFound />

  if (outcome.kind === 'unavailable') {
    return (
      <div className="shared shared--message" data-testid="shared-unavailable">
        <div className="shared__card">
          <h1 className="shared__title">Slaids</h1>
          <p role="alert">{outcome.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="shared" data-testid="shared-view">
      <AssetSourceProvider value={assetSource}>
        <PresentationPlayer
          deck={outcome.snapshot}
          // The QR page points at the page it is on, so a photograph of a
          // screen is enough to open the deck on another device.
          shareUrl={shareUrl(window.location.origin, token)}
          startIndex={0}
          onExit={null}
        />
      </AssetSourceProvider>
    </div>
  )
}

export function SharedPresentationView({ token }: { token: string | null }) {
  useLinkPrivacyMeta()
  // An address under `/s/` that cannot be a token is answered here and now.
  // Asking the server about it would tell it nothing it could act on, and would
  // turn a typo into a request that looks like a guess at somebody's link.
  if (!token) return <SharedLinkNotFound />
  return <SharedDeck token={token} />
}
