/**
 * The Tiptap editor instance that currently has focus.
 *
 * The text toolbar and the reference dialog need to issue commands against
 * whatever field the user is editing, without prop-drilling through the slide.
 */

import { create } from 'zustand'
import type { Editor } from '@tiptap/react'

interface ActiveEditorStore {
  editor: Editor | null
  /** Bumped on every editor transaction so toolbars re-render mark state. */
  version: number
  setEditor: (editor: Editor | null) => void
  bump: () => void
}

export const useActiveEditor = create<ActiveEditorStore>((set) => ({
  editor: null,
  version: 0,
  setEditor: (editor) => set({ editor, version: 0 }),
  bump: () => set((state) => ({ version: state.version + 1 })),
}))
