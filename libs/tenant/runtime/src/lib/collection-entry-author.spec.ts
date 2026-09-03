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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { HostEntityType } from '@aglyn/aglyn/server'

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
  updatedAt: { seconds: 1_800_000_000 },
  // Every remaining declared field, so the coverage sweep at the bottom of
  // this file has something to find for each one. A fixture that omits a
  // field cannot tell you the loader drops it.
  excerpt: 'An entry',
  body: '# Heading',
  coverImage: 'media:host-1/cover',
  coverImageAlt: 'A cover',
  seoTitle: 'SEO title',
  seoDescription: 'SEO description',
  categoryId: 'guides',
  category: 'Guides',
  tags: ['nextjs'],
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
 * The loader has to MAP a field for anything downstream to read it
 * (AGL-2534).
 *
 * This is the third field to be declared, written by the console, read by the
 * renderer, asserted by a spec — and never mapped. `authorName` was the first
 * (AGL-686, the subject of this file). `dateModified` was the second: the
 * console has written `updatedAt` on every save, `page.tsx` publishes
 * `Article.dateModified` from `entry.updatedAt.seconds`, and no published
 * article has ever carried one, because `mapEntryFields` dropped it.
 *
 * `article-json-ld.spec.ts` asserts the conversion and passed throughout — it
 * builds its entry object by hand, so it never crosses this boundary. That is
 * the whole lesson: a spec that constructs the input cannot tell you the
 * producer supplies it. These cases go through the LOADER.
 */
describe('the loader maps the dates the head publishes (AGL-2534)', () => {
  it('carries updatedAt to the routed entry, for dateModified', async () => {
    entryDocs = [publishedEntry({ authorName: 'Ada' })]

    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'shipping-the-export',
    })

    expect(content.entry?.updatedAt).toEqual({ seconds: 1_800_000_000 })
  })

  it('carries it on LIST entries too, not only the routed one', async () => {
    // Two read paths spread `mapEntryFields`, and a field mapped for one and
    // not the other is how `authorName` half-worked for months.
    entryDocs = [publishedEntry({ $id: 'a', authorName: 'Ada' })]

    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
    })

    expect(content.entries[0]?.updatedAt).toEqual({ seconds: 1_800_000_000 })
  })

  it('keeps it INDEPENDENT of publishedAt, so backdating is not editing', async () => {
    // The property the console's write depends on: re-dating a post touches
    // `publishedAt` alone, and `dateModified` must not follow it.
    entryDocs = [publishedEntry({ authorName: 'Ada' })]

    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'shipping-the-export',
    })

    expect(content.entry?.publishedAt).toEqual({ seconds: 1_700_000_000 })
    expect(content.entry?.updatedAt).toEqual({ seconds: 1_800_000_000 })
  })

  it('is null, never the epoch, for an entry that has never been edited', async () => {
    // `strictNullChecks` is off repo-wide, so an arithmetic fallback on a
    // missing date compiles clean and publishes 1970 — a date Google reads as
    // real. Absent has to stay absent.
    entryDocs = [publishedEntry({ authorName: 'Ada', updatedAt: undefined })]

    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'shipping-the-export',
    })

    expect(content.entry?.updatedAt).toBeNull()
  })
})

/**
 * Every field the interface DECLARES must survive the loader (AGL-2535).
 *
 * Three fields have now been declared here, written by the console, stored by
 * the rules, read by a renderer — and mapped by nobody:
 *
 *  - `authorName` (AGL-686), the subject of this file: read by the JSON-LD,
 *    the Entry Meta block and the RSS feed, `undefined` on every entry the
 *    loader ever returned;
 *  - `coverImageAlt` (AGL-2417), which only travelled with its cover after
 *    the same class of omission was noticed;
 *  - `updatedAt` (AGL-2535): `page.tsx` publishes `Article.dateModified` from
 *    it and a spec asserts the conversion, so no Aglyn site had ever published
 *    a `dateModified`.
 *
 * Every one was found by a person reading a live page, never by a test, and
 * every one was fixed on its own. A fourth is inevitable without this, because
 * an omission in the mapper is invisible: each layer is correct in isolation,
 * nothing throws, and the field is simply absent end to end.
 *
 * ## It asserts the OUTPUT, not the mapper
 *
 * `publishedAt` is mapped at the two call sites rather than inside
 * `mapEntryFields` — it carries a `publishAt` fallback and the list read sorts
 * on it. A guard aimed at that function would have to exempt `publishedAt`,
 * and that exemption is the very seam `updatedAt` hid in. So this asserts what
 * actually matters: a document carrying a field yields an entry carrying it,
 * whichever function does the work.
 *
 * The field list is PARSED FROM THE INTERFACE, because a restated copy would
 * be a fourth place to forget.
 */
