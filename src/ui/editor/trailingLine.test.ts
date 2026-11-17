// @vitest-environment jsdom
/**
 * The line below a picture, in the editor.
 *
 * Three halves of one rule, and they only work together: the document never
 * carries the line, a field being edited does, and a field nobody is standing
 * in gives it back. The last one is what keeps content mode, zone mode and
 * presentation mode drawing the same slide — and, through the same frame, what
 * keeps the offscreen fit measurement honest.
 *
 * Focus is driven with the events the browser would send rather than with
 * `commands.focus()`: jsdom cannot really focus a contenteditable, and the
 * whole rule turns on whether the editor believes it has focus.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { trimTrailingBlankLines } from '../../domain/richdoc'
import type { RichDoc } from '../../domain/types'
import { bodyExtensions } from './extensions'

const mounted: { editor: Editor; element: HTMLElement }[] = []

function editorWith(content: RichDoc, editable = true): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: bodyExtensions({}), content, editable })
  mounted.push({ editor, element })
  return editor
}

function focus(editor: Editor): void {
  editor.view.dom.dispatchEvent(new FocusEvent('focus'))
}

function blur(editor: Editor): void {
  editor.view.dom.dispatchEvent(new FocusEvent('blur'))
}

afterEach(() => {
  for (const { editor, element } of mounted.splice(0)) {
    editor.destroy()
    element.remove()
  }
})

const emptyField: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
const image = { type: 'slaidsImage', attrs: { assetId: 'a1', alt: '', widthPercent: 50 } }
const caption = { type: 'paragraph', content: [{ type: 'text', text: 'Bildetekst' }] }

const types = (editor: Editor): string[] =>
  (editor.getJSON().content ?? []).map((node) => node.type ?? '')

const meant = (editor: Editor): string[] =>
  (trimTrailingBlankLines(editor.getJSON() as RichDoc).content ?? []).map((node) => node.type ?? '')

describe('the line below a picture', () => {
  it('appears when the field is entered, not when it is merely drawn', () => {
    // A field nobody is standing in is drawn exactly as the slide draws it.
    const editor = editorWith({ type: 'doc', content: [image] })
    expect(types(editor)).toEqual(['slaidsImage'])

    focus(editor)
    expect(types(editor)).toEqual(['slaidsImage', 'paragraph'])
  })

  it('is there to write on after a picture is inserted', () => {
    const editor = editorWith(emptyField)
    focus(editor)
    editor.commands.insertSlaidsImage({ assetId: 'a1', alt: '' })
    expect(types(editor)).toEqual(['slaidsImage', 'paragraph'])
  })

  it('never reaches the document', () => {
    const editor = editorWith(emptyField)
    focus(editor)
    editor.commands.insertSlaidsImage({ assetId: 'a1', alt: '' })
    expect(meant(editor)).toEqual(['slaidsImage'])
  })

  it('is stable: what the editor means does not change by being read back', () => {
    // The document the store keeps is the trimmed one. Loading it back has to
    // land on the same trimmed document, or the editor and the store would
    // disagree forever and every keystroke would be followed by a reset.
    const editor = editorWith(emptyField)
    focus(editor)
    editor.commands.insertSlaidsImage({ assetId: 'a1', alt: '' })
    const stored = trimTrailingBlankLines(editor.getJSON() as RichDoc)

    const reopened = editorWith(stored)
    expect(trimTrailingBlankLines(reopened.getJSON() as RichDoc)).toEqual(stored)
  })

  it('becomes content the moment it is written in', () => {
    const editor = editorWith({ type: 'doc', content: [image] })
    focus(editor)
    editor.commands.focus('end')
    editor.commands.insertContent('Bildetekst')
    expect(meant(editor)).toEqual(['slaidsImage', 'paragraph'])
  })

  it('goes away again when the field is left with it empty', () => {
    const editor = editorWith({ type: 'doc', content: [image] })
    focus(editor)
    expect(types(editor)).toEqual(['slaidsImage', 'paragraph'])

    blur(editor)
    expect(types(editor)).toEqual(['slaidsImage'])
  })

  it('gives back a blank line the author left behind, too', () => {
    // Not only the line under a picture: any trailing blank line is a line of
    // nothing, and the slide has none of them.
    const editor = editorWith({ type: 'doc', content: [caption] })
    focus(editor)
    editor.commands.focus('end')
    editor.commands.splitBlock()
    expect(types(editor)).toEqual(['paragraph', 'paragraph'])

    blur(editor)
    expect(types(editor)).toEqual(['paragraph'])
  })

  it('is not added to a field whose last block can hold a caret', () => {
    const editor = editorWith({ type: 'doc', content: [image, caption] })
    focus(editor)
    expect(types(editor)).toEqual(['slaidsImage', 'paragraph'])
  })

  it('is chrome, so a read-only editor never gets one', () => {
    const editor = editorWith({ type: 'doc', content: [image] }, false)
    focus(editor)
    expect(types(editor)).toEqual(['slaidsImage'])
  })
})
