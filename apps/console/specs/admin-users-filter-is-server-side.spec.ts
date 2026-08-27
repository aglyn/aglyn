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

// No imports (everything arrives through jest.mock factories), so without an
// export TypeScript treats this as a GLOBAL SCRIPT and its top-level consts
// collide with sibling module specs (TS2451, AGL-1841).
export {}

/**
 * A paged list cannot be searched in the browser (AGL-693).
 *
 * The staff account list read 200 accounts at a time and narrowed the rows it
 * had — both the search box and the grid's filter panel — so it answered "no
 * such account" for everyone past the current page. On the list whose whole
 * job is that nobody is missing, that is the one wrong answer it cannot give.
 *
 * Firebase Auth is the hard part: `listUsers` takes a page size and a cursor
 * and nothing else, and there is no Firestore mirror to filter instead — the
 * `users` collection holds profile details for a fraction of the accounts and
 * carries neither email nor the staff claim. So the route answers a filter by
 * READING the pools and matching in memory, which makes this list more capable
 * than a Firestore-backed one rather than less: a mid-string `contains` and a
 * `doesNotContain` are ordinary JavaScript and no index can do either.
 *
 * What that costs is a walk, so these cases also pin the two things that keep
 * it honest: the walk happens only when a request carries a filter, and an
 * exact email or uid never walks at all.
 */

const mockScanned: any[] = []

const authRecord = (over: Record<string, unknown>) => ({
  uid: 'uid-1',
  email: null,
  displayName: null,
  disabled: false,
  customClaims: {},
  metadata: { creationTime: null, lastSignInTime: null },
  providerData: [] as { providerId: string }[],
  ...over,
})

const pooled = (over: Record<string, unknown>) => ({
  record: authRecord(over),
  tenantId: null as string | null,
})

/** Calls the route made, so a cheap path can be told from an expensive one. */
let mockScanCalls = 0
let mockListCalls = 0
let mockEmailLookups: string[] = []
let mockUidLookups: string[] = []
let mockScanTruncated = false

const mockDecodedToken: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  findUserByEmailAcrossPools: async (email: string) => {
    mockEmailLookups.push(email)
    return mockScanned.find((row) => row.record.email === email) ?? null
  },
  findUserByUidAcrossPools: async (uid: string) => {
    mockUidLookups.push(uid)
    return mockScanned.find((row) => row.record.uid === uid) ?? null
  },
  listUsersAcrossPools: async () => {
    mockListCalls += 1
    return {
      users: mockScanned,
      nextPageToken: null,
      tenantsIncluded: true,
      tenantTruncated: [],
    }
  },
  scanUsersAcrossPools: async () => {
    mockScanCalls += 1
    return { users: mockScanned, truncated: mockScanTruncated, tenantTruncated: [] }
  },
  // The collapse has its own specs against the real algorithm; here it must
  // simply not be the thing under test.
  collapseCrossPoolUidRows: (rows: any[]) => rows,
}))

// `require`, not `import`: the handler must load AFTER the mock factory, or
// it captures the real module.
const route = require('../app/api/admin/users/route') as {
  GET: (request: Request) => Promise<Response>
}