describe('the loader carries every declared entry field (AGL-2535)', () => {
  /** The interface's own field names, read from source. */
  const declaredFields = (): string[] => {
    const source = readFileSync(
      join(__dirname, 'get-collection-content.ts'),
      'utf8',
    )
    const block =
      /export interface CollectionEntrySummary \{([\s\S]*?)\n\}/.exec(source)
    if (!block) {
      throw new Error('CollectionEntrySummary not found — did it move?')
    }
    // Comments stripped first: several fields carry prose that mentions OTHER
    // field names, and a naive scan would invent requirements out of it.
    const withoutComments = block[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '')
    return [
      ...withoutComments.matchAll(/^\s*(\$?[A-Za-z_][A-Za-z0-9_]*)\??:/gm),
    ].map((match) => match[1])
  }

  /**
   * Fields that legitimately do NOT come from the entry document, each with
   * its reason — so widening the blind spot is a deliberate act.
   */
  const NOT_FROM_THE_ENTRY_DOC: Record<string, string> = {
    author:
      'resolved from hosts/{h}/authors by attachEntryAuthors; the entry stores authorId, which IS covered',
    collectionSlug:
      'stamped only by the cross-collection author-page reader, never by a routed read',
    collectionName:
      'stamped only by the cross-collection author-page reader, never by a routed read',
  }

  /**
   * And the one field a LIST deliberately withholds.
   *
   * `body` is mapped at the routed-entry call site alone. A listing renders
   * excerpts, and carrying every entry's full markdown would put twenty
   * article bodies into the ISR payload of a page that shows none of them —
   * so the omission is a payload decision, not an oversight.
   *
   * Scoped to the list path rather than exempted outright: the routed entry
   * still has to carry it, and an exemption that covered both would have let
   * the article body go missing exactly the way `updatedAt` did.
   *
   * The consequence is worth knowing: `{{entry.body}}` bound inside a
   * Collection entries block resolves empty. That is the existing behaviour,
   * pinned here rather than changed.
   */
  const NOT_ON_A_LIST_ENTRY: Record<string, string> = {
    body: 'a listing renders excerpts; whole bodies would bloat the ISR payload',
  }

  const missingFrom = (entry: unknown, alsoExempt: Record<string, string> = {}) =>
    declaredFields().filter(
      (field) =>
        !(field in NOT_FROM_THE_ENTRY_DOC) &&
        !(field in alsoExempt) &&
        (entry as Record<string, unknown>)?.[field] === undefined,
    )

  it('parses the interface rather than trusting a restated list', () => {
    const fields = declaredFields()
    // A floor, because a parse that silently returned nothing would make
    // every assertion below pass vacuously — the exact failure this guard
    // exists to stop, reproduced inside the guard.
    expect(fields.length).toBeGreaterThan(10)
    expect(fields).toContain('authorName')
    expect(fields).toContain('updatedAt')
  })

  it('returns every declared field on the ROUTED entry', async () => {
    entryDocs = [publishedEntry({})]

    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'shipping-the-export',
    })

    expect(missingFrom(content.entry)).toEqual([])
  })

  it('returns every declared field on a LIST entry too', async () => {
    // Two read paths spread `mapEntryFields`. A field mapped for one and not
    // the other is how `authorName` half-worked for months.
    entryDocs = [publishedEntry({})]

    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
    })

    expect(missingFrom(content.entries[0], NOT_ON_A_LIST_ENTRY)).toEqual([])
  })

  it('withholds the BODY from a list entry, and only from a list entry', async () => {
    // The distinction this guard found. Pinned in both directions, because an
    // exemption nobody checks is how a field goes missing on the path that
    // needed it.
    entryDocs = [publishedEntry({})]

    const list = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
    })
    const routed = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'shipping-the-export',
    })

    expect(list.entries[0]?.body).toBeUndefined()
    expect(routed.entry?.body).toBe('# Heading')
  })

  it('names every exemption, and none is stale', () => {
    // An exemption for a field the interface no longer declares would quietly
    // widen the blind spot as the shape changes.
    const fields = declaredFields()
    const every = { ...NOT_FROM_THE_ENTRY_DOC, ...NOT_ON_A_LIST_ENTRY }
    for (const [field, reason] of Object.entries(every)) {
      expect([field, fields.includes(field)]).toEqual([field, true])
      expect(reason.length).toBeGreaterThan(20)
    }
  })
})
