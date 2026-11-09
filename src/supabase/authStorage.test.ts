import { describe, expect, it } from 'vitest'
import { createAuthStorage, type AuthPersistence } from './authStorage'

const KEY = 'sb-project-auth-token'

/** A Web Storage area, in memory. */
function area(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  }
}

/**
 * One browser: `device` is shared by every tab and survives closing the
 * browser; each tab has its own `tab` area, which does not.
 */
function browser() {
  const device = area()
  return {
    device,
    openTab: (tab: Storage = area()) => ({ tab, storage: createAuthStorage({ device, tab }) }),
  }
}

function signIn(persistence: AuthPersistence, storage: ReturnType<typeof createAuthStorage>, value: string) {
  storage.setPersistence(persistence)
  storage.setItem(KEY, value)
}

describe('lagringen av innloggingsøkten', () => {
  it('husker økten på enheten når brukeren ber om det', () => {
    const { device, openTab } = browser()
    const { tab, storage } = openTab()

    signIn('device', storage, 'økt')

    expect(device.getItem(KEY)).toBe('økt')
    expect(tab.getItem(KEY)).toBeNull()
    // Nettleseren lukkes og åpnes igjen: ny fane, ny sessionStorage, samme enhet.
    expect(openTab().storage.getItem(KEY)).toBe('økt')
  })

  it('holder økten i fanen når brukeren ikke vil bli husket', () => {
    const { device, openTab } = browser()
    const { tab, storage } = openTab()

    signIn('tab', storage, 'økt')

    expect(tab.getItem(KEY)).toBe('økt')
    expect(device.getItem(KEY)).toBeNull()
    // En omlasting av samme fane beholder den …
    expect(createAuthStorage({ device, tab }).getItem(KEY)).toBe('økt')
    // … men nettleseren åpnet på nytt har den ikke.
    expect(openTab().storage.getItem(KEY)).toBeNull()
  })

  it('fortsetter å skrive dit økten ble funnet etter en omlasting', () => {
    const { device, openTab } = browser()
    const first = openTab()
    signIn('tab', first.storage, 'økt')

    // Omlasting: ingen har valgt noe i denne siden ennå.
    const reloaded = createAuthStorage({ device, tab: first.tab })
    expect(reloaded.getItem(KEY)).toBe('økt')
    reloaded.setItem(KEY, 'fornyet')

    expect(first.tab.getItem(KEY)).toBe('fornyet')
    expect(device.getItem(KEY)).toBeNull()
    expect(reloaded.persistence()).toBe('tab')
  })

  it('lar aldri en tidligere brukers økt ligge igjen i den andre lagringen', () => {
    for (const [before, after] of [
      ['device', 'tab'],
      ['tab', 'device'],
    ] as const) {
      const { device, openTab } = browser()
      const { tab, storage } = openTab()
      signIn(before, storage, 'forrige bruker')

      signIn(after, storage, 'ny bruker')

      const areas = { device, tab }
      expect(areas[after].getItem(KEY)).toBe('ny bruker')
      expect(areas[before].getItem(KEY)).toBeNull()
      expect(storage.getItem(KEY)).toBe('ny bruker')
    }
  })

  it('fjerner økten fra begge lagringene ved utlogging', () => {
    const { device, openTab } = browser()
    const { tab, storage } = openTab()
    device.setItem(KEY, 'gammel')
    tab.setItem(KEY, 'ny')

    storage.removeItem(KEY)
    storage.reset()

    expect(device.getItem(KEY)).toBeNull()
    expect(tab.getItem(KEY)).toBeNull()
    expect(storage.persistence()).toBeNull()
  })

  it('leser bare den valgte lagringen etter at et valg er gjort', () => {
    const { device, openTab } = browser()
    const { storage } = openTab()
    device.setItem(KEY, 'noe gammelt')

    storage.setPersistence('tab')

    expect(storage.getItem(KEY)).toBeNull()
  })

  it('tåler en nettleser som nekter tilgang til lagring', () => {
    const refusing = area()
    refusing.getItem = () => {
      throw new Error('SecurityError')
    }
    refusing.setItem = refusing.getItem
    refusing.removeItem = refusing.getItem
    const storage = createAuthStorage({ device: refusing, tab: null })

    expect(storage.getItem(KEY)).toBeNull()
    expect(() => storage.setItem(KEY, 'økt')).not.toThrow()
    expect(() => storage.removeItem(KEY)).not.toThrow()
  })
})
