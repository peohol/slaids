import { useCallback, useState, type ReactNode } from 'react'
import { LibraryView } from './ui/library/LibraryView'
import { EditorView } from './ui/editor/EditorView'
import { AuthGate } from './ui/auth/AuthGate'
import { Toaster } from './ui/components/Toaster'
import { TooltipProvider } from './ui/components/Tooltip'
import { AssetSourceProvider } from './state/assetSource'
import { repositoryAssetSource } from './state/assetSources'
import { LAST_OPEN_PRESENTATION_KEY, readPref, writePref } from './state/prefs'
import { useSessionStore } from './state/session'

function Workspace() {
  const [openId, setOpenId] = useState<string | null>(() =>
    readPref<string | null>(LAST_OPEN_PRESENTATION_KEY, null),
  )

  const open = useCallback((id: string) => {
    writePref(LAST_OPEN_PRESENTATION_KEY, id)
    setOpenId(id)
  }, [])

  const close = useCallback(() => {
    writePref<string | null>(LAST_OPEN_PRESENTATION_KEY, null)
    setOpenId(null)
  }, [])

  return openId ? <EditorView presentationId={openId} onClose={close} /> : <LibraryView onOpen={open} />
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
      <Workspace key={userId ?? 'local'} />
    </PrivatePage>
  )
}
