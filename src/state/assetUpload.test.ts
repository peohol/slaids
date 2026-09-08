/**
 * The editor's door, and that it is the same door as the agent's.
 *
 * These run against a real `DexieSlaidsRepository` rather than a stub, because
 * what is being checked is what ends up *in the store*: the bytes, and — for a
 * file that is refused — that there is nothing there at all. A stub could only
 * confirm which method was called.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createPresentation } from '../domain/presentation'
import { realImages, IMAGE_HEIGHT, IMAGE_WIDTH } from '../domain/testImages'
import { SVG_NAMESPACE } from '../domain/svg'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import { SlaidsDatabase } from '../persistence/db'
import { setRepositoryOverride } from '../persistence/activeRepository'
import { storeAsset } from '../agent/assetStore'
import type { Presentation } from '../domain/types'
import { describeSanitizing, storeUploadedFile } from './assetUpload'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshRepository(): DexieSlaidsRepository {
  counter += 1
  const database = new SlaidsDatabase(`slaids-upload-${counter}`)
  databases.push(database)
  const repository = new DexieSlaidsRepository(database)
  setRepositoryOverride(repository)
  return repository
}

afterEach(async () => {
  setRepositoryOverride(null)
  while (databases.length > 0) await databases.pop()?.delete()
})

async function seed(repository: DexieSlaidsRepository): Promise<Presentation> {
  const presentation = createPresentation({ title: 'Opplastingstest' })
  await repository.savePresentation(presentation)
  return presentation
}

function pick(markup: string, name = 'figur.svg', type = 'image/svg+xml'): File {
  return new File([markup], name, { type })
}

/** A picked file holding exactly these bytes. */
function picked(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name, { type })
}

const FIGURE = `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 100 50"><rect width="100" height="50" fill="#123456"/></svg>`

/** Every way a picture can try to run or fetch something, one per door. */
const REFUSED: [string, string, string][] = [
  ['<script>', `<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>`, 'UNSAFE_SVG'],
  ['onclick', `<svg viewBox="0 0 1 1"><rect onclick="alert(1)" width="1" height="1"/></svg>`, 'UNSAFE_SVG'],
  [
    'ekstern href',
    `<svg viewBox="0 0 1 1"><image href="https://evil.example/pixel.png" width="1" height="1"/></svg>`,
    'UNSAFE_SVG',
  ],
  [
    'ekstern url() i CSS',
    `<svg viewBox="0 0 1 1"><rect style="fill:url(https://evil.example/x)" width="1" height="1"/></svg>`,
    'UNSAFE_SVG',
  ],
  [
    'CSS-escape rundt url(',
    `<svg viewBox="0 0 1 1"><rect style="fill:\\75 rl(https://evil.example/x)" width="1" height="1"/></svg>`,
    'UNSAFE_SVG',
  ],
  [
    'image-set() med en naken streng',
    `<svg viewBox="0 0 1 1"><rect style="fill:image-set('https://evil.example/x' 1x)" width="1" height="1"/></svg>`,
    'UNSAFE_SVG',
  ],
  [
    'javascript: i en lenke',
    `<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>`,
    'UNSAFE_SVG',
  ],
  ['egne entiteter i doctype', `<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>`, 'UNSAFE_SVG'],
  ['ikke en brukbar SVG', `<svg viewBox="0 0 1 1"><rect`, 'INVALID_SVG'],
]

