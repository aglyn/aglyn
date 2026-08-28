/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
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
 * "WHO ACCESSED MY DATA", ANSWERED ON THE SUBJECT'S OWN PAGE.
 *
 * The audit card read two halves — entries BY this account and entries whose
 * `target` was literally `users/{uid}` — so any act whose target is something
 * else was invisible to the person it was about. Reading somebody's mail
 * targets `emailDeliveries/{messageId}`, which can never equal a user path,
 * and that is the whole of the gap: the log could say what a staff member
 * did and could not say who had looked at you.
 *
 * These assert the QUERIES the route issues and the payload it returns, not
 * anything rendered. Two properties:
 *
 *  1. An entry naming this account as its SUBJECT comes back, even though its
 *     target names a message.
 *  2. A burst of access entries cannot push a mutation off the card. Reads
 *     arrive far more often than impersonations, and `user.impersonate` is
 *     what somebody opens this page to find.
 */

export {}

/** One seeded `adminAudit` document. */
interface SeedRow {
  id: string
  actorUid?: string
  action: string
  target?: string
  subjectUid?: string
  at: string
  repeatCount?: number
  lastAt?: string
}

let auditSeed: SeedRow[] = []
/** Every `adminAudit` query the route issued, as `field=value`. */
let auditQueries: string[] = []

const mockDecodedToken: Record<string, unknown> = {}

const emptyQuery = { docs: [] as unknown[] }

function auditDoc(row: SeedRow) {
  const fields: Record<string, unknown> = {
    actorUid: row.actorUid ?? null,
    action: row.action,
    target: row.target ?? null,
    at: { toDate: () => new Date(row.at) },
    ...(row.subjectUid ? { subjectUid: row.subjectUid } : {}),
    ...(row.repeatCount ? { repeatCount: row.repeatCount } : {}),
    ...(row.lastAt ? { lastAt: { toDate: () => new Date(row.lastAt) } } : {}),
  }
  return { id: row.id, get: (field: string) => fields[field] }
}

/**
 * The `adminAudit` halves, answered from the seed.
 *
 * The double applies the WHERE, the ORDER and the LIMIT for real. Answering
 * every half with the same rows would make the quota assertion below pass on
 * a route that never separated the two kinds, and answering without the limit
 * would hide the crowding this exists to catch.
 */
function auditQuery(field: string, value: unknown) {
  auditQueries.push(`${field}=${String(value)}`)
  let limit = Number.POSITIVE_INFINITY
  const matched = () =>
    auditSeed
      .filter((row) => (row as unknown as Record<string, unknown>)[field] === value)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map(auditDoc)
  const query = {
    orderBy: () => query,
    limit: (count: number) => {
      limit = count
      return query
    },
    get: async () => ({ docs: matched() }),
  }
  return query
}

const mockFirestore = {
  collection: (collection: string) => ({
    where: (field: string, _op: string, value: unknown) =>
      collection === 'adminAudit'
        ? auditQuery(field, value)
        : {
            limit: () => ({ get: async () => emptyQuery }),
            orderBy: () => ({ limit: () => ({ get: async () => emptyQuery }) }),
          },
    doc: () => ({
      get: async () => ({
        exists: false,
        data: () => undefined,
        get: () => undefined,
      }),
      set: async () => undefined,
      collection: () => ({
        // `orderBy` as well as `limit`: the device registry reaches for it,
        // and a double that stops short sends that half into its own catch,
        // filling the run with a failure this suite is not about.
        limit: () => ({ get: async () => emptyQuery }),
        orderBy: () => ({ limit: () => ({ get: async () => emptyQuery }) }),
        doc: () => ({
          get: async () => ({ exists: false, get: () => undefined }),
        }),
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
      email: 'casey@customer.example',
      displayName: 'Casey',
      phoneNumber: null,
      photoURL: null,
      providerData: [],
      disabled: false,
      customClaims: {},
      metadata: { creationTime: null, lastSignInTime: null },
    },
  }),
  // Reached by the module under test through the shared audit helper. A
  // wholesale `jest.mock` is a closed world: an export the route can reach
  // has to exist here or the call throws into a `catch` that hides it.
  findUserByEmailAcrossPools: async () => null,
  getContactSuppression: async () => null,
  getLegalAcceptanceStatus: async () => ({
    currentVersion: 'v6',
    accepted: true,
    acceptedVersions: ['v6'],
    latestAcceptedVersion: 'v6',
    currentVersionAcceptedAt: null,
    reacceptanceRequired: false,
    reacceptanceReason: 'none',
    arbitration: {
      firstAcceptedAt: null,
      deadline: null,
      open: false,
      daysRemaining: 0,
    },
    acceptances: [],
  }),
}))

// The delivery history is read through a DEEP import, so the barrel mock
// above does not cover it. Stubbed rather than exercised: this suite is about
// the audit halves, and the real reader would reach an uninitialized SDK.
jest.mock('@aglyn/tenant-data-admin/server/email-delivery-log', () => ({
  __esModule: true,
  readEmailDeliveryHistory: async () => ({ lookupFailed: false, rows: [] }),
}))

const route = require('../app/api/admin/users/detail/route') as {
  GET: (request: Request) => Promise<Response>
}

async function detail(uid = 'casey_uid'): Promise<any> {
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
  auditSeed = []
  auditQueries = []
  Object.assign(mockDecodedToken, {
    uid: 'staff_1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
  })
})

