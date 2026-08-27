/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * A paged list cannot be searched in the browser.
 *
 * The staff organization list filtered the rows it had already fetched — ten
 * of them by default — so it answered "no such organization" for every
 * organization past the first page. That is the one answer a search must
 * never give wrongly, and it gets quietly more wrong as the platform grows.
 *
 * The search is an `array-contains` over `nameTokens` — every prefix of every
 * WORD, written by the same paths that write the name — which reaches the
 * whole collection and matches a word wherever it sits in the name. It
 * replaced a prefix range over `nameLower`, which was anchored at the start
 * of the whole name and so found "Acme Coffee" by "acme" and never by
 * "coffee".
 *
 * What it still cannot do is match MID-word, and a multi-word query narrows
 * by its first word only — one `array-contains` per query is a Firestore
 * limit. Both are the honest edge of doing this without a search service.
 */

/** Everything the query builder was asked for, in order. */
let ordering: string[] = []
let wheres: Array<[string, string, unknown]> = []
let startAt: any = null
let endAt: any = null
let startedAfter: string | null = null
let capped: number | null = null

/*
 * `ref.collection(...)` is modelled because the route reaches through it for
 * each org's billing document. A `ref` without it made every request throw
 * into the 500 handler — and the ordering assertions still passed, because
 * they are recorded before the throw. A double that lets the assertions pass
 * on a response nobody received is worse than no double at all.
 */
const orgDoc = (id: string, data: Record<string, unknown>) => ({
  id,
  exists: true,
  data: () => data,
  get: (key: string) => data[key],
  ref: {
    id,
    collection: () => ({ doc: () => ({ id, __billing: true }) }),
  },
})

let orgs: Array<{ id: string; data: Record<string, unknown> }> = []

function orgQuery(): any {
  return {
    orderBy: (field: unknown) => {
      ordering.push(typeof field === 'string' ? field : '__name__')
      return orgQuery()
    },
    where: (field: string, op: string, value: unknown) => {
      wheres.push([field, op, value])
      return orgQuery()
    },
    // The range operators (`startsWith`, `endsWith`) build on these; without
    // them the handler throws and every assertion reads as a 500.
    startAt: (value: unknown) => {
      startAt = value
      return orgQuery()
    },
    endAt: (value: unknown) => {
      endAt = value
      return orgQuery()
    },
    startAfter: (cursor: { id?: string }) => {
      startedAfter = cursor?.id ?? null
      return orgQuery()
    },
    limit: (value: number) => {
      capped = value
      return orgQuery()
    },
    get: async () => ({ docs: orgs.map((o) => orgDoc(o.id, o.data)) }),
    doc: (id: string) => ({
      get: async () => {
        const found = orgs.find((o) => o.id === id)
        return found
          ? orgDoc(found.id, found.data)
          : { id, exists: false, data: () => ({}), get: () => undefined }
      },
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'staff-1',
          email_verified: true,
          staff: true,
        }),
      }),
      firestore: () => ({
        collection: () => (global as any).__orgQuery(),
        // No billing subdocument for these fixtures; the route falls back to
        // the org's own inline `subscription`, which is the common case.
        getAll: async (...refs: unknown[]) =>
          refs.map(() => ({ exists: false, data: () => ({}) })),
      }),
    }),
    firestore: {
      FieldPath: { documentId: () => '__name__' },
      Timestamp: {
        fromMillis: (ms: number) => ({ toMillis: () => ms }),
        // Recorded as an ISO string so a date assertion reads as a date
        // rather than as an opaque object identity.
        fromDate: (date: Date) => ({ __ts: date.toISOString() }),
      },
    },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...(jest.requireActual('@aglyn/aglyn/server') as object),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: undefined,
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))
;(global as any).__orgQuery = () => orgQuery()

import { GET } from '../app/api/admin/orgs/route'

const get = (params: Record<string, string> = {}) => {
  const url = new URL('https://console.test/api/admin/orgs')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return GET(
    new Request(url.toString(), { headers: { authorization: 'Bearer t' } }),
  )
}

beforeEach(() => {
  ordering = []
  wheres = []
  startAt = null
  endAt = null
  startedAfter = null
  capped = null
  orgs = [
    {
      id: 'org-a',
      data: {
        name: 'Acme Coffee',
        nameLower: 'acme coffee',
        nameTokens: ['a', 'ac', 'acm', 'acme', 'c', 'co', 'cof', 'coff', 'coffe', 'coffee'],
      },
    },
  ]
})

