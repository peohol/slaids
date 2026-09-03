// @vitest-environment node
/**
 * Finding a browser, and saying so when there is none.
 *
 * The resolution order is the part of this subsystem most likely to be wrong in
 * exactly one environment, so it is checked as a value rather than observed in
 * production: an override that is actually an override, the bundled serverless
 * build next, and a legible refusal at the end rather than a stack trace from
 * inside a launcher.
 *
 * The launch itself is not exercised here — `agentLoop.test.ts` does that with a
 * real Chromium, which is the only way it is worth doing.
 */

import { describe, expect, it } from 'vitest'
import {
  CHROMIUM_EXECUTABLE_VAR,
  PreviewBrowserUnavailableError,
  resolveExecutable,
} from './chromium'

/** Something that exists and is executable on any POSIX machine. */
const REAL_EXECUTABLE = '/bin/sh'

describe('hvilken Chromium som brukes', () => {
  it('lar variabelen overstyre alt annet', async () => {
    const resolved = await resolveExecutable({ [CHROMIUM_EXECUTABLE_VAR]: REAL_EXECUTABLE })

    expect(resolved.executablePath).toBe(REAL_EXECUTABLE)
    // A browser that is not the serverless build gets the plain flag list: its
    // own is written for the environment it was built for.
    expect(resolved.args).toContain('--no-sandbox')
    expect(resolved.args).not.toContain('--single-process')
  })

  it('sier tydelig fra når variabelen peker på noe som ikke finnes', async () => {
    // An override that silently fell through to the next candidate would render
    // with a browser nobody asked for, which is worse than not rendering.
    await expect(
      resolveExecutable({ [CHROMIUM_EXECUTABLE_VAR]: '/finnes/ikke/chromium' }),
    ).rejects.toThrow(PreviewBrowserUnavailableError)
  })

  it('finner den innebygde serverless-buildet uten noen konfigurasjon', async () => {
    // `@sparticuz/chromium` is an ordinary dependency, and this is what makes
    // the preview work on Vercel with nothing set: the same path production
    // takes, taken here.
    const resolved = await resolveExecutable({})

    expect(resolved.executablePath.length).toBeGreaterThan(0)
    // Its own flag list, not ours.
    expect(resolved.args).toContain('--single-process')
  })
})
