/**
 * The one asset ingress policy, and the doors that must use it.
 *
 * Two kinds of test live here. The first is what `acceptAsset` accepts and what
 * it hands back — the rules themselves. The second is mechanical: it reads the
 * source tree and checks that every place that writes bytes into the asset
 * store either goes through this module or is one of the named internal copies.
 * That one is here because the failure it catches is silent: a new upload path
 * that forgets the door would compile, pass every other test, and quietly
 * accept an SVG nothing had parsed.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acceptAsset } from './assetIngress'
import { MAX_ASSET_BYTES } from './constants'
import { realImages, IMAGE_WIDTH, IMAGE_HEIGHT } from './testImages'
import { SVG_NAMESPACE } from './svg'

const FIGURE = `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 100 50"><rect width="100" height="50" fill="#123"/></svg>`

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function accepted(bytes: Uint8Array, raster: 'bitstream' | 'caller' = 'bitstream') {
  const result = acceptAsset(bytes, { raster })
  if (!result.ok) throw new Error(`Forventet at filen ble godtatt, fikk ${result.error.code}`)
  return result.value
}

function rejection(bytes: Uint8Array, raster: 'bitstream' | 'caller' = 'bitstream') {
  const result = acceptAsset(bytes, { raster })
  if (result.ok) throw new Error('Forventet at filen ble avvist')
  return result.error
}

describe('acceptAsset – SVG', () => {
  it('lagrer den saniterte reserialiseringen, ikke kallerens bytes', () => {
    const result = accepted(utf8(`<svg viewBox="0 0 10 10"><rect width="10" height="10"/><blink/></svg>`))
    const markup = new TextDecoder().decode(result.bytes)

    expect(result.mimeType).toBe('image/svg+xml')
    expect(result.isVector).toBe(true)
    expect(result.size).toEqual({ width: 10, height: 10 })
    expect(markup).not.toContain('blink')
    expect(markup).toContain('<rect')
    expect(result.report?.removedElements).toEqual(['blink'])
  })

  it('avviser skript og hendelsesattributter som UNSAFE_SVG', () => {
    expect(rejection(utf8(`<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>`)).code).toBe(
      'UNSAFE_SVG',
    )
    expect(rejection(utf8(`<svg viewBox="0 0 1 1"><rect onclick="alert(1)"/></svg>`)).code).toBe(
      'UNSAFE_SVG',
    )
  })

  it('avviser eksterne referanser og CSS-omveier', () => {
    const external = `<svg viewBox="0 0 1 1"><image href="https://evil.example/x.png"/></svg>`
    expect(rejection(utf8(external)).code).toBe('UNSAFE_SVG')

    const cssUrl = `<svg viewBox="0 0 1 1"><rect fill="url(https://evil.example/x)"/></svg>`
    expect(rejection(utf8(cssUrl)).code).toBe('UNSAFE_SVG')

    const escaped = `<svg viewBox="0 0 1 1"><rect style="fill:\\75 rl(https://evil.example/x)"/></svg>`
    expect(rejection(utf8(escaped)).code).toBe('UNSAFE_SVG')
  })

  it('avviser en SVG uten kjent størrelsesforhold', () => {
    expect(rejection(utf8('<svg><rect/></svg>')).code).toBe('INVALID_SVG')
  })

  it('leser formatet av bytene, ikke av det filen kalles', () => {
    // A file the caller would call a PNG, holding markup. It is an SVG, and it
    // is sanitised as one — otherwise naming a file is how the sanitiser gets
    // skipped.
    const result = accepted(utf8(FIGURE))
    expect(result.isVector).toBe(true)
  })

  it('måler grensen på det som faktisk lagres', () => {
    // A raw `&` is one byte in and five out, so markup under the limit crosses
    // it on the way back out.
    const ampersands = '&'.repeat(Math.ceil(MAX_ASSET_BYTES / 4))
    const markup = `<svg viewBox="0 0 1 1"><text>${ampersands}</text></svg>`
    expect(markup.length).toBeLessThan(MAX_ASSET_BYTES)
    expect(rejection(utf8(markup)).code).toBe('ASSET_TOO_LARGE')
  })

  it('svarer INVALID_SVG når kalleren sa at dette var SVG', () => {
    const result = acceptAsset(realImages.png(), { raster: 'bitstream', expect: 'vector' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_SVG')
  })

  it('behandler SVG likt i begge rastermodusene', () => {
    const strict = accepted(utf8(FIGURE), 'bitstream')
    const lenient = accepted(utf8(FIGURE), 'caller')
    expect(lenient).toEqual(strict)
  })
})

describe('acceptAsset – raster', () => {
  it('lar bytene stå urørt og leser størrelsen ut av bitstrømmen', () => {
    const png = realImages.png()
    const result = accepted(png)
    expect(result).toMatchObject({ mimeType: 'image/png', isVector: false })
    expect(result.size).toEqual({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT })
    expect(result.bytes).toBe(png)
    expect(result.report).toBeUndefined()
  })

  it('går gjennom den etablerte rastervalideringen for hvert format', () => {
    for (const bytes of [realImages.png(), realImages.jpeg(), realImages.gif(), realImages.webp()]) {
      expect(accepted(bytes).size).toEqual({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT })
    }
  })

  it('avviser en avkortet fil i bitstream-modus', () => {
    const truncated = realImages.png().slice(0, 40)
    expect(rejection(truncated).code).toBe('INVALID_IMAGE')
  })

  it('lar en dør som måler selv slippe unna størrelsen, men ikke SVG-regelen', () => {
    const result = accepted(realImages.png().slice(0, 40), 'caller')
    expect(result.size).toBeNull()
    expect(result.mimeType).toBe('image/png')
  })

  it('avviser noe som ikke er et bildeformat i det hele tatt', () => {
    expect(rejection(utf8('<html><body>hei</body></html>')).code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(rejection(new Uint8Array(0)).code).toBe('INVALID_ARGUMENT')
  })
})

/* ------------------------------------------------------------------ *
 * Every door
 * ------------------------------------------------------------------ */

