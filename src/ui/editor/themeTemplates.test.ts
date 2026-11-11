/**
 * Temamaler i bruk: malens logo kopieres inn i presentasjonens eget fillager,
 * og en kopi som ikke blir brukt, tas tilbake – men aldri en fil
 * presentasjonen hadde fra før.
 */

import { describe, expect, it, vi } from 'vitest'
import { registerAsset, setThemeLogo } from '../../domain/commands'
import { createPresentation } from '../../domain/presentation'
import { err, ok, type Result } from '../../domain/result'
import { themeTemplateContent, type ThemeTemplate } from '../../domain/themeTemplate'
import type { AssetRef, Presentation } from '../../domain/types'
import type { UploadedAsset } from '../../state/assetUpload'
import {
  applyThemeTemplateToOpenDeck,
  saveThemeAsTemplate,
  startInThemeTemplate,
  type ThemeTemplateDependencies,
} from './themeTemplates'

const SOURCE_LOGO: AssetRef = {
  id: 'a_source',
  name: 'logo.png',
  mimeType: 'image/png',
  byteSize: 4,
  width: 200,
  height: 100,
  isVector: false,
}

const COPY: AssetRef = { ...SOURCE_LOGO, id: 'a_copy' }

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function sourceDeck(): Presentation {
  const base = createPresentation({ title: 'Kilde' })
  return unwrap(setThemeLogo(unwrap(registerAsset(base, SOURCE_LOGO)), SOURCE_LOGO.id))
}

function templateOf(deck: Presentation): ThemeTemplate {
  return {
    id: 'tt_1',
    name: 'Firma',
    visibility: 'shared',
    own: false,
    content: themeTemplateContent(deck).content,
    createdAt: '2026-11-11T10:00:00.000Z',
    updatedAt: '2026-11-11T10:00:00.000Z',
  }
}

/** En editor med én åpen presentasjon, som kan byttes underveis. */
function editor(initial: Presentation | null) {
  const state = {
    presentation: initial,
    run: vi.fn((_label: string, command: (p: Presentation) => Result<Presentation>) => {
      if (!state.presentation) return false
      const result = command(state.presentation)
      if (!result.ok) return false
      state.presentation = result.value
      return true
    }),
  }
  return state
}

function dependencies(
  state: ReturnType<typeof editor>,
  options: {
    reused?: boolean
    during?: () => void
    logo?: Blob | null
    refuse?: boolean
    saveFails?: boolean
    defaultFails?: boolean
  } = {},
) {
  const created: { template: unknown; logo: Blob | null }[] = []
  const deps = {
    store: { getState: () => state } as unknown as ThemeTemplateDependencies['store'],
    discard: vi.fn(async () => {}),
    storeFile: vi.fn(async (_presentation: Presentation, file: File) => {
      options.during?.()
      if (options.refuse) return err('INVALID_IMAGE', 'Bildefilen kunne ikke leses.')
      expect(file.type).toBe('image/png')
      return ok<UploadedAsset>({ ref: COPY, reused: options.reused ?? false })
    }),
    templates: {
      listThemeTemplates: vi.fn(async () => []),
      createThemeTemplate: vi.fn(async (template: unknown, logo: Blob | null) => {
        created.push({ template, logo })
      }),
      getThemeTemplateLogo: vi.fn(async () => (options.logo === undefined ? new Blob(['png!']) : options.logo)),
      deleteThemeTemplate: vi.fn(async () => {}),
    },
    library: {
      getAsset: vi.fn(async (id: string) => (id === SOURCE_LOGO.id ? { ref: SOURCE_LOGO, blob: new Blob(['png!']) } : null)),
      savePresentation: vi.fn(async () => {
        if (options.saveFails) throw new Error('nett nede')
      }),
      getUserSettings: vi.fn(),
    },
    chooseDefault: vi.fn(async (_id: string | null) => {
      if (options.defaultFails) throw new Error('innstillingen ble avvist')
    }),
  } satisfies ThemeTemplateDependencies
  return { deps, created }
}

