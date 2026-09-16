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
    expect(MCP_INSTRUCTIONS).toMatch(/ikke en hjemmelaget erstatning eller et abstrakt diagram/i)
  })

  it('forces explicit reassessment of a visually concrete deck with zero raster images', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/0 planlagte rasterbilder/i)
    expect(MCP_INSTRUCTIONS).toMatch(/SVG var enklere å lage/i)
    expect(MCP_INSTRUCTIONS).toMatch(/felles bildekontekst uten noen planlagte rasterbilder/i)
  })
})
