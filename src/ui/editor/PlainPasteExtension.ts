/**
 * Ctrl/Cmd+Shift+V pastes the clipboard as plain text.
 *
 * Ordinary paste is already normalised, but a guaranteed plain-text path is the
 * safe basis when foreign markup is not wanted at all.
 */

import { Extension } from '@tiptap/core'

export const PlainPasteExtension = Extension.create({
  name: 'plainPaste',

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-v': () => {
        const { editor } = this
        void navigator.clipboard
          ?.readText()
          .then((text) => {
            if (!text) return
            editor.commands.insertContent(
              text
                .replace(/\r\n/g, '\n')
                .split(/\n{2,}/)
                .filter((block) => block.trim().length > 0)
                .map((block) => ({
                  type: 'paragraph',
                  content: block
                    .split('\n')
                    .flatMap((line, index) =>
                      index === 0
                        ? [{ type: 'text', text: line }]
                        : [{ type: 'hardBreak' }, { type: 'text', text: line }],
                    )
                    .filter((node) => node.type !== 'text' || (node as { text?: string }).text),
                })),
            )
          })
          .catch(() => {
            // Clipboard permission was denied; the normal paste path still works.
          })
        return true
      },
    }
  },
})