const call = async (params: Record<string, string> = {}) => {
  const url = new URL('https://app.aglyn.com/api/admin/users')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await route.GET(
    new Request(url.toString(), {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
  // Asserted first, always: a route that 500s on every request would leave a
  // "no rows matched" assertion perfectly green.
  expect(response.status).toBe(200)
  return response.json()
}

const uids = (payload: any) => payload.users.map((row: any) => row.uid).sort()

beforeEach(() => {
  mockScanCalls = 0
  mockListCalls = 0
  mockEmailLookups = []
  mockUidLookups = []
  mockScanTruncated = false
  mockScanned.length = 0
  mockScanned.push(
    pooled({
      uid: 'uid-ada',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      customClaims: { staff: true, staffRole: 'super' },
      metadata: {
        creationTime: 'Tue, 14 Jul 2026 10:00:00 GMT',
        lastSignInTime: 'Fri, 21 Aug 2026 10:00:00 GMT',
      },
      providerData: [{ providerId: 'google.com' }],
    }),
    pooled({
      uid: 'uid-grace',
      email: 'grace@navy.example',
      displayName: 'Grace Hopper',
      disabled: true,
      metadata: { creationTime: 'Wed, 05 Aug 2026 10:00:00 GMT', lastSignInTime: null },
      providerData: [{ providerId: 'password' }],
    }),
  )
  Object.assign(mockDecodedToken, {
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('an unfiltered listing never pays for a walk', () => {
  it('THE CONTROL: the plain listing pages, and does not scan', async () => {
    // Without this the assertions below cannot tell "did not scan" from
    // "never reached the handler".
    const payload = await call()
    expect(uids(payload)).toEqual(['uid-ada', 'uid-grace'])
    expect(mockListCalls).toBe(1)
    expect(mockScanCalls).toBe(0)
  })
})

describe('the search box reaches every pool', () => {
  it('matches a display name no page cursor had reached', async () => {
    const payload = await call({ search: 'hopper' })
    expect(uids(payload)).toEqual(['uid-grace'])
    expect(mockScanCalls).toBe(1)
  })

  it('matches on uid as well as name and email', async () => {
    expect(uids(await call({ search: 'uid-ada' }))).toEqual(['uid-ada'])
  })

  it('a COMPLETE email takes the O(1) lookup and never walks', async () => {
    // The common case, and the expensive read that does not have to happen.
    const payload = await call({ search: 'ada@example.com' })
    expect(uids(payload)).toEqual(['uid-ada'])
    expect(mockEmailLookups).toEqual(['ada@example.com'])
    expect(mockScanCalls).toBe(0)
  })

  it('an email that matches nothing still falls through to the walk', async () => {
    // Otherwise an address held only in a tenant pool the lookup missed would
    // read as "no such account" rather than being searched for.
    await call({ search: 'nobody@example.com' })
    expect(mockEmailLookups).toEqual(['nobody@example.com'])
    expect(mockScanCalls).toBe(1)
  })
})

describe('the column filter is answered by the server', () => {
  const filter = (field: string, op: string, value = '') =>
    call({ filterField: field, filterOp: op, filterValue: value })

  it('email · contains matches MID-string, which no index can', async () => {
    // The capability that comes free with matching in memory, and the reason
    // this list offers operators the Firestore-backed lists do not.
    // "da@ex" sits across the local part and the @ — it is a prefix of
    // neither address, so a prefix range could not find it at all.
    expect(uids(await filter('email', 'contains', 'da@ex'))).toEqual(['uid-ada'])
  })

  it('email · doesNotContain, likewise', async () => {
    expect(uids(await filter('email', 'doesNotContain', 'navy'))).toEqual([
      'uid-ada',
    ])
  })

  it('email · equals takes the O(1) lookup, not the walk', async () => {
    const payload = await filter('email', 'equals', 'ada@example.com')
    expect(uids(payload)).toEqual(['uid-ada'])
    expect(mockScanCalls).toBe(0)
  })

  it('uid · equals, likewise', async () => {
    const payload = await filter('uid', 'equals', 'uid-grace')
    expect(uids(payload)).toEqual(['uid-grace'])
    expect(mockUidLookups).toEqual(['uid-grace'])
    expect(mockScanCalls).toBe(0)
  })

  it('disabled · is true finds the disabled account', async () => {
    expect(uids(await filter('disabled', 'is', 'true'))).toEqual(['uid-grace'])
  })

  it('staff · is true reads the CLAIM, which the row carries', async () => {
    expect(uids(await filter('staff', 'is', 'true'))).toEqual(['uid-ada'])
  })

  it('providers · contains matches inside a provider id', async () => {
    expect(uids(await filter('providers', 'contains', 'google'))).toEqual([
      'uid-ada',
    ])
  })

  it('lastSignInAt · isEmpty means NEVER SIGNED IN', async () => {
    /*
     * The operator Firestore cannot answer at all — it cannot query for a
     * missing field — and the one this list answers exactly, because a
     * missing value is just a null in hand.
     */
    expect(uids(await filter('lastSignInAt', 'isEmpty'))).toEqual(['uid-grace'])
  })

  it('createdAt · before is a DAY boundary, not an instant', async () => {
    // Ada was created 14 July, Grace 5 August.
    expect(uids(await filter('createdAt', 'before', '2026-08-01'))).toEqual([
      'uid-ada',
    ])
    expect(uids(await filter('createdAt', 'onOrAfter', '2026-08-01'))).toEqual([
      'uid-grace',
    ])
  })

  it('an unknown field lists everything rather than nothing', async () => {
    // A filter this console cannot serve must not read as "no such account",
    // which is exactly what an empty page would say.
    expect(uids(await filter('nonesuch', 'contains', 'x'))).toEqual([
      'uid-ada',
      'uid-grace',
    ])
  })

  it('says so when the directory outran the scan', async () => {
    // A partial answer that reads as a complete one is the failure this whole
    // change is about.
    mockScanTruncated = true
    const payload = await filter('email', 'contains', 'example')
    expect(payload.scanTruncated).toBe(true)
  })

  it('a filtered response carries no cursor to resume', async () => {
    // Resuming one would page through the UNFILTERED directory, which is how
    // a narrowed list quietly turns back into the whole one.
    const payload = await filter('email', 'contains', 'example')
    expect(payload.nextPageToken).toBeNull()
  })
})
