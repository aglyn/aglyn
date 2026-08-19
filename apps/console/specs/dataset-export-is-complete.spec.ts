/**
 * @jest-environment node
 */

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
 * AGL-2335 — the dataset export is sold as a **full handover** and was a
 * pseudo-random sample.
 *
 * `handleExport` serialized `records`, the card's live listener window:
 * `limit(500)` with **no** `orderBy`. Firestore answers an unordered limit in
 * document-id order over auto-ids, so a 2,000-record dataset did not export
 * "the first 500" — it exported 500 unpredictable rows, and re-running it
 * could produce a different set. `sortDatasetRecords` then sorted that
 * sample, which made the file look ordered and be arbitrary.
 *
 * The assertion that must NOT be written here is "rows were written" — that
 * passes against a truncated export, which is the entire defect. What is
 * asserted instead:
 *
 *  - **the row count equals the SOURCE count**, over a dataset deliberately
 *    larger than both the old 500 window and the new 500 page size, so a
 *    cursor that stops after one page fails;
 *  - **the ordering is deterministic and total** — every id exactly once, in
 *    ascending document-id order, byte-identical across two runs. A random
 *    500 and an ordered first-500 are different bugs and only one of them is
 *    defensible; neither is what ships;
 *  - **the promise is checkable** — the count aggregate the client verifies
 *    against, and the verifier itself.
 */
import { exportShortfall } from '@aglyn/aglyn'

/** `orgs/{orgId}/datasets/{datasetId}/records` — id → doc data. */
const mockRecords = new Map<string, Record<string, unknown>>()
let mockDataset: Record<string, unknown> | null = null
let mockOrg: Record<string, unknown> | null = null
let mockMember: Record<string, unknown> | null = null
let mockDecoded: Record<string, unknown> = {
  uid: 'user-1',
  email_verified: true,
}
let mockReleaseFlag = true
/** How each records page was ordered — `null` means the query asked for no order. */
const mockPageOrderings: Array<string | null> = []
let mockLocked: Response | null = null
const mockAuditAdd = jest.fn(async () => undefined)

/**
 * A faithful-enough records query.
 *
 * Firestore answers an *unordered* `limit(n)` in document-id order too — so
 * this double does NOT pretend an unordered query scrambles, which would
 * fabricate a red the product cannot produce. What separates the fix from
 * the defect is completeness and a working cursor, and `startAfter` is
 * modelled the way Firestore evaluates it: on the ordered field's value,
 * which under `orderBy(__name__)` is the document id.
 */
function recordsQuery(
  ordered: boolean,
  take: number | null,
  after: string | null,
) {
  return {
    orderBy: (field: unknown) => recordsQuery(field === '__name__', take, after),
    limit: (count: number) => recordsQuery(ordered, count, after),
    startAfter: (snapshot: { id: string }) =>
      recordsQuery(ordered, take, snapshot.id),
    get: async () => {
      mockPageOrderings.push(ordered ? '__name__' : null)
      let ids = [...mockRecords.keys()].sort()
      if (after !== null) ids = ids.filter((id) => id > after)
      const page = take === null ? ids : ids.slice(0, take)
      return {
        empty: page.length === 0,
        docs: page.map((id) => ({ id, data: () => mockRecords.get(id) })),
      }
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: mockRecords.size }) }),
    }),
  }
}

const datasetRef = () => ({
  get: async () => ({
    exists: mockDataset !== null,
    data: () => mockDataset,
  }),
  collection: (name: string) => {
    if (name !== 'records') throw new Error(`unexpected subcollection ${name}`)
    return recordsQuery(false, null, null)
  },
})

const orgRef = () => ({
  get: async () => ({ exists: mockOrg !== null, data: () => mockOrg }),
  collection: (name: string) => {
    if (name !== 'datasets') throw new Error(`unexpected subcollection ${name}`)
    return { doc: () => datasetRef() }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecoded }),
      firestore: () => ({
        collection: (name: string) => {
          if (name === 'orgs') return { doc: () => orgRef() }
          if (name === 'adminAudit') return { add: mockAuditAdd }
          throw new Error(`unexpected collection ${name}`)
        },
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  isServerReleaseFlagOnForOrg: async () => mockReleaseFlag,
  lockdownRefusal: async () => mockLocked,
  resolveOrgMembership: async () =>
    mockMember ? { orgId: 'org-1', member: mockMember } : null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL scope predicate and the REAL model resolver — the two pieces of
  // product logic this route leans on. Stubbing either would leave the
  // authorization and the column set asserted against fiction.
  ...jest.requireActual('@aglyn/aglyn/app-utils/organizations'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/dataset-models'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/dataset-csv'),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      body: {},
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(
        [...request.headers.entries()].map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
    }
  },
}))

const route = require('../app/api/orgs/datasets/export/route')

