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
  absoluteMediaSrc,
  formatMediaRef,
  hostQualifiedScope,
  isFirstPartyMediaSrc,
  isMediaCdnUrl,
  isMediaRef,
  mediaNodeSrc,
  mediaRefFromCdnPath,
  mediaRefPattern,
  MEDIA_CDN_ROUTE,
  parseMediaRef,
  resolveMediaSrc,
  siteRelativeMediaSrc,
} from './media-ref'

const RAW_URL =
  'https://firebasestorage.googleapis.com/v0/b/aglyn.appspot.com/o/' +
  'hosts%2Fsite-a%2Fmedia%2Fmed123?alt=media&token=abc'

describe('media references (AGL-1215)', () => {
  describe('parse / format', () => {
    it('round-trips a host-library reference', () => {
      const ref = formatMediaRef('site-a', 'med123')
      expect(ref).toBe('media:site-a/med123')
      expect(parseMediaRef(ref)).toEqual({ scope: 'site-a', mediaId: 'med123' })
    })

    it('round-trips an org reference, bare and host-qualified', () => {
      expect(parseMediaRef('media:org:acme/med123')).toEqual({
        scope: 'org:acme',
        mediaId: 'med123',
      })
      expect(parseMediaRef('media:org:acme:site-a/med123')).toEqual({
        scope: 'org:acme:site-a',
        mediaId: 'med123',
      })
    })

    it('refuses to mint or parse anything the CDN would reject', () => {
      expect(formatMediaRef('org:acme:site-a:extra', 'med123')).toBeUndefined()
      expect(formatMediaRef('site-a', 'med/123')).toBeUndefined()
      expect(formatMediaRef('', 'med123')).toBeUndefined()
      expect(parseMediaRef('media:site-a')).toBeNull()
      expect(parseMediaRef('media:/med123')).toBeNull()
      expect(parseMediaRef('media:site a/med123')).toBeNull()
    })

    it('does not mistake a URL or a binding token for a reference', () => {
      expect(isMediaRef(RAW_URL)).toBe(false)
      expect(isMediaRef('/api/media/cdn/site-a/med123')).toBe(false)
      expect(isMediaRef('{{var:hero}}')).toBe(false)
      expect(isMediaRef(undefined)).toBe(false)
    })
  })

  describe('resolveMediaSrc', () => {
    it('resolves a reference to the CDN URL', () => {
      expect(resolveMediaSrc('media:site-a/med123')).toBe(
        '/api/media/cdn/site-a/med123',
      )
    })

    it('host-qualifies an org scope with the rendering site', () => {
      expect(
        resolveMediaSrc('media:org:acme/med123', { hostId: 'site-a' }),
      ).toBe('/api/media/cdn/org:acme:site-a/med123')
    })

    it('re-qualifies a reference placed on a different site', () => {
      // The picker baked site-a in because the canvas has no site context;
      // rendering on site-b must ask as site-b or the CDN 404s a restricted
      // asset that site-b is in fact allowed to see.
      expect(
        resolveMediaSrc('media:org:acme:site-a/med123', { hostId: 'site-b' }),
      ).toBe('/api/media/cdn/org:acme:site-b/med123')
    })

    it('keeps the picker-baked qualification with no site context', () => {
      expect(resolveMediaSrc('media:org:acme:site-a/med123')).toBe(
        '/api/media/cdn/org:acme:site-a/med123',
      )
    })

    it('never host-qualifies a host-library scope', () => {
      expect(resolveMediaSrc('media:site-a/med123', { hostId: 'site-b' })).toBe(
        '/api/media/cdn/site-a/med123',
      )
    })

    it('passes a legacy raw storage URL through untouched', () => {
      expect(resolveMediaSrc(RAW_URL, { hostId: 'site-a' })).toBe(RAW_URL)
    })

    it('passes a legacy CDN path through untouched', () => {
      const legacy = '/api/media/cdn/org:acme/med123'
      expect(resolveMediaSrc(legacy, { hostId: 'site-b' })).toBe(legacy)
    })

    it('passes an author-typed external URL through untouched', () => {
      const hotlink = 'https://images.example.com/hero.png?v=2'
      expect(resolveMediaSrc(hotlink)).toBe(hotlink)
    })

    it('resolves empty and malformed references to undefined', () => {
      expect(resolveMediaSrc('')).toBeUndefined()
      expect(resolveMediaSrc(undefined)).toBeUndefined()
      expect(resolveMediaSrc('media:nonsense')).toBeUndefined()
    })
  })

  /**
   * AGL-1726. Production stored a product image as
   * `https://northwind-coffee.aglyn.app/api/media/cdn/{scope}/{mediaId}` and
   * commerce rendered it unresolved, so a white-label storefront on the
   * customer's own domain served an image URL naming OUR platform —
   * cross-origin, in page source, and in every visitor's request.
   *
   * Each case below names the property it defends, so a red one says which
   * guarantee broke rather than only that a string changed.
   */
  describe('siteRelativeMediaSrc (AGL-1726)', () => {
    const ABSOLUTE_CDN =
      'https://northwind-coffee.aglyn.app/api/media/cdn/host-1/med123'

    it('drops a first-party origin from a CDN url — the whole defect', () => {
      expect(siteRelativeMediaSrc(ABSOLUTE_CDN)).toBe(
        '/api/media/cdn/host-1/med123',
      )
      // …and the result is not merely shorter: it names no host at all, which
      // is the property a white-label storefront actually needs.
      expect(siteRelativeMediaSrc(ABSOLUTE_CDN)).not.toContain('aglyn.app')
      expect(siteRelativeMediaSrc(ABSOLUTE_CDN)?.startsWith('/')).toBe(true)
    })

    it('drops the CONSOLE origin too — AGL-1378 white-label console domains', () => {
      expect(
        siteRelativeMediaSrc('https://app.aglyn.com/api/media/cdn/host-1/med'),
      ).toBe('/api/media/cdn/host-1/med')
    })

    it('carries the private-asset signature through', () => {
      // `signMediaAccess` signs (scope, mediaId, exp) and never the host, so
      // an unsigned result here would be a 403 on every private asset.
      expect(
        siteRelativeMediaSrc(`${ABSOLUTE_CDN}?exp=99&sig=deadbeef`),
      ).toBe('/api/media/cdn/host-1/med123?exp=99&sig=deadbeef')
    })

    it('NEVER rewrites a third-party host that mimics our path', () => {
      // The gate is the host, not the path. Relativizing this would silently
      // re-point an author's hotlink at our own CDN.
      const mimic = 'https://images.example.com/api/media/cdn/host-1/med123'
      expect(siteRelativeMediaSrc(mimic)).toBe(mimic)
    })

    it('leaves firebasestorage absolute — AGL-1726 condition 5', () => {
      // A first-party HOST, but not a CDN path: free-tier orgs store this
      // form, and relativizing it would blank every free-tier image.
      expect(siteRelativeMediaSrc(RAW_URL)).toBe(RAW_URL)
    })

    it('leaves an author hotlink and a protocol-relative url alone', () => {
      const hotlink = 'https://images.example.com/hero.png?v=2'
      expect(siteRelativeMediaSrc(hotlink)).toBe(hotlink)
      expect(siteRelativeMediaSrc('//cdn.other.test/x.png')).toBe(
        '//cdn.other.test/x.png',
      )
    })

    it('still resolves references, host-qualification included', () => {
      expect(siteRelativeMediaSrc('media:site-a/med123')).toBe(
        '/api/media/cdn/site-a/med123',
      )
      expect(
        siteRelativeMediaSrc('media:org:acme/med123', { hostId: 'site-b' }),
      ).toBe('/api/media/cdn/org:acme:site-b/med123')
    })

    it('keeps absent, empty and malformed distinct from a broken src', () => {
      // `strictNullChecks` is off repo-wide, so a missing field folds to
      // falsy silently. Every one of these must reach the caller as
      // undefined — the placeholder — never as a string an `<img>` fetches.
      expect(siteRelativeMediaSrc(undefined)).toBeUndefined()
      expect(siteRelativeMediaSrc(null)).toBeUndefined()
      expect(siteRelativeMediaSrc('')).toBeUndefined()
      expect(siteRelativeMediaSrc('media:junk')).toBeUndefined()
    })

    it('passes a value that is not a URL through rather than throwing', () => {
      expect(siteRelativeMediaSrc('{{var:hero}}')).toBe('{{var:hero}}')
      expect(siteRelativeMediaSrc('https://')).toBe('https://')
    })

    it('leaves resolveMediaSrc itself unchanged — the email mirror depends on it', () => {
      // `resolveEmailMediaSrc` is a hand-kept COPY pinned by
      // `apps/console/specs/email-media-src-drift.spec.ts`, and
      // `absoluteMediaSrc`'s out-of-band readers need the absolute form. If
      // this ever reddens, the relativization leaked into the authority.
      expect(resolveMediaSrc(ABSOLUTE_CDN)).toBe(ABSOLUTE_CDN)
      expect(absoluteMediaSrc(ABSOLUTE_CDN)).toBe(ABSOLUTE_CDN)
    })
  })

  describe('hostQualifiedScope', () => {
    it('is a no-op without a usable host id', () => {
      expect(hostQualifiedScope('org:acme', undefined)).toBe('org:acme')
      expect(hostQualifiedScope('org:acme', '')).toBe('org:acme')
      expect(hostQualifiedScope('org:acme', 'not a segment')).toBe('org:acme')
    })
  })

  describe('mediaNodeSrc — what the picker stores', () => {
    it('stores a reference derived from the entitled cdnPath', () => {
      expect(
        mediaNodeSrc({
          url: RAW_URL,
          cdnPath: `${MEDIA_CDN_ROUTE}/org:acme/med123`,
        }),
      ).toBe('media:org:acme/med123')
    })

    it('keeps the dialog host-qualification in the stored scope', () => {
      expect(
        mediaNodeSrc({ cdnPath: `${MEDIA_CDN_ROUTE}/org:acme:site-a/med123` }),
      ).toBe('media:org:acme:site-a/med123')
    })

    it('degrades to the raw URL for a free-tier org with no cdnPath', () => {
      // `cdnPath` is gated on the paid `mediaCdn` entitlement, and the CDN
      // handler does not re-check it — minting a reference from an id we
      // happen to know would hand free-tier orgs paid delivery.
      expect(mediaNodeSrc({ url: RAW_URL })).toBe(RAW_URL)
      expect(mediaNodeSrc({ url: RAW_URL, cdnPath: null })).toBe(RAW_URL)
    })

    it('has nothing to store when the asset has neither form', () => {
      expect(mediaNodeSrc({})).toBeUndefined()
    })
  })

  describe('mediaRefFromCdnPath', () => {
    it('drops the immutable content hash', () => {
      expect(
        mediaRefFromCdnPath(`${MEDIA_CDN_ROUTE}/site-a/med123/deadbeef`),
      ).toBe('media:site-a/med123')
    })

    it('accepts an absolute CDN URL', () => {
      expect(
        mediaRefFromCdnPath(`https://site-a.aglyn.app${MEDIA_CDN_ROUTE}/site-a/med123`),
      ).toBe('media:site-a/med123')
    })

    it('ignores anything that is not a CDN path', () => {
      expect(mediaRefFromCdnPath(RAW_URL)).toBeUndefined()
      expect(mediaRefFromCdnPath(undefined)).toBeUndefined()
    })
  })

  describe('mediaRefPattern — the where-used needle', () => {
    it('finds every scope form of the same asset in a serialized document', () => {
      const pattern = mediaRefPattern('med123')
      expect(
        pattern.test(JSON.stringify({ a: { props: { src: 'media:site-a/med123' } } })),
      ).toBe(true)
      expect(
        pattern.test(JSON.stringify({ a: { props: { src: 'media:org:acme/med123' } } })),
      ).toBe(true)
      expect(
        pattern.test(
          JSON.stringify({ a: { props: { src: 'media:org:acme:site-a/med123' } } }),
        ),
      ).toBe(true)
    })

    it('does not match a different asset with a shared prefix', () => {
      expect(mediaRefPattern('med1').test('media:site-a/med12')).toBe(false)
      expect(mediaRefPattern('med123').test('media:site-a/other')).toBe(false)
    })

    it('matches nothing for an id that sanitizes away', () => {
      expect(mediaRefPattern('../').test('media:site-a/med123')).toBe(false)
      expect(mediaRefPattern('').test('media:site-a/med123')).toBe(false)
    })
  })

  /**
   * The out-of-band variant (AGL-1407). Extracted from `resolveSocialImage`,
   * whose private copy this replaces, so the manifest icon, the inbox and
   * `og:image` share ONE rule about when a stored value may become an
   * absolute URL and when it must become nothing at all.
   */
  describe('absoluteMediaSrc — for consumers with no page to resolve against', () => {
    const ORIGIN = 'https://northwind.coffee'

    it('absolutizes a reference against the stated origin', () => {
      expect(
        absoluteMediaSrc('media:org:acme/med123', {
          hostId: 'site-a',
          origin: ORIGIN,
        }),
      ).toBe(`${ORIGIN}${MEDIA_CDN_ROUTE}/org:acme:site-a/med123`)
    })

    it('absolutizes the AGL-175 relative CDN path', () => {
      expect(
        absoluteMediaSrc('/api/media/cdn/org:acme/med123', { origin: ORIGIN }),
      ).toBe(`${ORIGIN}/api/media/cdn/org:acme/med123`)
    })

    it('leaves an already-absolute URL alone, origin or not', () => {
      expect(absoluteMediaSrc(RAW_URL, { origin: ORIGIN })).toBe(RAW_URL)
      expect(absoluteMediaSrc(RAW_URL)).toBe(RAW_URL)
      expect(absoluteMediaSrc('https://x.test/a.png')).toBe(
        'https://x.test/a.png',
      )
    })

    it('gives a protocol-relative URL a scheme, never an origin', () => {
      // Prefixing an origin would corrupt it — it already names a host.
      expect(absoluteMediaSrc('//cdn.test/a.png', { origin: ORIGIN })).toBe(
        'https://cdn.test/a.png',
      )
    })

    it('returns undefined rather than a relative URL when no origin is known', () => {
      // Never interpolate an unknown origin, and never emit a URL that is
      // well-formed but wrong (AGL-1160/AGL-1272).
      expect(absoluteMediaSrc('media:org:acme/med123')).toBeUndefined()
      expect(absoluteMediaSrc('/api/media/cdn/org:acme/med123')).toBeUndefined()
    })

    it('returns undefined for an unparseable reference and for nothing', () => {
      expect(absoluteMediaSrc('media:junk', { origin: ORIGIN })).toBeUndefined()
      expect(absoluteMediaSrc('', { origin: ORIGIN })).toBeUndefined()
      expect(absoluteMediaSrc(undefined, { origin: ORIGIN })).toBeUndefined()
    })
  })

  describe('isMediaCdnUrl — the srcSet gate', () => {
    it('recognises a resolved reference and a legacy path alike', () => {
      expect(isMediaCdnUrl(resolveMediaSrc('media:site-a/med123'))).toBe(true)
      expect(isMediaCdnUrl('/api/media/cdn/org:acme/med123')).toBe(true)
      expect(isMediaCdnUrl(RAW_URL)).toBe(false)
      expect(isMediaCdnUrl(undefined)).toBe(false)
    })
  })

  describe('isFirstPartyMediaSrc — the third-party image gate (AGL-1701)', () => {
    it('accepts the three forms the DAM picker actually produces', () => {
      // A reference, the same-origin CDN path, and — for a free-tier org with
      // no `mediaCdn` entitlement and therefore no `cdnPath` — the raw
      // storage download URL `mediaSrc` falls back to.
      expect(isFirstPartyMediaSrc('media:org:acme/med123')).toBe(true)
      expect(isFirstPartyMediaSrc('/api/media/cdn/org:acme/med123')).toBe(true)
      expect(isFirstPartyMediaSrc(RAW_URL)).toBe(true)
    })

    it('accepts the absolute CDN URL the browser-side picker emits', () => {
      // `mediaSrc` prefixes `window.location.origin` onto `cdnPath`, so the
      // stored value is absolute on whichever console host was open.
      expect(
        isFirstPartyMediaSrc(
          'https://console.aglyn.com/api/media/cdn/org:acme/med123',
        ),
      ).toBe(true)
      expect(
        isFirstPartyMediaSrc(
          'http://localhost:4200/api/media/cdn/org:acme/med123',
        ),
      ).toBe(false)
    })

    it('refuses a host the publisher controls, which is the whole point', () => {
      // The beacon shape: an `<img>` another org's browser fetches from a
      // server the publisher runs, disclosing the viewer's IP on every render.
      expect(isFirstPartyMediaSrc('https://cdn.publisher.example/logo.png')).toBe(
        false,
      )
      // A first-party LABEL inside a third-party domain must not pass.
      expect(isFirstPartyMediaSrc('https://aglyn.com.evil.example/a.png')).toBe(
        false,
      )
      expect(isFirstPartyMediaSrc('https://notaglyn.com/a.png')).toBe(false)
    })

    it('refuses http and protocol-relative in every form', () => {
      expect(isFirstPartyMediaSrc('http://cdn.publisher.example/a.png')).toBe(
        false,
      )
      // `//host/…` is a host, not a path — it must not fall through the
      // leading-slash branch and be read as same-origin.
      expect(
        isFirstPartyMediaSrc('//cdn.publisher.example/api/media/cdn/x/y'),
      ).toBe(false)
    })

    it('refuses a same-origin path that is not the media route', () => {
      // `'self'` would let this render, so the gate is what stops a listing
      // pointing at an arbitrary console route.
      expect(isFirstPartyMediaSrc('/api/orgs/settings')).toBe(false)
      expect(isFirstPartyMediaSrc('/images/hero.png')).toBe(false)
    })

    it('refuses malformed references, junk and non-strings', () => {
      expect(isFirstPartyMediaSrc('media:junk')).toBe(false)
      expect(isFirstPartyMediaSrc('')).toBe(false)
      expect(isFirstPartyMediaSrc('   ')).toBe(false)
      expect(isFirstPartyMediaSrc('javascript:alert(1)')).toBe(false)
      expect(isFirstPartyMediaSrc(undefined)).toBe(false)
      expect(isFirstPartyMediaSrc(null)).toBe(false)
      expect(isFirstPartyMediaSrc(42)).toBe(false)
    })
  })
})
