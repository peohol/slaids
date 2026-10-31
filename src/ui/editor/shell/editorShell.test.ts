import { describe, expect, it } from 'vitest'
import { compactPanelOnScreen, modeForPanel, type CompactPanel } from './editorShell'

const PANELS: (CompactPanel | null)[] = [null, 'slides', 'content', 'zone', 'tools']

describe('modeForPanel', () => {
  it('is zone mode for the zone panel and content mode for everything else', () => {
    for (const panel of PANELS) {
      expect(modeForPanel(panel)).toBe(panel === 'zone' ? 'zone' : 'content')
    }
  })
})

describe('compactPanelOnScreen', () => {
  it('shows the chosen panel when the mode agrees with it', () => {
    for (const chosen of PANELS) {
      expect(
        compactPanelOnScreen({
          chosen,
          mode: modeForPanel(chosen),
          zoneModeAvailable: true,
          toolWindowOpen: false,
        }),
      ).toBe(chosen)
    }
  })

  it('shows nothing while a tool window is up, whatever was chosen or the mode', () => {
    for (const chosen of PANELS) {
      for (const mode of ['content', 'zone'] as const) {
        expect(
          compactPanelOnScreen({ chosen, mode, zoneModeAvailable: true, toolWindowOpen: true }),
        ).toBeNull()
      }
    }
  })

  it('shows the zone panel whenever the editor is in zone mode, however it got there', () => {
    for (const chosen of PANELS) {
      expect(
        compactPanelOnScreen({ chosen, mode: 'zone', zoneModeAvailable: true, toolWindowOpen: false }),
      ).toBe('zone')
    }
  })

  it('hides a zone panel left behind when the mode went back to content', () => {
    expect(
      compactPanelOnScreen({
        chosen: 'zone',
        mode: 'content',
        zoneModeAvailable: true,
        toolWindowOpen: false,
      }),
    ).toBeNull()
  })

  it('keeps the zone panel on a page where zone mode cannot be entered, to say so', () => {
    expect(
      compactPanelOnScreen({
        chosen: 'zone',
        mode: 'content',
        zoneModeAvailable: false,
        toolWindowOpen: false,
      }),
    ).toBe('zone')
  })
})
