/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's Response
 * helpers are unavailable.
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
 * `/api/admin/users/detail` — the acceptance history reaches the staff view
 * (AGL-2316).
 *
 * AGL-2316 states the obligation exactly: the guard must assert the **accepted
 * version and timestamp reach the staff view from the stored document**, not
 * that the collection is read. So this drives the REAL library reader against
 * a Firestore double holding real-shaped documents — a mocked
 * `getLegalAcceptanceStatus` would assert that the route forwards a fixture,
 * which is the same nothing the issue is about.
 *
 * The other property, and the one that matters at the moment a dispute is
 * actually being answered: a lookup that FAILED must not render as "no
 * acceptance on file". The two are opposite claims about the company's
 * evidence, and only one of them is safe to be wrong about.
 */

import { LEGAL_DOCUMENT_VERSION } from '../constants/legal-documents'

let mockAcceptances: Array<{ id: string; data: Record<string, unknown> }> = []
let mockAcceptancesThrow = false
const mockDecodedToken: Record<string, unknown> = {}

const emptyQuery = { docs: [] as unknown[] }

const mockFirestore = {
  collection: (collection: string) => ({
    // `orderBy` too: the audit halves order before they cap (AGL-2501), and a
    // stub that stops at `limit` throws before the route can answer.
    where: () => ({
      limit: () => ({ get: async () => emptyQuery }),
      orderBy: () => ({ limit: () => ({ get: async () => emptyQuery }) }),
    }),
    doc: (id: string) => ({
      get: async () => ({
        exists: true,
        data: () => ({}),
        get: () => undefined,
      }),
      collection: (sub: string) => ({
        // The memberships read on this route uses `.limit().get()`; the
        // acceptance read is a plain `.get()`. Both shapes have to exist or
        // the route throws somewhere other than where the test is looking.
        limit: () => ({ get: async () => emptyQuery }),
        get: async () => {
          if (sub !== 'legalAcceptances') return emptyQuery
          if (mockAcceptancesThrow) throw new Error('rules denied')
          return {
            docs: mockAcceptances.map((record) => ({
              id: record.id,
              get: (field: string) => record.data[field],
            })),
          }
        },
      }),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL reader and evaluator. Everything else on this route is stubbed,
  // but the code under test here is precisely the projection from a stored
  // document to a staff answer.
  const legal = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/legal-acceptance',
  )
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
        firestore: () => mockFirestore,
      }),
    },
    isImpersonationSession: () => false,
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    findUserByUidAcrossPools: async (uid: string) => ({
      tenantId: null,
      record: {
        uid,
        email: 'member@customer.example',
        displayName: 'A Member',
        photoURL: null,
        providerData: [],
        disabled: false,
        customClaims: {},
        metadata: { creationTime: null, lastSignInTime: null },
      },
    }),
    getContactSuppression: async () => null,
    getLegalAcceptanceStatus: legal.getLegalAcceptanceStatus,
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/admin/users/detail/route') as {
  GET: (request: Request) => Promise<Response>
}

async function detail(uid = 'member-uid'): Promise<any> {
  const response = await route.GET(
    new Request(
      `https://app.aglyn.com/api/admin/users/detail?uid=${encodeURIComponent(uid)}`,
      { headers: { authorization: 'Bearer staff-token' } },
    ),
  )
  expect(response.status).toBe(200)
  return response.json()
}

function stored(version: string, acceptedAt: string, extra = {}) {
  return {
    id: version,
    data: {
      version,
      method: 'clickwrap',
      context: 'signup-password',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      documents: [
        {
          key: 'terms',
          url: 'https://aglyn.com/legal/terms',
          sha256: 'a'.repeat(64),
          bytes: 35966,
        },
      ],
      acceptedAt: { toDate: () => new Date(acceptedAt) },
      ...extra,
    },
  }
}

beforeEach(() => {
  mockAcceptances = []
  mockAcceptancesThrow = false
  Object.assign(mockDecodedToken, {
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
  })
})

describe('AGL-2316 · the accepted version and timestamp reach the staff view', () => {
  it('projects them out of the STORED document', async () => {
    mockAcceptances = [stored(LEGAL_DOCUMENT_VERSION, '2026-08-18T12:00:00.000Z')]
    const payload = await detail()

    expect(payload.legal.lookupFailed).toBe(false)
    expect(payload.legal.accepted).toBe(true)
    expect(payload.legal.currentVersion).toBe(LEGAL_DOCUMENT_VERSION)
    expect(payload.legal.currentVersionAcceptedAt).toBe(
      '2026-08-18T12:00:00.000Z',
    )
    // The evidence itself, which is what a §18.5 claim is answered with — the
    // hash is what pins WHAT they were shown, not merely that they clicked.
    expect(payload.legal.acceptances).toHaveLength(1)
    expect(payload.legal.acceptances[0]).toMatchObject({
      version: LEGAL_DOCUMENT_VERSION,
      acceptedAt: '2026-08-18T12:00:00.000Z',
      context: 'signup-password',
      ipAddress: '203.0.113.7',
    })
    expect(payload.legal.acceptances[0].documents[0].sha256).toBe('a'.repeat(64))
  })

  it('answers the §18.5 window from the FIRST acceptance', async () => {
    mockAcceptances = [
      stored('v0', '2026-08-01T00:00:00.000Z'),
      stored(LEGAL_DOCUMENT_VERSION, '2026-08-18T12:00:00.000Z'),
    ]
    const payload = await detail()
    expect(payload.legal.arbitration.firstAcceptedAt).toBe(
      '2026-08-01T00:00:00.000Z',
    )
    expect(payload.legal.arbitration.deadline).toBe('2026-08-31T00:00:00.000Z')
    // Still additive: the older version is evidence of what was agreed then.
    // `v0` rather than `v1`: the snapshot set was collapsed back to v1 on
    // 2026-08-20, so `v1` IS the current version and a fixture using it no
    // longer models a SUPERSEDED acceptance — which is the whole case.
    expect(payload.legal.acceptedVersions).toEqual(['v0', LEGAL_DOCUMENT_VERSION])
  })

  it('flags an account whose accepted version has been superseded', async () => {
    mockAcceptances = [stored('v0', '2026-08-01T00:00:00.000Z')]
    const payload = await detail()
    expect(payload.legal.accepted).toBe(false)
    expect(payload.legal.reacceptanceRequired).toBe(true)
    expect(payload.legal.reacceptanceReason).toBe('version-superseded')
  })

  it('says "never accepted" for an account with no record, and measures no window', async () => {
    const payload = await detail()
    expect(payload.legal.reacceptanceReason).toBe('never-accepted')
    // Null, not false: there is no window, as opposed to a closed one.
    expect(payload.legal.arbitration.open).toBeNull()
  })
})

describe('AGL-2316 · an unreadable record is not an absent one', () => {
  it('reports the failure instead of an empty history', async () => {
    mockAcceptancesThrow = true
    const payload = await detail()
    expect(payload.legal.lookupFailed).toBe(true)
    // Every verdict withheld. Rendering `accepted: false` here would tell a
    // staff member the company holds no evidence, in the one conversation
    // where that claim costs the most.
    expect(payload.legal.accepted).toBeNull()
    expect(payload.legal.reacceptanceRequired).toBeNull()
    expect(payload.legal.arbitration).toBeNull()
  })

  it('still answers the rest of the page when the legal read fails', async () => {
    mockAcceptancesThrow = true
    const payload = await detail()
    expect(payload.user.uid).toBe('member-uid')
  })
})
