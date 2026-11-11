import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { LibraryView, type OpenOptions } from './ui/library/LibraryView'
import { EditorView } from './ui/editor/EditorView'
import { AuthGate } from './ui/auth/AuthGate'
import { Toaster } from './ui/components/Toaster'
import { TooltipProvider } from './ui/components/Tooltip'
import { AssetSourceProvider } from './state/assetSource'
import { repositoryAssetSource } from './state/assetSources'
import { lastOpenPresentationKey, readPref, writePref } from './state/prefs'
import { useSessionStore } from './state/session'
import { loadAutocorrect } from './state/autocorrect'

function Workspace({ userId }: { userId: string | null }) {
  const lastOpenKey = lastOpenPresentationKey(userId)
  // The rules are the signed-in user's; the workspace is remounted per user.
  useEffect(() => {
    void loadAutocorrect()
  }, [])
  const [openId, setOpenId] = useState<string | null>(() =>
    readPref<string | null>(lastOpenKey, null),
  )
  /**
   * Om temaeditoren skal åpnes straks dekket er lastet. Bare et nettopp
   * opprettet dekk ber om det, og bare for denne åpningen: valget lagres ikke,
   * så en omlasting åpner dekket slik det ellers åpnes.
   */
  const [themeOnOpen, setThemeOnOpen] = useState(false)

  const open = useCallback(
    (id: string, options: OpenOptions = {}) => {
      writePref(lastOpenKey, id)
      setThemeOnOpen(options.openTheme ?? false)
      setOpenId(id)
    },
    [lastOpenKey],
  )

  const close = useCallback(() => {
    writePref<string | null>(lastOpenKey, null)
    setThemeOnOpen(false)
    setOpenId(null)
  }, [lastOpenKey])

  return openId ? (
    <EditorView presentationId={openId} onClose={close} openThemeOnLoad={themeOnOpen} />
  ) : (
    <LibraryView onOpen={open} />
  )
}

/**
 * Everything a private page is mounted inside, without being the workspace.
 *
 * The workspace is one private page; the OAuth consent screen is another, and
 * it is a page a user arrives at mid-flow from an application that sent them
 * here. Both need the same things around them — the gate, the toaster, the
 * asset source, tooltips — and neither should have to know that. What the
 * consent screen must *not* get is `Workspace`, which starts loading the
 * library the moment it mounts.
 */
export function PrivatePage({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      {/*
       * The private workspace reads pictures through the repository, and it says
       * so here rather than relying on a default: the shared view is mounted
       * under the public source instead, and the headless preview under one that
       * already holds the bytes. Which store a renderer reaches is a fact about
       * where it hangs, never a branch inside it.
       */}
      <AssetSourceProvider value={repositoryAssetSource}>
        <AuthGate>{children}</AuthGate>
      </AssetSourceProvider>
      <Toaster />
    </TooltipProvider>
  )
}

export default function App() {
  // Signing out remounts the workspace from scratch, so nothing the previous
  // user had open survives as React state.
  const userId = useSessionStore((state) => state.userId)

  return (
    <PrivatePage>
      <Workspace key={userId ?? 'local'} userId={userId} />
    </PrivatePage>
  )
}
