/**
 * The app's own stylesheets, as strings.
 *
 * The preview is not styled by a copy of the rules — it is styled by the files
 * the browser loads, imported with `?inline` so the same bytes end up inside a
 * `<style>` element instead of a `<link>`. That is the difference between "the
 * same renderer" and "a renderer built from the same values": a rule added to
 * `slide.css` tomorrow is in the preview tomorrow, with nobody remembering to
 * come here.
 *
 * Two sheets, in the order `main.tsx` loads them:
 *
 *  - `global.css` first, because the slide leans on its reset — `box-sizing:
 *    border-box` above all, which every rect in `slide.css` assumes;
 *  - `slide.css`, which is everything a drawn slide is.
 *
 * The editor and library sheets are deliberately absent. The preview draws the
 * *static* renderer, which is what presentation mode and the shared view draw,
 * and neither of those has ever depended on editor chrome — `IMPLEMENTATION_PLAN.md`
 * §43.5, "Én renderer". Loading them would make the preview the only place in
 * Slaids where a static slide sits inside an editor's cascade.
 */

import globalCss from '../styles/global.css?inline'
import slideCss from '../styles/slide.css?inline'

export const PREVIEW_STYLESHEETS: readonly string[] = [globalCss, slideCss]
