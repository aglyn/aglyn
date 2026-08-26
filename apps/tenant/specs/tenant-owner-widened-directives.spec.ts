/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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

const {
  GOOGLE_CCTLD_ORIGINS,
  MEASUREMENT_CONNECT_ORIGINS,
  tenantConnectSrcDirective,
  tenantFontSrcDirective,
  tenantFormActionDirective,
  tenantFrameSrcDirective,
  tenantMediaSrcDirective,
  // Root-level CommonJS, outside the nx graph, because `next.config.js` must
  // `require` it (AGL-523) — the console specs read it the same way.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @nx/enforce-module-boundaries
} = require('../../../security-origins.js')

const SITE = ['demo.aglyn.app', 'example.com']

/**
 * The directives an owner can widen from the Security tab (AGL-1152).
 *
 * They enforce rather than report, which is only defensible because each
 * fallback below was MEASURED against what our own code emits rather than
 * guessed. These assert the measurements, because the failure mode of getting
 * one wrong is silent and platform-wide: content that simply stops loading on
 * every published site at once, for a choice its owner made in our editor.
 */
describe('owner-widened tenant CSP directives (AGL-1152)', () => {
  it('pins the Google font FILE origin, which the theme editor implies', () => {
    // `host-theme.ts` builds a `fonts.googleapis.com/css2` link for any theme
    // naming Google families, and the faces it references are served from
    // `fonts.gstatic.com`. Dropping this pin strips the typeface from every
    // themed site on the platform.
    expect(tenantFontSrcDirective(true, [], SITE)).toContain(
      'https://fonts.gstatic.com',
    )
  })

  it('pins storage for media, so a free-tier upload still plays', () => {
    // Orgs without the paid `mediaCdn` entitlement store absolute
    // `firebasestorage.googleapis.com` URLs — for video exactly as for images.
    expect(tenantMediaSrcDirective(true, [], SITE)).toContain(
      'https://firebasestorage.googleapis.com',
    )
  })

  it("carries the site's OWN addresses, not just 'self'", () => {
    // A site with a custom domain attached has two origins, and `'self'` is
    // only the one the page was served from. The owner should not have to
    // approve their own address, and would have no way to know they must.
    for (const build of [
      tenantFontSrcDirective,
      tenantMediaSrcDirective,
      tenantFormActionDirective,
    ]) {
      const value = build(true, [], SITE)
      expect(value).toContain('https://demo.aglyn.app')
      expect(value).toContain('https://example.com')
    }
    // `connect-src` takes the measurement flag between the list and the
    // origins, so it is built here rather than in the loop above.
    const connect = tenantConnectSrcDirective(true, [], false, SITE)
    expect(connect).toContain('https://demo.aglyn.app')
    expect(connect).toContain('https://example.com')
  })

  it('pins Stripe for connect, so a card submit still reaches the API', () => {
    // `storefront-payment-element.tsx` mounts Stripe's `CheckoutProvider`,
    // whose session and confirm calls go to `api.stripe.com` from the top
    // document. Dropping the pin fails a purchase at its last step.
    expect(tenantConnectSrcDirective(true, [], false, SITE)).toContain(
      'https://api.stripe.com',
    )
  })

  it('admits a connection the owner approved, and refuses one it was not given', () => {
    // The widest of the owner lists in effect: a `srcdoc` iframe inherits
    // `connect-src`, so the Custom HTML block's Embed mode fetches under it.
    const value = tenantConnectSrcDirective(true, ['api.example.net'], false, SITE)
    expect(value).toContain('https://api.example.net')
    expect(tenantConnectSrcDirective(true, [], false, SITE)).not.toContain(
      'api.example.net',
    )
  })

  it('grants an analytics endpoint only to a site that runs measurement', () => {
    // A site with no analytics has no reason to permit an ad network's
    // endpoint; one that permits it anyway describes our convenience.
    const without = tenantConnectSrcDirective(true, [], false, SITE)
    const with_ = tenantConnectSrcDirective(true, [], true, SITE)
    // Measured on production: a load of `https://aglyn.com/pricing` recorded
    // `fetch https://www.google-analytics.com/g/collect?v=2&tid=G-…`.
    expect(with_).toContain('https://www.google-analytics.com')
    expect(without).not.toContain('google-analytics.com')
    for (const origin of MEASUREMENT_CONNECT_ORIGINS) {
      expect(with_).toContain(origin)
    }
  })

  it('pins the two players the Video block can actually build', () => {
    // `parseVideoEmbedSrc` rebuilds the address from a parsed video id, so
    // these two strings are the ONLY ones it can produce — the author's raw
    // URL never reaches the element. Dropping either takes the Video block to
    // an empty box on every site that uses one.
    const value = tenantFrameSrcDirective(true, [], SITE)
    expect(value).toContain('https://www.youtube-nocookie.com')
    expect(value).toContain('https://player.vimeo.com')
  })

  it('pins the payment frames, so in-page checkout still renders a card field', () => {
    // Measured against a real mount: `elements.create('payment')` put three
    // iframes on the page, all on `js.stripe.com`. `hooks.stripe.com` is the
    // 3-D Secure challenge — `csp-stripe-payment-element.spec.ts` demands both
    // of any `frame-src` this surface ever grows.
    const value = tenantFrameSrcDirective(true, [], SITE)
    expect(value).toContain('https://js.stripe.com')
    expect(value).toContain('https://hooks.stripe.com')
  })

  it("spells out 'self' and the site's own addresses, which frame-src needs", () => {
    // Measured: `frame-src` has NO implicit fallback to same-origin. Under
    // `frame-src https://example.invalid` a same-origin child reported
    // `frame-src <- …/denied.html`, so without `'self'` the platform's own
    // frames are refused on their own page.
    const value = tenantFrameSrcDirective(true, [], SITE)
    expect(value.startsWith("frame-src 'self' ")).toBe(true)
    expect(value).toContain('https://demo.aglyn.app')
    expect(value).toContain('https://example.com')
  })

  it('admits an embed the owner approved, and refuses one it was not given', () => {
    const value = tenantFrameSrcDirective(true, ['maps.example.net'], SITE)
    expect(value).toContain('https://maps.example.net')
    expect(tenantFrameSrcDirective(true, [], SITE)).not.toContain(
      'maps.example.net',
    )
  })

  it('never turns frame-src into a wildcard, whatever it is handed', () => {
    // The refusal that matters most on this directive: a bare `*` would let an
    // injected iframe load a pixel-perfect login form from anywhere.
    const value = tenantFrameSrcDirective(
      true,
      ['*', '', 'evil.com; frame-src *', 'https://ok.example.com'],
      SITE,
    )
    expect(value).not.toContain('*')
    expect(value).not.toContain(';')
    expect(value).not.toContain('evil.com')
  })

  it('keeps the ~190 Google country domains OUT of connect-src', () => {
    // They exist for one `<img>` remarketing beacon, so they buy nothing for a
    // fetch and would put ~4.8 KB of header on every response of every
    // measuring site. `www.google.com` is kept deliberately and is excluded
    // from this check.
    const value = tenantConnectSrcDirective(true, [], true, SITE)
    for (const origin of GOOGLE_CCTLD_ORIGINS) {
      if (origin === 'https://www.google.com') continue
      expect(value).not.toContain(origin)
    }
    expect(value).toContain('https://www.google.com')
  })

  it('admits what the owner approved, and nothing it was not given', () => {
    const value = tenantMediaSrcDirective(true, ['videos.example.net'], SITE)
    expect(value).toContain('https://videos.example.net')
    expect(tenantMediaSrcDirective(true, [], SITE)).not.toContain(
      'videos.example.net',
    )
  })

  it('refuses a form destination that was never approved', () => {
    // This is the directive that decides whether an injected form can carry
    // what a visitor typed off-site, so it gets no data:/blob: escape hatch.
    const value = tenantFormActionDirective(true, [], SITE)
    expect(value.startsWith('form-action ')).toBe(true)
    expect(value).not.toContain('data:')
    expect(value).not.toContain('blob:')
    expect(value).not.toContain('*')
  })

  it('keeps localhost off production policies', () => {
    for (const build of [tenantFontSrcDirective, tenantMediaSrcDirective]) {
      expect(build(true, [], SITE)).not.toContain('localhost')
      expect(build(false, [], SITE)).toContain('http://localhost:*')
    }
    expect(tenantConnectSrcDirective(true, [], false, SITE)).not.toContain(
      'localhost',
    )
    // `ws:` as well as `http:`, because a source expression matches by scheme
    // group — `http://localhost:*` does not admit the dev server's HMR socket.
    const dev = tenantConnectSrcDirective(false, [], false, SITE)
    expect(dev).toContain('http://localhost:*')
    expect(dev).toContain('ws://localhost:*')
  })
})
