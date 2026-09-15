/**
 * Putting text on the system clipboard, from a surface that has to cope with
 * being told no.
 *
 * One implementation rather than one per dialog: the asynchronous API is the
 * only one worth using, and it is also the one a browser refuses outright when
 * the page is not in a secure context or the user has denied the permission —
 * so every caller needs the same fallback, and a caller that quietly had a
 * weaker one would be the caller whose copy button silently did nothing.
 *
 * Returns whether the text actually got there, so the caller can say «Kopiert»
 * or offer the text for selecting by hand instead of claiming success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Denied or unavailable; the fallback below still works in most browsers.
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  } catch {
    return false
  }
}

/** How long a copy button says it worked. Long enough to read, short enough to forget. */
export const COPIED_FEEDBACK_MS = 1800