describe('the staff organization list searches the COLLECTION', () => {
  it('orders by document id and filters on nothing when not searching', () => {
    // The instrument: without a term the list is the plain paged walk it
    // always was, so the assertions below read as a difference.
    return get().then(async (response) => {
      // Asserted FIRST, and in every case below that inspects the query: the
      // builder records what it was asked for before the handler can throw,
      // so a route 500ing on every request would leave these green.
      expect(response.status).toBe(200)
      expect(ordering).toEqual(['__name__'])
      expect(wheres).toEqual([])
    })
  })

  it('matches a word ANYWHERE in the name, not just the first', async () => {
    /*
     * The whole point of the token array. A prefix range over `nameLower` is
     * anchored at the start of the WHOLE name — "acme" found "Acme Coffee"
     * and "coffee" did not — which is the wrong end for a search box, since
     * the word somebody remembers is rarely the first one.
     */
    expect((await get({ search: 'coffee' })).status).toBe(200)
    expect(wheres).toEqual([['nameTokens', 'array-contains', 'coffee']])
    expect(ordering).toEqual(['nameLower'])
  })

  it('normalizes case and stray whitespace like the stored tokens', async () => {
    expect((await get({ search: '  COF ' })).status).toBe(200)
    expect(wheres).toEqual([['nameTokens', 'array-contains', 'cof']])
  })

  it('narrows a multi-word query by its FIRST word', async () => {
    // Firestore permits one `array-contains` per query, so a multi-word
    // search cannot be an AND on the server. Stated rather than silently
    // dropping the rest.
    expect((await get({ search: 'acme cof' })).status).toBe(200)
    expect(wheres).toEqual([['nameTokens', 'array-contains', 'acme']])
  })

  it('caps the query at the length the tokens were written to', async () => {
    // A longer query would look for a token that was never stored, so every
    // search past twelve characters would find nothing at all.
    expect((await get({ search: 'extraordinarilylongname' })).status).toBe(200)
    expect(wheres[0][2]).toBe('extraordinar')
  })

  it('a blank search is NOT a search', async () => {
    // Otherwise an empty box would filter on '' — a token no document holds,
    // which reads as "there are no organizations".
    expect((await get({ search: '   ' })).status).toBe(200)
    expect(ordering).toEqual(['__name__'])
    expect(wheres).toEqual([])
  })


  it('resumes from a SNAPSHOT, not a raw cursor value', async () => {
    /*
     * A search page is ordered by `nameLower`, which is not unique. A raw
     * string cursor would be compared against that field, so two
     * organizations sharing a name would make the second one vanish —
     * silently, from the list whose whole job is that nobody is missing.
     * `startAfter(snapshot)` compares every ordering field including the
     * `__name__` Firestore appends.
     */
    expect((await get({ search: 'acme', after: 'org-a' })).status).toBe(200)
    expect(startedAfter).toBe('org-a')
  })

  it('a cursor that no longer resolves restarts at the top', async () => {
    const response = await get({ search: 'acme', after: 'deleted-org' })
    expect(response.status).toBe(200)
    expect(startedAfter).toBeNull()
  })

  it('asks for one row past the page, in both modes', async () => {
    await get({ pageSize: '10' })
    expect(capped).toBe(11)
    await get({ pageSize: '10', search: 'acme' })
    expect(capped).toBe(11)
  })
})

/**
 * The column filter panel, answered by the query.
 *
 * `filterMode="server"` stops the grid applying anything itself, so an
 * operator the route does not answer is a control that silently does nothing.
 * These cases pin which operators reach a real predicate — and the last one
 * pins that an unanswerable operator falls back to the unfiltered list rather
 * than to an empty one, because "no results" is the wrong answer to "this
 * console cannot do that".
 */
