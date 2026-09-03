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
 * The loader half of AGL-2486, and the AGL-686 defect it uncovered.
 *
 * `CollectionEntrySummary.authorName` has been DECLARED since AGL-686, the
 * console has collected it since AGL-686, the rules have stored it, the
 * tenant's JSON-LD read it and the Entry Meta block printed it — and
 * `mapEntryFields` never mapped it. So `entry.authorName` was `undefined` on
 * every entry this loader has ever returned: every routed entry page and every
 * Collection entries block. Written but never read, with no error anywhere on
 * the path, which is why two later features (AGL-1385/1459) could both build
 * on the field and both ship blank.
 *
 * These cases assert the byline over entries IN THE SHAPES THE STORE HOLDS —
 * the pre-author shape, the AGL-686 string, and the AGL-2486 reference — so a
 * mapper that drops any of them is red rather than merely quiet.
 */

const authorsById: Record<string, Record<string, unknown>> = {}
let entryDocs: Array<Record<string, unknown>> = []
const collectionDoc: { fields: Record<string, unknown> | null } = {
  fields: null,
}

/** Every author doc id `getAll` was asked for — a read the fake must count. */
const requestedAuthorIds: string[] = []

const snapshotFor = (id: string, value: Record<string, unknown>) => ({
  id,
  data: () => ({ ...value }),
  get: (key: string) => value[key],
  exists: true,
  ref: {
    update: jest.fn(async () => undefined),
    collection: (name: string) => entriesCollection(name),
  },
})

const entriesCollection = (name: string) => {
  if (name !== 'entries') throw new Error(`unexpected subcollection ${name}`)
  const query = {
    where: () => query,
    limit: () => query,
    get: async () => ({
      docs: entryDocs.map((value) =>
        snapshotFor(String(value['$id'] ?? 'entry'), value),
      ),
    }),
  }
  return query
}

const firestore = {
  collection: (name: string) => {
    if (name !== 'hosts') throw new Error(`unexpected root ${name}`)
    return {
      doc: () => ({
        collection: (sub: string) => {
          if (sub === 'authors') {
            return {
              // `getAll` takes REFERENCES, so the fake has to hand back
              // something that carries the id it was minted for — modelling
              // `doc()` as an opaque marker would let a wrong-id read pass.
              doc: (id: string) => ({ __authorId: id }),
            }
          }
          if (sub !== 'collections') {
            throw new Error(`unexpected subcollection ${sub}`)
          }
          const query = {
            where: () => query,
            limit: () => query,
            get: async () => ({
              docs:
                collectionDoc.fields === null
                  ? []
                  : [snapshotFor('collection-1', collectionDoc.fields)],
            }),
          }
          return query
        },
      }),
    }
  },
  getAll: async (...refs: Array<{ __authorId: string }>) => {
    for (const ref of refs) requestedAuthorIds.push(ref.__authorId)
    return refs.map((ref) => {
      const value = authorsById[ref.__authorId]
      return {
        id: ref.__authorId,
        exists: Boolean(value),
        data: () => (value ? { ...value } : undefined),
      }
    })
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
}))

// The render cache is not under test; run reads straight through so a stored
// value can never make an assertion pass by accident.
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: { read: () => unknown }) => options.read(),
}))

import { HostEntityType } from '@aglyn/aglyn/server'

import { collectionTokens } from './compose-collection-page'
import getCollectionContent from './get-collection-content'

const HOST = 'host-1'

beforeEach(() => {
  for (const key of Object.keys(authorsById)) delete authorsById[key]
  requestedAuthorIds.length = 0
  entryDocs = []
  collectionDoc.fields = {
    displayName: 'Blog',
    slug: 'blog',
    kind: 'content',
    categories: [],
  }
})

const publishedEntry = (extra: Record<string, unknown>) => ({
  $id: 'entry-1',
  title: 'Shipping the export',
  slug: 'shipping-the-export',
  status: 'published',
  publishedAt: { seconds: 1_700_000_000 },
  ...extra,
})

