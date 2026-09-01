import { useCallback, useState } from 'react'
import { LibraryView } from './ui/library/LibraryView'
import { EditorView } from './ui/editor/EditorView'
import { AuthGate } from './ui/auth/AuthGate'
import { Toaster } from './ui/components/Toaster'
import { TooltipProvider } from './ui/components/Tooltip'
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

export default function App() {
  // Signing out remounts the workspace from scratch, so nothing the previous
  // user had open survives as React state.
  const userId = useSessionStore((state) => state.userId)

  return (
    <TooltipProvider>
      <AuthGate>
        <Workspace key={userId ?? 'local'} />
      </AuthGate>
      <Toaster />
    </TooltipProvider>
  )
}
