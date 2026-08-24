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
 * The read-time publish gate for collection entries (AGL-123 / AGL-2498).
 *
 * ## Why this file exists
 *
 * Scheduling an entry writes `{ status: 'scheduled', publishAt }` from the
 * console and then NOTHING ELSE HAPPENS. There is no cron, no job and no
 * server beat that promotes a content entry: `publish-schedule-job.ts` is
 * "SCREENS ONLY, deliberately" and queries `publishSchedule.publishAt`, a map
 * field on a screen document that an entry does not have. `grep` finds no
 * `collectionGroup('entries')` anywhere and `vercel.json` declares no crons.
 *
 * So the entire feature rests on two private functions in
 * `get-collection-content.ts` — `isLive`, which decides per render whether a
 * due schedule counts as published, and `flipDueEntry`, which makes that
 * durable fail-open. Both were untested. A regression in either is invisible:
 * the console keeps accepting schedules and reporting "Scheduled for …", and
 * the entry simply never appears on the site, or appears immediately.
 *
 * These cases therefore drive the gate from BOTH SIDES of the instant. A suite
 * that only asserted the due case cannot tell a working scheduler from one
 * that publishes everything the moment it is scheduled — which is the failure
 * an author would not notice until the post was already public.
 *
 * ## The three states that must not collapse
 *
 * `strictNullChecks` is off repo-wide, so "never scheduled", "scheduled for
 * later" and "scheduled, and due" all reach comparison code as values that
 * coerce. `isLive` guards the first with `?? Number.POSITIVE_INFINITY`; the
 * obvious-looking `?? 0` compiles clean and dates an unscheduled entry to 1
 * Jan 1970, which is `<= Date.now()` forever — i.e. every draft-shaped
 * scheduled entry silently public. That case is asserted here on its own.
 */

/** Every `ref.update(...)` the loader performed, keyed by entry id. */
const flips: Record<string, Array<Record<string, unknown>>> = {}
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
    // Records rather than discards: `flipDueEntry` is fire-and-forget
    // (`.catch(console.error)`), so the ONLY evidence it ran is the argument
    // it was called with. A mock that threw the payload away would let a flip
    // that wrote the wrong field pass.
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
}))

// The render cache is not under test, and a cached read would make the
// SECOND assertion in a case pass on the first one's data.
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: { read: () => unknown }) => options.read(),
}))

import { getCollectionContent } from './get-collection-content'

const HOST = 'host-1'
const SLUG = 'shipping-the-export'

/** An hour either side of now — far enough out that clock drift cannot flip it. */
const nowSeconds = () => Math.floor(Date.now() / 1000)
const IN_AN_HOUR = () => ({ seconds: nowSeconds() + 3600 })
const AN_HOUR_AGO = () => ({ seconds: nowSeconds() - 3600 })

beforeEach(() => {
  for (const key of Object.keys(flips)) delete flips[key]
  entryDocs = []
  collectionDoc.fields = {
    displayName: 'Blog',
    slug: 'blog',
    kind: 'content',
    categories: [],
  }
})

const scheduledEntry = (extra: Record<string, unknown>) => ({
  $id: 'entry-1',
  title: 'Shipping the export',
  slug: SLUG,
  status: 'scheduled',
  ...extra,
})

const listing = () =>
  getCollectionContent({ hostId: HOST, collectionSlug: 'blog' })
const entryPage = () =>
  getCollectionContent({
    hostId: HOST,
    collectionSlug: 'blog',
    entrySlug: SLUG,
  })

describe('a schedule that has NOT come due is not published (AGL-123)', () => {
  it('keeps a future-dated entry OUT of the listing', async () => {
    entryDocs = [scheduledEntry({ publishAt: IN_AN_HOUR() })]
    const content = await listing()
    expect(content.entries).toEqual([])
  })

  it('keeps it off its own routed page — a 404, not a preview', async () => {
    entryDocs = [scheduledEntry({ publishAt: IN_AN_HOUR() })]
    const content = await entryPage()
    // Null is what makes the route answer "not found". Returning the entry
    // with a flag would publish the body to anybody who guessed the slug.
    expect(content.entry).toBeNull()
  })

  it('does NOT flip the document — the schedule must survive the render', async () => {
    entryDocs = [scheduledEntry({ publishAt: IN_AN_HOUR() })]
    await listing()
    // If `flipDueEntry` ever moved ahead of the `isLive` filter, every
    // scheduled entry would publish itself the first time any page rendered.
    expect(flips['entry-1']).toBeUndefined()
  })
})