describe('the byline reaches the loader at all (AGL-686 / AGL-2486)', () => {
  it('carries a legacy free-typed authorName through to the entry', async () => {
    entryDocs = [publishedEntry({ authorName: 'The Aglyn Team' })]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'shipping-the-export',
    })
    // The one assertion that was false for the whole life of the field.
    expect(content.entry?.authorName).toBe('The Aglyn Team')
    // Promoted to a bare Person — byte for byte the structured data this
    // entry shape already published.
    expect(content.entry?.author).toEqual({
      type: HostEntityType.PERSON,
      name: 'The Aglyn Team',
      sameAs: [],
    })
  })

  it('carries it on LIST entries too, not only the routed one', async () => {
    entryDocs = [publishedEntry({ authorName: 'Ada' })]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
    })
    expect(content.entries[0]?.authorName).toBe('Ada')
  })

  it('leaves an entry with no byline resolving to the SITE, not to a name', async () => {
    entryDocs = [publishedEntry({})]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'shipping-the-export',
    })
    expect(content.entry?.authorName).toBe('')
    // Null is what makes the page fall through to `host.seo.entity`. An empty
    // author object here would publish a nameless `Person` instead.
    expect(content.entry?.author).toBeNull()
  })
})

describe('custom author records (AGL-2486)', () => {
  it('resolves the reference into the full record and denormalizes the name', async () => {
    authorsById['author-1'] = {
      type: HostEntityType.ORGANIZATION,
      name: 'The Aglyn Team',
      url: 'https://example.com/team',
      image: 'media:host-1/media-1',
    }
    entryDocs = [
      publishedEntry({ authorId: 'author-1', authorName: 'Stale Name' }),
    ]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'shipping-the-export',
    })
    expect(requestedAuthorIds).toEqual(['author-1'])
    expect(content.entry?.author?.name).toBe('The Aglyn Team')
    expect(content.entry?.author?.url).toBe('https://example.com/team')
    // The record wins over the name stored beside it: picking an author is
    // the more recent statement of who wrote the piece.
    expect(content.entry?.authorName).toBe('The Aglyn Team')
  })

  it('costs ZERO reads when no entry names an author record', async () => {
    entryDocs = [
      publishedEntry({ $id: 'a', authorName: 'Ada' }),
      publishedEntry({ $id: 'b' }),
    ]
    await getCollectionContent({ hostId: HOST, collectionSlug: 'blog' })
    // The guard is on the ids already in hand, not a probe of the collection
    // — so every site that has not adopted authors pays nothing for them.
    expect(requestedAuthorIds).toEqual([])
  })

  it('reads each DISTINCT author once across a page of entries', async () => {
    authorsById['author-1'] = { name: 'Ada' }
    entryDocs = [
      publishedEntry({ $id: 'a', authorId: 'author-1' }),
      publishedEntry({ $id: 'b', authorId: 'author-1' }),
      publishedEntry({ $id: 'c', authorId: 'author-1' }),
    ]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
    })
    expect(requestedAuthorIds).toEqual(['author-1'])
    expect(content.entries.map((entry) => entry.authorName)).toEqual([
      'Ada',
      'Ada',
      'Ada',
    ])
  })

  it('falls through a DELETED author to the name stored on the entry', async () => {
    entryDocs = [
      publishedEntry({ authorId: 'gone', authorName: 'The Aglyn Team' }),
    ]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'shipping-the-export',
    })
    // Removing an author from the masthead must not strip the byline off
    // years of posts.
    expect(content.entry?.author?.name).toBe('The Aglyn Team')
    expect(content.entry?.authorName).toBe('The Aglyn Team')
  })

  it('renders the page when the authors read throws', async () => {
    authorsById['author-1'] = { name: 'Ada' }
    entryDocs = [publishedEntry({ authorId: 'author-1', authorName: 'Ada' })]
    const getAll = firestore.getAll
    ;(firestore as { getAll: unknown }).getAll = async () => {
      throw new Error('permission denied')
    }
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const content = await getCollectionContent({
        hostId: HOST,
        collectionSlug: 'blog',
        entrySlug: 'shipping-the-export',
      })
      // Fail-open, like every other read in this file: the entry keeps its
      // legacy byline rather than the page 500ing over a portrait.
      expect(content.entry?.title).toBe('Shipping the export')
      expect(content.entry?.authorName).toBe('Ada')
    } finally {
      error.mockRestore()
      ;(firestore as { getAll: unknown }).getAll = getAll
    }
  })
})

/**
 * The author archive narrows the listing (AGL-2517).
 *
 * The rule the category route already holds: filter BEFORE counting pages, or
 * the archive advertises pages that render empty and hides entries that
 * exist.
 */
