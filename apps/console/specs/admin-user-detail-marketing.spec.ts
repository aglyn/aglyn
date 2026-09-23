/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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

// This spec has no imports (everything arrives via jest.mock factories and
// globals), so without an export TypeScript treats it as a GLOBAL SCRIPT and
// its top-level consts collide with sibling module specs (TS2451, AGL-1841).
export {}

/**
 * /api/admin/users/detail — product-email consent (AGL-3292), driven
 * in-process with the same doubles as the phone disclosure spec.
 *
 * Two halves that nothing keeps in step, and the staff page needs both:
 *
 *  1. **`answer` is the person's own document** — what they said, which door
 *     and when. It is read off `users/{uid}`, the document the console shows
 *     them, and never off the CRM.
 *  2. **`reach` is the sender's view, passed through untouched.** It comes
 *     from `readPlatformMarketingReach`, asked about the account's primary
 *     address, and the route must not reinterpret it: a route that turned
 *     `unreadable` into "no consent" would put a claim about a person on the
 *     page that no read supports.
 */

let mockReach: Record<string, unknown> = { status: 'unconfigured' }
let mockReachAskedFor: unknown[] = []
jest.mock('@aglyn/tenant-data-admin/server/platform-marketing-consent', () => ({
  __esModule: true,
  readPlatformMarketingReach: async (input: { email: unknown }) => {
    mockReachAskedFor.push(input.email)
    return mockReach
  },
}))

let mockProfile: Record<string, unknown> | undefined
let mockAuthPhone: string | undefined
/** Every Firestore write attempted, so "a GET writes nothing" is provable. */
let mockWrites: string[] = []
let mockSuppression: Record<string, unknown> | null = null
let mockSuppressionThrows = false
let mockSuppressionCalls: string[] = []
const mockDecodedToken: Record<string, unknown> = {}

const emptyQuery = {
  docs: [] as unknown[],
}

const mockFirestore = {
  collection: (collection: string) => ({
    add: async () => {
      mockWrites.push(`${collection}/<generated>`)
      return { id: 'x' }
    },
    /*
      The audit halves are `where(...).orderBy('at', 'desc').limit(10)` since
      AGL-2501 — an unordered `limit()` answered ten arbitrary entries and the
      route then sorted that sample newest-first. A stub that stops at `limit`
      throws on the `orderBy` before it, and the route's 500 reads as a phone
      bug rather than a missing double.
    */
    where: () => ({
      limit: () => ({ get: async () => emptyQuery }),
      orderBy: () => ({ limit: () => ({ get: async () => emptyQuery }) }),
    }),
    doc: (id: string) => ({
      get: async () => ({
        exists: mockProfile !== undefined,
        data: () => mockProfile,
        get: (field: string) => mockProfile?.[field],
      }),
      set: async () => {
        mockWrites.push(`${collection}/${id}`)
      },
      collection: () => ({
        limit: () => ({ get: async () => emptyQuery }),
      }),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
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
      // Deliberately DIFFERENT from the profile's number: this is the field
      // the route must NOT project.
      phoneNumber: mockAuthPhone,
      photoURL: null,
      providerData: [],
      disabled: false,
      customClaims: {},
      metadata: { creationTime: null, lastSignInTime: null },
    },
  }),
  getContactSuppression: async (phoneNumber: string) => {
    mockSuppressionCalls.push(phoneNumber)
    if (mockSuppressionThrows) throw new Error('rules denied')
    return mockSuppression
  },
  // AGL-2316 added a second compliance read to this route. A wholesale
  // `jest.mock` is a CLOSED WORLD: every export the route reaches has to be
  // here, or the call throws and the route's own failure branch quietly
  // absorbs it. Stubbed rather than exercised — `admin-user-detail-legal.spec.ts`
  // is where the acceptance projection is actually asserted.
  getLegalAcceptanceStatus: async () => ({
    currentVersion: 'v6',
    accepted: true,
    acceptedVersions: ['v6'],
    latestAcceptedVersion: 'v6',
    currentVersionAcceptedAt: '2026-08-18T00:00:00.000Z',
    reacceptanceRequired: false,
    reacceptanceReason: 'none',
    arbitration: {
      firstAcceptedAt: '2026-08-18T00:00:00.000Z',
      deadline: '2026-09-17T00:00:00.000Z',
      open: true,
      daysRemaining: 30,
    },
    acceptances: [],
  }),
}))

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

beforeEach(() => {
  mockProfile = {}
  mockAuthPhone = undefined
  mockWrites = []
  mockSuppression = null
  mockSuppressionThrows = false
  mockSuppressionCalls = []
  mockReach = { status: 'unconfigured' }
  mockReachAskedFor = []
  Object.assign(mockDecodedToken, {
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
  })
})

describe('AGL-3292 · product-email consent on the staff user page', () => {
  it('reads the answer off the person’s own document', async () => {
    mockProfile = {
      marketingConsent: true,
      marketingConsentAtMs: Date.UTC(2026, 8, 20, 12),
      marketingConsentSource: {
        kind: 'console-prompt',
        by: 'member-uid',
        atMs: Date.UTC(2026, 8, 20, 12),
        actor: 'person',
        textVersion: '2026-09-20',
      },
    }
    const payload = await detail()
    expect(payload.marketing.answer).toEqual({
      decision: 'granted',
      atMs: Date.UTC(2026, 8, 20, 12),
      textVersion: '2026-09-20',
      sourceKind: 'console-prompt',
      promptDismissedAtMs: null,
    })
  })

  it('reports an unanswered prompt as no decision, with the dismissal', async () => {
    mockProfile = { marketingConsentPromptDismissedAtMs: Date.UTC(2026, 8, 21) }
    const payload = await detail()
    expect(payload.marketing.answer).toMatchObject({
      decision: null,
      promptDismissedAtMs: Date.UTC(2026, 8, 21),
    })
  })

  it('asks the sender’s reader about the primary address and passes its answer through', async () => {
    mockReach = {
      status: 'read',
      hostId: 'host-marketing',
      orgId: 'org-operator',
      orgSlug: 'aglyn-org',
      contactId: 'contact-1',
      basis: 'granted',
      basisAtMs: 1,
      assertedBy: 'person',
      basisKind: 'console-signup',
      verdict: 'consented',
      reason: 'granted',
      suppression: { list: 'site', reason: 'unsubscribe' },
    }
    const payload = await detail()
    expect(mockReachAskedFor).toEqual(['member@customer.example'])
    expect(payload.marketing.reach).toEqual(mockReach)
  })

  it('never turns an unreadable CRM into an answer', async () => {
    mockReach = { status: 'unreadable', hostId: 'host-marketing' }
    const payload = await detail()
    expect(payload.marketing.reach).toEqual({
      status: 'unreadable',
      hostId: 'host-marketing',
    })
  })

  it('writes nothing', async () => {
    await detail()
    expect(mockWrites).toEqual([])
  })
})
