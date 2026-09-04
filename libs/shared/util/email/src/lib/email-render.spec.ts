/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  renderEmailHtml,
  substituteMergeTokens,
} from './email-render'

const NODES = {
  root: { componentId: 'div', nodes: ['section'] },
  section: {
    componentId: 'emailSection',
    props: { backgroundColor: '#ffffff', padding: 20 },
    nodes: ['text', 'button', 'product', 'spacer'],
  },
  text: {
    componentId: 'emailText',
    props: { children: 'Hi {{contact.firstName}},', variant: 'heading' },
  },
  button: {
    componentId: 'emailButton',
    props: { children: 'Shop', href: 'https://x.test/shop' },
  },
  product: {
    componentId: 'emailProduct',
    props: { productId: 'p1' },
  },
  spacer: { componentId: 'emailSpacer', props: { height: 32 } },
}

/**
 * The default policy for tests that are not about sanitizing.
 *
 * Identity, and named so that reads as a decision rather than an oversight —
 * a test asserting layout should not also be asserting a policy. The tests
 * that ARE about the policy pass their own, and the ones proving the
 * REQUIREMENT pass none.
 */
const SANITIZE = (html: string) => html

describe('substituteMergeTokens', () => {
  it('substitutes known tokens and keeps unknown ones visible', () => {
    expect(
      substituteMergeTokens('Hi {{contact.firstName}} {{nope}}', {
        'contact.firstName': 'Sam',
      }),
    ).toBe('Hi Sam {{nope}}')
  })
})

