import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { Editor as ReactEditor } from '@tiptap/react'
import { bodyExtensions, titleExtensions } from './extensions'
import {
  alignActions,
  blockActions,
  insertTableAction,
  linkActions,
  markActions,
  scriptActions,
  tableActions,
  type TextAction,
} from './textActions'

/** Where the caret can be in a body field, as the HTML of a field with it in its first word. */
const PLACES: Record<string, string> = {
  paragraph: '<p>Hei verden</p>',
  accent: '<h1>Hei verden</h1>',
  code: '<pre><code>Hei verden</code></pre>',
  quote: '<blockquote><p>Hei verden</p></blockquote>',
  'bullet list': '<ul><li><p>Hei verden</p></li></ul>',
  'numbered list': '<ol><li><p>Hei verden</p></li></ol>',
  link: '<p><a href="https://example.com">Hei verden</a></p>',
  'one-row table': '<table><tr><td><p>Hei verden</p></td><td><p>b</p></td></tr></table>',
  table: '<table><tr><th><p>Hei verden</p></th><th><p>b</p></th></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></table>',
}

const editors: Editor[] = []
afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})

function field(html: string, selection: 'caret' | 'range', extensions = bodyExtensions({ enableTables: true })): ReactEditor {
  const editor = new Editor({ extensions, content: html })
  editors.push(editor)
  let first = -1
  editor.state.doc.descendants((node, pos) => {
    if (first < 0 && node.isText) first = pos
    return first < 0
  })
  editor.commands.setTextSelection(selection === 'caret' ? first + 2 : { from: first + 1, to: first + 5 })
  return editor as unknown as ReactEditor
}

/** Every action a body field offers wherever the caret is, the link prompt aside. */
function bodyActions(editor: ReactEditor): TextAction[] {
  return [
    ...markActions(editor),
    ...blockActions(editor),
    insertTableAction(editor),
    ...alignActions(editor),
    ...linkActions(editor).filter((action) => action.id !== 'link'),
    ...tableActions(editor),
  ]
}

function snapshot(editor: ReactEditor): { doc: string; stored: string } {
  return { doc: JSON.stringify(editor.getJSON()), stored: JSON.stringify(editor.state.storedMarks) }
}

describe('TextAction.can()', () => {
  /*
   * The toolbar disables what `can()` refuses, so `can()` has to answer for
   * what pressing the button actually does — everywhere the caret can be, not
   * only in a paragraph. Each action is run on a fresh field of its own.
   */
  for (const [place, html] of Object.entries(PLACES)) {
    for (const selection of ['caret', 'range'] as const) {
      it(`answers for what the command does: ${place}, ${selection}`, () => {
        const ids = bodyActions(field(html, selection)).map((action) => action.id)
        for (const id of ids) {
          const editor = field(html, selection)
          const action = bodyActions(editor).find((candidate) => candidate.id === id)!
          const can = action.can()
          const before = snapshot(editor)
          action.run()
          const after = snapshot(editor)
          if (can) {
            expect(after, `${id} is offered, so it does something`).not.toEqual(before)
          } else {
            expect(after.doc, `${id} is refused, so it changes nothing`).toBe(before.doc)
          }
        }
      })
    }
  }

  it('offers a list from an accent, and an accent from a list item, which a dry run without a transaction would refuse', () => {
    const accent = field(PLACES.accent, 'caret')
    expect(blockActions(accent).find((action) => action.id === 'bullet')!.can()).toBe(true)
    const item = field(PLACES['bullet list'], 'caret')
    expect(blockActions(item).find((action) => action.id === 'heading')!.can()).toBe(true)
  })

  it('refuses a mark where marks cannot go, and a row deleted from a table of one row', () => {
    const code = field(PLACES.code, 'range')
    expect(markActions(code).every((action) => !action.can())).toBe(true)
    const oneRow = field(PLACES['one-row table'], 'caret')
    expect(tableActions(oneRow).find((action) => action.id === 'del-row')!.can()).toBe(false)
  })

  it('offers only sub- and superscript in a title, both available', () => {
    const title = field('<p>Tittel</p>', 'range', titleExtensions())
    expect(scriptActions(title).map((action) => action.can())).toEqual([true, true])
  })
})

describe('TextAction.isActive', () => {
  it('is a state only for what can be in force, never for a one-off command', () => {
    const editor = field(PLACES.table, 'caret')
    const states = Object.fromEntries(bodyActions(editor).map((action) => [action.id, action.isActive !== undefined]))
    expect(states).toMatchObject({ bold: true, heading: true, bullet: true, 'align-left': true, header: true })
    expect(states).toMatchObject({ table: false, 'add-row': false, 'del-row': false, 'del-table': false })
  })

  it('follows the selection: bold, the list and the header row in force are pressed', () => {
    const bold = field('<p><strong>Hei verden</strong></p>', 'caret')
    expect(markActions(bold).find((action) => action.id === 'bold')!.isActive!()).toBe(true)
    const list = field(PLACES['bullet list'], 'caret')
    expect(blockActions(list).find((action) => action.id === 'bullet')!.isActive!()).toBe(true)
    expect(blockActions(list).find((action) => action.id === 'ordered')!.isActive!()).toBe(false)
    const header = field(PLACES.table, 'caret')
    expect(tableActions(header).find((action) => action.id === 'header')!.isActive!()).toBe(true)
  })

  it('offers taking a link off only inside one', () => {
    expect(linkActions(field(PLACES.paragraph, 'caret')).map((action) => action.id)).toEqual(['link'])
    const linked = linkActions(field(PLACES.link, 'caret'))
    expect(linked.map((action) => action.id)).toEqual(['link', 'unlink'])
    expect(linked[0].isActive!()).toBe(true)
  })
})
