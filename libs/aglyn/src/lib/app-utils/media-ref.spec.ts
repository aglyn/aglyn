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
  formatMediaRef,
  hostQualifiedScope,
  isMediaCdnUrl,
  isMediaRef,
  mediaNodeSrc,
  mediaRefFromCdnPath,
  mediaRefPattern,
  MEDIA_CDN_ROUTE,
  parseMediaRef,
  resolveMediaSrc,
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

  describe('isMediaCdnUrl — the srcSet gate', () => {
    it('recognises a resolved reference and a legacy path alike', () => {
      expect(isMediaCdnUrl(resolveMediaSrc('media:site-a/med123'))).toBe(true)
      expect(isMediaCdnUrl('/api/media/cdn/org:acme/med123')).toBe(true)
      expect(isMediaCdnUrl(RAW_URL)).toBe(false)
      expect(isMediaCdnUrl(undefined)).toBe(false)
    })
  })
})