describe('editorens opplasting av SVG', () => {
  it('godtar en trygg SVG og lagrer den saniterte reserialiseringen', async () => {
    const repository = freshRepository()
    const presentation = await seed(repository)

    const stored = await storeUploadedFile(
      presentation,
      pick(`<svg viewBox="0 0 100 50"><rect width="100" height="50"/><blink/></svg>`),
    )
    expect(stored.ok).toBe(true)
    if (!stored.ok) return

    expect(stored.value.ref).toMatchObject({
      name: 'figur.svg',
      mimeType: 'image/svg+xml',
      isVector: true,
      width: 100,
      height: 50,
    })

    const file = await repository.getAsset(stored.value.ref.id)
    const markup = await file!.blob.text()
    // What is stored is what came out of the parser, not what was picked.
    expect(markup).not.toContain('blink')
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(stored.value.ref.byteSize).toBe(new TextEncoder().encode(markup).byteLength)
    expect(describeSanitizing(stored.value.report)).toContain('<blink>')
  })

  it.each(REFUSED)('avviser %s uten å lagre noe', async (_label, markup, code) => {
    const repository = freshRepository()
    const presentation = await seed(repository)

    const stored = await storeUploadedFile(presentation, pick(markup, 'ondsinnet.svg'))
    expect(stored.ok).toBe(false)
    if (stored.ok) return
    expect(stored.error.code).toBe(code)

    // Nothing anywhere: no bytes, no asset row, and the document untouched —
    // the rejection happened before the first write rather than being undone
    // after it.
    expect(await repository.listAssets(presentation.id)).toEqual([])
    expect((await repository.loadPresentation(presentation.id)).assets).toEqual([])
    expect(await repository.deleteOrphanAssets()).toBe(0)
  })

  it('bevarer teksten i en fil som oppgir en annen tegnkoding enn UTF-8', async () => {
    const repository = freshRepository()
    const presentation = await seed(repository)

    // An older Illustrator export on Windows. Read as UTF-8 every accented
    // letter comes back as U+FFFD, and the figure that gets stored has mangled
    // text in it — worse than a refusal, because nobody is told.
    const markup = `<?xml version="1.0" encoding="ISO-8859-1"?><svg viewBox="0 0 100 50"><text>Blåbærsyltetøy</text></svg>`
    const latin1 = new Uint8Array(markup.length)
    for (let i = 0; i < markup.length; i += 1) latin1[i] = markup.charCodeAt(i)

    const stored = await storeUploadedFile(presentation, picked(latin1, 'figur.svg', 'image/svg+xml'))
    expect(stored.ok).toBe(true)
    if (!stored.ok) return

    const file = await repository.getAsset(stored.value.ref.id)
    const text = await file!.blob.text()
    expect(text).toContain('Blåbærsyltetøy')
    expect(text).not.toContain('\uFFFD')
  })

  it('leser formatet av bytene, ikke av filnavnet', async () => {
    const repository = freshRepository()
    const presentation = await seed(repository)

    // Markup wearing a `.png` name and a raster MIME type. Believing either
    // would be how the sanitiser gets skipped.
    const stored = await storeUploadedFile(
      presentation,
      pick(`<svg viewBox="0 0 4 2"><script>alert(1)</script></svg>`, 'ikke-en-svg.png', 'image/png'),
    )
    expect(stored.ok).toBe(false)
    if (!stored.ok) expect(stored.error.code).toBe('UNSAFE_SVG')
  })

  it('lagrer aldri en fil som image/svg+xml uten at parseren har sett den', async () => {
    const repository = freshRepository()
    const presentation = await seed(repository)

    // A PNG that calls itself an SVG. It is stored as the PNG it is, so the
    // blob is never served with a type that would make it active content.
    const stored = await storeUploadedFile(
      presentation,
      picked(realImages.png(), 'lurt.svg', 'image/svg+xml'),
    )
    expect(stored.ok).toBe(true)
    if (!stored.ok) return
    expect(stored.value.ref).toMatchObject({ mimeType: 'image/png', isVector: false })
  })
})