describe('the author archive (AGL-2517)', () => {
  const byAda = () =>
    publishedEntry({ $id: 'e-ada', slug: 'ada-post', authorName: 'Ada' })
  const byZach = () => ({
    ...publishedEntry({}),
    $id: 'e-zach',
    slug: 'zach-post',
    authorName: 'Zach Gover',
  })

  it('keeps only the entries that author wrote', async () => {
    entryDocs = [byAda(), byZach()]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      authorSlug: 'ada',
    })
    expect(content.entries.map((entry) => entry.slug)).toEqual(['ada-post'])
  })

  it('counts pages over the ARCHIVE, not the collection', async () => {
    // Two entries, one author, one per page: the archive is ONE page. Counting
    // first would advertise two and serve an empty second.
    entryDocs = [byAda(), byZach()]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      authorSlug: 'ada',
      page: 1,
      perPage: 1,
    })
    expect(content.pagination?.totalEntries).toBe(1)
    expect(content.pagination?.totalPages).toBe(1)
  })

  it('names the author from a post they actually wrote', async () => {
    entryDocs = [byAda(), byZach()]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      authorSlug: 'zach-gover',
    })
    expect(content.author?.name).toBe('Zach Gover')
    expect(content.author?.known).toBe(true)
    expect(content.author?.slug).toBe('zach-gover')
  })

  it('carries the resolved RECORD when the entry references one', async () => {
    authorsById['author-1'] = {
      type: HostEntityType.PERSON,
      name: 'Zach Gover',
      bio: 'Building the open web platform.',
      links: [{ platform: 'x', url: 'https://x.com/aglyn' }],
    }
    entryDocs = [{ ...publishedEntry({}), authorId: 'author-1' }]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      authorSlug: 'author-1',
    })
    // The heading, the bio and the links all come from here — and from a read
    // the page was already paying for, not a second one.
    expect(content.author?.record?.bio).toBe('Building the open web platform.')
    expect(content.author?.record?.links).toEqual([
      { platform: 'x', url: 'https://x.com/aglyn' },
    ])
  })

  it('renders an EMPTY archive for an author nobody has published', async () => {
    entryDocs = [byAda()]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      authorSlug: 'nobody',
    })
    // Empty, never a crash — the category route's rule for an unknown segment.
    expect(content.entries).toEqual([])
    expect(content.author?.known).toBe(false)
    // The raw segment stands in for a name there is no record to supply.
    expect(content.author?.name).toBe('nobody')
  })

  it('leaves an unfiltered listing untouched', async () => {
    entryDocs = [byAda(), byZach()]
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
    })
    expect(content.entries).toHaveLength(2)
    expect(content.author).toBeUndefined()
  })
})

/**
 * One list template serves the collection, a category AND an author
 * (AGL-2517).
 *
 * A template has no runtime conditional, so the tokens have to be the thing
 * that varies: a heading bound to `{{collection.author}}` prints a name on an
 * archive and nothing anywhere else, which is how the same screen can be all
 * three pages without an author designing three.
 */
describe('author archive tokens (AGL-2517)', () => {
  const collection = { displayName: 'Blog', slug: 'blog' }

  it('names the author, and carries the record’s own fields', () => {
    const tokens = collectionTokens(collection, null, null, {
      slug: 'zach-gover',
      name: 'Zach Gover',
      known: true,
      record: {
        name: 'Zach Gover',
        bio: 'Building the open web platform.',
        image: 'media:host-1/portrait',
        url: 'https://example.com/zach',
      },
    })
    expect(tokens['collection.author']).toBe('Zach Gover')
    expect(tokens['collection.authorSlug']).toBe('zach-gover')
    expect(tokens['collection.authorBio']).toBe(
      'Building the open web platform.',
    )
    expect(tokens['collection.authorImage']).toBe('media:host-1/portrait')
    expect(tokens['collection.authorUrl']).toBe('https://example.com/zach')
  })

  it('empties every one of them off an archive', () => {
    const tokens = collectionTokens(collection)
    for (const key of [
      'collection.author',
      'collection.authorSlug',
      'collection.authorBio',
      'collection.authorImage',
      'collection.authorUrl',
    ]) {
      expect([key, tokens[key]]).toEqual([key, ''])
    }
  })

  it('names an unknown author from the segment, with no record behind it', () => {
    const tokens = collectionTokens(collection, null, null, {
      slug: 'nobody',
      name: 'nobody',
      known: false,
    })
    expect(tokens['collection.author']).toBe('nobody')
    // Nothing to print rather than a stale value from another page.
    expect(tokens['collection.authorBio']).toBe('')
  })
})
