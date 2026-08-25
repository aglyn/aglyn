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

/**
 * The org the plan gate sees, and a count of how often it was asked (AGL-471).
 *
 * The COUNT is asserted, not decorative. The gate is on the tenant render hot
 * path, and the whole reason it is arranged as two passes is that a collection
 * with nothing due must never read the org at all. A regression there is pure
 * cost — invisible in behaviour, visible only on the bill.
 */
let orgForHost: { orgId: string; org: Record<string, unknown> } | null = null
let orgReads = 0
/** `getOrgForHost` rejects, for the fail-open case. */
let orgReadThrows = false
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
  // The plan gate's only dependency (AGL-471). Absent, the call threw and
  // `getCollectionContent`'s try/catch folded it into an EMPTY collection —
  // which is how a missing mock impersonates "this blog has no posts".
  getOrgForHost: async (hostId: string) => {
    orgReads += 1
    if (orgReadThrows) throw new Error(`org read failed for ${hostId}`)
    return orgForHost
  },
}))

// The render cache is not under test, and a cached read would make the
// SECOND assertion in a case pass on the first one's data.
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: { read: () => unknown }) => options.read(),
}))

import { COLLECTION_SOURCE_MAX } from '@aglyn/aglyn/server'
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
  orgForHost = { orgId: 'org-1', org: { plan: 'business' } }
  orgReads = 0
  orgReadThrows = false
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

describe('the plan gate on entry scheduling (AGL-471)', () => {
  /**
   * The leak this closes.
   *
   * `scheduledPublishing` is a Business entitlement and the SCREENS path has
   * enforced it since AGL-471 — but entries were wired to neither half. The
   * console wrote `status: 'scheduled'` for any plan and this render path
   * published it, so scheduling worked end to end on Free. Nothing failed;
   * that is why it survived.
   */
  const onFree = () => {
    orgForHost = { orgId: 'org-1', org: { plan: 'free' } }
  }

  it('publishes a due entry for an entitled plan — the paying case still works', async () => {
    entryDocs = [scheduledEntry({ publishAt: AN_HOUR_AGO() })]
    const content = await listing()
    expect(content.entries.map((entry) => entry.$id)).toEqual(['entry-1'])
  })

  it('keeps a due entry OFF the listing when the plan cannot schedule', async () => {
    onFree()
    entryDocs = [scheduledEntry({ publishAt: AN_HOUR_AGO() })]
    const content = await listing()
    expect(content.entries).toEqual([])
  })

  it('keeps it off its own routed page too, not just the listing', async () => {
    onFree()
    entryDocs = [scheduledEntry({ publishAt: AN_HOUR_AGO() })]
    const content = await entryPage()
    expect(content.entry).toBeNull()
  })

  it('records the refusal instead of leaving it due forever', async () => {
    onFree()
    entryDocs = [scheduledEntry({ publishAt: AN_HOUR_AGO() })]
    await listing()
    // Left as a bare pending `scheduled`, the entry stays permanently due —
    // so the day the org upgrades, the next render publishes a post that was
    // scheduled months ago and forgotten. This is the AGL-1185 argument,
    // ported from screens.
    expect(flips['entry-1']).toEqual([
      { scheduleStatus: 'skipped-unentitled' },
    ])
  })

  it('never publishes a refused entry, even after an upgrade', async () => {
    entryDocs = [
      scheduledEntry({
        publishAt: AN_HOUR_AGO(),
        scheduleStatus: 'skipped-unentitled',
      }),
    ]
    // Entitled now — the refusal must still be terminal.
    const content = await listing()
    expect(content.entries).toEqual([])
    expect(flips['entry-1']).toBeUndefined()
  })

  it('does not re-read the org for an entry it already refused', async () => {
    onFree()
    entryDocs = [
      scheduledEntry({
        publishAt: AN_HOUR_AGO(),
        scheduleStatus: 'skipped-unentitled',
      }),
    ]
    await listing()
    expect(orgReads).toBe(0)
  })

  it('never asks the plan question when nothing is due', async () => {
    // The cost guard. A published entry and a future-dated one between them
    // cover every non-due shape; neither may reach the org read.
    entryDocs = [
      { $id: 'entry-1', title: 'Live', slug: 'live', status: 'published' },
      scheduledEntry({ $id: 'entry-2', publishAt: IN_AN_HOUR() }),
    ]
    await listing()
    expect(orgReads).toBe(0)
  })

  it('asks it exactly once for a page full of due entries', async () => {
    onFree()
    entryDocs = [
      scheduledEntry({ $id: 'entry-1', slug: 'a', publishAt: AN_HOUR_AGO() }),
      scheduledEntry({ $id: 'entry-2', slug: 'b', publishAt: AN_HOUR_AGO() }),
      scheduledEntry({ $id: 'entry-3', slug: 'c', publishAt: AN_HOUR_AGO() }),
    ]
    await listing()
    // Per call site, not per entry — `getOrgForHost` is request-deduped in
    // production, but this path must not depend on that to stay cheap.
    expect(orgReads).toBe(1)
  })

  it('withholds — does not publish — when the host resolves to no org', async () => {
    // Consistency with every other entitlement caller in this lib
    // (`run-event-actions`, `run-event-workflows`, `apply-publish-schedule`):
    // they all hand a possibly-undefined org to `checkEntitlement`, which
    // resolves a missing plan as free and DENIES (AGL-247). A gate that opened
    // when it could not see would be the free-tier leak shape that
    // `no-plan-gated-entitlement` exists to forbid.
    orgForHost = null
    entryDocs = [scheduledEntry({ publishAt: AN_HOUR_AGO() })]
    const content = await listing()
    expect(content.entries).toEqual([])
  })

  it('does NOT burn the schedule when the org could not be resolved', async () => {
    // The difference between `refused` and `unresolved`, and the reason the
    // permission is a tri-state. A hostIndex miss is not evidence about the
    // plan, so writing the terminal marker here would destroy a customer's
    // post over a condition that may not be true a second later.
    orgForHost = null
    entryDocs = [scheduledEntry({ publishAt: AN_HOUR_AGO() })]
    await listing()
    expect(flips['entry-1']).toBeUndefined()
  })

  it('withholds only the scheduled entry when the org read throws', async () => {
    // The failure that must not happen. The only caller sits inside
    // `getCollectionContent`'s try/catch, and that catch returns an EMPTY
    // collection — so a rejecting org read that escaped would take down every
    // PUBLISHED entry on the page too. The published one is the assertion
    // that matters; the scheduled one is merely deferred to the next render.
    orgReadThrows = true
    entryDocs = [
      { $id: 'entry-1', title: 'Live', slug: 'live', status: 'published' },
      scheduledEntry({ $id: 'entry-2', slug: 'b', publishAt: AN_HOUR_AGO() }),
    ]
    const content = await listing()
    expect(content.entries.map((entry) => entry.$id)).toEqual(['entry-1'])
    expect(flips['entry-2']).toBeUndefined()
  })
})

