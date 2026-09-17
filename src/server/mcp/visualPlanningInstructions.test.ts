import { describe, expect, it } from 'vitest'
import { MCP_INSTRUCTIONS } from './instructions'

describe('visual media planning instructions', () => {
  it('requires a deck-level visual pass before assets are produced', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/på dekknivå før du produserer visuelle filer/i)
    expect(MCP_INSTRUCTIONS).toMatch(/før du lager den første visuelle filen/i)
    expect(MCP_INSTRUCTIONS).toMatch(/navngitte personer, virkelige steder, bygninger, gjenstander eller historiske scener/i)
    expect(MCP_INSTRUCTIONS).toMatch(/velg medietype ut fra hva publikum trenger å se/i)
  })

  it('does not let an easy SVG replace a useful concrete image', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/et diagram er ikke en erstatning for et konkret motiv/i)
    expect(MCP_INSTRUCTIONS).toMatch(/skal ikke erstatte rasterbildet bare fordi SVG kan produseres direkte/i)
    expect(MCP_INSTRUCTIONS).toMatch(/hjemmelaget erstatning eller et abstrakt diagram/i)
  })

  it('waits for final QA, then makes host generation an observable next action', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/Rasterflyten er fast, ikke en fallback/i)
    expect(MCP_INSTRUCTIONS).toMatch(/med bilder.*bruk bilder.*bilder i hvert steg/i)
    expect(MCP_INSTRUCTIONS).toMatch(/ikke start ekstern rastergenerering ennå/i)
    expect(MCP_INSTRUCTIONS).toMatch(/innholdsendringer, citations, validering\/reparasjoner og visuell QA.*bildesonene er stabile/i)
    expect(MCP_INSTRUCTIONS).toMatch(/hent den genererte bildebriefen på nytt fra den endelige presentasjonstilstanden/i)
    expect(MCP_INSTRUCTIONS).toMatch(/skriv den returnerte briefen ut i samme samtale/i)
    expect(MCP_INSTRUCTIONS).toMatch(/kall deretter umiddelbart.*bildegenereringsverktøyet/i)
    expect(MCP_INSTRUCTIONS).toMatch(/briefen finnes i verktøyresponsen er ikke en overlevering/i)
    expect(MCP_INSTRUCTIONS).toMatch(/først startet når bildegenereringsverktøyet faktisk er kalt/i)
    expect(MCP_INSTRUCTIONS).toMatch(/bildeplanen etter handoff.*ny fersk sluttbrief.*på nytt/i)
    expect(MCP_INSTRUCTIONS).toMatch(/filbro.*bildedeponeringen/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/Mangler du en rastergenerator|har du ingen[^.]*bildegenerator/i)
  })

  it('forces explicit reassessment of a visually concrete deck with zero raster images', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/0 planlagte rasterbilder/i)
    expect(MCP_INSTRUCTIONS).toMatch(/SVG var enklere å lage/i)
    expect(MCP_INSTRUCTIONS).toMatch(/felles bildekontekst uten noen planlagte rasterbilder/i)
  })
})
