/**
 * The document a miniapp runs in, and the policy it runs under.
 *
 * Uploaded HTML is never Slaids' own markup. It is loaded, as data, into a
 * frame that the browser keeps apart from the page around it, and this module
 * builds that frame's document — which is the security boundary, so it is
 * stated in one place and tested as data rather than spread across a
 * component's attributes.
 *
 * Two frames, not one, and the reason is the thing a single frame cannot do.
 *
 *  - The **app frame** holds the uploaded file. It is sandboxed with
 *    `allow-scripts` alone: an opaque origin, so nothing in it can read
 *    Slaids' storage, session or DOM; no forms, no popups, no top navigation,
 *    no modal dialogs, no downloads, no pointer lock. Its document carries a
 *    Content Security Policy that refuses every resource by default and allows
 *    exactly what a self-contained file needs — inline script and style, and
 *    `data:`/`blob:` pictures, fonts and media it brings along — with no
 *    network at all: no `fetch`, no `XMLHttpRequest`, no WebSocket, no beacon,
 *    no external script, stylesheet, font, image, frame, object or worker, no
 *    `eval`, no `<base>`.
 *  - The **wrapper frame** is a small document Slaids writes itself, and the
 *    app frame is its child. It exists for one rule the app's own policy
 *    cannot express: what URLs the app frame may *navigate to*. `connect-src
 *    'none'` stops requests, not navigations, and a frame's own `frame-src`
 *    says nothing about the frame itself — but the *parent's* `frame-src`
 *    does. The wrapper's policy says `frame-src 'none'`, and the browser then
 *    refuses every navigation of the app frame — `location.href`, a link, a
 *    form, a `<meta refresh>`, whether to the internet or to Slaids' own
 *    origin — before the request is made. (Chromium then shows its own block
 *    page in the frame in place of the app; the app is gone, and «Avslutt
 *    miniapp» is the way back.) Slaids' own document could carry that policy
 *    instead, and then it would apply to the whole app; the wrapper keeps it
 *    local to the one frame it is about.
 *
 * The wrapper's policy is also the app's baseline. A `srcdoc` document
 * inherits its parent's Content Security Policy, so the app frame runs under
 * the wrapper's policy from its first byte, before any of the uploaded file
 * has been parsed, and the copy repeated in the app document's own `<head>`
 * can only narrow it. Nothing in the file can widen either: a policy can be
 * added by a `<meta>` but never relaxed, a `<base>` is refused by
 * `base-uri 'none'`, and the file's own `<meta http-equiv>` lands in the body
 * where the parser ignores it.
 *
 * ## What Slaids puts in front of the file
 *
 * The app document's head carries the charset, the policy and then one
 * `<style>` — the deck's design as CSS: `@font-face` rules whose files are
 * `data:` URLs, the theme tokens, and Slaids' base stylesheet (see
 * `domain/interactiveStyle.ts`). It needs no new permission: `style-src 'unsafe-inline'`
 * already allows the rules and `font-src data:` already allows the faces, so
 * the app is drawn in the deck's real type without the frame being able to
 * fetch anything. Slaids' CSS comes first and the author's `<style>` is parsed
 * after it, which is what makes the base sheet a starting point rather than
 * something to fight.
 *
 * The file goes into the app frame's `srcdoc` attribute, inside the wrapper's
 * markup, as an escaped attribute value. That is the one place untrusted text
 * is embedded, the escaping is the complete one for that context, and it is
 * what keeps the file from becoming markup of the wrapper's. The wrapper is
 * itself the `srcdoc` of the frame Slaids mounts, set as a property rather
 * than serialised into anything, so it needs no escaping of its own.
 *
 * What this does *not* do, stated as plainly as what it does: it is not a
 * network firewall — a `<link rel=preconnect>` may still open a connection
 * that carries nothing, and the browser's own DNS is the browser's; it does
 * not isolate CPU, memory or the audio output; and it is not a defence against
 * a bug in the browser's sandbox or CSP implementation. It is the browser's
 * own isolation, configured as tightly as a self-contained app allows.
 */

/**
 * The policy every miniapp runs under.
 *
 * One string, used twice: as the wrapper's policy, which the app document
 * inherits, and repeated in the app document's own head. `frame-src 'none'`
 * is the navigation rule described above; in the app document it additionally
 * refuses any frame the app tries to open with a URL. `worker-src 'none'`
 * refuses workers outright, and `object-src 'none'` plugins.
 */
export const INTERACTIVE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/**
 * The sandbox both frames get: scripts, and nothing else.
 *
 * Deliberately never `allow-same-origin` (which with scripts is no sandbox at
 * all), `allow-forms`, `allow-popups`, `allow-modals`, `allow-downloads`,
 * `allow-pointer-lock`, `allow-top-navigation` or any of its variants,
 * `allow-orientation-lock` or `allow-presentation`.
 */