describe('editorens opplasting av rasterbilder', () => {
  it.each([
    ['png', realImages.png, 'image/png'],
    ['jpeg', realImages.jpeg, 'image/jpeg'],
    ['gif', realImages.gif, 'image/gif'],
    ['webp', realImages.webp, 'image/webp'],
  ])('lagrer en %s uendret, med størrelsen fra filen', async (name, bytes, mimeType) => {
    const repository = freshRepository()
    const presentation = await seed(repository)
    const source = bytes()

    const stored = await storeUploadedFile(
      presentation,
      picked(source, `bilde.${name}`, mimeType),
    )
    expect(stored.ok).toBe(true)
    if (!stored.ok) return

    expect(stored.value.ref).toMatchObject({
      mimeType,
      isVector: false,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      byteSize: source.byteLength,
    })
    expect(stored.value.report).toBeUndefined()

    const file = await repository.getAsset(stored.value.ref.id)
    expect(new Uint8Array(await file!.blob.arrayBuffer())).toEqual(source)
  })

  it('avviser noe som ikke er et bildeformat i det hele tatt', async () => {
    const repository = freshRepository()
    const presentation = await seed(repository)

    const stored = await storeUploadedFile(
      presentation,
      new File(['bare tekst'], 'notat.txt', { type: 'text/plain' }),
    )
    expect(stored.ok).toBe(false)
    if (!stored.ok) expect(stored.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(await repository.listAssets(presentation.id)).toEqual([])
  })
})

describe('de to dørene', () => {
  it('gir samme resultat for den samme SVG-en', async () => {
    const repository = freshRepository()
    const presentation = await seed(repository)
    const markup = `<svg viewBox="0 0 100 50"><style>rect{fill:red}</style><rect width="100" height="50"/><blink/></svg>`

    const throughEditor = await storeUploadedFile(presentation, pick(markup))
    const throughAgent = await storeAsset(
      { repository },
      { presentationId: presentation.id, name: 'figur.svg', bytes: new TextEncoder().encode(markup) },
    )
    expect(throughEditor.ok && throughAgent.ok).toBe(true)
    if (!throughEditor.ok || !throughAgent.ok) return

    const editorFile = await repository.getAsset(throughEditor.value.ref.id)
    const agentFile = await repository.getAsset(throughAgent.value.ref.id)
    expect(await editorFile!.blob.text()).toBe(await agentFile!.blob.text())

    // The same picture, described the same way — only the id differs.
    const { id: _editorId, ...editorRef } = throughEditor.value.ref
    const { id: _agentId, ...agentRef } = throughAgent.value.ref
    expect(editorRef).toEqual(agentRef)
    expect(throughEditor.value.report).toEqual(throughAgent.value.sanitized)
  })

  it.each(REFUSED)('avviser %s med den samme koden', async (_label, markup, code) => {
    const repository = freshRepository()
    const presentation = await seed(repository)

    const throughEditor = await storeUploadedFile(presentation, pick(markup))
    const throughAgent = await storeAsset(
      { repository },
      { presentationId: presentation.id, name: 'figur.svg', bytes: new TextEncoder().encode(markup) },
    )

    expect(throughEditor.ok).toBe(false)
    expect(throughAgent.ok).toBe(false)
    if (throughEditor.ok || throughAgent.ok) return
    expect(throughEditor.error.code).toBe(code)
    expect(throughAgent.error.code).toBe(code)
    expect(throughEditor.error.message).toBe(throughAgent.error.message)
  })

  it('godtar den samme trygge figuren gjennom begge', async () => {
    const repository = freshRepository()
    const presentation = await seed(repository)

    const throughEditor = await storeUploadedFile(presentation, pick(FIGURE))
    const throughAgent = await storeAsset(
      { repository },
      { presentationId: presentation.id, name: 'figur.svg', bytes: new TextEncoder().encode(FIGURE) },
    )
    expect(throughEditor.ok).toBe(true)
    expect(throughAgent.ok).toBe(true)
  })
})

describe('den samme filen to ganger', () => {
  it('bruker filen presentasjonen har fra før i stedet for å lagre en kopi', async () => {
    const repository = freshRepository()
    const presentation = await seed(repository)
    const png = realImages.png()

    const first = await storeUploadedFile(presentation, picked(png, 'ferie.png', 'image/png'))
    if (!first.ok) throw new Error(first.error.message)
    expect(first.value.reused).toBe(false)
    // The file's identity is recorded, so the next comparison costs no read.
    expect(first.value.ref.contentHash).toMatch(/^[0-9a-f]{64}$/)

    const withFile = { ...presentation, assets: [first.value.ref] }
    // Another name, the same bytes: the same file.
    const second = await storeUploadedFile(withFile, picked(png, 'ferie (kopi).png', 'image/png'))
    if (!second.ok) throw new Error(second.error.message)
    expect(second.value.reused).toBe(true)
    expect(second.value.ref).toEqual(first.value.ref)
    expect((await repository.listAssets(presentation.id)).map((asset) => asset.id)).toEqual([
      first.value.ref.id,
    ])

    // A different picture is a different file. (Same size, different bytes is
    // `persistence/assetDedupe.test.ts`'s case; a corrupted file would hang on
    // jsdom's image decoder here.)
    const third = await storeUploadedFile(withFile, picked(realImages.jpeg(), 'annen.jpg', 'image/jpeg'))
    if (!third.ok) throw new Error(third.error.message)
    expect(third.value.reused).toBe(false)
    expect(third.value.ref.id).not.toBe(first.value.ref.id)
  })
})
