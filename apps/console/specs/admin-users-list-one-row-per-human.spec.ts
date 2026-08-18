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

// No imports (everything arrives through jest.mock factories and globals), so
// without an export TypeScript treats this as a GLOBAL SCRIPT and its
// top-level consts collide with sibling module specs (TS2451, AGL-1841).
export {}

/**
 * AGL-2005 — `GET /api/admin/users` returns ONE row per human.
 *
 * **Zach, 2026-08-18:** "We still have two users list in this list with the
 * same uid but one without an email attached, this needs fixed we should only
 * see one user, even if they are sso."
 *
 * The collapse RULE is proved in `auth-pools.spec.ts`, against the real
 * algorithm: which row survives, that a uid in three pools reduces to one,
 * and — the control that keeps the merge honest — that two distinct accounts
 * sharing an email stay two rows. What that cannot prove is that this route
 * actually applies it. `listUsersAcrossPools` deliberately still returns
 * every auth record, so a route that forgets the collapse call renders the
 * duplicate again while every library test stays green.
 *
 * So this drives the handler with the production shape: the same uid in the
 * project pool with nothing on it and in `aglyn-org-y5v14` with
 * `zach@aglyn.com`. It asserts the wiring, the choice of survivor, and that
 * the collision still reaches the client — a merge that says nothing is
 * indistinguishable from a real duplicate being quietly dropped.
 */

const SHADOW_UID = 'IHumyGGhGxZKjVV26qCRx5Okf573'
const SSO_TENANT = 'aglyn-org-y5v14'

const authRecord = (over: Record<string, unknown>) => ({
  uid: SHADOW_UID,
  email: null,
  displayName: null,
  disabled: false,
  customClaims: {},
  metadata: { creationTime: null, lastSignInTime: null },
  providerData: [] as { providerId: string }[],
  ...over,
})

/** The forged twin: no address, no provider entry, nothing but a uid. */
const shadowRow = {
  record: authRecord({}),
  tenantId: null as string | null,
  uidAlsoInPools: [SSO_TENANT] as (string | null)[],
}

/** The account the human actually signs in as. */
const ssoRow = {
  record: authRecord({
    email: 'zach@aglyn.com',
    providerData: [{ providerId: 'saml.aglyn-workspace' }],
  }),
  tenantId: SSO_TENANT as string | null,
  uidAlsoInPools: [null] as (string | null)[],
}

/** What the (unmerged) data layer hands the route. */
let mockListed: any[] = []
/** What the collapse was asked to merge — proves the route routed through it. */
let mockCollapseInput: any[] | null = null
/** What the collapse hands back; the route must serialize THIS. */
let mockCollapseOutput: any[] = []
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
  findUserByEmailAcrossPools: async () => null,
  listUsersAcrossPools: async () => ({
    users: mockListed,
    nextPageToken: null,
    tenantsIncluded: true,
    tenantTruncated: [],
  }),
  // Recorded rather than reimplemented. A double that re-derives the merge
  // would prove only that the double works — the algorithm has its own specs
  // against the real function, and what is unproven here is the WIRING.
  collapseCrossPoolUidRows: (rows: any[]) => {
    mockCollapseInput = rows
    return mockCollapseOutput
  },
}))

// `require`, not `import`: the handler must be loaded AFTER the jest.mock
// factory above is registered, or it captures the real module.
const route = require('../app/api/admin/users/route') as {
  GET: (request: Request) => Promise<Response>
}

async function listUsers(): Promise<any> {
  const response = await route.GET(
    new Request('https://app.aglyn.com/api/admin/users', {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

beforeEach(() => {
  mockListed = [shadowRow, ssoRow]
  mockCollapseInput = null
  mockCollapseOutput = [ssoRow]
  Object.assign(mockDecodedToken, {
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('AGL-2005 · one row per human', () => {
  /**
   * The report itself. Forced red by deleting the `collapseCrossPoolUidRows`
   * call from the route and serializing `page.users`: two rows come back, one
   * of them the emailless twin — exactly what Zach is looking at.
   */
  it('returns ONE row for a uid that exists in two pools', async () => {
    const payload = await listUsers()
    expect(payload.users).toHaveLength(1)
  })

  /**
   * And it is the record that identifies the person, not whichever pool the
   * listing reached first. Same red as above: the surviving row's email reads
   * null and its tenantId null.
   */
  it('keeps the identified record, never the emailless artifact', async () => {
    const payload = await listUsers()
    expect(payload.users[0].email).toBe('zach@aglyn.com')
    expect(payload.users[0].tenantId).toBe(SSO_TENANT)
    expect(payload.users[0].providers).toEqual(['saml.aglyn-workspace'])
  })

  /**
   * The route must hand the collapse EVERY listed row. Passing a filtered or
   * pre-trimmed set would silently narrow what it can merge — a collision it
   * cannot see is one it cannot report.
   */
  it('routes every listed record through the collapse', async () => {
    await listUsers()
    expect(mockCollapseInput).toHaveLength(2)
    expect(mockCollapseInput?.map((row: any) => row.tenantId)).toEqual([
      null,
      SSO_TENANT,
    ])
  })

  /**
   * Merged is not hidden. Zach asked not to SEE two rows; he did not ask to be
   * uninformed, and the staff console is where a genuine duplicate has to stay
   * legible. Forced red by dropping `uidAlsoInPools` from the route's
   * `serialize` — the row still renders, and every trace that a second record
   * exists is gone.
   */
  it('carries the collision through to the client on the surviving row', async () => {
    const payload = await listUsers()
    expect(payload.users[0].uidAlsoInPools).toEqual([null])
  })

  /**
   * The other direction: an ordinary listing must be untouched, and a row with
   * no collision reports none rather than an empty array the UI would have to
   * special-case.
   */
  it('leaves an ordinary listing alone', async () => {
    const ordinary = [
      { record: authRecord({ uid: 'a', email: 'a@x.com' }), tenantId: null },
      { record: authRecord({ uid: 'b', email: 'b@x.com' }), tenantId: null },
    ]
    mockListed = ordinary
    mockCollapseOutput = ordinary
    const payload = await listUsers()
    expect(payload.users.map((row: any) => row.uid)).toEqual(['a', 'b'])
    expect(payload.users.every((row: any) => row.uidAlsoInPools === null)).toBe(
      true,
    )
  })
})
