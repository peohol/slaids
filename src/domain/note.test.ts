/**
 * Notat: redaksjonell tekst som hører til en sone og aldri vises for publikum.
 *
 * The rules this file checks are the ones that make a note a content kind of
 * its own rather than a variation on air:
 *
 *  - it is a real `ZoneContentKind`, so everything that walks content reaches
 *    it — serialisation, cloning, the sandbox, an export and back again;
 *  - it carries a payload, which is what makes it *different* from air, and
 *    therefore what a conversion in either direction has to refuse rather than
 *    quietly throw away;
 *  - it never reaches an audience: what leaves the machine as a published
 *    snapshot carries the zone and not the text.
 *
 * Written against those rules rather than against one example deck: every
 * other kind is asked the conversion question, and the snapshot is checked by
 * searching the published JSON rather than by reading the field the test
 * already knows about.
 */

import { describe, expect, it } from 'vitest'
import { MAX_NOTE_CHARS, NOTE_PURPOSES } from './constants'
import {
  contentConversionRefusal,
  contentIsEmpty,
  contentLabel,
  createContentOfKind,
  createNote,
  createUntitledCard,
  ZONE_CONTENT_KINDS,
} from './content'
import { setContentKind, setNoteText, setZoneContent } from './commands'
import { minimumSizeForKind } from './contentSize'
import { estimateFit } from './fit'
import { cloneContentWithNewIds, createLeaf, findLeaf } from './layout'
import { createPresentation, duplicatePresentationDocument } from './presentation'
import { paragraphDoc } from './richdoc'
import { validateClipboardPayload, validatePresentation } from './schema'
import { migratePresentation } from './migrations'
import { buildSharedSnapshot, parseSharedSnapshot } from './sharing'
import { contentAt } from './testDecks'
import type { NoteContent, Presentation, Rect, ZoneContent } from './types'

const PROMPT = 'Fotorealistisk rekonstruksjon, halvfigur, motivet i venstre tredjedel.'
const ROOMY: Rect = { x: 0, y: 0, width: 1400, height: 700 }

function deckWithNote(note: NoteContent = createNote(PROMPT, 'image-prompt')): {
  presentation: Presentation
  slideId: string
  nodeId: string
} {
  const base = createPresentation({ title: 'Notat' })
  const slide = contentAt(base, 1)
  const placed = setZoneContent(base, {
    slideId: slide.id,
    nodeId: slide.root.id,
    content: note,
  })
  if (!placed.ok) throw new Error(placed.error.message)
  return {
    presentation: placed.value.presentation,
    slideId: slide.id,
    nodeId: slide.root.id,
  }
}

function noteIn(presentation: Presentation, slideId: string, nodeId: string): NoteContent {
  const content = findLeaf(contentAt(presentation, 1).root, nodeId)?.content
  if (!content || content.kind !== 'note') throw new Error(`${slideId}/${nodeId} holder ikke et notat`)
  return content
}

describe('note er en ekte innholdstype', () => {
  it('er med i domenets egen liste, med sin egen etikett', () => {
    expect(ZONE_CONTENT_KINDS).toContain('note')
    expect(createContentOfKind('note').kind).toBe('note')
    expect(contentLabel(createNote())).toBe('Notat')
  })

  it('er ikke det samme som negativt rom', () => {
    // Both draw nothing; what tells them apart is what they mean, and the only
    // thing anybody may read it off is the kind.
    expect(createNote().kind).not.toBe(createContentOfKind('negative-space').kind)
    expect(createLeaf(createNote()).content?.kind).toBe('note')
  })

  it('sier hva det er for, og sier «Bildeprompt» når det er en bildeprompt', () => {
    expect(createNote().purpose).toBe('general')
    expect(contentLabel(createNote(PROMPT, 'image-prompt'))).toBe('Bildeprompt')
    expect([...NOTE_PURPOSES]).toEqual(['general', 'image-prompt'])
  })

  it('teller som tomt bare når ingen har skrevet noe i det', () => {
    expect(contentIsEmpty(createNote())).toBe(true)
    expect(contentIsEmpty(createNote('   '))).toBe(true)
    expect(contentIsEmpty(createNote(PROMPT))).toBe(false)
  })

  it('har ingen minstestørrelse og kan aldri flyte over', () => {
    expect(minimumSizeForKind('note')).toEqual({ width: 0, height: 0 })
    const long = createNote(PROMPT.repeat(20), 'image-prompt')
    expect(estimateFit(long, { x: 0, y: 0, width: 1, height: 1 })).toEqual({
      fits: true,
      overflow: 0,
      parts: {},
    })
  })
})

