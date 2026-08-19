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
  isBrandingImageUrl,
  isBrandingLinkUrl,
} from '../app/api/_lib/branding-url'

/**
 * The branding save must accept what its own picker produces (AGL-2247).
 *
 * `/api/orgs/settings` validated all four `OrgBrandingProfile` URL fields with
 * one `^https://` rule, while `MediaUrlField`'s "Browse" button — offered on
 * three of them — writes `media.cdnPath`, which is
 * `/api/media/cdn/{scope}/{mediaId}` and never absolute. So picking any normal
 * public asset and pressing Save returned 400 `Logo URL must be an https:// URL`.
 * The affordance the white-label docs advertise hardest could not be saved, on
 * the tier that costs the most, and the only value that survived was a URL
 * pasted by hand from somewhere the customer hosts themselves.
 *
 * The positive cases below are therefore the point, but they are worthless
 * alone: a predicate that returned `true` for everything would satisfy every
 * one of them, and would turn the field into an XSS sink the moment a
 * `javascript:` value reached an `<img src>` or an `<a href>`. So the refusals
 * are asserted at equal weight, and the two shapes are asserted to stay
 * DIFFERENT — `supportUrl` is navigated and must still name a host.
 */
describe('branding URL validation (AGL-2247)', () => {
  /** Exactly what `media-picker-dialog`'s `onPick` hands `MediaUrlField`. */
  const PICKER_OUTPUT = '/api/media/cdn/org:org-1/media-1'

  describe('an image field takes the picker output', () => {
    it('accepts the CDN path the media picker actually writes', () => {
      expect(isBrandingImageUrl(PICKER_OUTPUT)).toBe(true)
    })

    it('accepts the host-qualified form for a restricted org asset', () => {
      // `hostQualifiedCdnPath` rewrites `org:{orgId}` to `org:{orgId}:{hostId}`
      // at pick time, so this is the shape a restricted asset arrives in.
      expect(isBrandingImageUrl('/api/media/cdn/org:org-1:host-9/media-1')).toBe(
        true,
      )
    })

    it('still accepts a hand-pasted absolute https URL', () => {
      expect(isBrandingImageUrl('https://cdn.example.com/acme.png')).toBe(true)
    })
  })

  describe('...and refuses everything else, which is what makes that safe', () => {
    it.each([
      ['http, not https', 'http://cdn.example.com/acme.png'],
      ['a bare hostname', 'cdn.example.com/acme.png'],
      ['a javascript: scheme', 'javascript:alert(1)'],
      ['a data: URI', 'data:image/svg+xml;base64,PHN2Zy8+'],
      ['protocol-relative, which names a FOREIGN host', '//evil.example/x.png'],
      ['a path outside the media CDN', '/api/admin/secrets'],
      ['the CDN prefix with a traversal escape', '/api/media/cdn/../../etc/pw'],
      ['a CDN path with no media id', '/api/media/cdn/org:org-1'],
      ['a CDN path with an extra segment', '/api/media/cdn/org:org-1/med/1'],
      ['a query smuggled onto a CDN path', '/api/media/cdn/org:org-1/m?x=1'],
      ['an https URL with leading whitespace', ' https://cdn.example.com/a.png'],
    ])('refuses %s', (_label, value) => {
      expect(isBrandingImageUrl(value)).toBe(false)
    })
  })

  /**
   * The negative control for the whole change. If `supportUrl` had been
   * widened alongside the image fields, every assertion above would still
   * pass — and a support "URL" of `/api/media/cdn/…` in an email footer is a
   * dead link, because an inbox has no page to resolve it against.
   */
  describe('a NAVIGATED url is not widened with the rendered ones', () => {
    it('refuses the picker output for Support URL', () => {
      expect(isBrandingLinkUrl(PICKER_OUTPUT)).toBe(false)
    })

    it('accepts an absolute https support URL', () => {
      expect(isBrandingLinkUrl('https://acme.example.com/help')).toBe(true)
    })

    it('the two predicates genuinely disagree', () => {
      // Stated as a property rather than two coincidences: if someone later
      // collapses them back into one shared rule, this is the assertion that
      // names what was lost.
      expect(isBrandingImageUrl(PICKER_OUTPUT)).toBe(true)
      expect(isBrandingLinkUrl(PICKER_OUTPUT)).toBe(false)
    })
  })
})
