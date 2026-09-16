// @vitest-environment node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedChromium = vi.hoisted(() => ({
  executablePath: vi.fn(),
  args: ['--single-process'],
}))

vi.mock('@sparticuz/chromium', () => ({
  default: {
    executablePath: mockedChromium.executablePath,
    args: mockedChromium.args,
  },
}))

import { SERVERLESS_CHROMIUM_PACK_URL, resolveExecutable } from './chromium'

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
}

describe('Chromium utenfor Vercel-funksjonsbundelen', () => {
  beforeEach(() => {
    mockedChromium.executablePath.mockReset()
  })

  it('bruker den lokale npm-pakken når binærene finnes', async () => {
    mockedChromium.executablePath.mockResolvedValueOnce(process.execPath)

    const resolved = await resolveExecutable({})

    expect(mockedChromium.executablePath).toHaveBeenCalledTimes(1)
    expect(mockedChromium.executablePath).toHaveBeenCalledWith()
    expect(resolved.executablePath).toBe(process.execPath)
    expect(resolved.args).toContain('--single-process')
  })

  it('henter den låste release-pakken når lokale binærer er ekskludert', async () => {
    mockedChromium.executablePath
      .mockRejectedValueOnce(new Error('lokal bin-katalog mangler'))
      .mockResolvedValueOnce(process.execPath)

    const resolved = await resolveExecutable({})

    expect(mockedChromium.executablePath).toHaveBeenCalledTimes(2)
    expect(mockedChromium.executablePath).toHaveBeenNthCalledWith(1)
    expect(mockedChromium.executablePath).toHaveBeenNthCalledWith(2, SERVERLESS_CHROMIUM_PACK_URL)
    expect(resolved.executablePath).toBe(process.execPath)
  })

  it('låser den eksterne pakken til nøyaktig samme Chromium-versjon som npm-pakken', () => {
    const version = packageJson.dependencies['@sparticuz/chromium']
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(SERVERLESS_CHROMIUM_PACK_URL).toBe(
      `https://github.com/Sparticuz/chromium/releases/download/v${version}/chromium-v${version}-pack.x64.tar`,
    )
  })
})