describe('saveThemeAsTemplate', () => {
  it('lagrer temaet med en egen kopi av logofilen', async () => {
    const { deps, created } = dependencies(editor(null))
    const { template: saved, defaultChosen } = await saveThemeAsTemplate(
      sourceDeck(),
      { name: '  Firma  ', visibility: 'shared' },
      deps,
    )
    expect(saved).toMatchObject({ name: 'Firma', visibility: 'shared', own: true })
    expect(defaultChosen).toBe(false)
    expect(deps.chooseDefault).not.toHaveBeenCalled()
    expect(created).toHaveLength(1)
    expect(created[0].logo).toBeInstanceOf(Blob)
    expect(deps.library.getAsset).toHaveBeenCalledWith(SOURCE_LOGO.id)
  })

  it('gjør malen til standard når det er bedt om', async () => {
    const { deps } = dependencies(editor(null))
    const { template, defaultChosen } = await saveThemeAsTemplate(
      sourceDeck(),
      { name: 'Firma', visibility: 'private', asDefault: true },
      deps,
    )
    expect(defaultChosen).toBe(true)
    expect(deps.chooseDefault).toHaveBeenCalledWith(template.id)
  })

  it('svarer med den lagrede malen også når standardvalget feiler, så den ikke lages to ganger', async () => {
    const { deps, created } = dependencies(editor(null), { defaultFails: true })
    const { template, defaultChosen } = await saveThemeAsTemplate(
      sourceDeck(),
      { name: 'Firma', visibility: 'private', asDefault: true },
      deps,
    )
    expect(defaultChosen).toBe(false)
    expect(template.name).toBe('Firma')
    expect(created).toHaveLength(1)
  })

  it('lagrer ingenting uten navn, eller når logofilen ikke kan leses', async () => {
    const { deps, created } = dependencies(editor(null))
    await expect(saveThemeAsTemplate(sourceDeck(), { name: '   ', visibility: 'private' }, deps)).rejects.toThrow(/navn/)
    deps.library.getAsset.mockResolvedValueOnce(null)
    await expect(saveThemeAsTemplate(sourceDeck(), { name: 'X', visibility: 'private' }, deps)).rejects.toThrow(/Logofilen/)
    expect(created).toHaveLength(0)
  })
})

describe('applyThemeTemplateToOpenDeck', () => {
  it('kopierer logoen inn og setter tema, farger og logo i ett angresteg', async () => {
    const state = editor(createPresentation({ title: 'Mål' }))
    const { deps } = dependencies(state)
    expect(await applyThemeTemplateToOpenDeck(templateOf(sourceDeck()), deps)).toBe('set')
    expect(state.run).toHaveBeenCalledTimes(1)
    expect(state.presentation?.assets.map((asset) => asset.id)).toEqual([COPY.id])
    expect(state.presentation?.theme.logo?.assetId).toBe(COPY.id)
    expect(deps.discard).not.toHaveBeenCalled()
  })

  it('tar kopien tilbake når en annen presentasjon er åpnet i mellomtiden', async () => {
    const state = editor(createPresentation({ title: 'Mål' }))
    const { deps } = dependencies(state, {
      during: () => {
        state.presentation = createPresentation({ title: 'En annen' })
      },
    })
    expect(await applyThemeTemplateToOpenDeck(templateOf(sourceDeck()), deps)).toBe('moved-on')
    expect(deps.discard).toHaveBeenCalledWith([COPY.id])
  })

  it('sletter aldri en fil presentasjonen hadde fra før', async () => {
    const state = editor(createPresentation({ title: 'Mål' }))
    const { deps } = dependencies(state, {
      reused: true,
      during: () => {
        state.presentation = createPresentation({ title: 'En annen' })
      },
    })
    expect(await applyThemeTemplateToOpenDeck(templateOf(sourceDeck()), deps)).toBe('moved-on')
    expect(deps.discard).toHaveBeenCalledWith([])
  })

  it('stopper når logoen i malen er borte eller avvises, uten å endre noe', async () => {
    for (const options of [{ logo: null }, { refuse: true }]) {
      const state = editor(createPresentation({ title: 'Mål' }))
      const before = state.presentation
      const { deps } = dependencies(state, options)
      expect(await applyThemeTemplateToOpenDeck(templateOf(sourceDeck()), deps)).toBe('refused')
      expect(state.presentation).toBe(before)
    }
  })

  it('bruker en mal uten logo uten å røre fillageret', async () => {
    const state = editor(sourceDeck())
    const { deps } = dependencies(state)
    expect(await applyThemeTemplateToOpenDeck(templateOf(createPresentation({ title: 'Ren' })), deps)).toBe('set')
    expect(deps.storeFile).not.toHaveBeenCalled()
    expect(state.presentation?.theme.logo).toBeUndefined()
  })
})

describe('startInThemeTemplate', () => {
  it('gir en ny presentasjon malen og lagrer den', async () => {
    const { deps } = dependencies(editor(null))
    const started = unwrap(await startInThemeTemplate(createPresentation({ title: 'Ny' }), templateOf(sourceDeck()), deps))
    expect(started.theme.logo?.assetId).toBe(COPY.id)
    expect(deps.library.savePresentation).toHaveBeenCalledWith(started)
  })

  it('tar kopien tilbake når lagringen feiler', async () => {
    const { deps } = dependencies(editor(null), { saveFails: true })
    await expect(
      startInThemeTemplate(createPresentation({ title: 'Ny' }), templateOf(sourceDeck()), deps),
    ).rejects.toThrow(/nett nede/)
    expect(deps.discard).toHaveBeenCalledWith([COPY.id])
  })
})
