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

const mockVerifyIdToken = jest.fn()

const state: {
  reports: Record<string, Record<string, unknown>>
  audit: Record<string, unknown>[]
  lastQuery: { where?: [string, string, unknown]; order?: string; limit?: number }
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
    get: async () => ({ docs: [] }),
    doc: (id: string) => docHandle(id),
  })
  return build()
}

const listing = () => {
  const build = () => ({
    orderBy: (field: string) => {
      state.lastQuery.order = field
      return build()
    },
    limit: (count: number) => {
      state.lastQuery.limit = count
      return build()
    },
    where: (field: string, op: string, value: unknown) => {
      state.lastQuery.where = [field, op, value]
      return build()
    },
    select: () => build(),
    get: async () => {
      const rows = Object.entries(state.reports).filter(([, data]) =>
        state.lastQuery.where
          ? data[state.lastQuery.where[0]] === state.lastQuery.where[2]
          : true,
      )
      return { docs: rows.map(([id, data]) => ({ id, data: () => data })) }
    },
  })
  return build()
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
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
    email: 'zach@aglyn.com',
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

describe('the listing', () => {
  it('surfaces the open urgent count and says when it is only a page', async () => {
    asSuper()
    const body = await (await get()).json()
    expect(body.openUrgent).toBe(1)
    // Two rows, both open; only the phishing one is urgent (`dmca` is high).
    expect(body.count).toBe(2)
    expect(body.truncated).toBe(false)
  })

  it('filters by status, and ignores a status that is not one of ours', async () => {
    asSuper()
    state.reports[REPORT_ID].status = 'actioned'

    const filtered = await (await get('?status=actioned')).json()
    expect(state.lastQuery.where).toEqual(['status', '==', 'actioned'])
    expect(filtered.reports.map((row: any) => row.id)).toEqual([REPORT_ID])

    // A junk filter must fall back to the whole queue rather than composing a
    // `where status == 'nonsense'` that quietly returns nothing — an empty
    // abuse queue is the most reassuring wrong answer this page can give.
    state.lastQuery = {}
    const unfiltered = await (await get('?status=nonsense')).json()
    expect(state.lastQuery.where).toBeUndefined()
    expect(unfiltered.count).toBe(2)
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
    expect(row.actorEmail).toBe('zach@aglyn.com')
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
