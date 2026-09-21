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
 * WHAT A PREVIEW GRANT MAY AND MAY NOT DO (AGL-3205).
 *
 * `previewUnpublishedEntry` is the one option in this file that reveals
 * something the public site withholds, so the cases below are written as a
 * pair of fences rather than as a feature demo:
 *
 *  - the PUBLIC half — with no grant, every assertion
 *    `collection-entry-schedule.spec.ts` makes still holds, restated here so
 *    the two halves live side by side and a change that widens one is read
 *    against the other;
 *  - the GRANT half — one entry, on its own routed page, with no write of any
 *    kind and nothing added to any list.
 *
 * The no-write cases are the load-bearing ones. `flipDueEntry` IS the entire
 * publishing mechanism for a content entry — no cron promotes one — so a
 * preview that flipped would publish the post it was asked to keep private,
 * and a preview that recorded the terminal refusal marker would destroy the
 * schedule outright. Neither failure is visible in the rendered page, which is
 * why they are asserted on the write log rather than on the output.
 */

/** Every `ref.update(...)` the loader performed, keyed by entry id. */
const flips: Record<string, Array<Record<string, unknown>>> = {}

let orgForHost: { orgId: string; org: Record<string, unknown> } | null = null
let entryDocs: Array<Record<string, unknown>> = []
const collectionDoc: { fields: Record<string, unknown> | null } = {
  fields: null,
}

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

const snapshotFor = (id: string, value: Record<string, unknown>) => ({
  id,
  data: () => ({ ...value }),
  get: (key: string) => value[key],
  exists: true,
  ref: {
    // `flipDueEntry` is fire-and-forget, so the argument it was called with is
    // the only evidence it ran at all.
    update: async (payload: Record<string, unknown>) => {
      flips[id] = [...(flips[id] ?? []), payload]
      return undefined
    },
    collection: (name: string) => entriesCollection(name),
  },
})

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
  getOrgForHost: async () => orgForHost,
}))

/**
 * Records what the shared source cache was asked to STORE.
 *
 * The cache is the other half of the safety property: a preview must never
 * reach a cached read, because that read is shared by every page of the site.
 * Passing the value through while remembering the `store` verdict is what lets
 * a case below assert that a preview neither widened the cached list nor
 * changed what the cache was willing to keep.
 */
const storeVerdicts: boolean[] = []
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: {
    read: () => Promise<unknown>
    store?: (value: unknown) => boolean
  }) => {
    const value = await options.read()
    storeVerdicts.push(options.store ? options.store(value) : true)
    return value
  },
}))

import { getCollectionContent } from './get-collection-content'

const HOST = 'host-1'
const SLUG = 'shipping-the-export'

const nowSeconds = () => Math.floor(Date.now() / 1000)
const IN_AN_HOUR = () => ({ seconds: nowSeconds() + 3600 })
const AN_HOUR_AGO = () => ({ seconds: nowSeconds() - 3600 })

beforeEach(() => {
  for (const key of Object.keys(flips)) delete flips[key]
  storeVerdicts.length = 0
  entryDocs = []
  orgForHost = { orgId: 'org-1', org: { plan: 'business' } }
  collectionDoc.fields = {
    displayName: 'Blog',
    slug: 'blog',
    kind: 'content',
    categories: [],
  }
})

const entry = (extra: Record<string, unknown>) => ({
  $id: 'entry-1',
  title: 'Shipping the export',
  slug: SLUG,
  ...extra,
})

const scheduledLater = () =>
  entry({ status: 'scheduled', publishAt: IN_AN_HOUR() })

/** The public entry page: exactly what an anonymous visitor's render asks. */
const publicPage = (slug = SLUG) =>
  getCollectionContent({ hostId: HOST, collectionSlug: 'blog', entrySlug: slug })

/** The same read, with a grant the caller has already verified. */
const previewPage = (slug = SLUG) =>
  getCollectionContent({
    hostId: HOST,
    collectionSlug: 'blog',
    entrySlug: slug,
    previewUnpublishedEntry: true,
  })

describe('with no grant, nothing about the public answer changes', () => {
  it('withholds a future-dated scheduled entry from its own page', async () => {
    entryDocs = [scheduledLater()]
    expect((await publicPage()).entry).toBeNull()
  })

  it('withholds a draft from its own page', async () => {
    entryDocs = [entry({ status: 'draft' })]
    expect((await publicPage()).entry).toBeNull()
  })

  it('still serves a published entry, and marks it as no preview', async () => {
    entryDocs = [entry({ status: 'published', publishedAt: AN_HOUR_AGO() })]
    const content = await publicPage()
    expect(content.entry?.$id).toBe('entry-1')
    expect(content.entryPreview).toBeUndefined()
  })

  it('still publishes a due schedule on a public render', async () => {
    entryDocs = [entry({ status: 'scheduled', publishAt: AN_HOUR_AGO() })]
    expect((await publicPage()).entry?.$id).toBe('entry-1')
    expect(flips['entry-1']).toEqual([
      { status: 'published', publishedAt: AN_HOUR_AGO() },
    ])
  })
})

