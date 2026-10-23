/**
 * A shared folder, as an anonymous visitor sees it.
 *
 * The folder's name and one card per published deck, and nothing else: no
 * editor, no library, no tools, no way to change anything — not hidden, simply
 * never imported here. Pressing a card opens that deck in presentation mode,
 * through the very `SharedDeck` a deck shared on its own plays in, and leaving
 * the presentation comes back here.
 *
 * Opening a deck is a step in the browser's history, so the back button and the
 * back gesture on a phone leave the presentation rather than the folder. The
 * address itself does not change: the folder's link is the only link there is.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchSharedFolder, type SharedDeckAddress, type SharedFolderOutcome } from '../../sharing/shareClient'
import { formatSlideCount } from '../format'
import { Icon } from '../components/Icon'
import { SharedDeck, SharedLinkNotFound, SharedMessage, useLinkPrivacyMeta } from './SharedPresentationView'

/** Where in `history.state` the open deck is remembered. */
const OPEN_DECK_KEY = 'slaidsSharedDeck'

function openDeckIn(state: unknown): string | null {
  const value = (state as Record<string, unknown> | null)?.[OPEN_DECK_KEY]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** The listing, keyed by the token it answers for, for the same reason `SharedDeck` keys its answer. */
type LoadedFolder = { token: string; outcome: SharedFolderOutcome }

function SharedFolder({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<LoadedFolder | null>(null)
  const [openId, setOpenId] = useState<string | null>(() => openDeckIn(window.history.state))
  const browsing = openId === null

  // Asked again every time the viewer comes back to the folder: the owner may
  // have filed a deck in it, or taken one out, while somebody was presenting.
  // The previous answer stays on screen until the new one arrives.
  useEffect(() => {
    if (!browsing) return
    const controller = new AbortController()
    void fetchSharedFolder(token, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return
      setLoaded({ token, outcome })
    })
    return () => controller.abort()
  }, [token, browsing])

  useEffect(() => {
    const onPop = (event: PopStateEvent): void => setOpenId(openDeckIn(event.state))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const open = useCallback((presentationId: string) => {
    window.history.pushState({ [OPEN_DECK_KEY]: presentationId }, '')
    setOpenId(presentationId)
  }, [])

  const exit = useCallback(() => {
    // Back through the history entry `open` made, so the browser's own back
    // button and this agree about where the viewer is.
    if (openDeckIn(window.history.state)) window.history.back()
    else setOpenId(null)
  }, [])

  const address = useMemo<SharedDeckAddress | null>(
    () => (openId ? { kind: 'folder', folderToken: token, presentationId: openId } : null),
    [token, openId],
  )

  const outcome = loaded && loaded.token === token ? loaded.outcome : null
  const name = outcome?.kind === 'ok' ? outcome.value.name : null

  useEffect(() => {
    if (!browsing || !name) return
    document.title = `${name} – Slaids`
  }, [browsing, name])

  if (address) return <SharedDeck address={address} qrUrl={null} onExit={exit} />

  if (!outcome) {
    return (
      <div className="shared shared--message" data-testid="shared-loading">
        <p className="hint">Henter mappen …</p>
      </div>
    )
  }

  if (outcome.kind === 'not-found') return <SharedLinkNotFound what="mappen" />

  if (outcome.kind === 'unavailable') {
    return (
      <SharedMessage testId="shared-unavailable">
        <p role="alert">{outcome.message}</p>
      </SharedMessage>
    )
  }

  const { presentations } = outcome.value
  return (
    <div className="shared-folder" data-testid="shared-folder">
      <header className="shared-folder__header">
        <span className="shared-folder__brand">Slaids</span>
        <h1 className="shared-folder__title" data-testid="shared-folder-name">
          <Icon name="folder" size={22} /> {outcome.value.name}
        </h1>
      </header>
      {presentations.length === 0 ? (
        <p className="hint shared-folder__empty">Det er ingen presentasjoner i denne mappen ennå.</p>
      ) : (
        <main className="shared-folder__grid">
          {presentations.map((entry) => (
            <article key={entry.id} className="presentation-card" data-testid="shared-folder-card">
              <button
                type="button"
                className="presentation-card__open"
                onClick={() => open(entry.id)}
                data-testid="open-shared-presentation"
              >
                <span className="presentation-card__name">{entry.title}</span>
                <span className="presentation-card__meta">
                  <Icon name="play" size={12} /> {formatSlideCount(entry.slideCount)}
                </span>
              </button>
            </article>
          ))}
        </main>
      )}
    </div>
  )
}

export function SharedFolderView({ token }: { token: string | null }) {
  useLinkPrivacyMeta()
  // Answered here and now, for the reason `SharedPresentationView` gives.
  if (!token) return <SharedLinkNotFound what="mappen" />
  return <SharedFolder token={token} />
}