/**
 * The gate above THINS the read, and the search index downstream has to know
 * that (AGL-1516).
 *
 * `listLiveEntries` asks Firestore for `status in ['published', 'scheduled']`
 * bounded by `COLLECTION_SOURCE_MAX`, and then everything in this file
 * happens: a future `publishAt` is withheld, and since AGL-471 so is a due
 * schedule on a plan that does not carry `scheduledPublishing`. So the array
 * that comes out is SHORTER than the read that produced it, and its length
 * stops being an answer to "did this read stop at its limit?".
 *
 * That question is not academic. `collectionSourceIsBounded` is what makes a
 * collection search say it looked through a ceiling rather than through a
 * collection, and the branch a `false` selects is the flat "No matches." — the
 * one wording that claims to have searched everything. Under-report it on a
 * blog holding four posts back, and a reader is told their post does not exist
 * because four OTHER posts are scheduled for next week.
 */
describe('a bounded read declares itself past the liveness gate (AGL-1516)', () => {
  /** Published docs, `count` of them — the part of a read that survives. */
  const publishedDocs = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      $id: `pub-${i}`,
      title: `Post ${i}`,
      slug: `post-${i}`,
      status: 'published',
    }))

  it('reports the bound when the gate thinned the read below it', async () => {
    // The load-bearing case: the query came back FULL, four of its documents
    // were not live yet, and the 96 survivors look nothing like a ceiling.
    entryDocs = [
      ...publishedDocs(COLLECTION_SOURCE_MAX - 4),
      ...Array.from({ length: 4 }, (_, i) => ({
        $id: `sched-${i}`,
        title: `Later ${i}`,
        slug: `later-${i}`,
        status: 'scheduled',
        publishAt: IN_AN_HOUR(),
      })),
    ]
    const content = await listing()
    expect(content.entries).toHaveLength(COLLECTION_SOURCE_MAX - 4)
    expect(content.entriesReachedBound).toBe(true)
  })

  it('reports the bound when the PLAN withheld the difference', async () => {
    // Same shape, AGL-471's refusal instead of a future date — a Free org
    // whose scheduled posts are permanently withheld would otherwise make a
    // capped collection look complete forever.
    orgForHost = { orgId: 'org-1', org: { plan: 'free' } }
    entryDocs = [
      ...publishedDocs(COLLECTION_SOURCE_MAX - 1),
      scheduledEntry({ publishAt: AN_HOUR_AGO() }),
    ]
    const content = await listing()
    expect(content.entries).toHaveLength(COLLECTION_SOURCE_MAX - 1)
    expect(content.entriesReachedBound).toBe(true)
  })

  it('leaves it FALSE on a read that came back short', async () => {
    // The other direction, and what keeps the flag worth reading: a
    // three-post collection must not describe itself as truncated, or the
    // cautious wording appears on every small blog and stops meaning anything.
    entryDocs = publishedDocs(3)
    const content = await listing()
    expect(content.entriesReachedBound).toBe(false)
  })

  it('does not claim a bound on an ENTRY route', async () => {
    // An entry page reads one document by slug; nothing there is bounded. A
    // stray `true` would have an article page's blocks describe a complete
    // collection as truncated.
    entryDocs = [
      { $id: 'entry-1', title: 'Live', slug: SLUG, status: 'published' },
    ]
    const content = await entryPage()
    expect(content.entry?.slug).toBe(SLUG)
    expect(content.entriesReachedBound).toBeUndefined()
  })
})