describe('a grant reveals the one entry it names', () => {
  it('serves a future-dated scheduled entry, body and all', async () => {
    entryDocs = [{ ...scheduledLater(), body: 'the unpublished body' }]
    const content = await previewPage()
    expect(content.entry?.$id).toBe('entry-1')
    expect(content.entry?.body).toBe('the unpublished body')
  })

  it('carries the facts the preview chrome has to state', async () => {
    entryDocs = [scheduledLater()]
    const content = await previewPage()
    expect(content.entryPreview).toEqual({
      status: 'scheduled',
      publishAtSeconds: IN_AN_HOUR().seconds,
    })
  })

  it('serves a draft, and says it is a draft with nothing scheduled', async () => {
    entryDocs = [entry({ status: 'draft' })]
    const content = await previewPage()
    expect(content.entry?.$id).toBe('entry-1')
    expect(content.entryPreview).toEqual({
      status: 'draft',
      publishAtSeconds: null,
    })
  })

  it('says NOTHING is withheld when the entry is already published', async () => {
    // The absence is what the preview page reads to send the visitor to the
    // public URL instead of rendering an uncacheable second copy.
    entryDocs = [entry({ status: 'published', publishedAt: AN_HOUR_AGO() })]
    const content = await previewPage()
    expect(content.entry?.$id).toBe('entry-1')
    expect(content.entryPreview).toBeUndefined()
  })

  it('still 404s an entry slug that does not exist', async () => {
    entryDocs = []
    expect((await previewPage('no-such-post')).entry).toBeNull()
  })
})

describe('a preview render writes nothing', () => {
  it('does not flip a schedule that has come due', async () => {
    entryDocs = [entry({ status: 'scheduled', publishAt: AN_HOUR_AGO() })]
    const content = await previewPage()
    expect(content.entry?.$id).toBe('entry-1')
    // The whole hazard: the mechanism that publishes an entry is a render, and
    // a preview is a render. It must not be THIS one.
    expect(flips['entry-1']).toBeUndefined()
  })

  it('does not record the terminal refusal on a plan without scheduling', async () => {
    // Free plan, entry due: a public render would stamp
    // `scheduleStatus: 'skipped-unentitled'`, which is TERMINAL. A preview
    // that did it would burn the author's schedule for good.
    orgForHost = { orgId: 'org-1', org: { plan: 'free' } }
    entryDocs = [entry({ status: 'scheduled', publishAt: AN_HOUR_AGO() })]
    await previewPage()
    expect(flips['entry-1']).toBeUndefined()
  })

  it('leaves the refusal to the public render, which still records it', async () => {
    // The companion of the case above, and the reason it is safe: skipping the
    // write costs nothing because the public path still does it.
    orgForHost = { orgId: 'org-1', org: { plan: 'free' } }
    entryDocs = [entry({ status: 'scheduled', publishAt: AN_HOUR_AGO() })]
    await publicPage()
    expect(flips['entry-1']).toEqual([
      { scheduleStatus: 'skipped-unentitled' },
    ])
  })

  it('does not flip a schedule already refused', async () => {
    entryDocs = [
      entry({
        status: 'scheduled',
        publishAt: AN_HOUR_AGO(),
        scheduleStatus: 'skipped-unentitled',
      }),
    ]
    const content = await previewPage()
    // A refused entry is still previewable — it is still the author's post —
    // but nothing about it is rewritten by looking at it.
    expect(content.entry?.$id).toBe('entry-1')
    expect(flips['entry-1']).toBeUndefined()
  })
})

describe('a grant is one entry, never a list', () => {
  it('keeps the previewed entry out of the collection listing', async () => {
    entryDocs = [scheduledLater()]
    const listing = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      // Passed deliberately: a list route has no entry to name, and the
      // option must be inert rather than "preview everything".
      previewUnpublishedEntry: true,
    })
    expect(listing.entries).toEqual([])
    expect(listing.entryPreview).toBeUndefined()
  })

  it('leaves the shared source cache refusing to store, exactly as before', async () => {
    entryDocs = [scheduledLater()]
    await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      previewUnpublishedEntry: true,
    })
    // A pending schedule is SERVED but never STORED, so the render that
    // publishes it is never suppressed. A preview must not have changed that
    // verdict in either direction.
    expect(storeVerdicts).toEqual([false])
  })

  it('does not consult the shared source cache at all on an entry route', async () => {
    entryDocs = [scheduledLater()]
    await previewPage()
    // The entry branch reads ONE document by slug. If a preview ever started
    // going through the cached source, this is where it would show — and that
    // read is shared by every other page on the site.
    expect(storeVerdicts).toEqual([])
  })
})
