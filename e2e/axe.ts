/**
 * The automated WCAG audit (axe-core), shared by every spec that checks a
 * surface of the app as assistive technology sees it.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/**
 * WCAG 2.2 A and AA, and axe's best practices — all of them.
 *
 * `region` asks for every piece of content to sit in a landmark. axe already
 * counts a dialog as its own place; a popup menu is the same kind of thing — it
 * belongs to the control that opened it, takes the focus, and is not somewhere
 * a reader navigates *to* by landmark — so it is counted the same way. Nothing
 * else is excused: the text bar has its own landmark («Tekstredigering»).
 */
const REGION_MATCHER = 'dialog, [role=dialog], [role=alertdialog], svg, [role=menu]'

export async function audit(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE })
  return page.evaluate(async (regionMatcher) => {
    const axe = (
      window as unknown as {
        axe: {
          configure: (spec: unknown) => void
          run: (...args: unknown[]) => Promise<AxeResult>
        }
      }
    ).axe
    interface AxeResult {
      violations: Array<{ id: string; nodes: Array<{ target: string[] }> }>
    }
    axe.configure({ checks: [{ id: 'region', options: { regionMatcher } }] })
    const result = await axe.run(
      { include: [document.body], exclude: [['[data-testid="stage-slide"]']] },
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
      },
    )
    /*
     * A thumbnail is a picture of a page inside a button named after the page
     * («Slide 3»). Its words are the slide's, drawn at a sixth of their size
     * and hidden from assistive technology; they are not the button's label,
     * which is what WCAG 2.5.3 (label in name) is about.
     */
    const pictureOfAPage = (target: string[]) =>
      document.querySelector(target.join(' '))?.matches('.filmstrip__thumb') ?? false
    return result.violations
      .map((violation) => ({
        ...violation,
        nodes: violation.nodes.filter(
          (node) => !(violation.id === 'label-content-name-mismatch' && pictureOfAPage(node.target)),
        ),
      }))
      .filter((violation) => violation.nodes.length > 0)
      .map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
      )
  }, REGION_MATCHER)
}

/**
 * Both appearances, by the operating system's setting the app follows by
 * default: every audit below runs once in each, since a colour that reads in
 * dark can fail in light.
 */
export const SCHEMES = [
  ['mørkt', 'dark'],
  ['lyst', 'light'],
] as const
