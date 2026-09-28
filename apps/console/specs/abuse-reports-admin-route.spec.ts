/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * The staff end of the abuse queue (AGL-1964).
 *
 * AGL-1964 is only closed if a report actually reaches a human. The tenant
 * spec proves a stranger can file one; this proves staff can read it, that the
 * people who should not read it cannot, and that acting on one leaves a
 * record.
 *
 * The redaction tier is the interesting property. A report can carry the
 * reporter's email and — on a DMCA notice, because §512(c)(3) demands a
 * signature — their real legal name. We hold identity we did not choose to
 * collect, so the read-only `support` tier triages without it. The test that
 * matters is not that `support` sees `null`; it is that `support` can still
 * tell an ANONYMOUS report apart from a REDACTED one, because only the first
 * means there is nobody to reply to.
 */

const mockDecideHeldOutboundSend = jest.fn(async (..._args: unknown[]) => 'released')
const mockVerifyIdToken = jest.fn()

const state: {
  reports: Record<string, Record<string, unknown>>
  audit: Record<string, unknown>[]
  lastQuery: {
    wheres?: Array<[string, string, unknown]>
    order?: string
    limit?: number
    counted?: boolean
  }
} = { reports: {}, audit: [], lastQuery: {} }

const stamp = (millis: number) => ({ toMillis: () => millis })

const docHandle = (id: string) => ({
  get: async () => {
    const data = state.reports[id]
    return {
      exists: data != null,
      id,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, unknown>, options?: { merge?: boolean }) => {
    const base = options?.merge ? (state.reports[id] ?? {}) : {}
    state.reports[id] = { ...base, ...patch }
  },
  /**
   * Subcollections, for the AGL-1983 strike ledger at
   * `orgs/{orgId}/dmcaStrikes`.
   *
   * Empty in this file, deliberately: these tests are about the AGL-1964
   * queue — auth, redaction, the audit row — and none of them seeds a strike.
   * What the double has to do is EXIST, so the route's ledger read returns
   * nothing rather than throwing and turning every assertion here into a 500.
   * The ledger's own behaviour is proved in `dmca-counter-notice-admin.spec`,
   * against a double that models paths properly.
   */
  collection: () => emptyListing(),
})

/** A listing over nothing, for the collections this file does not seed. */
const emptyListing = () => {
  const build = (): any => ({
    orderBy: () => build(),
    limit: () => build(),
    where: () => build(),
    select: () => build(),
    startAfter: () => build(),
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    get: async () => ({ docs: [] }),
    doc: (id: string) => docHandle(id),
  })
  return build()
}

/**
 * The reports, queried: `==` and `in` predicates, the `updatedAt` order the
 * list pages in, a document cursor and a limit — the shapes the route's plan
 * (`runStaffListQuery`) and its summary counts put on the query. Every
 * predicate is recorded, so a test can see what reached the query.
 */
const listing = () => {
  const build = (query: {
    wheres: Array<[string, string, unknown]>
    after?: string
    limit?: number
  }): any => {
    const rows = () => {
      const matched = Object.entries(state.reports)
        .filter(([, data]) =>
          query.wheres.every(([field, op, value]) =>
            op === 'in'
              ? (value as unknown[]).includes(data[field])
              : data[field] === value,
          ),
        )
        .sort(
          ([, a], [, b]) =>
            ((b['updatedAt'] as any)?.toMillis?.() ?? 0) -
            ((a['updatedAt'] as any)?.toMillis?.() ?? 0),
        )
      const from = query.after
        ? matched.findIndex(([id]) => id === query.after) + 1
        : 0
      const page = matched.slice(from)
      return query.limit == null ? page : page.slice(0, query.limit)
    }
    return {
      orderBy: (field: string) => {
        state.lastQuery.order = field
        return build(query)
      },
      limit: (count: number) => {
        state.lastQuery.limit = count
        return build({ ...query, limit: count })
      },
      where: (field: string, op: string, value: unknown) => {
        const wheres = [...query.wheres, [field, op, value] as [string, string, unknown]]
        state.lastQuery.wheres = wheres
        return build({ ...query, wheres })
      },
      startAfter: (snapshot: { id: string }) => build({ ...query, after: snapshot.id }),
      select: () => build(query),
      count: () => ({
        get: async () => {
          state.lastQuery.counted = true
          return { data: () => ({ count: rows().length }) }
        },
      }),
      get: async () => ({
        docs: rows().map(([id, data]) => ({
          id,
          data: () => data,
          get: (field: string) => data[field],
          ref: { path: `abuseReports/${id}` },
        })),
      }),
    }
  }
  return build({ wheres: [] })
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        // The list cursor is a document path, read back to start after it.
        doc: (path: string) => docHandle(path.split('/').pop() as string),
        collection: (name: string) => {
          if (name === 'adminAudit') {
            return {
              add: async (row: Record<string, unknown>) => {
                state.audit.push(row)
                return { id: `audit-${state.audit.length}` }
              },
            }
          }
          // Only `abuseReports` is backed by `state.reports`. Before AGL-1983
          // this double answered every collection with the reports, which was
          // harmless while the route read one — but the route now also lists
          // `dmcaCounterNotices` and reads `hosts`, and a double that handed
          // those back the reports would have the queue rendering abuse rows
          // as counter-notices.
          if (name !== 'abuseReports') return emptyListing()
          return Object.assign(listing(), { doc: (id: string) => docHandle(id) })
        },
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  // The held-send decision (AGL-3356) is proven against its own store in
  // `tenant-data-admin`; here the route's contract with it is what is asked.
  decideHeldOutboundSend: (...args: unknown[]) => mockDecideHeldOutboundSend(...args),
}))

