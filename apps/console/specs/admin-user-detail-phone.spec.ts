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
 * /api/admin/users/detail — the phone disclosure (AGL-1569), driven
 * in-process. Firestore, the auth-pool lookup and token verification are
 * mocked; the route's own projection runs for real.
 *
 * Four properties, each of which a plausible implementation breaks silently:
 *
 *  1. **It projects the PROFILE's phone, not the Auth record's.** They are
 *     different fields. `seedUserProfile` writes `users/{uid}.phoneNumber`;
 *     the Auth record's phone is phone-auth's, which nothing here populates.
 *     Reading the wrong one renders "—" for every account that actually has a
 *     number — the AGL-1569 gap, reintroduced while looking fixed. The
 *     fixture gives the two DIFFERENT values so only the right one passes.
 *  2. **The do-not-contact answer travels with the number.** The only stated
 *     purpose of this data (Privacy Policy v4 §11) is calling and texting
 *     about upsells and overdue bills, so the read that hands staff a
 *     dialable number is the read that must say whether they may use it.
 *  3. **The suppression lookup fails CLOSED**, in step with
 *     `isPhoneContactSuppressed`. A list we could not read never answers
 *     "go ahead".
 *  4. **A GET writes nothing.** No profile write, no `adminAudit` row — the
 *     read is currently unaudited, and this pins that a page view cannot
 *     mutate anything while that stays true.
 */

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
    where: () => ({
      limit: () => ({ get: async () => emptyQuery }),
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
}))

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

beforeEach(() => {
  mockProfile = { phoneNumber: '+15125550123' }
  mockAuthPhone = '+19995550000'
  mockWrites = []
  mockSuppression = null
  mockSuppressionThrows = false
  mockSuppressionCalls = []
  Object.assign(mockDecodedToken, {
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
  })
})

describe('AGL-1569 · which phone field reaches the staff surface', () => {
  it("projects the profile number, never the Auth record's phone-auth field", async () => {
    const payload = await detail()
    expect(payload.user.phoneNumber).toBe('+15125550123')
    // The trap: `record.phoneNumber` is a different field with a different
    // value, and reading it would look like a working feature.
    expect(payload.user.phoneNumber).not.toBe('+19995550000')
  })

  it('reports no number, and why, when the profile has none', async () => {
    mockProfile = { phoneNumberErasedAt: { toDate: () => new Date(0) } }
    const payload = await detail()
    expect(payload.user.phoneNumber).toBeNull()
    expect(payload.user.phoneNumberErasedAt).toBe('1970-01-01T00:00:00.000Z')
    // Nothing to dial means nothing to check — and no needless PII read.
    expect(payload.user.phoneContact).toBeNull()
    expect(mockSuppressionCalls).toHaveLength(0)
  })

  it('treats a blank stored value as no number', async () => {
    mockProfile = { phoneNumber: '   ' }
    const payload = await detail()
    expect(payload.user.phoneNumber).toBeNull()
    expect(payload.user.phoneContact).toBeNull()
  })

  it('still answers when the profile document does not exist at all', async () => {
    mockProfile = undefined
    const payload = await detail()
    expect(payload.user.phoneNumber).toBeNull()
    expect(payload.user.phoneNumberErasedAt).toBeNull()
    expect(payload.user.uid).toBe('member-uid')
  })
})

describe('AGL-1569 · the do-not-contact answer travels with the number', () => {
  it('checks the suppression list against the number it is disclosing', async () => {
    await detail()
    expect(mockSuppressionCalls).toEqual(['+15125550123'])
  })

  it('marks a suppressed number, with the channels the opt-out covers', async () => {
    mockSuppression = {
      channels: ['calls'],
      source: 'verbal',
      erasePhoneOnFile: false,
      revokedAt: null,
    }
    const payload = await detail()
    expect(payload.user.phoneContact.suppressed).toBe(true)
    expect(payload.user.phoneContact.channels).toEqual(['calls'])
    expect(payload.user.phoneContact.source).toBe('verbal')
    expect(payload.user.phoneContact.lookupFailed).toBe(false)
  })

  it('does not suppress on a revoked record — they opted back in', async () => {
    mockSuppression = {
      channels: ['calls', 'texts'],
      source: 'sms-keyword',
      erasePhoneOnFile: false,
      revokedAt: { toDate: () => new Date('2026-08-01T00:00:00.000Z') },
    }
    const payload = await detail()
    expect(payload.user.phoneContact.suppressed).toBe(false)
    expect(payload.user.phoneContact.revokedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(payload.user.phoneContact.channels).toEqual([])
  })

  it('reports no opt-out when the list holds no record', async () => {
    const payload = await detail()
    expect(payload.user.phoneContact.suppressed).toBe(false)
    expect(payload.user.phoneContact.lookupFailed).toBe(false)
  })

  it('fails CLOSED when the list cannot be read', async () => {
    mockSuppressionThrows = true
    const payload = await detail()
    // A list we could not read is not a list that said "go ahead".
    expect(payload.user.phoneContact.suppressed).toBe(true)
    expect(payload.user.phoneContact.lookupFailed).toBe(true)
    // …and the number is still disclosed, so the failure reads as "cannot
    // check", not as "this account has no phone".
    expect(payload.user.phoneNumber).toBe('+15125550123')
  })
})

describe('AGL-1569 · the read is a read', () => {
  it('writes nothing — no profile mutation and no audit row', async () => {
    mockSuppression = { channels: ['texts'], source: 'email', revokedAt: null }
    await detail()
    expect(mockWrites).toEqual([])
  })
})
