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

import { createTheme } from '@mui/material/styles'
import { unstable_styleFunctionSx as styleFunctionSx } from '@mui/system'

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

    it('drops an http: cover — mixed content, no defensible use (AGL-1725)', () => {
      // The SECOND of the two http:-accepting paths AGL-1701 found;
      // markdown-lite is AGL-1713 and this rule is separate from it.
      expect(build('http://images.example.com/photo.jpg').cfb__cover).toBe(
        undefined,
      )
      expect(build('HTTP://images.example.com/photo.jpg').cfb__cover).toBe(
        undefined,
      )
      // The https twin still renders, so this is a scheme rule and not a
      // host restriction — the site owner's own hotlink keeps working.
      expect(coverUrl(build('https://images.example.com/photo.jpg'))).toBe(
        'https://images.example.com/photo.jpg',
      )
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

describe('the entry article fallback shell is the PROSE width (AGL-1298)', () => {
  const CONTAINER_ID = 'cfb__container'

  it('an entry body renders at stock md, not the xl section default', () => {
    // The Container standard carries a third case for long-form. A collection
    // entry IS the long-form case, and this is the one place the repo — not
    // besigner authoring — decides its width.
    const nodes = build(undefined) as Record<string, any>
    expect(nodes[CONTAINER_ID].componentId).toBe('muiContainer')
    expect(nodes[CONTAINER_ID].props.maxWidth).toBe('md')
  })

  it('RED on purpose: the width is a stock breakpoint, never a pixel cap', () => {
    // The shape AGL-1298 exists to keep out. `sx.maxWidth` alongside
    // `props.maxWidth` is exactly how the 144 bespoke `1328px` caps were
    // authored, so its absence is asserted rather than assumed.
    const nodes = build(undefined) as Record<string, any>
    const props = nodes[CONTAINER_ID].props
    expect(['xs', 'sm', 'md', 'lg', 'xl']).toContain(props.maxWidth)
    expect(props.sx?.maxWidth).toBeUndefined()
    expect(String(JSON.stringify(props))).not.toContain('1328')
  })
})

/**
 * The built-in listing's vertical rhythm (AGL-2567).
 *
 * This is the page EVERY tenant gets for a collection with no `listScreenId`,
 * so it is the first impression of a listing on a new site — and unlike the
 * authored screens AGL-2547 fixed by hand in the canvas, this one is code and
 * can regress silently.
 *
 * The gaps are read through MUI's own `sx` resolver rather than asserted as
 * bare props, so what is pinned is the CSS the browser receives: a test that
 * only checked `gap === 6` would pass just as happily against a `6` that the
 * theme resolved to nothing.
 */
describe('the built-in listing has a vertical rhythm (AGL-2567)', () => {
  const CONTAINER_ID = 'cfb__container'
  const PAGER_ID = 'cfb__pager'
  const ENTRIES_ID = 'cfb__entries'
  const EMPTY_ID = 'cfb__empty'

  const theme = createTheme()

  /** The CSS an `sx` object actually produces, resolved against the theme. */
  const css = (sx: unknown): Record<string, unknown> =>
    styleFunctionSx({ theme, sx } as any) as Record<string, unknown>

  const list = (
    options: {
      entries?: number
      pagination?: { page: number; perPage: number; totalPages: number }
    } = {},
  ): Record<string, any> =>
    buildCollectionFallbackNodes({
      collection,
      entries: Array.from({ length: options.entries ?? 3 }, (_unused, i) => ({
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
      entry: null,
      pagination: options.pagination ?? null,
    }) as Record<string, any>

  const paged = { page: 1, perPage: 10, totalPages: 3 }

  it('spaces the sections 48px apart, measured through the theme', () => {
    // One `row-gap` on the flex container is the whole rhythm: every
    // section is separated by this single declaration, so no section can
    // space itself differently from its neighbors.
    const stack = list({ pagination: paged })[STACK_ID]
    expect(css(stack.props.sx)).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      gap: '48px',
    })
  })

  it('leaves 48px under the pager, which is what the footer meets', () => {
    // The reported symptom: the pagination row sitting on the dark footer.
    const pager = list({ pagination: paged })[PAGER_ID]
    expect(pager).toBeDefined()
    expect(css(pager.props.sx).paddingBottom).toBe('48px')
  })

  it('does NOT let the pager offset itself on top of the gap', () => {
    // The stack's gap is the one owner of the space between sections. A
    // pager that also offset itself would sit further from the entries than
    // every other pair of sections, a section at a time.
    const pager = list({ pagination: paged })[PAGER_ID]
    expect(pager.props.sx.paddingTop).toBeUndefined()
    expect(css(pager.props.sx).paddingTop).toBeUndefined()
  })

  it('pads the entries block instead when the listing has no pager', () => {
    // A single-page listing ends on the entries, so that is the section the
    // footer meets — naming the pager alone would leave this case flush.
    const nodes = list()
    expect(nodes[PAGER_ID]).toBeUndefined()
    expect(css(nodes[ENTRIES_ID].props.sx).paddingBottom).toBe('48px')
  })

  it('pads the empty-state line on a listing with nothing published', () => {
    const nodes = list({ entries: 0 })
    expect(nodes[EMPTY_ID]).toBeDefined()
    expect(css(nodes[EMPTY_ID].props.sx).paddingBottom).toBe('48px')
    // The empty state keeps the color it already had; the padding merges into
    // the existing `sx` rather than replacing it.
    expect(nodes[EMPTY_ID].props.sx.color).toBe('text.secondary')
  })

  it('renders at the section width, not the entry article reading column', () => {
    // A listing is a card grid. The prose `md` the entry article takes
    // (AGL-1298) is the wrong measure for it, and the authored list screens
    // render at `xl` — a built-in listing that disagreed would look like a
    // different product from an authored one.
    expect(list({ pagination: paged })[CONTAINER_ID].props.maxWidth).toBe('xl')
  })

  it('RED on purpose: the gap is a theme token, never a typed length', () => {
    // A hand-written length answers to no theme, and one that lost its unit
    // is a valid-looking value the browser drops.
    const nodes = list({ pagination: paged })
    expect(typeof nodes[STACK_ID].props.sx.gap).toBe('number')
    expect(typeof nodes[PAGER_ID].props.sx.paddingBottom).toBe('number')
    expect(JSON.stringify(nodes)).not.toMatch(/\d+(px|rem|em|vw|vh|lvw)/)
  })

  it('leaves the entry article rhythm alone', () => {
    // The two pages share one shell builder, so a listing change is one edit
    // away from silently rewriting the article body.
    const article = buildCollectionEntryFallbackNodes(collection, {
      title: 'Hello world',
      body: '# Hi',
    }) as Record<string, any>
    expect(article[STACK_ID].props.spacing).toBe(2)
    expect(article[STACK_ID].props.sx).toBeUndefined()
    expect(article[CONTAINER_ID].props.maxWidth).toBe('md')
  })
})