describe('the column filter reaches the query', () => {
  const filterFor = (field: string, op: string, value: string) =>
    get({ filterField: field, filterOp: op, filterValue: value })

  it('name · contains → array-contains over the word tokens', async () => {
    expect((await filterFor('name', 'contains', 'Coffee')).status).toBe(200)
    expect(wheres).toEqual([['nameTokens', 'array-contains', 'coffee']])
  })

  it('name · equals → equality on the normalized key', async () => {
    expect((await filterFor('name', 'equals', '  Acme Coffee ')).status).toBe(200)
    expect(wheres).toEqual([['nameLower', '==', 'acme coffee']])
  })

  it('name · startsWith → a range over nameLower', async () => {
    expect((await filterFor('name', 'startsWith', 'Acme')).status).toBe(200)
    expect(ordering).toEqual(['nameLower'])
    expect(startAt).toBe('acme')
    expect(wheres).toEqual([])
  })

  it('name · endsWith → the same range, read backwards', async () => {
    // Firestore anchors a range at the FRONT of the stored value, so "ends
    // with" is only answerable against a reversed copy of the key.
    expect((await filterFor('name', 'endsWith', 'Coffee')).status).toBe(200)
    expect(ordering).toEqual(['nameReversed'])
    // "coffee" reversed — the stored key is reversed too, so the end of the
    // name is at the front of the index.
    expect(startAt).toBe('eeffoc')
  })

  it('plan · isAnyOf → `in`, and never more than Firestore allows', async () => {
    expect((await filterFor('plan', 'isAnyOf', 'free, business')).status).toBe(200)
    expect(wheres).toEqual([['plan', 'in', ['free', 'business']]])

    // Cleared, because `wheres` accumulates across calls inside one test and
    // `wheres[0]` would still be the two-value query above.
    wheres = []
    const many = Array.from({ length: 40 }, (_, i) => `p${i}`).join(',')
    expect((await filterFor('plan', 'isAnyOf', many)).status).toBe(200)
    expect((wheres[0][2] as string[]).length).toBe(30)
  })

  it('subscription · equals reaches the DENORMALIZED status', async () => {
    /*
     * `subscription` is not a field on the org document. It moved to
     * `orgs/{orgId}/billing/stripe` (AGL-1028) and the row merges it in after
     * the query has run, so a predicate on `subscription.status` matches a
     * path nothing writes — it returned zero rows for every value, which on a
     * list reads as "no organization is in that state".
     *
     * `billingStatus` is the mirror `writeOrgBilling` keeps on the org
     * document for the dunning banner, and it is the only status a query can
     * reach.
     */
    expect((await filterFor('subscription', 'equals', 'canceled')).status).toBe(200)
    expect(wheres).toEqual([['billingStatus', '==', 'canceled']])
  })

  it('$id · startsWith → a range over the document id', async () => {
    expect((await filterFor('$id', 'startsWith', 'org-')).status).toBe(200)
    expect(ordering).toEqual(['__name__'])
    expect(startAt).toBe('org-')
  })

  it('slug · startsWith needs no lower-case twin', async () => {
    // A slug is lower-case by construction, so the stored value IS its own
    // normalized key.
    expect((await filterFor('slug', 'startsWith', 'Acme')).status).toBe(200)
    expect(ordering).toEqual(['slug'])
    expect(startAt).toBe('acme')
  })

  it('ownerUid · equals is filterable without being a column', async () => {
    expect((await filterFor('ownerUid', 'equals', 'uid-1')).status).toBe(200)
    expect(wheres).toEqual([['ownerUid', '==', 'uid-1']])
  })

  it('createdAt · is covers the DAY, not an instant', async () => {
    /*
     * A stored timestamp carries a time of day, so equality against midnight
     * matches nothing — a date column filtered by `is` would answer "none"
     * for every row, every time. It is a range across the day instead.
     */
    expect((await filterFor('createdAt', 'is', '2026-07-18')).status).toBe(200)
    expect(ordering).toEqual(['createdAt'])
    expect(wheres).toEqual([])
    expect((startAt as any).__ts).toBeDefined()
    expect((endAt as any).__ts).toBeDefined()
    expect(new Date((endAt as any).__ts).getTime()).toBeGreaterThan(
      new Date((startAt as any).__ts).getTime(),
    )
  })

  it('createdAt · before is a bound, not a range', async () => {
    expect((await filterFor('createdAt', 'before', '2026-07-18')).status).toBe(200)
    expect(wheres.length).toBe(1)
    expect(wheres[0][0]).toBe('createdAt')
    expect(wheres[0][1]).toBe('<')
  })

  it('plan · isNotEmpty requires the field to EXIST', async () => {
    // `!= null` in Firestore also excludes documents that lack the field,
    // which is exactly what "is not empty" should mean.
    expect((await filterFor('plan', 'isNotEmpty', '')).status).toBe(200)
    expect(wheres).toEqual([['plan', '!=', null]])
  })

  it('isEmpty on a field writers OMIT lists everything, not nothing', async () => {
    /*
     * Firestore cannot query for absence: `== null` matches an explicit null
     * and never a missing field. `plan` is simply absent on organizations
     * that never had one, so answering this would report "none" to a question
     * with real answers. The panel does not offer it — this pins that a
     * hand-built request degrades to unfiltered rather than to empty.
     */
    expect((await filterFor('plan', 'isEmpty', '')).status).toBe(200)
    expect(ordering).toEqual(['__name__'])
    expect(wheres).toEqual([])
  })

  it('an unanswerable operator lists everything rather than nothing', async () => {
    // `doesNotContain` has no Firestore predicate. The panel does not offer
    // it, but a hand-built request must not read as "no such organization".
    expect((await filterFor('name', 'doesNotContain', 'acme')).status).toBe(200)
    expect(ordering).toEqual(['__name__'])
    expect(wheres).toEqual([])
  })

  it('a blank filter value is not a filter', async () => {
    expect((await filterFor('name', 'equals', '   ')).status).toBe(200)
    expect(ordering).toEqual(['__name__'])
    expect(wheres).toEqual([])
  })
})
