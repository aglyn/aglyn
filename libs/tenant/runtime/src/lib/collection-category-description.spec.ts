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
 * A category's own description survives the hop out of Firestore.
 *
 * This loader is where two fields the console wrote have been silently
 * dropped before — `entry.authorName` (AGL-2486) and `entry.updatedAt`
 * (AGL-2534) — each because the mapper between the document and the page did
 * not carry them. Both were written, stored, read at the far end and never
 * seen, and neither left an error behind: a field that is `undefined` renders
 * as the fallback, which is exactly what a page with no override looks like.
 *
 * A category description is that same shape one collection over. It is stored
 * on the COLLECTION document inside `categories`, it is read by
 * `buildMetadata` off the routed category, and nothing between the two would
 * complain if it stopped arriving — the listing would simply go back to
 * repeating the collection's description on every filtered URL, which is the
 * state this field exists to leave.
 *
 * So the assertions are about the WIRE: what a routed category carries, given
 * what the document holds.
 */

let entryDocs: Array<Record<string, unknown>> = []
const collectionDoc: { fields: Record<string, unknown> | null } = {
  fields: null,
}

const snapshotFor = (id: string, value: Record<string, unknown>) => ({
  id,
  data: () => ({ ...value }),
  get: (key: string) => value[key],
  exists: true,
  ref: {
    update: async () => undefined,
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
          if (sub === 'authors') return { doc: (id: string) => ({ id }) }
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
  getAll: async () => [],
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'business' } }),
}))

/**
 * A pass-through cache: these cases vary the COLLECTION DOCUMENT between
 * them, and a real cache keyed on the host and slug would answer the second
 * case with the first case's taxonomy.
 */
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: { read: () => Promise<unknown> }) =>
    options.read(),
}))

import { getCollectionContent } from './get-collection-content'

const HOST = 'host-1'

const GUIDES_DESCRIPTION =
  'Step-by-step walkthroughs for getting a site live on Aglyn.'

const givenCategories = (categories: unknown) => {
  collectionDoc.fields = {
    displayName: 'Blog',
    slug: 'blog',
    kind: 'content',
    categories,
  }
}

const routedCategory = async (categorySlug: string) =>
  (
    await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      categorySlug,
    })
  ).category

beforeEach(() => {
  entryDocs = [
    {
      $id: 'entry-1',
      title: 'Publishing a page',
      slug: 'publishing-a-page',
      status: 'published',
      categoryId: 'guides',
      publishedAt: { seconds: Math.floor(Date.now() / 1000) },
    },
  ]
  givenCategories([{ id: 'guides', name: 'Guides' }])
})

describe('a described category (AGL-2689)', () => {
  it('carries its description onto the routed category', async () => {
    givenCategories([
      { id: 'guides', name: 'Guides', description: GUIDES_DESCRIPTION },
    ])

    expect(await routedCategory('guides')).toMatchObject({
      id: 'guides',
      name: 'Guides',
      known: true,
      description: GUIDES_DESCRIPTION,
    })
  })

  it('exposes it on the taxonomy the listing renders from too', async () => {
    // The pills and the entry meta read `collection.categories`, so a
    // description that only reached the routed category would be a second
    // shape of the same row.
    givenCategories([
      { id: 'guides', name: 'Guides', description: GUIDES_DESCRIPTION },
    ])

    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
    })

    expect(content.collection?.categories).toEqual([
      { id: 'guides', name: 'Guides', description: GUIDES_DESCRIPTION },
    ])
  })

  it('trims it, because a stored newline is not a description', async () => {
    givenCategories([
      {
        id: 'guides',
        name: 'Guides',
        description: `  ${GUIDES_DESCRIPTION}\n`,
      },
    ])

    expect((await routedCategory('guides'))?.description).toBe(
      GUIDES_DESCRIPTION,
    )
  })
})

describe('a category with nothing written about it', () => {
  it('carries no description at all, so the listing inherits', async () => {
    // ABSENT rather than `''`: the head picks the first truthy description in
    // its chain, and an empty string would win the chain and leave the page
    // with no description rather than the collection's.
    const category = await routedCategory('guides')

    expect(category).toMatchObject({ id: 'guides', name: 'Guides' })
    expect(category).not.toHaveProperty('description')
  })

  it('drops a blank one rather than storing it as an override', async () => {
    givenCategories([{ id: 'guides', name: 'Guides', description: '   ' }])

    expect(await routedCategory('guides')).not.toHaveProperty('description')
    expect(
      (await getCollectionContent({ hostId: HOST, collectionSlug: 'blog' }))
        .collection?.categories,
    ).toEqual([{ id: 'guides', name: 'Guides' }])
  })

  it('drops a non-string one rather than passing it through', async () => {
    // A hand-edited or imported document is the only way this arrives, and a
    // number reaching `<meta name="description">` is worse than none.
    givenCategories([{ id: 'guides', name: 'Guides', description: 42 }])

    expect(await routedCategory('guides')).not.toHaveProperty('description')
  })
})

describe('a segment naming no category', () => {
  it('has no description to carry', async () => {
    // The listing renders empty and `noindex`, so there is nothing here to
    // describe — and no row to take a description from.
    const category = await routedCategory('nonesuch')

    expect(category).toMatchObject({ known: false, name: 'nonesuch' })
    expect(category).not.toHaveProperty('description')
  })
})
