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
 * `Article.image` must be an absolute, fetchable URL (AGL-1343).
 *
 * The sequel to AGL-1337: that issue routed `og:image` through
 * `resolveSocialImage` because a cover picked from the DAM is stored as
 * `media:{scope}/{id}` and the tenant declares no `metadataBase`, so nothing
 * made it absolute. The structured data still emitted `entry.coverImage`
 * verbatim — the same unresolvable string, one surface over, read by exactly
 * the consumers (search engines, rich-result validators) that have no page to
 * resolve a reference or a site-relative path against.
 *
 * These assert the RENDERED JSON-LD rather than the resolver (that is
 * `libs/aglyn/.../social-image.spec.ts`) — the bug was never in resolution, it
 * was that this surface called nothing.
 */

jest.mock('../app/[host]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
// The client renderer is a large browser-side graph; the JSON-LD is emitted by
// the server component beside it and nothing here mounts it.
jest.mock('../app/[host]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))

import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import CatchAllPage from '../app/[host]/[[...slug]]/page'

const mockLoad = loadPageData as jest.Mock

const CDN = 'https://custom.example/api/media/cdn/host-1'

const hostWith = (overrides: Record<string, unknown> = {}) => ({
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: {},
  seo: {},
  ...overrides,
})

/** Renders the route and returns every JSON-LD block it emitted, parsed. */
const jsonLdFor = async (options: {
  cover?: unknown
  host?: Record<string, unknown>
  /** Extra fields merged onto the entry — dates, for AGL-2497 below. */
  entry?: Record<string, unknown>
}) => {
  mockLoad.mockResolvedValue({
    props: {
      data: { host: options.host ?? hostWith() },
      nodes: null,
      content: {
        collection: { slug: 'blog', displayName: 'Blog' },
        entry: {
          $id: 'e1',
          title: 'Hello',
          slug: 'hello',
          excerpt: 'An entry',
          ...('cover' in options ? { coverImage: options.cover } : {}),
          ...options.entry,
        },
      },
    },
  })
  const tree = await CatchAllPage({
    params: Promise.resolve({ host: 'acme', slug: ['blog', 'hello'] }),
  } as never)
  // The route renders `<script dangerouslySetInnerHTML>` per block; walking the
  // element tree reads what the HTML would carry without a DOM.
  const blocks: string[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const html = node.props?.dangerouslySetInnerHTML?.__html
    if (typeof html === 'string') blocks.push(html)
    walk(node.props?.children)
  }
  walk(tree)
  return blocks.map((block) => ({ raw: block, value: JSON.parse(block) }))
}

const articleFrom = async (options: {
  cover?: unknown
  host?: Record<string, unknown>
  entry?: Record<string, unknown>
}) => {
  const blocks = await jsonLdFor(options)
  const article = blocks.find((block) => block.value['@type'] === 'Article')
  expect(article).toBeDefined()
  return article as { raw: string; value: any }
}

beforeEach(() => jest.clearAllMocks())

describe('Article structured data resolves its cover (AGL-1343)', () => {
  it('resolves a DAM reference to the absolute CDN URL', async () => {
    const article = await articleFrom({ cover: 'media:host-1/cover' })

    expect(article.value.image).toEqual([`${CDN}/cover`])
    // The exact shape of the bug: the stored value reached the JSON-LD as the
    // literal `media:…`, which no crawler can fetch.
    expect(article.raw).not.toContain('media:')
  })

  it('qualifies an org-scoped reference to the site doing the rendering', async () => {
    // The picker bakes its best guess into the scope; the rendering host is
    // the better answer, and a restricted asset only serves for that site.
    const article = await articleFrom({ cover: 'media:org:org-1/cover' })

    expect(article.value.image).toEqual([
      'https://custom.example/api/media/cdn/org:org-1:host-1/cover',
    ])
  })

  it('makes a site-relative path absolute', async () => {
    const article = await articleFrom({ cover: '/api/media/cdn/host-1/cover' })

    expect(article.value.image).toEqual([`${CDN}/cover`])
  })

  it('passes an already-absolute URL through unchanged', async () => {
    // An author-typed external URL (a hotlinked image) is a supported case and
    // must not be re-based onto the site origin.
    const article = await articleFrom({
      cover: 'https://cdn.example.com/cover.png',
    })

    expect(article.value.image).toEqual(['https://cdn.example.com/cover.png'])
  })

  it('omits the field entirely when the entry has no cover', async () => {
    const article = await articleFrom({})

    expect(article.value.image).toBeUndefined()
    // `strictNullChecks` is off repo-wide, so nothing but this guard stops
    // `"image": ["undefined"]` or an empty string reaching a validator.
    expect(article.raw).not.toContain('image')
    // The rest of the node is unaffected — this is an omission, not a bail-out.
    expect(article.value.headline).toBe('Hello')
  })

  it('treats a CLEARED cover as no cover rather than an empty image', async () => {
    // "Clear" writes `''` rather than dropping the key, so an empty string is
    // the value most likely to reach here (AGL-1191).
    const article = await articleFrom({ cover: '' })

    expect(article.value.image).toBeUndefined()
  })

  it('emits nothing for a reference that does not parse', async () => {
    const article = await articleFrom({ cover: 'media:junk' })

    expect(article.value.image).toBeUndefined()
    expect(article.raw).not.toContain('media:')
  })

  it('omits the image rather than emitting a relative one when the host names no origin', async () => {
    // Same rule as the canonical and the feed: never emit a URL that is
    // well-formed but wrong.
    const article = await articleFrom({
      cover: 'media:host-1/cover',
      host: hostWith({ cname: null, subdomain: null }),
    })

    expect(article.value.image).toBeUndefined()
  })
})

/**
 * `Article.datePublished` carries the author-chosen publish date (AGL-2497).
 *
 * The console can now set an entry's `publishedAt`, including to a PAST
 * instant, so an archive imported from another site can be dated truthfully
 * instead of claiming every post went out on migration day.
 *
 * This surface was never broken and is deliberately unchanged — which is
 * exactly why it needs asserting HERE. The whole feature is worth nothing if
 * the value the console writes does not come out the other end, and the
 * console suite can only prove what it put into Firestore. These render the
 * route and read the emitted structured data, so the two halves meet: what
 * `apps/console/specs/content-entry-publish-date.spec.tsx` proves is WRITTEN
 * to `publishedAt` is what these prove is PUBLISHED as `datePublished`.
 *
 * A `Timestamp` reaches this code as `{ seconds }` — the shape the loader
 * hands over — so that is what is fed in.
 */
describe('Article.datePublished reflects the stored publish date (AGL-2497)', () => {
  /** 2019-05-01T14:30:00Z — comfortably before any migration date. */
  const BACKDATED_SECONDS = 1_556_721_000
  const MIGRATED_SECONDS = 1_756_000_000

  it('emits a BACKDATED instant, not the day the entry was imported', async () => {
    const migrated = await articleFrom({
      entry: { publishedAt: { seconds: MIGRATED_SECONDS } },
    })
    const backdated = await articleFrom({
      entry: { publishedAt: { seconds: BACKDATED_SECONDS } },
    })

    // Before: every imported post claimed the migration date. After: the date
    // the author set. The two must not be the same string, or the control
    // that writes it is not reaching this surface at all.
    expect(migrated.value.datePublished).toBe('2025-08-24T01:46:40.000Z')
    expect(backdated.value.datePublished).toBe('2019-05-01T14:30:00.000Z')
    expect(backdated.value.datePublished).not.toBe(
      migrated.value.datePublished,
    )
  })

  it('OMITS the field for an entry that was never published', async () => {
    const article = await articleFrom({ entry: {} })

    // Absent, never `1970-01-01`. `strictNullChecks` is off repo-wide, so an
    // arithmetic fallback on a missing date compiles clean and publishes the
    // epoch — a date Google would read as real.
    expect(article.value.datePublished).toBeUndefined()
    expect(article.raw).not.toContain('1970')
    // An omission, not a bail-out: the rest of the node still renders.
    expect(article.value.headline).toBe('Hello')
  })

  it('keeps dateModified tracking updatedAt, independent of the publish date', async () => {
    // The regression control for the backdating feature. `dateModified` is
    // what Google reads for freshness and it must go on meaning "last
    // edited" — re-dating a post is not editing it, so the console's write
    // names `publishedAt` alone and this stays put.
    const article = await articleFrom({
      entry: {
        publishedAt: { seconds: BACKDATED_SECONDS },
        updatedAt: { seconds: MIGRATED_SECONDS },
      },
    })

    expect(article.value.datePublished).toBe('2019-05-01T14:30:00.000Z')
    expect(article.value.dateModified).toBe('2025-08-24T01:46:40.000Z')
  })

  /**
   * The one-letter guard, at the far end of the pipe.
   *
   * `publishedAt` (when it WENT live) and `publishAt` (when it is DUE to)
   * differ by one letter and now sit beside each other in the console. If
   * they were ever conflated, the visible symptom would be here: a scheduled
   * post announcing a publication date it has not reached.
   */
  it('never reads the SCHEDULER field as the publication date', async () => {
    const article = await articleFrom({
      entry: { publishAt: { seconds: MIGRATED_SECONDS }, status: 'scheduled' },
    })

    expect(article.value.datePublished).toBeUndefined()
  })
})
