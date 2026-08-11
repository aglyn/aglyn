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

/**
 * The built-in entry article's cover block (AGL-1407).
 *
 * The failure being pinned is a SILENT DROP: the old gate was
 * `/^https?:\/\//i`, so a `media:` reference — and the AGL-175 relative CDN
 * path before it — failed the test and no cover node was emitted at all. No
 * error, no placeholder, no broken-image box; just a post that quietly lost
 * its picture. A test asserting "nothing threw" would pass against that bug,
 * so every case below asserts the node is **present, parented, and carrying
 * the URL** — or, for the negative cases, that it is absent.
 */

import {
  buildCollectionEntryFallbackNodes,
  buildCollectionFallbackNodes,
} from './collection-fallback-nodes'

const COVER_ID = 'cfb__cover'
const STACK_ID = 'cfb__stack'

const collection = { slug: 'blog', displayName: 'Blog' }

/** The cover's background URL, or undefined when no cover node was emitted. */
const coverUrl = (nodes: Record<string, any>): string | undefined => {
  const node = nodes[COVER_ID]
  if (!node) return undefined
  // Parented AND slotted: a node in the map that no parent lists renders
  // nowhere, which would be the same invisible failure wearing a disguise.
  expect(node.parentId).toBe(STACK_ID)
  expect(nodes[STACK_ID].nodes).toContain(COVER_ID)
  const background = String(node.props?.sx?.backgroundImage ?? '')
  const match = /^url\("(.*)"\)$/.exec(background)
  return match ? match[1] : undefined
}

const build = (coverImage: string | undefined, hostId?: string) =>
  buildCollectionEntryFallbackNodes(
    collection,
    { title: 'Hello world', body: '# Hi', coverImage },
    hostId,
  )

describe('collection entry fallback cover (AGL-1407)', () => {
  it('RENDERS a media reference as the CDN path for the composing site', () => {
    // Fails before the fix by emitting NO cover node whatsoever.
    const nodes = build('media:org:jWmGooWE3L/4GF1hRJBUp', 'DXnRbPH4CQ')
    expect(nodes[COVER_ID]).toBeDefined()
    expect(coverUrl(nodes)).toBe(
      '/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/4GF1hRJBUp',
    )
  })

  it('host-qualifies an org reference, so a site-restricted asset serves', () => {
    // The scope segment names the site actually rendering (AGL-1043) —
    // `org:{orgId}` alone serves ORG-WIDE assets only.
    const baked = build('media:org:jWmGooWE3L:OTHERHOST/4GF1hRJBUp', 'DXnRbPH4CQ')
    expect(coverUrl(baked)).toBe(
      '/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/4GF1hRJBUp',
    )
  })

  it('resolves a host-library reference with no org scope', () => {
    expect(coverUrl(build('media:DXnRbPH4CQ/4GF1hRJBUp'))).toBe(
      '/api/media/cdn/DXnRbPH4CQ/4GF1hRJBUp',
    )
  })

  it('threads the host through the top-level entry/list selector', () => {
    // The route composes through `buildCollectionFallbackNodes`, so the
    // qualification has to survive that hop or only the direct caller is fixed.
    const nodes = buildCollectionFallbackNodes({
      collection,
      entries: [],
      entry: { title: 'Hello', coverImage: 'media:org:jWmGooWE3L/4GF1hRJBUp' },
      hostId: 'DXnRbPH4CQ',
    })
    expect(coverUrl(nodes)).toBe(
      '/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/4GF1hRJBUp',
    )
  })

  describe('the legacy stored forms all still render', () => {
    it('a raw firebasestorage download URL', () => {
      const raw =
        'https://firebasestorage.googleapis.com/v0/b/aglyn-main.appspot.com/' +
        'o/orgs%2FjWmGooWE3L%2Fmedia%2Fbrand%2Fcover?alt=media'
      expect(coverUrl(build(raw, 'DXnRbPH4CQ'))).toBe(raw)
    })

    it('the AGL-175 relative CDN path written by the first pass', () => {
      // Also a silent drop before the fix — `/api/media/cdn/…` is not
      // `https?://` either, so this generation was never rendering.
      expect(coverUrl(build('/api/media/cdn/org:jWmGooWE3L/4GF1hRJBUp'))).toBe(
        '/api/media/cdn/org:jWmGooWE3L/4GF1hRJBUp',
      )
    })

    it("an external URL the author typed themselves (a hotlinked image)", () => {
      // Breaking someone's own hotlinked image while fixing references would
      // be a bad trade — passthrough is the documented precedence rule.
      expect(coverUrl(build('https://images.example.com/photo.jpg?v=2'))).toBe(
        'https://images.example.com/photo.jpg?v=2',
      )
    })
  })

  describe('values that must NOT reach the stylesheet', () => {
    it('drops a malformed media reference rather than emitting it raw', () => {
      // `url("media:junk")` is a console error nobody reads.
      expect(build('media:not a ref').cfb__cover).toBeUndefined()
    })

    it('drops a non-http scheme', () => {
      expect(build('javascript:alert(1)').cfb__cover).toBeUndefined()
      expect(build('data:image/png;base64,AAAA').cfb__cover).toBeUndefined()
    })

    it('drops an empty or absent cover, as before', () => {
      expect(build(undefined).cfb__cover).toBeUndefined()
      expect(build('').cfb__cover).toBeUndefined()
    })
  })

  it('escapes a quote so it cannot break out of the CSS url()', () => {
    // Pinned because the value is interpolated into a stylesheet rather than
    // into an `<img src>`.
    expect(coverUrl(build('https://x.test/a".png'))).toBe(
      'https://x.test/a%22.png',
    )
  })

  it('does NOT re-encode an already-encoded storage path', () => {
    // The `encodeURI` this replaced turned `%2F` into `%252F`, so every raw
    // firebasestorage cover 404'd while the block still rendered — a broken
    // image, not a missing block, and therefore invisible in a "was it
    // dropped?" test.
    expect(coverUrl(build('https://x.test/o/orgs%2Fabc%2Fmedia?alt=media'))).toBe(
      'https://x.test/o/orgs%2Fabc%2Fmedia?alt=media',
    )
  })
})
