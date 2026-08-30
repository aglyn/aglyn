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
 * `/api/hosts/delete` — the one event in this class that cannot be recorded
 * where every other site event is recorded (AGL-118).
 *
 * A site's own activity log lives at `hosts/{hostId}/activity`, which is
 * inside the tree `eraseHost` recursive-deletes. So the obvious instrumentation
 * — a `logHostActivity` call beside the others — writes into a path that no
 * longer exists, resurrects a fragment of a site the customer asked us to
 * destroy, and is read by nobody, because the surface that reads that
 * collection is the site's own page. The event belongs to the WORKSPACE, which
 * is also where somebody asking "where did our site go" is looking.
 *
 * Two orderings follow from that and both are asserted below, because each is
 * a single line away from being wrong in a way nothing else would catch:
 *
 *   - the entry is composed from data read BEFORE the erase, because the
 *     site's name and its owning workspace are gone the moment it returns; and
 *   - it is WRITTEN after, because `eraseHost` can throw and the audit trail
 *     must not be the one place claiming a deletion that did not happen.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockEraseHost = jest.fn(async (..._args: unknown[]) => undefined)
const mockLogOrgActivity = jest.fn(async (..._args: unknown[]) => undefined)
const mockMemberHasOrgPermission = jest.fn(async (..._args: unknown[]) => true)
const mockAuditAdd = jest.fn(async (..._args: unknown[]) => undefined)
/** Lazy so the hoisted mock factory never touches a const in its TDZ. */
const mockHostData = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The site's sending domain, read before the erase and released after it.
   *
   * Stubbed to "nothing provisioned" here: these specs are about the delete's
   * authorization and ordering, and a site with no sending domain is the
   * state that exercises the skip path. The teardown itself — that it names
   * the Resend domain, the DKIM selector and the zone records before anything
   * is dropped — is proved in `host-sending-domain.spec.ts`.
   */
  readHostSendingTeardown: async () => null,
  releaseHostSendingDomain: async () => undefined,
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({
            get: async () => ({
              exists: mockHostData() !== null,
              get: (field: string) => (mockHostData() ?? {})[field],
              data: () => mockHostData(),
            }),
          }),
          add:
            name === 'adminAudit'
              ? (...args: unknown[]) => mockAuditAdd(...args)
              : undefined,
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
  eraseHost: (...args: unknown[]) => mockEraseHost(...args),
  getOrgForHost: async () => ({ orgId: 'org-1', org: {} }),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: {} }),
  memberHasOrgPermission: (...args: unknown[]) =>
    mockMemberHasOrgPermission(...args),
  lockdownRefusal: async () => null,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  // CAPTURED, not stubbed away — it is the subject. Named explicitly because
  // this factory is a closed world: an absent export is `undefined`, the
  // route throws past every assertion here, and its own catch answers 500,
  // which reads exactly like the deletion itself regressing.
  logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

const { POST } = require('./route') as {
  POST: (request: Request) => Promise<Response>
}

const post = () =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/delete', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1' }),
    }),
  )

/** The single call's arguments, so each case names what it is asserting. */
function entry() {
  const args = mockLogOrgActivity.mock.calls[0] as unknown as [
    string,
    { uid: string; email: string | null },
    string,
    Record<string, unknown>,
  ]
  return { orgId: args[0], actor: args[1], action: args[2], target: args[3] }
}

const LIVE_SITE = {
  memberRoles: { 'u-1': 'admin' },
  orgId: 'org-1',
  displayName: 'Acme Storefront',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'admin@example.test',
    email_verified: true,
  })
  mockHostData.mockReturnValue(LIVE_SITE)
  mockEraseHost.mockResolvedValue(undefined)
  mockMemberHasOrgPermission.mockResolvedValue(true)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe("a deleted site's last event goes to the workspace (AGL-118)", () => {
  it('THE CONTROL — a delete that lands writes one workspace entry naming the site', async () => {
    // First, because every "writes nothing" case below also passes against a
    // route that logs nothing at all, in any branch, forever.
    const response = await post()

    expect(response.status).toBe(200)
    expect(mockEraseHost).toHaveBeenCalledWith('host-1')

    expect(mockLogOrgActivity).toHaveBeenCalledTimes(1)
    const { orgId, actor, action, target } = entry()
    // The OWNING workspace, resolved from the host document rather than from
    // the request — a caller cannot file this under a workspace of its choice.
    expect(orgId).toBe('org-1')
    expect(actor).toEqual({ uid: 'u-1', email: 'admin@example.test' })
    expect(action).toBe('Deleted a site')
    // `type: 'host'` inside an ORG feed: the entry is about a site, filed
    // where the site's own feed cannot reach.
    expect(target).toEqual({
      type: 'host',
      id: 'host-1',
      name: 'Acme Storefront',
    })
  })

  it('writes the entry AFTER the erase, never before', async () => {
    await post()

    // An entry written first would claim a deletion that had not happened —
    // and `eraseHost` can throw, which the next case pins. Read off jest's
    // own global call counter rather than a hand-kept array, so the ordering
    // cannot be recorded by anything but the calls themselves.
    expect(mockEraseHost.mock.invocationCallOrder[0]).toBeLessThan(
      mockLogOrgActivity.mock.invocationCallOrder[0],
    )
  })

  it('writes NOTHING when the erase throws', async () => {
    mockEraseHost.mockRejectedValue(new Error('storage offline'))

    expect((await post()).status).toBe(500)

    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('names the site from data read BEFORE the erase', async () => {
    /*
     * The bite. `eraseHost` takes the host document with it, so a route that
     * composed the entry afterwards would file "Deleted a site" under no
     * workspace at all, naming the raw id — for the one event whose whole
     * purpose is telling somebody which site is gone.
     *
     * Modelled by having the host read answer `null` once the erase has run,
     * which is what the real Firestore does a moment later.
     */
    mockEraseHost.mockImplementation(async () => {
      mockHostData.mockReturnValue(null)
      return undefined
    })

    await post()

    expect(entry().orgId).toBe('org-1')
    expect(entry().target).toMatchObject({ name: 'Acme Storefront' })
  })

  it('writes NOTHING when the caller is not a site admin', async () => {
    mockHostData.mockReturnValue({ ...LIVE_SITE, memberRoles: { 'u-1': 'editor' } })

    expect((await post()).status).toBe(403)

    expect(mockEraseHost).not.toHaveBeenCalled()
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('writes NOTHING when the org role withholds hosts.delete', async () => {
    mockMemberHasOrgPermission.mockResolvedValue(false)

    expect((await post()).status).toBe(403)

    expect(mockEraseHost).not.toHaveBeenCalled()
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('writes NOTHING for a site that names no workspace', async () => {
    // An orphaned host has no feed to be filed under, and inventing one would
    // put a stranger's deletion in somebody else's workspace. The staff
    // `adminAudit` row still records it, which is asserted so this reads as a
    // deliberate fallback rather than a hole.
    mockHostData.mockReturnValue({ ...LIVE_SITE, orgId: undefined })

    expect((await post()).status).toBe(200)

    expect(mockEraseHost).toHaveBeenCalledWith('host-1')
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
    expect(mockAuditAdd).toHaveBeenCalledTimes(1)
  })
})