// The REAL catalog and status helpers are spread in below — stubbing them
// would make this file assert that a mock agreed with itself.
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/abuse-report'),
  // The §512 halves the route grew in AGL-1983. Spread in for the same reason
  // the catalog above is: a stub would make this file assert that a mock
  // agreed with itself about a statutory deadline.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/dmca-counter-notice',
  ),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/repeat-infringer'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { GET, POST } from '../app/api/admin/abuse-reports/route'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => 'server-timestamp',
    // Removes a FIELD, not a document — the AGL-1983 cancel path clears a
    // host's scheduled `suspendedUntilMs`. See the deletion guard below.
    delete: () => 'field-deleted',
  },
}))

const REPORT_ID = 'a'.repeat(40)
const DMCA_ID = 'b'.repeat(40)

const get = (search = '', token = 'staff-token') =>
  GET(
    new Request(`https://console.aglyn.com/api/admin/abuse-reports${search}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  )

const post = (body: Record<string, unknown>, token = 'staff-token') =>
  POST(
    new Request('https://console.aglyn.com/api/admin/abuse-reports', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )

const asSuper = () =>
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })

const asSupport = () =>
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-2',
    email: 'support@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'support',
  })

beforeEach(() => {
  state.reports = {
    [REPORT_ID]: {
      reference: 'AR-AAAAAAAAAA',
      status: 'open',
      category: 'phishing',
      url: 'https://evil.aglyn.app/signin',
      reportedHostname: 'evil.aglyn.app',
      hostId: 'host-evil',
      orgId: 'org-9',
      details: 'Copies a bank sign-in page.',
      reporterEmail: 'fraud@bank.example',
      reporterName: 'Fraud Desk',
      reportCount: 2,
      createdAt: stamp(1000),
      updatedAt: stamp(2000),
      dmca: null,
    },
    [DMCA_ID]: {
      reference: 'AR-BBBBBBBBBB',
      status: 'open',
      category: 'dmca',
      url: 'https://copycat.aglyn.app/gallery',
      details: 'Photographs republished without a licence.',
      // No reporter email on purpose: this row is the ANONYMOUS control that
      // makes the redaction test able to fail.
      reporterEmail: null,
      reporterName: null,
      reportCount: 1,
      createdAt: stamp(1000),
      updatedAt: stamp(1500),
      dmca: {
        work: 'Photograph "Harbour at Dawn"',
        signature: 'Dana Reyes',
        goodFaith: true,
        underPenalty: true,
      },
    },
  }
  state.audit = []
  state.lastQuery = {}
  mockVerifyIdToken.mockReset()
})

describe('only staff reach the queue', () => {
  it('401s without a bearer token', async () => {
    const response = await GET(
      new Request('https://console.aglyn.com/api/admin/abuse-reports'),
    )
    expect(response.status).toBe(401)
  })

  it('403s a signed-in customer', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-1',
      email_verified: true,
    })
    expect((await get()).status).toBe(403)
  })

  it('403s an unverified staff email', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: false,
      staff: true,
      staffRole: 'super',
    })
    expect((await get()).status).toBe(403)
  })

  it('treats a missing staffRole claim as support, not super', async () => {
    // Failing OPEN here would hand the reporter-identity fields to any staff
    // token that predates the RBAC claim.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-3',
      email: 'old@aglyn.com',
      email_verified: true,
      staff: true,
    })
    const body = await (await get()).json()
    expect(body.actorRole).toBe('support')
    expect(body.identityVisible).toBe(false)
  })
})

describe('the reporter’s identity is a super-tier fact', () => {
  it('gives super staff the reporter, so a counter-notice can be answered', async () => {
    asSuper()
    const body = await (await get()).json()
    const phishing = body.reports.find((row: any) => row.id === REPORT_ID)
    expect(body.identityVisible).toBe(true)
    expect(phishing.reporterEmail).toBe('fraud@bank.example')
    expect(phishing.reporterName).toBe('Fraud Desk')
    const dmca = body.reports.find((row: any) => row.id === DMCA_ID)
    // The signature IS the reporter's legal name, so it follows identity
    // rather than travelling with the rest of the notice.
    expect(dmca.dmca.signature).toBe('Dana Reyes')
  })

  it('withholds it from the support tier without hiding that it exists', async () => {
    asSupport()
    const body = await (await get()).json()
    const phishing = body.reports.find((row: any) => row.id === REPORT_ID)
    const dmca = body.reports.find((row: any) => row.id === DMCA_ID)

    expect(body.identityVisible).toBe(false)
    expect(phishing.reporterEmail).toBeNull()
    expect(phishing.reporterName).toBeNull()
    expect(dmca.dmca.signature).toBeNull()

    // The property that makes the redaction usable rather than confusing: a
    // support operator can still tell "somebody filed this and I am not
    // cleared to see who" from "nobody left a way to reply". Without this
    // pair, both rows look identical and the second fact is lost.
    expect(phishing.hasReporterContact).toBe(true)
    expect(dmca.hasReporterContact).toBe(false)

    // Redaction has to be real, not a UI convention: the address must not be
    // anywhere in the payload the browser receives.
    expect(JSON.stringify(body)).not.toContain('fraud@bank.example')
    expect(JSON.stringify(body)).not.toContain('Dana Reyes')
  })

  /**
   * AGL-2400 — and whether the reporter got their copy.
   *
   * `receiptStatus` is written by the tenant intake after it tries to mail the
   * reference, and this route is the only reader. It has to survive the
   * redaction tier for the same reason `hasReporterContact` does: "this person
   * is holding nothing" is triage information at every tier, and a support
   * operator who can see the failure can escalate it to someone who can see
   * the address. Redacting it would hide the WORK rather than the identity.
   */
  it('shows a failed receipt to the support tier, address redacted or not', async () => {
    state.reports[REPORT_ID].receiptStatus = 'failed'
    state.reports[REPORT_ID].receiptReason = 'rejected'
    state.reports[REPORT_ID].receiptAttemptedAtMs = 4000
    asSupport()
    const body = await (await get()).json()
    const phishing = body.reports.find((row: any) => row.id === REPORT_ID)
    expect(body.identityVisible).toBe(false)
    expect(phishing.reporterEmail).toBeNull()
    // The failure and its reason survive the redaction; the address does not.
    expect(phishing.receiptStatus).toBe('failed')
    expect(phishing.receiptReason).toBe('rejected')
    expect(phishing.receiptAttemptedAtMs).toBe(4000)
  })

  it('reports an unrecorded receipt as UNKNOWN, and counts it as nothing', async () => {
    // Both fixture rows predate the record, which is what every report filed
    // before AGL-2400 looks like. They may well have been acknowledged —
    // nothing measured it — so the queue must invent neither answer, and above
    // all must not open the day this deploys with a page of imaginary work.
    asSuper()
    const body = await (await get()).json()
    for (const row of body.reports) expect(row.receiptStatus).toBeNull()
  })

  it('does not count a SENT receipt, or a status it does not recognise', async () => {
    state.reports[REPORT_ID].receiptStatus = 'sent'
    // A value from a future writer, or a corrupted row, degrades to UNKNOWN
    // rather than reaching a page whose three branches would then not be
    // exhaustive.
    state.reports[DMCA_ID].receiptStatus = 'queued'
    asSuper()
    const body = await (await get()).json()
    const phishing = body.reports.find((row: any) => row.id === REPORT_ID)
    const dmca = body.reports.find((row: any) => row.id === DMCA_ID)
    expect(phishing.receiptStatus).toBe('sent')
    expect(dmca.receiptStatus).toBeNull()
  })

  it('never redacts what the queue is actually triaged on', async () => {
    asSupport()
    const body = await (await get()).json()
    const phishing = body.reports.find((row: any) => row.id === REPORT_ID)
    // A redaction that took the URL or the severity with it would leave the
    // support tier unable to do the job the tier exists for.
    expect(phishing.url).toBe('https://evil.aglyn.app/signin')
    expect(phishing.severity).toBe('urgent')
    expect(phishing.categoryLabel).toBe('Phishing or fraud')
    expect(phishing.hostId).toBe('host-evil')
    expect(phishing.details).toContain('bank sign-in')
  })
})

const filters = (clauses: Array<{ field: string; op: string; value: string }>) =>
  `filters=${encodeURIComponent(JSON.stringify(clauses))}`

describe('the listing', () => {
  it('counts the open urgent backlog across the whole queue, not a page', async () => {
    asSuper()
    const body = await (await get('?view=summary')).json()
    // Two rows, both open; only the phishing one is urgent (`dmca` is high).
    expect(body.openUrgent).toBe(1)
    expect(state.lastQuery.counted).toBe(true)
    expect(state.lastQuery.wheres).toEqual([
      ['status', '==', 'open'],
      ['category', 'in', ['phishing', 'csam', 'malware']],
    ])
    expect(body.actorRole).toBe('super')
  })

  it('filters by status and category on the query, not over a page', async () => {
    asSuper()
    state.reports[REPORT_ID].status = 'actioned'

    const filtered = await (
      await get(`?${filters([{ field: 'status', op: 'equals', value: 'actioned' }])}`)
    ).json()
    expect(state.lastQuery.wheres).toEqual([['status', '==', 'actioned']])
    expect(state.lastQuery.order).toBe('updatedAt')
    expect(filtered.reports.map((row: any) => row.id)).toEqual([REPORT_ID])
    expect(filtered.refused).toEqual([])

    const both = await (
      await get(
        `?${filters([
          { field: 'status', op: 'isAnyOf', value: 'open,actioned' },
          { field: 'category', op: 'equals', value: 'dmca' },
        ])}`,
      )
    ).json()
    expect(state.lastQuery.wheres).toEqual([
      ['status', 'in', ['open', 'actioned']],
      ['category', '==', 'dmca'],
    ])
    expect(both.reports.map((row: any) => row.id)).toEqual([DMCA_ID])
  })

  it('refuses by name a clause the query cannot hold, and applies none of it', async () => {
    asSuper()
    // A junk filter must not compose a predicate that quietly returns
    // nothing — an empty abuse queue is the most reassuring wrong answer
    // this page can give — nor vanish while its chip says it applied.
    const body = await (
      await get(`?${filters([{ field: 'status', op: 'startsWith', value: 'act' }])}`)
    ).json()
    expect(state.lastQuery.wheres).toBeUndefined()
    expect(body.reports).toHaveLength(2)
    expect(body.refused).toHaveLength(1)
    expect(body.refused[0].clause).toEqual({ field: 'status', op: 'startsWith', value: 'act' })

    expect((await get('?filters=not-json')).status).toBe(400)
  })

  it('pages the whole queue by a cursor in its own order', async () => {
    asSuper()
    const first = await (await get('?pageSize=1')).json()
    // Newest update first: the phishing row was updated last.
    expect(first.reports.map((row: any) => row.id)).toEqual([REPORT_ID])
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBe(`abuseReports/${REPORT_ID}`)

    const second = await (
      await get(`?pageSize=1&cursor=${encodeURIComponent(first.nextCursor)}`)
    ).json()
    expect(second.reports.map((row: any) => row.id)).toEqual([DMCA_ID])
    expect(second.hasMore).toBe(false)
    expect(second.nextCursor).toBeNull()
  })
})

describe('acting on a report leaves a record', () => {
  it('writes an adminAudit row naming the actor, the change and the URL', async () => {
    asSuper()
    const response = await post({
      id: REPORT_ID,
      status: 'actioned',
      resolution: 'Host suspended at host scope. Notice #4417.',
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.confirmed).toBe(true)
    expect(body.report.status).toBe('actioned')

    expect(state.audit).toHaveLength(1)
    const row = state.audit[0]
    expect(row.action).toBe('abuseReport.actioned')
    expect(row.actorUid).toBe('staff-1')
    expect(row.actorEmail).toBe('staff@aglyn.com')
    expect((row.before as any).status).toBe('open')
    expect((row.after as any).status).toBe('actioned')
    // The reported URL rides the row, because a year later it is the only
    // thing that makes the row mean anything.
    expect(row.reason).toBe('https://evil.aglyn.app/signin')
    expect(row.note).toContain('Notice #4417')
  })

  it('refuses to close a report with no note', async () => {
    asSuper()
    for (const status of ['actioned', 'dismissed']) {
      const response = await post({ id: REPORT_ID, status })
      expect(response.status).toBe(400)
      // Nothing moved and nothing was audited — a rejected close must not
      // leave a half-applied state.
      expect(state.reports[REPORT_ID].status).toBe('open')
      expect(state.audit).toHaveLength(0)
    }
  })

  it('allows an intermediate status without a note', async () => {
    // Picking a report up is not a decision, so demanding prose for it would
    // just train operators to type a full stop.
    asSuper()
    const response = await post({ id: REPORT_ID, status: 'reviewing' })
    expect(response.status).toBe(200)
    expect(state.reports[REPORT_ID].status).toBe('reviewing')
    expect(state.reports[REPORT_ID].resolvedAt).toBeNull()
  })

  it('rejects an unknown status and a malformed id', async () => {
    asSuper()
    expect((await post({ id: REPORT_ID, status: 'closed' })).status).toBe(400)
    expect((await post({ id: 'not-a-hash', status: 'reviewing' })).status).toBe(400)
    expect(
      (await post({ id: 'f'.repeat(40), status: 'reviewing' })).status,
    ).toBe(404)
    expect(state.audit).toHaveLength(0)
  })

  it('never renders the reported URL as a live link', async () => {
    // The single most dangerous thing on this page. Every row holds an
    // attacker-controlled address for a page we have been TOLD is phishing or
    // serving malware, and it is displayed to the one browser session on the
    // platform that can suspend any site and read any workspace. One
    // absent-minded click is the worst outcome available here.
    //
    // A source assertion rather than a render test, deliberately: the risk is
    // that somebody later makes it clickable because it looks obviously
    // useful, and this is what says no in their diff.
    const page: string = jest.requireActual('node:fs').readFileSync(
      require.resolve('../app/(app)/admin/abuse-reports/page'),
      'utf8',
    )
    // No `href` anywhere in the file may be built from a report's URL field.
    expect(page).not.toMatch(/href=\{[^}]*\breport\.url/)
    expect(page).not.toMatch(/href=\{[^}]*\brow\.url/)
    // …and no bare anchor is opened in a new tab with report data either.
    expect(page).not.toMatch(/<a\s[^>]*href=\{[^}]*url/)
  })

  it('offers no way to delete a report', async () => {
    // A queue whose rows can be removed cannot answer "did we know, and
    // when" — the question that matters if a *.aglyn.app block is ever
    // argued about. `dismissed` is a status, not a deletion.
    const route = jest.requireActual('node:fs').readFileSync(
      require.resolve('../app/api/admin/abuse-reports/route'),
      'utf8',
    )
    /**
     * Narrowed in AGL-1983, and narrowed rather than dropped.
     *
     * The invariant is that no DOCUMENT is ever removed. The original
     * assertion enforced it by banning the substring `.delete(` outright,
     * which was exact while the route had no other use for the word — and
     * became wrong the moment the §512(g) cancel path needed
     * `FieldValue.delete()` to clear a host's scheduled `suspendedUntilMs`.
     * That removes a FIELD from a host document; it deletes nothing, and the
     * host row it touches is not in this queue at all.
     *
     * So `FieldValue.delete()` is stripped first and the ban stands over what
     * is left. A `ref.delete()`, a `doc(id).delete()` or a bulk writer's
     * delete still goes red — verified by mutation, not assumed.
     */
    const withoutFieldDeletes = route.replace(/FieldValue\.delete\s*\(\s*\)/g, '')
    expect(withoutFieldDeletes).not.toMatch(/\.delete\s*\(/)
    expect(route).not.toMatch(/export const DELETE/)
  })
})

describe('a send the phishing screen held (AGL-3356)', () => {
  const HELD_ID = 'c'.repeat(40)
  beforeEach(() => {
    mockDecideHeldOutboundSend.mockClear()
    state.reports[HELD_ID] = {
      reference: 'HS-CCCCCCCCCC',
      status: 'open',
      category: 'phishing',
      severity: 'urgent',
      source: 'outbound-screen',
      url: 'https://poshmark.id63835663.shop/',
      reportedHostname: 'poshmark.id63835663.shop',
      hostId: 'host-evil',
      orgId: 'org-9',
      details: 'Held workflow email step.',
      reporterEmail: null,
      reporterName: null,
      reportCount: 23,
      createdAt: stamp(1000),
      updatedAt: stamp(2000),
      dmca: null,
      heldSend: {
        kind: 'workflow',
        path: 'hosts/host-evil/workflows/wf-1',
        subject: 'Poshmark Order',
        state: 'held',
        ageDays: 2,
        heldAtMs: 1000,
        signals: [
          { code: 'lookalike-link', brand: 'poshmark', host: 'poshmark.id63835663.shop' },
        ],
      },
    }
  })

  it('shows staff what was held and why', async () => {
    asSupport()
    const body = await (await get()).json()
    const row = body.reports.find((report: any) => report.id === HELD_ID)
    expect(row.source).toBe('outbound-screen')
    expect(row.heldSend).toMatchObject({
      kind: 'workflow',
      subject: 'Poshmark Order',
      state: 'held',
      ageDays: 2,
    })
    expect(row.heldSend.reasons[0]).toContain('poshmark.id63835663.shop')
  })

  it('DISMISSING the row releases the send, and the audit row says so', async () => {
    asSuper()
    const response = await post({
      id: HELD_ID,
      status: 'dismissed',
      resolution: 'Real Poshmark reseller; verified by phone.',
    })
    expect(response.status).toBe(200)
    expect(mockDecideHeldOutboundSend).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: HELD_ID, decision: 'release', actorUid: 'staff-1' }),
    )
    expect((await response.json()).heldSend).toBe('released')
    expect((state.audit[0].after as any).heldSend).toBe('released')
  })

  it('ACTIONING the row rejects the send', async () => {
    asSuper()
    mockDecideHeldOutboundSend.mockResolvedValueOnce('rejected')
    await post({ id: HELD_ID, status: 'actioned', resolution: 'Phishing. Org locked.' })
    expect(mockDecideHeldOutboundSend).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: HELD_ID, decision: 'reject' }),
    )
  })

  it('leaves it held while the row is only being reviewed', async () => {
    asSuper()
    await post({ id: HELD_ID, status: 'reviewing' })
    expect(mockDecideHeldOutboundSend).not.toHaveBeenCalled()
  })

  it('decides nothing for an ordinary intake report', async () => {
    asSuper()
    await post({ id: REPORT_ID, status: 'dismissed', resolution: 'Not phishing.' })
    expect(mockDecideHeldOutboundSend).not.toHaveBeenCalled()
  })
})

describe('a Stripe fraud signal the billing webhook filed (AGL-3356)', () => {
  const SIGNAL_ID = 'd'.repeat(40)
  beforeEach(() => {
    state.reports[SIGNAL_ID] = {
      reference: 'PF-DDDDDDDDDD',
      status: 'open',
      category: 'phishing',
      severity: 'urgent',
      source: 'stripe-fraud-signal',
      url: null,
      reportedHostname: null,
      hostId: null,
      orgId: 'org-9',
      details: 'Early fraud warning from Stripe (issfr_1).',
      reporterEmail: null,
      reporterName: null,
      reportCount: 1,
      createdAt: stamp(1000),
      updatedAt: stamp(3000),
      dmca: null,
      paymentSignal: {
        kind: 'early-fraud-warning',
        stripeObjectId: 'issfr_1',
        chargeId: 'ch_1',
        paymentIntentId: null,
        amountCents: 5600,
        currency: 'usd',
        detail: 'unauthorized_use_of_card',
        livemode: true,
        subscriptionCard: '/admin/orgs/org-9#subscription',
        checks: { cvcCheck: 'unavailable', cardCountry: 'NL' },
      },
    }
  })

  it('hands the page the org, charge, amount, checks and the Subscription card link', async () => {
    asSupport()
    const body = await (await get()).json()
    const row = body.reports.find((report: any) => report.id === SIGNAL_ID)
    expect(row.source).toBe('stripe-fraud-signal')
    expect(row.orgId).toBe('org-9')
    expect(row.paymentSignal).toMatchObject({
      kind: 'early-fraud-warning',
      chargeId: 'ch_1',
      amountCents: 5600,
      currency: 'usd',
      subscriptionCard: '/admin/orgs/org-9#subscription',
      checks: { cvcCheck: 'unavailable', cardCountry: 'NL', riskLevel: null },
    })
    // Not a held send: closing it decides nothing about one.
    expect(row.heldSend).toBeNull()
  })
})
