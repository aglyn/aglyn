/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor and every case here fails identically.
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
 * `/api/hosts/rename` — a site's public address moving, and the one moment
 * that counts as it having moved (AGL-118).
 *
 * This route has SIX exits and only one of them is the event. Four are
 * refusals; the fifth is the interesting one, because it answers 200 without
 * changing anything — sending the address a site already has is a no-op, and
 * a log line placed on "success" would record an address change once per
 * double-click on a site whose address never moved.
 *
 * Every assertion here is about the WRITTEN ENTRY — the arguments the route
 * handed the logger — and never about the response body or anything rendered.
 * A feed is read long after the response is gone, and the response was
 * already the thing that was right when the log was wrong.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockLogHostActivity = jest.fn(async (..._args: unknown[]) => undefined)
const mockSyncHostProjectionForMembers = jest.fn(async (..._args: unknown[]) => undefined)
const mockRevalidateHostAliases = jest.fn(async (..._args: unknown[]) => undefined)
const mockAuditAdd = jest.fn(async (..._args: unknown[]) => undefined)
/** Lazy so the hoisted mock factory never touches a const in its TDZ. */
const mockHostData = jest.fn()
/** Ids the uniqueness query answers with, so a claim can be made to lose. */
let subdomainHolders: string[] = []
/** Every `tx.set`, so a refused claim can be shown to have written nothing. */
let transactionWrites: Array<{ path: string; data: Record<string, unknown> }> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockMakeFirestore(),
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: {} }),
  lockdownRefusal: async () => null,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  syncHostProjectionForMembers: (...args: unknown[]) =>
    mockSyncHostProjectionForMembers(...args),
  // CAPTURED, not stubbed away — it is the subject. Named explicitly because
  // this factory is a closed world: an absent export is `undefined`, the
  // route throws past every assertion here, and its own catch answers 500,
  // which reads exactly like the rename regressing.
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL name rules. Stubbing them would turn the two refusal cases below
  // into tests of the stub, and the reserved-name list is exactly the kind of
  // thing that is right in the double and wrong in the product.
  ...jest.requireActual('../../../../../../libs/aglyn/src/lib/app-utils/host-naming'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

jest.mock('../../../../utils/server/tenant-revalidate', () => ({
  __esModule: true,
  revalidateHostAliases: (...args: unknown[]) => mockRevalidateHostAliases(...args),
}))

/**
 * Just enough Firestore for this route: the host document, the uniqueness
 * query inside the transaction, and the two `tx.set` calls the claim makes.
 * `runTransaction` applies writes immediately, which is faithful enough for a
 * suite that never runs two at once — what is under test is what the query
 * SEES, not contention.
 */
function mockMakeFirestore(): any {
  const collection = (name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      id,
      get: async () => ({
        exists: name === 'hosts' && mockHostData() !== null,
        get: (field: string) => (mockHostData() ?? {})[field],
        data: () => mockHostData(),
      }),
    }),
    where: () => ({ limit: () => ({ __query: true }) }),
    // The staff audit row. Present because the route writes one after the
    // claim and a missing `add` throws into the handler's catch — which
    // answers 500 and would make a working rename read as a broken one.
    add: (...args: unknown[]) => mockAuditAdd(...args),
  })
  return {
    collection,
    runTransaction: async (body: (tx: unknown) => Promise<unknown>) =>
      body({
        get: async () => ({
          docs: subdomainHolders.map((id) => ({ id })),
        }),
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
        ) => {
          transactionWrites.push({ path: ref.path, data })
          return undefined
        },
      }),
  }
}

const { POST } = require('./route') as {
  POST: (request: Request) => Promise<Response>
}

const post = (subdomain: string) =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/rename', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1', subdomain }),
    }),
  )

/** The single call's arguments, so each case names what it is asserting. */
function entry() {
  const call = mockLogHostActivity.mock.calls[0] as unknown as [
    string,
    { uid: string; email: string | null },
    string,
    Record<string, unknown>,
  ]
  return { hostId: call[0], actor: call[1], action: call[2], target: call[3] }
}

beforeEach(() => {
  jest.clearAllMocks()
  subdomainHolders = []
  transactionWrites = []
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'admin@example.test',
    email_verified: true,
  })
  mockHostData.mockReturnValue({
    memberRoles: { 'u-1': 'admin' },
    subdomain: 'oldname',
    orgId: 'org-1',
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the address change is recorded at the claim, and nowhere else (AGL-118)', () => {
  it('THE CONTROL — a rename that lands writes one entry carrying BOTH addresses', async () => {
    // First, because every "writes nothing" case below also passes against a
    // route that logs nothing at all, in any branch, forever.
    const response = await post('newname')

    expect(response.status).toBe(200)
    // The claim really committed — otherwise this suite is asserting the log
    // of a rename that did not happen.
    expect(transactionWrites).toEqual([
      { path: 'hosts/host-1', data: { subdomain: 'newname', updatedAt: '__now__' } },
      { path: 'hostIndex/host-1', data: { subdomain: 'newname' } },
    ])

    expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
    const { hostId, actor, action, target } = entry()
    expect(hostId).toBe('host-1')
    // The uid and address this route VERIFIED off the token, never the body.
    expect(actor).toEqual({ uid: 'u-1', email: 'admin@example.test' })
    expect(action).toBe('Changed the site address')
    // The OLD name is in the entry. Without it the log cannot answer "where
    // did this site used to live", which is the question it is opened for.
    expect(target).toEqual({
      type: 'host',
      id: 'host-1',
      name: 'oldname -> newname',
    })
  })

  it('writes NOTHING when another site already holds the name', async () => {
    // The transaction returns false and the route answers 409. This is the
    // branch where an entry would be most misleading: the request looked
    // exactly like the successful one, and the site kept its old address.
    subdomainHolders = ['host-2']

    expect((await post('newname')).status).toBe(409)

    expect(transactionWrites).toEqual([])
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('writes NOTHING when the site is already on that address', async () => {
    // A 200, and the subtlest of the refusals to spot: nothing moved, so an
    // entry here would put an address change in the feed once per repeat
    // request on a site whose address never changed.
    const response = await post('oldname')

    expect(response.status).toBe(200)
    expect(transactionWrites).toEqual([])
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('writes NOTHING for a name the validator refuses', async () => {
    expect((await post('no')).status).toBe(400)
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('writes NOTHING for a reserved name', async () => {
    // Through the REAL blocklist — `www` is reserved because it shadows
    // platform routing, which is the reason this route exists server-side.
    expect((await post('www')).status).toBe(409)
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('writes NOTHING when the caller is not a site admin', async () => {
    mockHostData.mockReturnValue({
      memberRoles: { 'u-1': 'editor' },
      subdomain: 'oldname',
      orgId: 'org-1',
    })

    expect((await post('newname')).status).toBe(403)
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('records the rename even when the best-effort cleanup fails', async () => {
    // The projection sync and the alias bust run AFTER the claim and cannot
    // un-rename the site. A route that logged only once everything downstream
    // had succeeded would drop the entry for a rename that demonstrably
    // happened — the same silent gap this issue exists to close.
    mockSyncHostProjectionForMembers.mockRejectedValue(new Error('offline'))
    mockRevalidateHostAliases.mockRejectedValue(new Error('offline'))

    await post('newname')

    expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
    expect(entry().action).toBe('Changed the site address')
  })
})
