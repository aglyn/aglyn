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
  tenantFontSrcDirective,
  tenantFormActionDirective,
  tenantMediaSrcDirective,
  // Root-level CommonJS, outside the nx graph, because `next.config.js` must
  // `require` it (AGL-523) — the console specs read it the same way.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @nx/enforce-module-boundaries
} = require('../../../security-origins.js')

const SITE = ['demo.aglyn.app', 'example.com']

/**
 * The three directives an owner can widen from the Security tab (AGL-1152).
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
  })
})