describe('an entry about a person reaches that person’s page', () => {
  const mailRead: SeedRow = {
    id: 'audit_mail',
    actorUid: 'staff_1',
    action: 'email.message-viewed',
    target: 'emailDeliveries/msg_1',
    subjectUid: 'casey_uid',
    at: '2026-08-27T10:00:00.000Z',
    repeatCount: 2,
    lastAt: '2026-08-27T10:00:01.000Z',
  }

  it('asks the subject question at all', async () => {
    await detail()
    // The gap was structural: two halves, neither of which could match a
    // target that is not a user path.
    expect(auditQueries).toContain('subjectUid=casey_uid')
    expect(auditQueries).toContain('target=users/casey_uid')
    expect(auditQueries).toContain('actorUid=casey_uid')
  })

  it('returns a staff read of this account’s mail', async () => {
    auditSeed = [mailRead]
    const payload = await detail()

    const entry = payload.audit.find((row: any) => row.id === 'audit_mail')
    expect(entry).toBeDefined()
    expect(entry.action).toBe('email.message-viewed')
    expect(entry.subjectUid).toBe('casey_uid')
    // The target still names the MESSAGE. The subject is a separate fact, and
    // overloading the target to carry it would have lost which record was
    // actually opened.
    expect(entry.target).toBe('emailDeliveries/msg_1')
    // The collapse travels with the row, so the card can say a single
    // opening was recorded twice instead of silently standing for both.
    expect(entry.repeatCount).toBe(2)
    expect(entry.lastAt).toBe('2026-08-27T10:00:01.000Z')
  })

  it('does not return an entry about somebody else', async () => {
    // CONTROL. A route that merely stopped filtering, or matched the subject
    // loosely, would pass the assertion above while putting one customer's
    // access history on another customer's page — a worse defect than the
    // one being fixed.
    auditSeed = [{ ...mailRead, id: 'audit_other', subjectUid: 'other_uid' }]
    const payload = await detail()

    expect(payload.audit).toHaveLength(0)
  })

  it('counts an entry answered by two halves once', async () => {
    // CONTROL on the merge. An action that targets the account AND names it
    // as the subject is one act; returning it twice would read as two.
    auditSeed = [
      {
        id: 'audit_both',
        actorUid: 'staff_1',
        action: 'user.impersonate',
        target: 'users/casey_uid',
        subjectUid: 'casey_uid',
        at: '2026-08-27T09:00:00.000Z',
      },
    ]
    const payload = await detail()

    expect(payload.audit).toHaveLength(1)
  })
})

describe('an access cannot displace a change', () => {
  /** More reads than the card has room for, all newer than the change. */
  const flood: SeedRow[] = Array.from({ length: 20 }, (_unused, index) => ({
    id: `read_${index}`,
    actorUid: 'staff_1',
    action: 'email.message-viewed',
    target: `emailDeliveries/msg_${index}`,
    subjectUid: 'casey_uid',
    at: `2026-08-27T12:${String(index).padStart(2, '0')}:00.000Z`,
  }))

  it('keeps an impersonation on the card under a flood of reads', async () => {
    auditSeed = [
      ...flood,
      {
        id: 'impersonation',
        actorUid: 'staff_9',
        action: 'user.impersonate',
        target: 'users/casey_uid',
        subjectUid: 'casey_uid',
        // OLDER than every read, which is exactly the case a single
        // time-ordered window gets wrong.
        at: '2026-08-27T08:00:00.000Z',
      },
    ]
    const payload = await detail()

    const kinds = new Map(
      payload.audit.map((row: any) => [row.id, row.kind]),
    )
    expect(kinds.get('impersonation')).toBe('change')
    // The entry somebody opens this card to find, which four message views
    // were enough to push out of a ten-row window.
    expect(
      payload.audit.some((row: any) => row.action === 'user.impersonate'),
    ).toBe(true)
  })

  it('still returns the reads — they are separated, never dropped', async () => {
    // CONTROL on the fix's failure mode. Solving the crowding by hiding
    // reads would trade one silence for another: an unrecorded look is the
    // failure this collection exists to prevent, and an unrendered one is
    // the quiet version of it.
    auditSeed = [...flood]
    const payload = await detail()

    expect(
      payload.audit.filter((row: any) => row.kind === 'access').length,
    ).toBeGreaterThan(0)
  })

  it('classifies an unknown action as a change, not an access', async () => {
    // CONTROL on the DEFAULT, which matters more than the membership of the
    // access list: an action nobody has classified yet must land in the
    // louder half. The opposite default would let a new high-consequence
    // action render as routine browsing.
    auditSeed = [
      {
        id: 'novel',
        actorUid: 'staff_1',
        action: 'something.nobody.classified',
        target: 'users/casey_uid',
        at: '2026-08-27T11:00:00.000Z',
      },
    ]
    const payload = await detail()

    expect(payload.audit[0].kind).toBe('change')
  })
})
