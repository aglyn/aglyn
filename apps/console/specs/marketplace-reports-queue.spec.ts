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
 * EVERY MARKETPLACE REPORT REACHES A HUMAN (AGL-2310).
 *
 * `report.ts` has written `marketplaceReports` since the report button
 * shipped — `reason`, `reporterUid`, `listingName`, `publisherOrgId`,
 * `targetType`, `status: 'open'` — and NOTHING read it. No collection group,
 * no admin surface, no cron. The Firestore rules grant staff read, but rules
 * are not a reader. Every report a user filed was stored, acknowledged, and
 * unreachable; nothing ever moved one off `open`, because no queue showed it.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - EACH REPORT'S OWN REASON. Two reports with different text, and each must
 *    arrive carrying its own. A queue that listed rows and truncated the
 *    reason into a label is the original silence with an extra click in it.
 *  - THE STATUS CHANGE IS WHAT THE QUEUE WRITES BACK. The document has to
 *    move, and an `adminAudit` row has to carry BOTH statuses — a row saying
 *    only "someone set this to dismissed" cannot answer what it was before or
 *    who decided.
 *  - CLOSING NEEDS A NOTE. The abuse queue's rule for the abuse queue's
 *    reason: "actioned" with no note is the row nobody can defend later.
 *  - REDACTION BY TIER, and the distinction that matters — `support` must
 *    still be able to tell a report with somebody behind it from one without.
 *
 * The writer half — that the stored `reason` is the reporter's own words and
 * not a constant — is guarded in
 * `libs/plugins/marketplace/src/lib/server/report-reaches-the-queue.spec.ts`.
 * It cannot live here: nx `depConstraints` forbid `scope:app` importing an
 * `aglyn:addons` lib.
 */

const mockVerifyIdToken = jest.fn()

const state: {
  reports: Record<string, Record<string, unknown>>
  audit: Record<string, unknown>[]
} = { reports: {}, audit: [] }

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
})

const listing = (): any => ({
  orderBy: () => listing(),
  limit: () => listing(),
  get: async () => ({
    docs: Object.entries(state.reports).map(([id, data]) => ({
      id,
      data: () => data,
      get: (field: string) => data[field],
    })),
  }),
  doc: (id: string) => docHandle(id),
})

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
          return listing()
        },
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

// The REAL status vocabulary is spread in. A stubbed status list would make
// this file assert that a mock agreed with itself about what "actioned" is.
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/abuse-report'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    body: await request
      .clone()
      .json()
      .catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { GET, POST } from '../app/api/admin/marketplace-reports/route'

const PHISHING = 'a'.repeat(40)
const SPAM = 'b'.repeat(40)

/** The two reasons. Different on purpose — see the file header. */
const PHISHING_REASON =
  'The install steps tell you to paste your API key into their site.'
const SPAM_REASON = 'Five near-identical listings from the same publisher.'

const get = (search = '') =>
  GET(
    new Request(
      `https://console.aglyn.com/api/admin/marketplace-reports${search}`,
      { headers: { authorization: 'Bearer staff-token' } },
    ),
  )

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://console.aglyn.com/api/admin/marketplace-reports', {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-token',
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
    [PHISHING]: {
      targetType: 'listing',
      listingId: 'listing-1',
      listingName: 'Contact Form Pro',
      publisherOrgId: 'org-9',
      reporterUid: 'user-7',
      reason: PHISHING_REASON,
      status: 'open',
      createdAt: stamp(1000),
      updatedAt: stamp(2000),
    },
    [SPAM]: {
      targetType: 'review',
      listingId: 'listing-2',
      listingName: 'Gallery Grid',
      publisherOrgId: 'org-4',
      reviewUid: 'user-3',
      // NO reporter: the anonymous control that makes the redaction test able
      // to fail. `support` must tell this apart from a redacted one.
      reason: SPAM_REASON,
      status: 'open',
      createdAt: stamp(1000),
      updatedAt: stamp(1500),
    },
  }
  state.audit = []
  mockVerifyIdToken.mockReset()
  asSuper()
})

describe('only staff reach the queue', () => {
  it('401s without a bearer token', async () => {
    const response = await GET(
      new Request('https://console.aglyn.com/api/admin/marketplace-reports'),
    )
    expect(response.status).toBe(401)
  })

  it('403s a signed-in customer', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
    expect((await get()).status).toBe(403)
  })
})