describe('renderEmailHtml', () => {
  it('renders table HTML with merge values and product data', () => {
    const { html, text } = renderEmailHtml({
      sanitize: SANITIZE,
      nodes: NODES as any,
      subject: 'Hello',
      preheader: 'Preview line',
      merge: { 'contact.firstName': 'Sam' },
      products: {
        p1: {
          name: 'Widget',
          priceLabel: '$29',
          url: 'https://x.test/products/widget',
        },
      },
    })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Hi Sam,')
    expect(html).toContain('https://x.test/shop')
    expect(html).toContain('Widget')
    expect(html).toContain('$29')
    expect(html).toContain('Preview line')
    expect(html).toContain('height:32px')
    // Table layout, not divs-with-flex.
    expect(html).toContain('role="presentation"')
    // Plain-text alternative captures the content.
    expect(text).toContain('Hi Sam,')
    expect(text).toContain('Widget — $29')
  })

  it('escapes user text and skips unresolvable products', () => {
    const { html } = renderEmailHtml({
      sanitize: SANITIZE,
      nodes: {
        root: { componentId: 'div', nodes: ['t', 'p'] },
        t: {
          componentId: 'emailText',
          props: { children: '<script>alert(1)</script>' },
        },
        p: { componentId: 'emailProduct', props: { productId: 'gone' } },
      } as any,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('sanitizes richtext through the provided sanitizer', () => {
    const { html } = renderEmailHtml({
      nodes: {
        root: { componentId: 'div', nodes: ['r'] },
        r: {
          componentId: 'emailRichtext',
          props: { html: '<p onclick="x()">hey</p>' },
        },
      } as any,
      sanitize: (value) => value.replace(/ onclick="[^"]*"/g, ''),
    })
    expect(html).toContain('<p>hey</p>')
    expect(html).not.toContain('onclick')
  })

  /**
   * AGL-1224. The besigner's media picker stores a `media:` reference, and
   * before it an `/api/media/cdn/…` path — both site-relative once resolved.
   * A browser has a page to resolve them against; an inbox does not, so
   * without an origin every picked image was a broken-image box in the
   * delivered mail while looking perfect on the besigner canvas.
   */
  describe('picked media (AGL-1224)', () => {
    const imageNodes = (src: string) =>
      ({
        root: { componentId: 'div', nodes: ['i'] },
        i: { componentId: 'emailImage', props: { src, alt: 'Hero' } },
      }) as any

    const render = (src: string, options = {}) =>
      renderEmailHtml({ sanitize: SANITIZE, nodes: imageNodes(src), ...options }).html

    it('absolutizes a media reference against the origin', () => {
      expect(
        render('media:h1/med123', { mediaOrigin: 'https://acme.test' }),
      ).toContain('src="https://acme.test/api/media/cdn/h1/med123"')
    })

    it('host-qualifies an org-scoped reference', () => {
      // The CDN is unauthenticated and decides from the URL alone, so an org
      // asset restricted to some sites only serves through the qualified form.
      expect(
        render('media:org:o1/med123', {
          mediaOrigin: 'https://acme.test',
          mediaHostId: 'h1',
        }),
      ).toContain('src="https://acme.test/api/media/cdn/org:o1:h1/med123"')
    })

    it('absolutizes the legacy relative CDN path too', () => {
      expect(
        render('/api/media/cdn/h1/med123', {
          mediaOrigin: 'https://acme.test',
        }),
      ).toContain('src="https://acme.test/api/media/cdn/h1/med123"')
    })

    it('does not double the slash when the origin has a trailing one', () => {
      const html = render('media:h1/med123', {
        mediaOrigin: 'https://acme.test/',
      })
      expect(html).toContain('src="https://acme.test/api/media/cdn/h1/med123"')
      expect(html).not.toContain('.test//api')
    })

    it('passes an author-typed absolute URL through untouched', () => {
      expect(
        render('https://cdn.other.test/x.png', {
          mediaOrigin: 'https://acme.test',
        }),
      ).toContain('src="https://cdn.other.test/x.png"')
    })

    it('passes a protocol-relative URL through rather than corrupting it', () => {
      expect(
        render('//cdn.other.test/x.png', { mediaOrigin: 'https://acme.test' }),
      ).toContain('src="//cdn.other.test/x.png"')
    })

    it('drops the image rather than emitting an unfetchable src', () => {
      // The regression guard: BOTH broken forms must be absent from the HTML
      // that actually goes out, not merely "handled somewhere".
      for (const stored of ['media:h1/med123', '/api/media/cdn/h1/med123']) {
        const html = render(stored)
        expect(html).not.toContain('media:h1')
        expect(html).not.toContain('src="/api/media/cdn')
        expect(html).not.toContain('<img')
      }
    })

    it('applies the same resolution to a product image', () => {
      const { html } = renderEmailHtml({
        sanitize: SANITIZE,
        nodes: {
          root: { componentId: 'div', nodes: ['p'] },
          p: { componentId: 'emailProduct', props: { productId: 'p1' } },
        } as any,
        products: { p1: { name: 'Widget', imageUrl: 'media:h1/med9' } },
        mediaOrigin: 'https://acme.test',
      })
      expect(html).toContain('src="https://acme.test/api/media/cdn/h1/med9"')
      // The card itself still renders — only the image is conditional.
      expect(html).toContain('Widget')
    })

    it('keeps the product card when its image cannot be absolutized', () => {
      const { html } = renderEmailHtml({
        sanitize: SANITIZE,
        nodes: {
          root: { componentId: 'div', nodes: ['p'] },
          p: { componentId: 'emailProduct', props: { productId: 'p1' } },
        } as any,
        products: { p1: { name: 'Widget', imageUrl: 'media:h1/med9' } },
      })
      expect(html).toContain('Widget')
      expect(html).not.toContain('<img')
    })
  })

  it('renders children of unknown components instead of dropping them', () => {
    const { html } = renderEmailHtml({
      sanitize: SANITIZE,
      nodes: {
        root: { componentId: 'div', nodes: ['stack'] },
        stack: { componentId: 'muiStack', nodes: ['t'] },
        t: { componentId: 'emailText', props: { children: 'inside' } },
      } as any,
    })
    expect(html).toContain('inside')
  })
})

/**
 * The white-label email logo (AGL-2139).
 *
 * `emailLogoUrl` was resolvable, storable, editable — and rendered by nothing.
 * These assert the rendering half in both directions, because a test that only
 * exercises the with-a-logo case passes on a renderer that emits an `<img>`
 * unconditionally, which is the failure that matters: a broken-image box at
 * the top of every transactional email a non-white-label org sends.
 */
describe('brand logo header (AGL-2139)', () => {
  const BODY = {
    root: { componentId: 'div', nodes: ['t'] },
    t: { componentId: 'emailText', props: { children: 'hello' } },
  } as any

  it('renders an absolute logo above the body when the org has one', () => {
    const { html } = renderEmailHtml({
      sanitize: SANITIZE,
      nodes: BODY,
      brandLogoUrl: 'https://cdn.example.com/acme.png',
      merge: { 'brand.productName': 'Acme' },
    })
    expect(html).toContain('https://cdn.example.com/acme.png')
    // Alt text carries the brand, so a client with images off still reads it.
    expect(html).toContain('alt="Acme"')
    // Above the body, not appended after it.
    expect(html.indexOf('acme.png')).toBeLessThan(html.indexOf('hello'))
  })

  it('emits NO img at all when the org has no logo', () => {
    const { html } = renderEmailHtml({ sanitize: SANITIZE, nodes: BODY })
    expect(html).not.toContain('<img')
    expect(html).toContain('hello')
  })

  it('resolves a media: reference against the media origin', () => {
    const { html } = renderEmailHtml({
      sanitize: SANITIZE,
      nodes: BODY,
      brandLogoUrl: 'media:h1/med9',
      mediaOrigin: 'https://console.example.com',
      mediaHostId: 'h1',
    })
    // The whole point is the ABSOLUTE form, so assert the exact src rather
    // than a substring: `toContain('/api/media/cdn/')` alone would also pass
    // on a renderer that emitted the site-relative path, which is the very
    // bug AGL-1224 fixed for every other image.
    expect(html).toContain(
      'src="https://console.example.com/api/media/cdn/h1/med9"',
    )
    // And the stored reference must not survive into the markup. Without
    // this, a renderer that emitted BOTH — or that passed the ref through in
    // some other attribute — would still read as green (AGL-2230).
    expect(html).not.toContain('media:h1/med9')
  })

  it('resolves a cdnPath logo, which is what "Browse" actually stores', () => {
    // `MediaUrlField.onPick` writes `media.cdnPath`, a SITE-RELATIVE path —
    // so this generation reaches the renderer just as often as a `media:`
    // ref, and is equally unfetchable from an inbox (AGL-2230).
    const { html } = renderEmailHtml({
      sanitize: SANITIZE,
      nodes: BODY,
      brandLogoUrl: '/api/media/cdn/h1/med9',
      mediaOrigin: 'https://console.example.com',
    })
    expect(html).toContain(
      'src="https://console.example.com/api/media/cdn/h1/med9"',
    )
    expect(html).not.toContain('src="/api/media/cdn/')
  })

  it('DROPS a relative logo rather than emitting a broken src', () => {
    // Same rule as every other image (AGL-1224): an inbox has no page to
    // resolve `/api/media/cdn/…` against, so a gap beats a broken-image box.
    const { html } = renderEmailHtml({
      sanitize: SANITIZE,
      nodes: BODY,
      brandLogoUrl: 'media:h1/med9',
    })
    expect(html).not.toContain('<img')
    // Belt and braces: the ref must not leak anywhere in the document, not
    // merely out of an `<img>` tag.
    expect(html).not.toContain('media:h1/med9')
    // The rest of the email still renders — a dropped logo is a gap, not a
    // failed render.
    expect(html).toContain('hello')
  })
})

/**
 * The two properties that keep the mailed copy and the console's copy of the
 * SAME nodes in agreement: block HTML passes a policy, and every URL passes a
 * scheme check.
 *
 * Neither is load-bearing in an inbox on its own — mail clients strip
 * `javascript:` and most markup themselves — so this is defense in depth
 * until one of these documents renders somewhere without a sandbox, at which
 * point it is the only defense. A "view this email in your browser" link is
 * the ordinary way that happens.
 */
describe('render safety', () => {
  const nodesWith = (id: string, props: Record<string, unknown>) =>
    ({
      root: { componentId: 'div', nodes: ['n'] },
      n: { componentId: id, props },
    }) as any

  /**
   * A stand-in for `sanitizeAuthorHtml` — the real policy is aglyn-scoped and
   * `scope:shared` may not import it, which is the whole reason the renderer
   * takes the sanitizer as an argument instead of choosing one.
   *
   * Crude on purpose: these tests prove the renderer ROUTES block HTML
   * through the policy and routes the right string through it. What the
   * policy itself keeps is `author-html.spec.ts`'s subject, and duplicating
   * it here would be a second copy of the rule that could drift from the one
   * that ships.
   */
  const strip = (html: string) =>
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/ on\w+="[^"]*"/gi, '')

  describe('the sanitizer is required, not defaulted', () => {
    it('routes an emailRichtext block through the caller policy', () => {
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailRichtext', {
          html: '<p>hi</p><script>alert(1)</script>',
        }),
        sanitize: strip,
      })
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('alert(1)')
      // The legitimate half survives — a policy that ate everything would
      // also pass the two assertions above.
      expect(html).toContain('<p>hi</p>')
    })

    it('routes an emailHtml block through it too', () => {
      // Two componentIds, one case arm. A fix applied to the arm covers both,
      // but nothing stops someone splitting them later.
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailHtml', {
          html: '<div onclick="steal()">copy</div>',
        }),
        sanitize: strip,
      })
      expect(html).not.toContain('onclick')
      expect(html).toContain('copy')
    })

    it('sanitizes AFTER merge substitution, so a merge value is covered too', () => {
      // The sharp edge. Substituting first and sanitizing second is what makes
      // the policy see the final string; the other order would sanitize a
      // template whose dangerous half had not arrived yet.
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailRichtext', { html: '<p>{{note}}</p>' }),
        merge: { note: '<script>alert(1)</script>ok' },
        sanitize: strip,
      })
      expect(html).not.toContain('<script>')
      expect(html).toContain('ok')
    })

    it('is a compile error to omit', () => {
      // The runtime cannot assert this and the runtime is not where it
      // matters. An optional `sanitize` with an identity default type-checks
      // at every call site and silently sends unpoliced markup, so the
      // requirement is the control and the type is the only place to state
      // it. `@ts-expect-error` FAILS THE BUILD if the property becomes
      // optional, which is what actually holds the door shut.
      // @ts-expect-error sanitize is required on EmailRenderOptions
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailText', { children: 'x' }),
      })
      expect(html).toContain('x')
    })
  })

  describe('URL schemes', () => {
    it('refuses a javascript: button href and keeps the button inert', () => {
      const { html, text } = renderEmailHtml({
        nodes: nodesWith('emailButton', {
          children: 'Claim offer',
          href: 'javascript:alert(document.cookie)',
        }),
        sanitize: SANITIZE,
      })
      expect(html).not.toContain('javascript:')
      expect(html).toContain('href="#"')
      // The author's copy survives — the link is refused, not the content.
      expect(html).toContain('Claim offer')
      // And the plain-text alternative does not carry it either.
      expect(text).not.toContain('javascript:')
    })

    it('refuses the whitespace-obfuscated spelling a browser still honors', () => {
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailButton', {
          children: 'Go',
          href: 'java\tscript:alert(1)',
        }),
        sanitize: SANITIZE,
      })
      expect(html).toContain('href="#"')
      expect(html).not.toContain('script:')
    })

    it('refuses a data: href deliberately', () => {
      // Deliberate, not incidental: a data: href is a whole document the
      // reader navigates into. Refused for every payload, raster included.
      for (const href of [
        'data:text/html,<script>alert(1)</script>',
        'data:image/svg+xml,<svg onload="x()"/>',
        'data:image/png;base64,iVBORw0KGgo=',
      ]) {
        const { html } = renderEmailHtml({
          nodes: nodesWith('emailButton', { children: 'Go', href }),
          sanitize: SANITIZE,
        })
        expect(html).toContain('href="#"')
        expect(html).not.toContain('data:')
      }
    })

    it('drops the link wrapper on an image but keeps the image', () => {
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailImage', {
          src: 'https://cdn.acme.test/hero.png',
          alt: 'Hero',
          href: 'javascript:alert(1)',
        }),
        sanitize: SANITIZE,
      })
      expect(html).not.toContain('javascript:')
      expect(html).not.toContain('<a ')
      // The picture is the content; the link was decoration on it.
      expect(html).toContain('src="https://cdn.acme.test/hero.png"')
    })

    it('refuses a javascript: image src outright', () => {
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailImage', { src: 'javascript:alert(1)', alt: 'x' }),
        sanitize: SANITIZE,
        mediaOrigin: 'https://acme.test',
      })
      expect(html).not.toContain('javascript:')
      expect(html).not.toContain('<img')
    })

    it('refuses an unsafe product url and keeps the card', () => {
      const { html, text } = renderEmailHtml({
        nodes: {
          root: { componentId: 'div', nodes: ['p'] },
          p: { componentId: 'emailProduct', props: { productId: 'p1' } },
        } as any,
        products: {
          p1: { name: 'Widget', priceLabel: '$29', url: 'javascript:alert(1)' },
        },
        sanitize: SANITIZE,
      })
      expect(html).not.toContain('javascript:')
      expect(text).not.toContain('javascript:')
      // Catalog data, but "it came from a table" is a claim about every writer
      // of that table. The card still renders; only the button is gone.
      expect(html).toContain('Widget')
      expect(html).toContain('$29')
    })

    it('escapes an entity-encoded scheme into inert text', () => {
      // The check reads raw characters and approves this, because it names no
      // scheme as written. The ESCAPE is what closes it: `&` becomes `&amp;`,
      // so the parser reads literal text rather than a character reference.
      // Both steps, in that order — this fails if either is removed.
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailButton', {
          children: 'Go',
          href: '&#106;avascript:alert(1)',
        }),
        sanitize: SANITIZE,
      })
      expect(html).toContain('href="&amp;#106;avascript:alert(1)"')
      expect(html).not.toContain('href="&#106;')
    })
  })

  describe('recipient data never reaches a URL', () => {
    const MERGE = {
      'contact.email': 'sam@acme.test',
      'contact.firstName': 'Sam',
      'site.url': 'https://acme.test',
      unsubscribeUrl: 'https://acme.test/u/abc123',
    }

    it('refuses a contact token spliced into a button href', () => {
      const { html, text } = renderEmailHtml({
        nodes: nodesWith('emailButton', {
          children: 'Hi {{contact.firstName}}',
          href: 'https://tracker.test/c?e={{contact.email}}',
        }),
        merge: MERGE,
        sanitize: SANITIZE,
      })
      expect(html).not.toContain('sam@acme.test')
      expect(text).not.toContain('sam@acme.test')
      // Left standing rather than blanked, which is this module's convention
      // for a token it will not fill: a test send shows the author what
      // happened instead of shipping a quietly different URL.
      expect(html).toContain('e={{contact.email}}')
      // The SAME token still personalizes body copy — the refusal is scoped
      // to the URL position, not to the token.
      expect(html).toContain('Hi Sam')
    })

    it('refuses one spliced into an image src or its link', () => {
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailImage', {
          src: 'https://tracker.test/px.gif?e={{contact.email}}',
          alt: 'x',
          href: 'https://tracker.test/c?e={{contact.email}}',
        }),
        merge: MERGE,
        sanitize: SANITIZE,
      })
      expect(html).not.toContain('sam@acme.test')
    })

    it('still substitutes the URL tokens that ARE urls', () => {
      // The control for this rule. Narrowing to everything would take
      // `{{unsubscribeUrl}}` with it, and an unsubscribe link that does not
      // resolve is its own, worse, problem.
      const { html } = renderEmailHtml({
        nodes: nodesWith('emailButton', {
          children: 'Unsubscribe',
          href: '{{unsubscribeUrl}}',
        }),
        merge: MERGE,
        sanitize: SANITIZE,
      })
      expect(html).toContain('href="https://acme.test/u/abc123"')
      expect(html).not.toContain('{{')
    })
  })

  it('CONTROL: an ordinary email renders exactly as it did', () => {
    // The whole point of the guard is that it is invisible to real content.
    // Every refusal test above would also pass on a renderer that emitted an
    // empty document.
    const { html, text } = renderEmailHtml({
      nodes: {
        root: { componentId: 'div', nodes: ['s'] },
        s: {
          componentId: 'emailSection',
          props: { backgroundColor: '#ffffff', padding: 20 },
          nodes: ['t', 'r', 'i', 'b', 'm', 'p'],
        },
        t: {
          componentId: 'emailText',
          props: { children: 'Hi {{contact.firstName}},', variant: 'heading' },
        },
        r: {
          componentId: 'emailRichtext',
          props: { html: '<p>Our <strong>spring</strong> sale is on.</p>' },
        },
        i: {
          componentId: 'emailImage',
          props: {
            src: 'https://cdn.acme.test/hero.png',
            alt: 'Hero',
            href: 'https://acme.test/sale?utm_source=email&page=2',
          },
        },
        b: {
          componentId: 'emailButton',
          props: { children: 'Shop the sale', href: '{{site.url}}/shop' },
        },
        m: {
          componentId: 'emailButton',
          props: { children: 'Reply', href: 'mailto:hi@acme.test' },
        },
        p: { componentId: 'emailProduct', props: { productId: 'p1' } },
      } as any,
      subject: 'Spring sale',
      merge: {
        'contact.firstName': 'Sam',
        'contact.email': 'sam@acme.test',
        'site.url': 'https://acme.test',
      },
      products: {
        p1: {
          name: 'Widget',
          priceLabel: '$29',
          url: 'https://acme.test/products/widget',
          imageUrl: 'https://cdn.acme.test/widget.png',
        },
      },
      sanitize: strip,
    })
    expect(html).toContain('Hi Sam,')
    expect(html).toContain('<p>Our <strong>spring</strong> sale is on.</p>')
    expect(html).toContain('src="https://cdn.acme.test/hero.png"')
    // A query string with an `&` still escapes to the one correct form, not a
    // double-encoded one.
    expect(html).toContain(
      'href="https://acme.test/sale?utm_source=email&amp;page=2"',
    )
    expect(html).toContain('href="https://acme.test/shop"')
    expect(html).toContain('href="mailto:hi@acme.test"')
    expect(html).toContain('href="https://acme.test/products/widget"')
    expect(html).toContain('src="https://cdn.acme.test/widget.png"')
    // Nothing was refused, so no placeholder crept in anywhere.
    expect(html).not.toContain('href="#"')
    expect(html).not.toContain('{{')
    expect(text).toContain('Widget — $29')
  })
})