const FIELDS = {
  order: ['title', 'note'],
  fields: {
    title: { id: 'title', type: 'text', label: 'Title' },
    note: { id: 'note', type: 'text', label: 'Note' },
  },
}

/** `count` records with deliberately NON-sequential ids, as auto-ids are. */
const seedRecords = (count: number) => {
  mockRecords.clear()
  for (let index = 0; index < count; index += 1) {
    // A scrambled-but-stable id space: sorting by id is nothing like
    // sorting by creation order, which is what makes an unordered window a
    // sample rather than a prefix.
    const id = `rec-${String((index * 7919) % 100000).padStart(6, '0')}-${index}`
    mockRecords.set(id, {
      values: { title: `Row ${index}`, note: `note ${index}` },
      order: index,
    })
  }
}

const callExport = (
  params: Record<string, string> = {},
  headers: Record<string, string> = { Authorization: 'Bearer tok' },
) => {
  const search = new URLSearchParams({
    orgId: 'org-1',
    datasetId: 'ds-1',
    ...params,
  })
  return route.GET(
    new Request(`https://console.aglyn.com/api/orgs/datasets/export?${search}`, {
      headers,
    }),
  )
}

beforeEach(() => {
  mockDataset = { displayName: 'Client Contacts', model: FIELDS }
  mockOrg = { plan: 'agency' }
  mockMember = { $id: 'user-1', role: 'admin' }
  mockDecoded = { uid: 'user-1', email_verified: true }
  mockReleaseFlag = true
  mockLocked = null
  mockAuditAdd.mockClear()
  mockPageOrderings.length = 0
  seedRecords(1200)
})

describe('the dataset export is the whole dataset (AGL-2335)', () => {
  it('REGRESSION — exports every row, not a 500-row window', async () => {
    const response = await callExport()
    expect(response.status).toBe(200)
    const body = await response.text()
    const lines = body.trim().split('\n')

    // 1,200 is deliberately past BOTH the old listener window and the new
    // server page size, so a fix that pages once fails here as loudly as
    // the original truncation does.
    expect(lines).toHaveLength(1 + mockRecords.size)
    expect(lines[0]).toBe('title,note')
    // The header states the same number the body delivers. Asserting only
    // one of the two lets a stream that dies mid-flight pass.
    expect(response.headers.get('X-Aglyn-Export-Rows')).toBe('1200')
    expect(lines.length - 1).toBe(
      Number(response.headers.get('X-Aglyn-Export-Rows')),
    )
  })

  it('REGRESSION — the rows are the SOURCE rows, each exactly once', async () => {
    const body = await (await callExport()).text()
    const titles = body.trim().split('\n').slice(1).map((line) => line.split(',')[0])

    expect(new Set(titles).size).toBe(mockRecords.size)
    // Every source row, not merely the right NUMBER of rows — a cursor that
    // re-reads a page would keep the count and lose the content.
    const expected = [...mockRecords.keys()]
      .sort()
      .map((id) => (mockRecords.get(id)?.['values'] as any).title)
    expect(titles).toEqual(expected)
  })

  it('REGRESSION — every page ASKS for an order; none is left to chance', async () => {
    await (await callExport()).text()
    // The defect was `limit(500)` with no `orderBy`, whose result order
    // Firestore documents as unspecified. Asserting the emitted rows come
    // back sorted cannot catch a regression here — this double sorts either
    // way, and so, today, does the real backend. What must be pinned is that
    // the route ASKS, because relying on an unspecified order is the bug
    // whether or not it currently happens to hold.
    expect(mockPageOrderings.length).toBeGreaterThan(1)
    expect(mockPageOrderings.every((order) => order === '__name__')).toBe(true)
  })

  it('REGRESSION — the ordering is deterministic, not an arbitrary sample', async () => {
    const first = await (await callExport()).text()
    const second = await (await callExport()).text()
    // Re-exporting the same unchanged dataset must produce the same file.
    // The old window could hand back a different 500 each time.
    expect(second).toBe(first)

    const ids = [...mockRecords.keys()].sort()
    const titles = first.trim().split('\n').slice(1).map((l) => l.split(',')[0])
    // A TOTAL order over a field every document has. Ordering by `order` —
    // the field the table sorts on — would drop legacy records that lack it,
    // reintroducing the silent row loss this issue is about.
    expect(titles[0]).toBe((mockRecords.get(ids[0])?.['values'] as any).title)
    expect(titles[titles.length - 1]).toBe(
      (mockRecords.get(ids[ids.length - 1])?.['values'] as any).title,
    )
  })

  it('spans page boundaries without a gap or a repeat', async () => {
    // 1,200 over a 500-row page is 2.4 pages: two full pages, a short one,
    // and an exhausted cursor. Every off-by-one in the paging lands here.
    seedRecords(1201)
    const body = await (await callExport()).text()
    const rows = body.trim().split('\n').slice(1)
    expect(rows).toHaveLength(1201)
    expect(new Set(rows).size).toBe(1201)
  })

  it('an empty dataset is an empty export, not an error', async () => {
    seedRecords(0)
    const response = await callExport()
    expect(response.status).toBe(200)
    expect((await response.text()).trim()).toBe('title,note')
    expect(response.headers.get('X-Aglyn-Export-Rows')).toBe('0')
  })

  it('the JSON export is complete too', async () => {
    const response = await callExport({ format: 'json' })
    const parsed = JSON.parse(await response.text())
    expect(parsed).toHaveLength(1200)
    expect(parsed[0]).toEqual({ title: 'Row 0', note: 'note 0' })
    expect(response.headers.get('Content-Disposition')).toContain('.json"')
  })

  it('is a download, and is never cached', async () => {
    const response = await callExport()
    expect(response.headers.get('Content-Type')).toContain('text/csv')
    expect(response.headers.get('Content-Disposition')).toContain(
      'attachment; filename="client-contacts-',
    )
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  })

  it('escapes cells that would otherwise break the row', async () => {
    seedRecords(0)
    mockRecords.set('rec-a', {
      values: { title: 'Smith, John', note: 'line one\nline two' },
    })
    const body = await (await callExport()).text()
    expect(body).toContain('"Smith, John","line one\nline two"')
  })
})