describe('EACH REPORT ARRIVES WITH ITS OWN REASON', () => {
  it('carries both reports and both reasons, not one label', async () => {
    const body = await (await get()).json()
    const byId = Object.fromEntries(
      body.reports.map((row: any) => [row.id, row]),
    )
    // Two different sentences. A queue that dropped `reason`, truncated it to
    // a category, or reused the first row's text satisfies at most one line.
    expect(byId[PHISHING].reason).toBe(PHISHING_REASON)
    expect(byId[SPAM].reason).toBe(SPAM_REASON)
    // …and the context that makes a reason chaseable.
    expect(byId[PHISHING]).toMatchObject({
      listingName: 'Contact Form Pro',
      publisherOrgId: 'org-9',
      targetType: 'listing',
    })
    expect(byId[SPAM]).toMatchObject({
      listingName: 'Gallery Grid',
      targetType: 'review',
    })
  })

  it('filters by status without inventing an index', async () => {
    state.reports[SPAM]['status'] = 'dismissed'
    const open = await (await get('?status=open')).json()
    expect(open.reports.map((row: any) => row.id)).toEqual([PHISHING])
    const all = await (await get()).json()
    expect(all.reports).toHaveLength(2)
  })
})

describe('THE STATUS CHANGE IS WHAT THE QUEUE WRITES BACK', () => {
  it('moves the document and audits BOTH statuses', async () => {
    const response = await post({
      id: PHISHING,
      status: 'actioned',
      resolution: 'Listing unpublished; publisher emailed.',
    })
    expect(response.status).toBe(200)

    // The document actually moved — not merely a 200.
    expect(state.reports[PHISHING]).toMatchObject({
      status: 'actioned',
      resolution: 'Listing unpublished; publisher emailed.',
      resolvedByEmail: 'zach@aglyn.com',
    })
    // And the audit row can answer "from what, by whom" a year later.
    expect(state.audit).toHaveLength(1)
    expect(state.audit[0]).toMatchObject({
      action: 'marketplace-report-status',
      targetId: PHISHING,
      actorEmail: 'zach@aglyn.com',
      before: { status: 'open' },
      after: {
        status: 'actioned',
        resolution: 'Listing unpublished; publisher emailed.',
      },
    })
  })

  it('audits the status it actually came FROM, not always "open"', async () => {
    // A second transition on a row already moved. `before: { status: 'open' }`
    // hardcoded reads correctly on the first hop and lies on every one after.
    state.reports[PHISHING]['status'] = 'reviewing'
    await post({ id: PHISHING, status: 'dismissed', resolution: 'Not a breach.' })
    expect(state.audit[0]).toMatchObject({ before: { status: 'reviewing' } })
  })

  it('leaves the OTHER report alone', async () => {
    await post({ id: PHISHING, status: 'reviewing' })
    expect(state.reports[SPAM]['status']).toBe('open')
  })

  it('refuses to CLOSE without saying what was done', async () => {
    const response = await post({ id: PHISHING, status: 'actioned' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/say what you did/i)
    // Nothing moved, and nothing was audited — a refused transition that
    // still wrote an audit row would be a record of something that did not
    // happen.
    expect(state.reports[PHISHING]['status']).toBe('open')
    expect(state.audit).toHaveLength(0)
  })

  it('allows an IN-PROGRESS move with no note', async () => {
    // The positive control. "Reviewing" is a claim of attention, not a
    // verdict, and demanding prose for it would push people to skip the step.
    expect((await post({ id: PHISHING, status: 'reviewing' })).status).toBe(200)
    expect(state.reports[PHISHING]['status']).toBe('reviewing')
  })

  it('refuses a status outside the vocabulary', async () => {
    const response = await post({ id: PHISHING, status: 'ignored-forever' })
    expect(response.status).toBe(400)
    expect(state.reports[PHISHING]['status']).toBe('open')
  })

  it('404s an id that is not a report', async () => {
    const response = await post({ id: 'c'.repeat(40), status: 'reviewing' })
    expect(response.status).toBe(404)
  })
})

describe('the reporter’s account is a super-tier fact', () => {
  it('gives super staff the reporter', async () => {
    const body = await (await get()).json()
    const phishing = body.reports.find((row: any) => row.id === PHISHING)
    expect(body.identityVisible).toBe(true)
    expect(phishing.reporterUid).toBe('user-7')
  })

  it('withholds it from support — but still says one EXISTS', async () => {
    asSupport()
    const body = await (await get()).json()
    const byId = Object.fromEntries(
      body.reports.map((row: any) => [row.id, row]),
    )
    expect(body.identityVisible).toBe(false)
    expect(byId[PHISHING].reporterUid).toBeNull()
    // The distinction that matters: redacted is not the same as anonymous,
    // and only the second means there is nobody to follow up with.
    expect(byId[PHISHING].reporterKnown).toBe(true)
    expect(byId[SPAM].reporterKnown).toBe(false)
    // The reason is never redacted — it IS the report.
    expect(byId[PHISHING].reason).toBe(PHISHING_REASON)
  })

  it('treats a missing staffRole claim as support, not super', async () => {
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