describe('notatets tekst overlever alt som kopierer innhold', () => {
  it('serialiseres og valideres som en del av presentasjonen', () => {
    const { presentation } = deckWithNote()
    const roundTripped = JSON.parse(JSON.stringify(presentation)) as unknown
    const validated = validatePresentation(roundTripped)
    expect(validated.issues).toEqual([])
    expect(validated.ok).toBe(true)
  })

  it('leses uendret tilbake gjennom migrasjonskjeden — en import av en .slaids-fil', () => {
    const { presentation, slideId, nodeId } = deckWithNote()
    const imported = migratePresentation(JSON.parse(JSON.stringify(presentation)))
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(noteIn(imported.value, slideId, nodeId)).toEqual({
      ...noteIn(presentation, slideId, nodeId),
    })
  })

  it('avvises av skjemaet når teksten er lengre enn grensen', () => {
    const { presentation, slideId, nodeId } = deckWithNote(createNote('x'.repeat(MAX_NOTE_CHARS + 1)))
    expect(validatePresentation(JSON.parse(JSON.stringify(presentation))).ok).toBe(false)
    // …and the command refuses before it can get there, naming the number.
    const refused = setNoteText(presentation, {
      slideId,
      nodeId,
      text: 'y'.repeat(MAX_NOTE_CHARS + 1),
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.details).toMatchObject({ maxChars: MAX_NOTE_CHARS })
  })

  it('kopieres med ny id og samme tekst', () => {
    const source = createNote(PROMPT, 'image-prompt')
    const copy = cloneContentWithNewIds(source) as NoteContent
    expect(copy.id).not.toBe(source.id)
    expect(copy.text).toBe(PROMPT)
    expect(copy.purpose).toBe('image-prompt')
  })

  it('kan ligge på den strukturelle utklippstavlen', () => {
    // Copy/paste of a zone moves one whole `ZoneContent` through the same
    // versioned payload every other kind uses; a note is no exception.
    const payload = {
      format: 'application/x-slaids-content',
      version: 1,
      content: createNote(PROMPT, 'image-prompt'),
      assets: [],
    }
    const parsed = validateClipboardPayload(JSON.parse(JSON.stringify(payload)))
    expect(parsed.issues).toEqual([])
    expect(parsed.value?.content).toMatchObject({ kind: 'note', text: PROMPT })
  })

  it('følger med når hele presentasjonen dupliseres', () => {
    const { presentation, slideId, nodeId } = deckWithNote()
    const { presentation: copy } = duplicatePresentationDocument(presentation)
    const copied = contentAt(copy, 1)
    const content = findLeaf(copied.root, copied.root.id)?.content as NoteContent | undefined
    expect(content?.text).toBe(PROMPT)
    expect(content?.id).not.toBe(noteIn(presentation, slideId, nodeId).id)
  })
})

describe('setNoteText', () => {
  it('skriver teksten, og lar formålet stå når kallet ikke nevner det', () => {
    const { presentation, slideId, nodeId } = deckWithNote(createNote('', 'image-prompt'))
    const written = setNoteText(presentation, { slideId, nodeId, text: PROMPT })
    expect(written.ok).toBe(true)
    if (!written.ok) return
    expect(noteIn(written.value, slideId, nodeId)).toMatchObject({
      text: PROMPT,
      purpose: 'image-prompt',
    })
  })

  it('endrer formålet uten å røre teksten', () => {
    const { presentation, slideId, nodeId } = deckWithNote(createNote(PROMPT, 'general'))
    const written = setNoteText(presentation, { slideId, nodeId, purpose: 'image-prompt' })
    expect(written.ok).toBe(true)
    if (!written.ok) return
    expect(noteIn(written.value, slideId, nodeId)).toMatchObject({
      text: PROMPT,
      purpose: 'image-prompt',
    })
  })

  it('skriver aldri om teksten under markøren', () => {
    /*
     * The note dialog is a controlled field that runs this command on every
     * keystroke and shows back what was stored, exactly as the image brief's
     * is — so the same rule holds, and for the same reason. Modelled as the
     * loop the component actually is: what the field shows after a keystroke
     * is what was stored, and the next keystroke is appended to that.
     */
    const { presentation, slideId, nodeId } = deckWithNote(createNote())
    let current = presentation
    let shown = ''
    for (const character of 'Halvfigur, motivet i venstre tredjedel.\n\nIngen tekst.') {
      const written = setNoteText(current, { slideId, nodeId, text: shown + character })
      expect(written.ok, `avvist etter «${shown}»`).toBe(true)
      if (!written.ok) return
      current = written.value
      shown = noteIn(current, slideId, nodeId).text
    }
    expect(shown).toBe('Halvfigur, motivet i venstre tredjedel.\n\nIngen tekst.')
  })

  it('svarer med det samme dokumentet når ingenting endres', () => {
    const { presentation, slideId, nodeId } = deckWithNote()
    const same = setNoteText(presentation, { slideId, nodeId, text: PROMPT })
    expect(same.ok).toBe(true)
    if (same.ok) expect(same.value).toBe(presentation)
  })

  it('avvises på en sone som ikke har et notat', () => {
    const base = createPresentation({ title: 'Uten notat' })
    const slide = contentAt(base, 1)
    const placed = setZoneContent(base, {
      slideId: slide.id,
      nodeId: slide.root.id,
      content: createUntitledCard(),
    })
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    const refused = setNoteText(placed.value.presentation, {
      slideId: slide.id,
      nodeId: slide.root.id,
      text: PROMPT,
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('INVALID_CONTENT')
  })
})

describe('konvertering: et notat er redaksjonelt arbeid, ikke innhold på sliden', () => {
  const withText: ZoneContent = (() => {
    const card = createUntitledCard()
    return {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc('noe tekst') }],
      },
    }
  })()

  it('nekter å gjøre en sone med innhold om til et notat', () => {
    expect(contentConversionRefusal(withText, 'note')).toContain('Tøm sonen først')
  })

  it('nekter å gjøre et notat med tekst om til noe annet', () => {
    const note = createNote(PROMPT, 'image-prompt')
    for (const kind of ZONE_CONTENT_KINDS) {
      if (kind === 'note') {
        expect(contentConversionRefusal(note, kind), kind).toBeNull()
        continue
      }
      expect(contentConversionRefusal(note, kind), kind).toContain('Tøm sonen først')
    }
  })

  it('slipper et tomt notat gjennom til hvilken som helst type', () => {
    const empty = createNote()
    for (const kind of ZONE_CONTENT_KINDS) {
      expect(contentConversionRefusal(empty, kind), kind).toBeNull()
    }
  })

  it('avviser konverteringen som kommando, med sandkassen som veien videre', () => {
    const { presentation, slideId, nodeId } = deckWithNote()
    const refused = setContentKind(presentation, { slideId, nodeId, kind: 'image' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.error.code).toBe('INVALID_CONTENT')
      expect(refused.error.message).toContain('sandkassen')
    }
  })

  it('lar et tomt notat bli et bilde i nøyaktig samme sone', () => {
    const { presentation, slideId, nodeId } = deckWithNote(createNote())
    const converted = setContentKind(presentation, { slideId, nodeId, kind: 'image' })
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    const slide = contentAt(converted.value, 1)
    expect(slide.root.id).toBe(nodeId)
    expect(findLeaf(slide.root, nodeId)?.content?.kind).toBe('image')
  })

  it('parkerer notatet i sandkassen når et bilde erstatter det', () => {
    // The gesture the whole workflow ends with: the picture has arrived, and it
    // takes the zone the note was reserving. The prompt is not destroyed — the
    // ordinary replace semantics park it, so it can be used again.
    const { presentation, slideId, nodeId } = deckWithNote()
    const replaced = setZoneContent(presentation, {
      slideId,
      nodeId,
      content: createContentOfKind('image'),
      replace: true,
    })
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) return
    const slide = contentAt(replaced.value.presentation, 1)
    expect(slide.root.id).toBe(nodeId)
    expect(findLeaf(slide.root, nodeId)?.content?.kind).toBe('image')
    expect(replaced.value.presentation.sandbox.map((item) => item.content)).toContainEqual(
      expect.objectContaining({ kind: 'note', text: PROMPT }),
    )
  })
})

