/**
 * Logoopplasting som overlever at personen går videre mens filen lastes opp:
 * logoen settes bare i presentasjonen filen ble lagret under, og en fil som
 * ikke blir brukt, tas tilbake – men aldri en fil presentasjonen hadde fra før.
 */

import { describe, expect, it, vi } from 'vitest'
import { registerAsset } from '../../domain/commands'
import { createPresentation } from '../../domain/presentation'
import { err, ok, type Result } from '../../domain/result'
import type { AssetRef, Presentation } from '../../domain/types'
import type { UploadedAsset } from '../../state/assetUpload'
import { uploadThemeLogo, type LogoUploadDependencies } from './logoUpload'

const REF: AssetRef = {
  id: 'a_logo',
  name: 'logo.svg',
  mimeType: 'image/svg+xml',
  byteSize: 100,
  width: 300,
  height: 100,
  isVector: true,
}

const FILE = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })

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
  options: { reused?: boolean; during?: () => void; fail?: boolean } = {},
): LogoUploadDependencies & { discard: ReturnType<typeof vi.fn> } {
  return {
    store: { getState: () => state } as unknown as LogoUploadDependencies['store'],
    storeFile: vi.fn(async () => {
      options.during?.()
      if (options.fail) throw new Error('nett nede')
      return ok<UploadedAsset>({ ref: REF, reused: options.reused ?? false })
    }),
    discard: vi.fn(async () => {}),
  }
}

describe('uploadThemeLogo', () => {
  it('setter logoen i presentasjonen som er åpen, i ett angresteg', async () => {
    const state = editor(createPresentation({ title: 'A' }))
    const deps = dependencies(state)
    expect(await uploadThemeLogo(FILE, deps)).toBe('set')
    expect(state.presentation!.theme.logo?.assetId).toBe(REF.id)
    expect(state.presentation!.assets.map((asset) => asset.id)).toEqual([REF.id])
    expect(state.run).toHaveBeenCalledTimes(1)
    expect(deps.discard).not.toHaveBeenCalled()
  })

  it('setter ingenting, og tar filen tilbake, når en annen presentasjon ble åpnet underveis', async () => {
    const first = createPresentation({ title: 'A' })
    const other = createPresentation({ title: 'B' })
    const state = editor(first)
    const deps = dependencies(state, { during: () => (state.presentation = other) })
    expect(await uploadThemeLogo(FILE, deps)).toBe('moved-on')
    expect(state.run).not.toHaveBeenCalled()
    expect(state.presentation!.theme.logo).toBeUndefined()
    expect(deps.discard).toHaveBeenCalledWith([REF.id])
  })

  it('sletter aldri en fil presentasjonen hadde fra før', async () => {
    const first = unwrap(registerAsset(createPresentation({ title: 'A' }), REF))
    const state = editor(first)
    const deps = dependencies(state, {
      reused: true,
      during: () => (state.presentation = createPresentation({ title: 'B' })),
    })
    expect(await uploadThemeLogo(FILE, deps)).toBe('moved-on')
    expect(deps.discard).toHaveBeenCalledWith([])
  })

  it('tar filen tilbake når kommandoen avvises', async () => {
    const state = editor(createPresentation({ title: 'A' }))
    state.run.mockImplementation(() => false)
    const deps = dependencies(state)
    expect(await uploadThemeLogo(FILE, deps)).toBe('refused')
    expect(deps.discard).toHaveBeenCalledWith([REF.id])
  })

  it('svarer med en feil i stedet for å kaste når opplastingen feiler', async () => {
    const state = editor(createPresentation({ title: 'A' }))
    const deps = dependencies(state, { fail: true })
    expect(await uploadThemeLogo(FILE, deps)).toBe('failed')
    expect(state.run).not.toHaveBeenCalled()
  })

  it('setter ingenting for en fil som avvises ved døren', async () => {
    const state = editor(createPresentation({ title: 'A' }))
    const deps = dependencies(state)
    deps.storeFile = vi.fn(async () => err('INVALID_ARGUMENT', 'Ikke tillatt.'))
    expect(await uploadThemeLogo(FILE, deps)).toBe('refused')
    expect(state.run).not.toHaveBeenCalled()
    expect(deps.discard).not.toHaveBeenCalled()
  })
})

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
