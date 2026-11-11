export const EDITOR_SHORTCUTS = {
  sandbox: ['K', 'Vis/skjul sandkassen'],
  slide: ['N', 'Ny slide'],
  reference: ['R', 'Sett inn referanse'],
  splitVertical: ['V', 'Del sone med en vertikal strek'],
  splitHorizontal: ['H', 'Del sone med en horisontal strek'],
  clear: ['T', 'Tøm sone'],
  remove: ['X', 'Slett sone'],
  toSandbox: ['M', 'Flytt innhold til sandkassen'],
} as const

export type EditorShortcut = keyof typeof EDITOR_SHORTCUTS

export function editorShortcutFor(event: KeyboardEvent): EditorShortcut | undefined {
  // Ctrl + Alt, eller ⌘ + Ctrl på Mac. AltGr kan også rapportere Ctrl + Alt.
  if (
    !event.ctrlKey ||
    event.altKey === event.metaKey ||
    event.shiftKey ||
    event.isComposing ||
    event.getModifierState('AltGraph')
  ) return undefined
  return (Object.keys(EDITOR_SHORTCUTS) as EditorShortcut[]).find(
    (action) => event.code === `Key${EDITOR_SHORTCUTS[action][0]}`,
  )
}