describe('publisering bærer sonen, aldri teksten', () => {
  it('tømmer notatet i det som faktisk sendes ut', () => {
    const { presentation } = deckWithNote()
    const snapshot = buildSharedSnapshot(presentation)
    // Searched in the published JSON rather than read off the field the test
    // already knows about: what must not leave is the string, wherever it sits.
    expect(JSON.stringify(snapshot)).not.toContain(PROMPT)
  })

  it('beholder sonen, så komposisjonen er den forfatteren la opp', () => {
    const { presentation, nodeId } = deckWithNote()
    const snapshot = buildSharedSnapshot(presentation)
    const parsed = parseSharedSnapshot(snapshot)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const slide = parsed.value.slides[1]
    if (slide.kind !== 'content') throw new Error('Slide 1 skulle vært en innholdsslide')
    expect(slide.root.id).toBe(nodeId)
    expect(findLeaf(slide.root, nodeId)?.content).toMatchObject({ kind: 'note', text: '' })
  })

  it('publiserer aldri bildebriefen', () => {
    const { presentation } = deckWithNote()
    const brief = 'Dempet jordfargepalett, naturlig dagslys, ingen tekst i bildene.'
    const snapshot = buildSharedSnapshot({ ...presentation, imageBrief: brief })
    expect(JSON.stringify(snapshot)).not.toContain(brief)
    expect(snapshot).not.toHaveProperty('imageBrief')
  })

  it('lar en sone i ro når den ikke holder et notat', () => {
    const base = createPresentation({ title: 'Uten notat' })
    const snapshot = buildSharedSnapshot(base)
    expect(snapshot.slides).toEqual(base.slides)
  })

  it('måler ikke notatsonen annerledes fordi teksten er borte', () => {
    // A note has no minimum size whatever it says, so emptying it on the way
    // out cannot make a published deck lay out differently from the private one.
    expect(estimateFit(createNote(PROMPT), ROOMY)).toEqual(estimateFit(createNote(), ROOMY))
  })
})
