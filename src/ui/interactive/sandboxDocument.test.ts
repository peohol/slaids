/**
 * The frame document, as data.
 *
 * These tests state what the boundary *is* — which policy, which sandbox
 * flags, in which order, with the uploaded file where — and that the
 * construction cannot be broken by what the file contains. They do not and
 * cannot show that a browser enforces any of it; that is what the Playwright
 * security spec measures, in a real Chromium, by trying.
 */

import { describe, expect, it } from 'vitest'
import {
  INTERACTIVE_CONTENT_SECURITY_POLICY,
  INTERACTIVE_PERMISSIONS_POLICY,
  INTERACTIVE_REFERRER_POLICY,
  INTERACTIVE_SANDBOX_FLAGS,
  buildInteractiveAppDocument,
  buildInteractiveWrapperDocument,
  escapeHtmlAttribute,
} from './sandboxDocument'

const APP = '<!doctype html><html><head><title>Teller</title></head><body><button>+1</button><script>let n = 0</script></body></html>'

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(';').map((entry) => {
      const [name, ...values] = entry.trim().split(/\s+/)
      return [name, values.join(' ')]
    }),
  )
}

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, 'text/html')
}

describe('policyen', () => {
  it('nekter alt som utgangspunkt, og slipper bare gjennom det en selvstendig fil trenger', () => {
    const csp = directives(INTERACTIVE_CONTENT_SECURITY_POLICY)
    expect(csp.get('default-src')).toBe("'none'")
    expect(csp.get('script-src')).toBe("'unsafe-inline'")
    expect(csp.get('style-src')).toBe("'unsafe-inline'")
    expect(csp.get('img-src')).toBe('data: blob:')
    expect(csp.get('font-src')).toBe('data: blob:')
    expect(csp.get('media-src')).toBe('data: blob:')
    expect(csp.get('connect-src')).toBe("'none'")
    expect(csp.get('object-src')).toBe("'none'")
    expect(csp.get('frame-src')).toBe("'none'")
    expect(csp.get('worker-src')).toBe("'none'")
    expect(csp.get('manifest-src')).toBe("'none'")
    expect(csp.get('form-action')).toBe("'none'")
    expect(csp.get('base-uri')).toBe("'none'")
  })

  it('åpner aldri for eval, nettverk eller eksterne kilder', () => {
    expect(INTERACTIVE_CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval')
    expect(INTERACTIVE_CONTENT_SECURITY_POLICY).not.toContain('http')
    expect(INTERACTIVE_CONTENT_SECURITY_POLICY).not.toContain('*')
    expect(INTERACTIVE_CONTENT_SECURITY_POLICY).not.toContain("'self'")
    for (const directive of ['script-src', 'style-src', 'img-src', 'font-src', 'media-src']) {
      const value = directives(INTERACTIVE_CONTENT_SECURITY_POLICY).get(directive) ?? ''
      // Inline and the app's own embedded data, nothing that names a host.
      expect(value.split(' ').every((source) => ["'unsafe-inline'", 'data:', 'blob:'].includes(source))).toBe(true)
    }
  })

  it('sandkassen tillater skript og ingenting annet', () => {
    expect(INTERACTIVE_SANDBOX_FLAGS).toBe('allow-scripts')
    for (const flag of [
      'allow-same-origin',
      'allow-forms',
      'allow-popups',
      'allow-modals',
      'allow-downloads',
      'allow-pointer-lock',
      'allow-top-navigation',
      'allow-orientation-lock',
      'allow-presentation',
    ]) {
      expect(INTERACTIVE_SANDBOX_FLAGS).not.toContain(flag)
    }
    expect(INTERACTIVE_REFERRER_POLICY).toBe('no-referrer')
  })

  it('nekter kraftige funksjoner ved navn', () => {
    const policy = directives(INTERACTIVE_PERMISSIONS_POLICY)
    for (const feature of ['camera', 'microphone', 'geolocation', 'display-capture', 'fullscreen', 'payment']) {
      expect(policy.get(feature)).toBe("'none'")
    }
    expect([...policy.values()].every((value) => value === "'none'")).toBe(true)
  })
})

describe('appdokumentet', () => {
  it('bærer policyen i hodet, før én byte av filen', () => {
    const document = buildInteractiveAppDocument(APP)
    const policyAt = document.indexOf('http-equiv="Content-Security-Policy"')
    const fileAt = document.indexOf(APP)
    expect(policyAt).toBeGreaterThan(-1)
    expect(fileAt).toBeGreaterThan(policyAt)
    expect(document.indexOf('<meta charset="utf-8">')).toBeLessThan(policyAt)
    expect(document).toContain(`content="${INTERACTIVE_CONTENT_SECURITY_POLICY}"`)
  })

  it('tar filen inn ordrett', () => {
    // Verbatim, so a self-contained page works as written — not escaped,
    // not rewritten, not parsed by Slaids.
    expect(buildInteractiveAppDocument(APP)).toContain(APP)
  })
})

describe('innpakningen', () => {
  it('holder appen som en attributtverdi, aldri som markup', () => {
    const wrapper = buildInteractiveWrapperDocument({ html: APP, title: 'Teller' })
    // The file's own tags never appear as tags of the wrapper's.
    expect(wrapper).not.toContain('<button>+1</button>')
    expect(wrapper).not.toContain('<script>let n = 0</script>')
    expect(wrapper).toContain(escapeHtmlAttribute(APP))
  })

  it('gir appen den samme policyen som sin egen, som den arver før noe er lest', () => {
    const wrapper = parse(buildInteractiveWrapperDocument({ html: APP, title: 'Teller' }))
    const meta = wrapper.querySelector('meta[http-equiv="Content-Security-Policy"]')
    expect(meta?.getAttribute('content')).toBe(INTERACTIVE_CONTENT_SECURITY_POLICY)
    // The policy stands before the frame in document order.
    const frame = wrapper.querySelector('iframe#app')
    expect(frame).not.toBeNull()
    expect(meta!.compareDocumentPosition(frame!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('setter opp apprammen med sandkasse, referrer-policy, tillatelser og srcdoc', () => {
    const wrapper = parse(buildInteractiveWrapperDocument({ html: APP, title: 'Teller' }))
    const frame = wrapper.querySelector('iframe#app')!
    expect(frame.getAttribute('sandbox')).toBe(INTERACTIVE_SANDBOX_FLAGS)
    expect(frame.getAttribute('referrerpolicy')).toBe(INTERACTIVE_REFERRER_POLICY)
    expect(frame.getAttribute('allow')).toBe(INTERACTIVE_PERMISSIONS_POLICY)
    expect(frame.getAttribute('src')).toBeNull()
    // Parsed back out of the attribute, the app document is exactly the one
    // built for it: the escaping round-trips.
    expect(frame.getAttribute('srcdoc')).toBe(buildInteractiveAppDocument(APP))
    expect(frame.getAttribute('title')).toBe('Miniapp: Teller')
  })

  it('inneholder ett skript, Slaids’ eget, og ingen meldingslytter', () => {
    const wrapper = parse(buildInteractiveWrapperDocument({ html: APP, title: 'Teller' }))
    const scripts = [...wrapper.querySelectorAll('script')]
    expect(scripts).toHaveLength(1)
    expect(scripts[0].textContent).toContain('app.focus()')
    expect(scripts[0].textContent).not.toContain('message')
    expect(scripts[0].textContent).not.toContain('postMessage')
    expect(wrapper.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('lar seg ikke bryte opp av en fil som prøver å lukke attributten eller rammen', () => {
    const hostile =
      '"></iframe><script>parent.document.title = "tatt"</script><iframe srcdoc="' +
      "'<img src=x onerror=alert(1)>' </script><!-- --> &quot;"
    const wrapper = parse(buildInteractiveWrapperDocument({ html: hostile, title: '"><b>x</b>' }))
    // Still one frame and one script, and the hostile text is inside the
    // frame's attribute rather than anywhere in the wrapper's tree.
    expect(wrapper.querySelectorAll('iframe')).toHaveLength(1)
    expect(wrapper.querySelectorAll('script')).toHaveLength(1)
    expect(wrapper.querySelector('img')).toBeNull()
    expect(wrapper.querySelector('b')).toBeNull()
    expect(wrapper.querySelector('iframe#app')!.getAttribute('srcdoc')).toBe(
      buildInteractiveAppDocument(hostile),
    )
    expect(wrapper.querySelector('iframe#app')!.getAttribute('title')).toBe('Miniapp: "><b>x</b>')
    expect(wrapper.title).toBe('')
  })
})

describe('Slaids’ eget stilark i dokumentet', () => {
  const STYLE = ':root { --slaids-accent: #bfccd9; }\nbody { color: var(--slaids-text); }'

  it('står i hodet, etter policyen og før én byte av filen', () => {
    const document = buildInteractiveAppDocument(APP, STYLE)
    const policyAt = document.indexOf('Content-Security-Policy')
    const styleAt = document.indexOf('--slaids-accent')
    const fileAt = document.indexOf(APP)

    expect(policyAt).toBeGreaterThan(-1)
    expect(styleAt).toBeGreaterThan(policyAt)
    // Before the file, so the author's own <style> is parsed after Slaids'
    // and wins wherever the two disagree.
    expect(fileAt).toBeGreaterThan(styleAt)
    expect(document.indexOf('</head>')).toBeLessThan(fileAt)
  })

  it('trenger ingen ny tillatelse: inline stil og data-fonter er allerede lov', () => {
    const csp = directives(INTERACTIVE_CONTENT_SECURITY_POLICY)
    expect(csp.get('style-src')).toBe("'unsafe-inline'")
    expect(csp.get('font-src')).toBe('data: blob:')
    // And still nothing that reaches a host.
    expect(csp.get('default-src')).toBe("'none'")
  })

  it('følger med gjennom innpakningen, inn i apprammens srcdoc', () => {
    const wrapper = parse(buildInteractiveWrapperDocument({ html: APP, title: 'T', styleCss: STYLE }))
    expect(wrapper.querySelector('iframe#app')!.getAttribute('srcdoc')).toBe(
      buildInteractiveAppDocument(APP, STYLE),
    )
    // The deck's design is the app's, not the wrapper's: the wrapper is a
    // frame holder, and its own style says only how to hold a frame.
    const own = [...wrapper.querySelectorAll('head style')].map((node) => node.textContent).join('')
    expect(own).not.toContain('--slaids-')
  })

  it('er borte, ikke tomt, når det ikke er noe å legge ved', () => {
    expect(buildInteractiveAppDocument(APP)).not.toContain('<style>')
  })
})

describe('escapeHtmlAttribute', () => {
  it('nøytraliserer alt som kan avslutte eller ligne markup', () => {
    expect(escapeHtmlAttribute(`a&b"c<d>e'f`)).toBe('a&amp;b&quot;c&lt;d&gt;e&#39;f')
    expect(escapeHtmlAttribute('</iframe>')).toBe('&lt;/iframe&gt;')
    expect(escapeHtmlAttribute('&amp;')).toBe('&amp;amp;')
  })

  it('er omvendbar gjennom HTML-parseren', () => {
    const text = `alle <tegn> "som" 'kan' &skade; </script></iframe>`
    const parsed = parse(`<div data-x="${escapeHtmlAttribute(text)}"></div>`)
    expect(parsed.querySelector('div')!.getAttribute('data-x')).toBe(text)
  })
})
