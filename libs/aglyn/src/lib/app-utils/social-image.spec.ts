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

import { resolveSocialImage } from './social-image'

/** A site on a custom domain that also still answers on its subdomain. */
const HOST = {
  $id: 'host-1',
  cname: 'custom.example',
  subdomain: 'acme',
}

describe('social card image resolution (AGL-1337)', () => {
  describe('precedence', () => {
    it('lets the more specific source win outright', () => {
      const resolved = resolveSocialImage({
        sources: [
          { image: 'media:host-1/screen-img', imageWidth: 1200, imageHeight: 630 },
          { image: 'media:host-1/host-img', imageWidth: 800, imageHeight: 400 },
        ],
        host: HOST,
      })

      expect(resolved).toEqual({
        url: 'https://custom.example/api/media/cdn/host-1/screen-img',
        width: 1200,
        height: 630,
      })
    })

    it('falls through to the site default when the screen sets none', () => {
      const resolved = resolveSocialImage({
        sources: [
          { image: undefined },
          { image: 'media:host-1/host-img', imageWidth: 1200, imageHeight: 630 },
        ],
        host: HOST,
      })

      expect(resolved?.url).toBe(
        'https://custom.example/api/media/cdn/host-1/host-img',
      )
    })

    it('treats a CLEARED screen image as "inherit", not "no card"', () => {
      // The round trip the console depends on: "Clear" writes `''` (a value
      // that is actually sent, unlike an absent key on a merge write), and
      // that must put the site default back rather than suppressing it.
      const resolved = resolveSocialImage({
        sources: [
          { image: '', imageWidth: 0, imageHeight: 0 },
          { image: 'media:host-1/host-img', imageWidth: 1200, imageHeight: 630 },
        ],
        host: HOST,
      })

      expect(resolved).toEqual({
        url: 'https://custom.example/api/media/cdn/host-1/host-img',
        width: 1200,
        height: 630,
      })
    })

    it('resolves to nothing when neither is set', () => {
      expect(
        resolveSocialImage({ sources: [{ image: '' }, {}], host: HOST }),
      ).toBeUndefined()
      expect(
        resolveSocialImage({ sources: [null, undefined], host: HOST }),
      ).toBeUndefined()
    })

    it('never mixes one source’s image with another’s dimensions', () => {
      // A card described with the previous image's proportions is worse than
      // one described with none.
      const resolved = resolveSocialImage({
        sources: [
          { image: 'media:host-1/screen-img' },
          { image: 'media:host-1/host-img', imageWidth: 1200, imageHeight: 630 },
        ],
        host: HOST,
      })

      expect(resolved?.url).toBe(
        'https://custom.example/api/media/cdn/host-1/screen-img',
      )
      expect(resolved?.width).toBeUndefined()
      expect(resolved?.height).toBeUndefined()
    })
  })

  describe('the URL is absolute', () => {
    it('prefixes a resolved reference with the site’s own origin', () => {
      // A crawler fetches `og:image` out of band, with no page to resolve a
      // relative path against — and the tenant app declares no metadataBase.
      const resolved = resolveSocialImage({
        sources: [{ image: 'media:host-1/img' }],
        host: HOST,
      })

      expect(resolved?.url.startsWith('https://custom.example/')).toBe(true)
    })

    it('prefers the custom domain over the platform subdomain', () => {
      const resolved = resolveSocialImage({
        sources: [{ image: 'media:host-1/img' }],
        host: HOST,
      })

      expect(resolved?.url).not.toContain('aglyn.app')
    })

    it('uses the platform subdomain when there is no custom domain', () => {
      const resolved = resolveSocialImage({
        sources: [{ image: 'media:host-1/img' }],
        host: { $id: 'host-1', cname: null, subdomain: 'acme' },
      })

      expect(resolved?.url).toBe(
        'https://acme.aglyn.app/api/media/cdn/host-1/img',
      )
    })

    it('absolutises a legacy stored CDN path too', () => {
      const resolved = resolveSocialImage({
        sources: [{ image: '/api/media/cdn/host-1/img' }],
        host: HOST,
      })

      expect(resolved?.url).toBe(
        'https://custom.example/api/media/cdn/host-1/img',
      )
    })

    it('leaves an already-absolute URL alone', () => {
      // What the content and favicon pickers have always written: a raw
      // firebasestorage download URL. Back-compat, no migration.
      const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/cover.png'
      const resolved = resolveSocialImage({
        sources: [{ image: url }],
        host: HOST,
      })

      expect(resolved?.url).toBe(url)
    })

    it('emits nothing rather than a relative URL when the host has no origin', () => {
      // Same rule as the canonical and the RSS feed (AGL-1160/AGL-1272):
      // never ship a URL that is well-formed but wrong.
      const resolved = resolveSocialImage({
        sources: [{ image: 'media:host-1/img' }],
        host: { $id: 'host-1', cname: null, subdomain: null },
      })

      expect(resolved).toBeUndefined()
    })

    it('host-qualifies an org-scoped reference so a restricted asset resolves', () => {
      const resolved = resolveSocialImage({
        sources: [{ image: 'media:org:org-9/img' }],
        host: HOST,
      })

      expect(resolved?.url).toBe(
        'https://custom.example/api/media/cdn/org:org-9:host-1/img',
      )
    })

    it('emits nothing for a reference that does not parse', () => {
      // `src="media:junk"` is a console error nobody reads; a missing tag is
      // a fact a share-debugger reports.
      expect(
        resolveSocialImage({ sources: [{ image: 'media:junk' }], host: HOST }),
      ).toBeUndefined()
    })
  })

  describe('dimensions', () => {
    it('emits a pair only when both sides are positive', () => {
      const only = (source: Record<string, unknown>) =>
        resolveSocialImage({
          sources: [{ image: 'media:host-1/img', ...source }],
          host: HOST,
        })

      expect(only({ imageWidth: 1200 })?.height).toBeUndefined()
      expect(only({ imageWidth: 1200 })?.width).toBeUndefined()
      expect(only({ imageWidth: 0, imageHeight: 0 })?.width).toBeUndefined()
      expect(only({ imageWidth: -1, imageHeight: 630 })?.width).toBeUndefined()
      expect(only({ imageWidth: 1200, imageHeight: 630 })).toEqual({
        url: 'https://custom.example/api/media/cdn/host-1/img',
        width: 1200,
        height: 630,
      })
    })

    it('reports whatever the media record says, never a hardcoded 1200×630', () => {
      // The designed assets happen to all be 1200×630; a site is free to use
      // something else, and the head must describe the actual asset.
      const resolved = resolveSocialImage({
        sources: [
          { image: 'media:host-1/img', imageWidth: 1600, imageHeight: 900 },
        ],
        host: HOST,
      })

      expect(resolved).toMatchObject({ width: 1600, height: 900 })
    })
  })
})