const ROOT = join(process.cwd(), 'src')

/**
 * The paths that copy bytes already inside Slaids from one place to another.
 *
 * Named rather than pattern-matched, and the reason is the same one
 * `boundary.test.ts` gives: a rule that says "some file that copies assets" is a
 * rule that grows a second such file without anybody noticing. These two hold a
 * blob they read out of Slaids' own store, so the file came through the door
 * when it first arrived; nothing external reaches them. Everything else that
 * writes bytes must go through `assetIngress.ts`.
 */
const INTERNAL_COPIES = ['src/state/pasteAssets.ts', 'src/persistence/library.ts']

/** The repository layer, which implements `putAsset` rather than calling it. */
const REPOSITORY_LAYER = [
  'src/persistence/activeRepository.ts',
  'src/persistence/dexieRepository.ts',
  'src/persistence/supabaseRepository.ts',
  'src/persistence/repository.ts',
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return []
    return /\.test\.tsx?$/.test(entry.name) ? [] : [full]
  })
}

describe('dørene inn til assetlageret', () => {
  it('går gjennom den felles ingress-policyen, eller er en navngitt intern kopi', () => {
    const known = new Set([...INTERNAL_COPIES, ...REPOSITORY_LAYER].map((name) => join(...name.split('/'))))
    // The import clause, so a mention in a comment cannot stand in for a call.
    const usesTheDoor = /import\s*\{[^}]*\bacceptAsset\b[^}]*\}\s*from/
    const offenders = sourceFiles(ROOT)
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return /\bputAsset\s*\(/.test(source) && !usesTheDoor.test(source)
      })
      .map((file) => relative(process.cwd(), file))
      .filter((name) => !known.has(name))

    expect(offenders).toEqual([])
  })

  it('kaller saniteringen fra nøyaktig ett sted', () => {
    /*
     * `sanitizeSvg` has one caller, and that is what makes "the same rules
     * whichever door you came through" a property of the code rather than a
     * promise. A second caller would be free to read the result differently —
     * to keep the input instead of the re-serialisation, to treat a dropped
     * element as a rejection or the other way round — and the two doors would
     * drift apart without anything failing.
     */
    // The import clause, not the word: `imageBytes.ts` and `imageFile.ts` both
    // name the sanitiser in a comment to say that SVG is not their business.
    const imported = /import\s*\{[^}]*\bsanitizeSvg\b[^}]*\}\s*from/
    const callers = sourceFiles(ROOT)
      .filter((file) => imported.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file))

    expect(callers).toEqual([join('src', 'domain', 'assetIngress.ts')])
  })
})
