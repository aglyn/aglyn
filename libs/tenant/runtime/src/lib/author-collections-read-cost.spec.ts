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
 * What an AUTHOR page costs in Firestore reads (AGL-3213).
 *
 * `collection-read-cost.spec.ts`'s argument, one surface over, and the reason
 * it needs its own suite: an author archive is not one address either. A
 * person with a hundred posts has `/author/{slug}` plus nine `/page/{n}`, each
 * its own ISR entry on its own window, and every one of them walks the host's
 * collections to find out which ones hold content.
 *
 * Two of the three reads on that path had been shared since AGL-2518 — the
 * roster, and each collection's entries through `getPublishedCollectionSource`
 * — and the third, the collections scan itself, simply never was. It is
 * invisible in behaviour, which is why it survived: a loader that re-reads the
 * table returns exactly what one that reads it once returns.
 *
 * So the assertions are COUNTS, taken on the `.get()` calls that become billed
 * document reads, plus one on the FIELD MASK — the other half of what a read
 * costs, and the half no count can see.
 */

/** Every `.get()` that reached the fake Firestore, by what it addressed. */
const reads = { collections: 0, authors: 0 }
/** The field mask the collections query carried, if any. */
let collectionsMask: string[] | null = null

let collectionDocs: Array<Record<string, unknown>> = []
let authorDocs: Array<{ id: string; data: Record<string, unknown> }> = []
/** Which collection slugs the entries source was asked for. */
const requestedSources: string[] = []

const firestore = {
  collection: (name: string) => {
    if (name !== 'hosts') throw new Error(`unexpected root ${name}`)
    return {
      doc: () => ({
        collection: (sub: string) => {
          if (sub === 'authors') {
            const query = {
              limit: () => query,
              get: async () => {
                reads.authors += authorDocs.length
                return {
                  docs: authorDocs.map((doc) => ({
                    id: doc.id,
                    data: () => ({ ...doc.data }),
                  })),
                }
              },
            }
            return query
          }
          if (sub !== 'collections') {
            throw new Error(`unexpected subcollection ${sub}`)
          }
          const query = {
            // Recorded rather than ignored: what the mask CONTAINS is as much
            // a fact about this read as how often it happens, and it is the
            // one a count can never reach.
            select: (...fields: string[]) => {
              collectionsMask = fields
              return query
            },
            limit: () => query,
            get: async () => {
              reads.collections += collectionDocs.length
              return {
                docs: collectionDocs.map((value) => ({
                  data: () => ({ ...value }),
                  get: (key: string) => value[key],
                })),
              }
            },
          }
          return query
        },
      }),
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
}))

/**
 * A REAL cache, for `collection-read-cost.spec.ts`'s reason: the claim under
 * test is that a second address costs nothing, and a pass-through stub would
 * make a loader that shares nothing pass.
 */
const cacheStore = new Map<string, unknown>()

jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: {
    key: readonly string[]
    read: () => Promise<unknown>
    store?: (value: unknown) => boolean
  }) => {
    const key = options.key.join('|')
    if (cacheStore.has(key)) return cacheStore.get(key)
    const value = await options.read()
    if (!options.store || options.store(value)) cacheStore.set(key, value)
    return value
  },
}))

/**
 * The per-collection entries source is mocked, not driven. Its own cost is
 * `collection-read-cost.spec.ts`'s subject; here it only has to record that it
 * was asked, so the collections scan's count is not confounded with it.
 */
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(
    async (options: { collectionSlug: string }) => {
      requestedSources.push(options.collectionSlug)
      return { collection: null, entries: [], categories: [], reachedBound: false }
    },
  ),
}))

import { getAuthorContent } from './get-author-content'

const HOST = 'host-1'

beforeEach(() => {
  reads.collections = 0
  reads.authors = 0
  collectionsMask = null
  cacheStore.clear()
  requestedSources.length = 0
  authorDocs = [{ id: 'a1', data: { name: 'Ada Lovelace', slug: 'ada' } }]
  collectionDocs = [
    { slug: 'blog', displayName: 'Blog', kind: 'content' },
    { slug: 'changelog', displayName: 'Changelog', kind: 'content' },
    { slug: 'shop', displayName: 'Shop', kind: 'catalog' },
  ]
})

describe('every page of an author archive shares ONE collections read', () => {
  it('reads the table once across page 1 and the pages after it', async () => {
    for (const page of [1, 2, 3, 7]) {
      await getAuthorContent({
        hostId: HOST,
        authorSlug: 'ada',
        page,
        perPage: 10,
      })
    }

    // Three documents, scanned once — not once per address. Before this the
    // count was 12, and on a site with twenty collections and ten authors it
    // was the largest uncached read on any public page.
    expect(reads.collections).toBe(3)
    expect(reads.authors).toBe(1)
  })

  it('reads it once across DIFFERENT authors too', async () => {
    authorDocs = [
      { id: 'a1', data: { name: 'Ada Lovelace', slug: 'ada' } },
      { id: 'a2', data: { name: 'Grace Hopper', slug: 'grace' } },
    ]

    await getAuthorContent({ hostId: HOST, authorSlug: 'ada' })
    await getAuthorContent({ hostId: HOST, authorSlug: 'grace' })

    // The table is a fact about the HOST, so the key must not carry the
    // author — a per-author key would share nothing between two people and
    // look identical in every behavioural assertion.
    expect(reads.collections).toBe(3)
  })

  it('does not cache a scan that came back empty', async () => {
    collectionDocs = []
    await getAuthorContent({ hostId: HOST, authorSlug: 'ada' })
    collectionDocs = [{ slug: 'blog', displayName: 'Blog', kind: 'content' }]
    const second = await getAuthorContent({ hostId: HOST, authorSlug: 'ada' })

    // A miss held for the TTL would make every author page on the site an
    // empty archive for an hour — the negative-cache failure `withRenderCache`
    // refuses by default and this read opts back into refusing.
    expect(requestedSources).toEqual(['blog'])
    expect(second.known).toBe(true)
  })
})

describe('the collections scan asks for the fields it reads', () => {
  it('carries a field mask rather than whole documents', async () => {
    await getAuthorContent({ hostId: HOST, authorSlug: 'ada' })

    expect(collectionsMask).not.toBeNull()
    // `kind` decides whether a collection is commerce's; `slug` is the address
    // the entries source is fetched by; the three name candidates are the
    // display-name fallback chain, and a mask missing one would silently
    // rename every collection storing its name under an older key.
    expect(collectionsMask).toEqual(
      expect.arrayContaining(['slug', 'kind', 'displayName', 'name', 'title']),
    )
  })

  it('leaves the taxonomy out of it, which the entries source already holds', async () => {
    await getAuthorContent({ hostId: HOST, authorSlug: 'ada' })

    // `categories` is read on this path — out of
    // `getPublishedCollectionSource`, cached beside the entries it describes.
    // Pulling it here too fetched up to fifty labelled, described rows per
    // collection for a second copy nothing looked at.
    expect(collectionsMask).not.toContain('categories')
  })

  it('still tells a catalog collection from a content one through the mask', async () => {
    await getAuthorContent({ hostId: HOST, authorSlug: 'ada' })

    // The negative control on the mask: `shop` is a catalog and owns no
    // entries, and a mask that dropped `kind` would make it look like content
    // and add a wasted source read per author page.
    expect(requestedSources).toEqual(['blog', 'changelog'])
  })
})
