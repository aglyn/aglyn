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
      renderEmailHtml({ nodes: imageNodes(src), ...options }).html

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
    const { html } = renderEmailHtml({ nodes: BODY })
    expect(html).not.toContain('<img')
    expect(html).toContain('hello')
  })

  it('resolves a media: reference against the media origin', () => {
    const { html } = renderEmailHtml({
      nodes: BODY,
      brandLogoUrl: 'media:h1/med9',
      mediaOrigin: 'https://console.example.com',
      mediaHostId: 'h1',
    })
    expect(html).toContain('https://console.example.com/api/media/cdn/')
  })

  it('DROPS a relative logo rather than emitting a broken src', () => {
    // Same rule as every other image (AGL-1224): an inbox has no page to
    // resolve `/api/media/cdn/…` against, so a gap beats a broken-image box.
    const { html } = renderEmailHtml({ nodes: BODY, brandLogoUrl: 'media:h1/med9' })
    expect(html).not.toContain('<img')
  })
})
