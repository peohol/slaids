import { useCallback, useState } from 'react'
import { LibraryView } from './ui/library/LibraryView'
import { EditorView } from './ui/editor/EditorView'
import { Toaster } from './ui/components/Toaster'
import { TooltipProvider } from './ui/components/Tooltip'
import { readPref, writePref } from './state/prefs'

const LAST_OPEN_KEY = 'lastOpenPresentation'

export default function App() {
  const [openId, setOpenId] = useState<string | null>(() => readPref<string | null>(LAST_OPEN_KEY, null))

  const open = useCallback((id: string) => {
    writePref(LAST_OPEN_KEY, id)
    setOpenId(id)
  }, [])

  const close = useCallback(() => {
    writePref(LAST_OPEN_KEY, null)
    setOpenId(null)
  }, [])

  return (
    <TooltipProvider>
      {openId ? <EditorView presentationId={openId} onClose={close} /> : <LibraryView onOpen={open} />}
      <Toaster />
    </TooltipProvider>
  )
}