describe('a schedule that HAS come due is published (AGL-123)', () => {
  it('brings a past-dated entry INTO the listing', async () => {
    entryDocs = [scheduledEntry({ publishAt: AN_HOUR_AGO() })]
    const content = await listing()
    expect(content.entries.map((entry) => entry.$id)).toEqual(['entry-1'])
  })

  it('serves its routed page', async () => {
    entryDocs = [scheduledEntry({ publishAt: AN_HOUR_AGO() })]
    const content = await entryPage()
    expect(content.entry?.$id).toBe('entry-1')
  })

  it('flips the document durably, stamping publishAt as publishedAt', async () => {
    const due = AN_HOUR_AGO()
    entryDocs = [scheduledEntry({ publishAt: due })]
    await listing()
    // The date the article goes on to CLAIM (`Article.datePublished`) is the
    // instant it was scheduled for, not the moment a crawler happened to
    // trigger the render.
    expect(flips['entry-1']).toEqual([
      { status: 'published', publishedAt: due },
    ])
  })

  it('reports publishAt as the entry publishedAt before the flip lands', async () => {
    const due = AN_HOUR_AGO()
    entryDocs = [scheduledEntry({ publishAt: due })]
    const content = await listing()
    // The flip is fire-and-forget, so THIS render must not show a dateless
    // post while the write is in flight.
    expect(content.entries[0]?.publishedAt).toEqual({ seconds: due.seconds })
  })
})

describe('an absent publishAt is not a schedule that came due (strictNullChecks)', () => {
  it('never publishes a scheduled entry that carries NO publishAt', async () => {
    entryDocs = [scheduledEntry({})]
    const content = await listing()
    // The `?? Number.POSITIVE_INFINITY` guard in `isLive`. Swap it for `?? 0`
    // and this entry dates to 1 Jan 1970 — permanently `<= Date.now()` — so
    // it publishes itself and every entry like it.
    expect(content.entries).toEqual([])
    expect(flips['entry-1']).toBeUndefined()
  })

  it('keeps it off its routed page too', async () => {
    entryDocs = [scheduledEntry({})]
    const content = await entryPage()
    expect(content.entry).toBeNull()
  })
})

describe('an explicitly published entry is unaffected by the gate', () => {
  it('is live with no publishAt at all', async () => {
    entryDocs = [
      {
        $id: 'entry-1',
        title: 'Shipping the export',
        slug: SLUG,
        status: 'published',
        publishedAt: AN_HOUR_AGO(),
      },
    ]
    const content = await listing()
    expect(content.entries.map((entry) => entry.$id)).toEqual(['entry-1'])
    // Nothing to flip: it is already published, and a spurious update here
    // would rewrite `publishedAt` on every render.
    expect(flips['entry-1']).toBeUndefined()
  })

  it('stays live even while carrying a stale FUTURE publishAt', async () => {
    // Reachable today: publishing a scheduled entry from the console writes
    // `status: 'published'` and leaves `publishAt` behind — nothing clears it.
    // `isLive` short-circuits on status, so the leftover must not un-publish
    // a live post.
    entryDocs = [
      {
        $id: 'entry-1',
        title: 'Shipping the export',
        slug: SLUG,
        status: 'published',
        publishedAt: AN_HOUR_AGO(),
        publishAt: IN_AN_HOUR(),
      },
    ]
    const content = await listing()
    expect(content.entries.map((entry) => entry.$id)).toEqual(['entry-1'])
    // And `publishedAt` wins the precedence, so the post does not advertise
    // a publication date in the future.
    expect(content.entries[0]?.publishedAt?.seconds).toBeLessThan(nowSeconds())
  })
})

describe('a draft is never live, however it is dated', () => {
  it('stays out even carrying a past publishAt', async () => {
    entryDocs = [scheduledEntry({ status: 'draft', publishAt: AN_HOUR_AGO() })]
    const content = await listing()
    expect(content.entries).toEqual([])
    expect(flips['entry-1']).toBeUndefined()
  })
})