export const INTERACTIVE_SANDBOX_FLAGS = 'allow-scripts'

/** A srcdoc document has no referrer to send; said explicitly all the same. */
export const INTERACTIVE_REFERRER_POLICY = 'no-referrer'

/**
 * Powerful features, refused by Permissions Policy on both frames.
 *
 * A cross-origin frame is not delegated any of these unless its embedder says
 * so, so the list is a statement rather than the only thing standing between
 * the app and the camera — but a statement the browser enforces, on frames
 * whose embedder might one day be more generous. Only feature names browsers
 * recognise are listed: an unknown name is a warning in the console and
 * nothing else.
 */
export const INTERACTIVE_PERMISSIONS_POLICY = [
  'camera',
  'microphone',
  'geolocation',
  'display-capture',
  'fullscreen',
  'payment',
  'usb',
  'midi',
  'picture-in-picture',
  'screen-wake-lock',
  'xr-spatial-tracking',
  'publickey-credentials-get',
  'hid',
  'serial',
  'idle-detection',
  'clipboard-read',
  'local-fonts',
  'autoplay',
]
  .map((feature) => `${feature} 'none'`)
  .join('; ')

/**
 * Text as an HTML attribute value, exhaustively.
 *
 * `&` and `"` are what a double-quoted attribute needs; `<`, `>` and `'` are
 * escaped too, so the value cannot even *look* like markup to anything that
 * reads it less carefully than the HTML parser does.
 */
export function escapeHtmlAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
}

/**
 * The uploaded file as the document the app frame loads.
 *
 * Slaids' head first — the charset and the policy — and the file verbatim in
 * the body. The HTML parser processes a file's own `<html>`, `<head>`,
 * `<body>`, `<meta charset>`, `<title>`, `<style>` and `<script>` exactly as
 * it would at the top of a document (a `<body>` tag's attributes are merged,
 * a `<head>` tag is ignored, `<style>` and `<script>` are inserted where they
 * stand), so a self-contained page works as written. What it cannot do is
 * reach in front of the policy: the parser is sequential, and the policy is
 * already in force when the first byte of the file is read.
 */
export function buildInteractiveAppDocument(html: string, styleCss = ''): string {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${INTERACTIVE_CONTENT_SECURITY_POLICY}">`,
    ...(styleCss ? ['<style>', styleCss, '</style>'] : []),
    '</head>',
    '<body>',
    html,
    '</body>',
    '</html>',
  ].join('\n')
}

/**
 * The wrapper: Slaids' own document, carrying the policy and the app frame.
 *
 * Its one script passes keyboard focus down to the app frame whenever the
 * wrapper itself is focused — which is what Slaids does on activation — so the
 * audience can use the keyboard without clicking first. Focus is delegated a
 * tick late on purpose: moving it from inside the wrapper's own focus event is
 * a move the browser drops.
 *
 * Nothing in it listens for messages. There is no bridge from the app to the
 * wrapper or to Slaids, and no channel for one to be added to by the app: the
 * app's markup exists only as an attribute value here.
 */
export function buildInteractiveWrapperDocument(input: {
  html: string
  title: string
  /**
   * Slaids' own CSS for this run: the deck's tokens, the base stylesheet and
   * the theme's faces with their files in them. Built by
   * `interactiveDocumentStyle`, and always *before* the file, so the author's
   * own CSS is what wins where the two disagree.
   */
  styleCss?: string
}): string {
  const app = buildInteractiveAppDocument(input.html, input.styleCss ?? '')
  const title = escapeHtmlAttribute(`Miniapp: ${input.title}`)
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${INTERACTIVE_CONTENT_SECURITY_POLICY}">`,
    '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}iframe{display:block;width:100%;height:100%;border:0;background:#fff}</style>',
    '</head>',
    '<body>',
    `<iframe id="app" title="${title}" sandbox="${INTERACTIVE_SANDBOX_FLAGS}" referrerpolicy="${INTERACTIVE_REFERRER_POLICY}" allow="${escapeHtmlAttribute(INTERACTIVE_PERMISSIONS_POLICY)}" srcdoc="${escapeHtmlAttribute(app)}"></iframe>`,
    '<script>',
    '(function () {',
    "  var app = document.getElementById('app');",
    '  var pass = function () { setTimeout(function () { app.focus(); }, 0); };',
    "  window.addEventListener('focus', pass);",
    "  app.addEventListener('load', function () { if (document.hasFocus()) pass(); });",
    '  if (document.hasFocus()) pass();',
    '})();',
    '</script>',
    '</body>',
    '</html>',
  ].join('\n')
}