describe('the export refuses what the caller may not read (AGL-2335)', () => {
  it('a non-member gets a 404, not a file', async () => {
    mockMember = null
    expect((await callExport()).status).toBe(404)
  })

  it('a scoped collaborator cannot export a dataset outside their scope', async () => {
    mockMember = {
      $id: 'user-1',
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-a': 'editor' },
      scopeTokens: ['host:host-a'],
    }
    mockDataset = { displayName: 'Internal', model: FIELDS, visibleTo: ['host:host-b'] }
    expect((await callExport()).status).toBe(404)

    // …and CAN export one that is in scope, so the check is a scope check
    // and not a blanket refusal that would pass this test by doing nothing.
    mockDataset = { displayName: 'Theirs', model: FIELDS, visibleTo: ['host:host-a'] }
    const allowed = await callExport()
    expect(allowed.status).toBe(200)
    expect((await allowed.text()).trim().split('\n')).toHaveLength(1201)
  })

  it('refuses without a bearer token, and refuses a POST', async () => {
    expect((await callExport({}, {})).status).toBe(401)
    const response = await route.GET(
      new Request('https://console.aglyn.com/api/orgs/datasets/export', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok' },
      }),
    )
    expect(response.status).toBe(405)
  })

  it('honours the lockdown verdict and the release flag', async () => {
    mockLocked = Response.json({ error: 'Locked' }, { status: 423 })
    expect((await callExport()).status).toBe(423)
    mockLocked = null
    mockReleaseFlag = false
    expect((await callExport()).status).toBe(404)
  })

  it('records that a copy left, with counts and no content', async () => {
    await (await callExport()).text()
    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dataset.exported',
        target: 'orgs/org-1/datasets/ds-1',
        after: { format: 'csv', records: 1200 },
      }),
    )
    const logged = JSON.stringify(
      (mockAuditAdd.mock.calls[0] as unknown[])[0],
    )
    expect(logged).not.toContain('Row 0')
  })
})

describe('the download is checked, not trusted (AGL-2335)', () => {
  const csv = (rows: number) =>
    ['title,note', ...Array.from({ length: rows }, (_, i) => `r${i},n${i}`)].join(
      '\n',
    )

  it('REGRESSION — a body short of the promised count is a SHORTFALL', () => {
    expect(exportShortfall('1200', csv(500), 'csv')).toEqual({
      promised: 1200,
      received: 500,
      short: true,
    })
  })

  it('a complete body is not', () => {
    expect(exportShortfall('1200', csv(1200), 'csv').short).toBe(false)
  })

  it('counts quoted newlines as data, not as row breaks', () => {
    const body = 'title,note\n"Smith, John","line one\nline two"\nb,c'
    expect(exportShortfall('2', body, 'csv')).toEqual({
      promised: 2,
      received: 2,
      short: false,
    })
  })

  it('a missing header is not evidence of truncation', () => {
    // Refusing a download because the server forgot its own bookkeeping
    // fails the user for nothing.
    expect(exportShortfall(null, csv(10), 'csv').short).toBe(false)
  })

  it('more rows than promised is not short — the count is a snapshot', () => {
    expect(exportShortfall('10', csv(12), 'csv').short).toBe(false)
  })

  it('a JSON body that is not an array at all is short', () => {
    expect(exportShortfall('5', 'not json', 'json')).toEqual({
      promised: 5,
      received: 0,
      short: true,
    })
    expect(exportShortfall('5', '[{},{}]', 'json').short).toBe(true)
    expect(exportShortfall('2', '[{},{}]', 'json').short).toBe(false)
  })
})
