/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * Org settings must not MINT the workspace they are asked to change
 * (AGL-1766).
 *
 * `orgId` is body-supplied and four action branches merge-set `orgs/{orgId}`
 * by it, so a mistyped id created an unowned workspace holding a `name`, or a
 * `defaultResourceScope`, or an `enabledPlugins` list — and nothing else. No
 * owner, no members, no slug. The console's own lists scope by membership so
 * it is invisible there; the staff orgs list does not, so that is where it
 * shows up, with no way to tell it from a real workspace someone is setting
 * up.
 *
 * The interesting part is that the route already KNEW: `getOrgDoc` checks
 * `snapshot.exists` and returns null, and the lockdown call laundered that
 * null into `undefined`. One line, not four — which is what these tests are
 * shaped to prove, by driving all four branches through the single guard.
 *
 * NO STRIPE PATH IS EXERCISED — localhost carries the LIVE key. `after()` is
 * replaced with a recorder that never invokes its callback, and `global.fetch`
 * is replaced for the whole file with a fake that fails the test if it is
 * called at all.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

/** Every document, keyed by its full path. */
let mockDocs = new Map<string, Record<string, unknown>>()
/** Org activity entries, in order. */
let mockActivity: unknown[][] = []
/** Callbacks handed to `after()` — recorded, never run. */
let mockDeferred: unknown[] = []
/** Whether the lockdown verdict should refuse. */
let mockLockdownResponse: Response | null = null

const mockVerifyIdToken = jest.fn()
const mockFetch = jest.fn()

/** The real role ladder, not a re-typed copy (AGL-1715). */
const mockOrganizations = jest.requireActual(
  '../../../../../../libs/aglyn/src/lib/app-utils/organizations',
)

function mockMakeFirestore() {
  const makeDoc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => ({
      exists: mockDocs.has(path),
      id: path.split('/').pop(),
      data: () => mockDocs.get(path),
      get: (field: string) => (mockDocs.get(path) ?? {})[field],
    }),
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      mockDocs.set(
        path,
        options?.merge ? { ...mockDocs.get(path), ...data } : { ...data },
      )
      return undefined
    },
  })
  const makeCollection = (prefix: string) => ({
    doc: (id: string) => makeDoc(`${prefix}/${id}`),
  })
  return {
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const queued: Array<() => void> = []
      const batch = {
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          queued.push(() => {
            mockDocs.set(
              ref.path,
              options?.merge ? { ...mockDocs.get(ref.path), ...data } : { ...data },
            )
          })
          return batch
        },
        commit: async () => {
          for (const write of queued) write()
        },
      }
      return batch
    },
  }
}

jest.mock('next/server', () => ({
  __esModule: true,
  // Recorded, NEVER invoked: the deferred work on the profile branch talks to
  // Stripe with the live key on localhost.
  after: (callback: unknown) => {
    mockDeferred.push(callback)
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__', delete: () => '__delete__' },
}))

jest.mock('../../../../utils/stripe-address-divergence', () => ({
  __esModule: true,
  stripeAddressDivergence: () => ({}),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  canManageOrg: mockOrganizations.canManageOrg,
  checkEntitlement: () => true,
  isValidOrgSlug: () => true,
  normalizeAddress: () => null,
  normalizePhone: (value: string) => value,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json(),
    headers: Object.fromEntries(request.headers),
  }),
}))

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
  // The real contract: null for a missing org, because it checks `.exists`.
  // The whole defect is that the route threw this answer away.
  getOrgDoc: async (orgId: string) => {
    const stored = mockDocs.get(`orgs/${orgId}`)
    return stored ? { $id: orgId, ...stored } : null
  },
  OrgSlugTakenError: class extends Error {},
  changeOrgSlug: async () => ({ previousSlug: 'old' }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  listOrgMembers: async (orgId: string) =>
    [...mockDocs.entries()]
      .filter(([path]) => path.startsWith(`orgs/${orgId}/members/`))
      .map(([path, data]) => ({ $id: path.split('/').pop(), ...data })),
  lockdownRefusal: async () => mockLockdownResponse,
  logOrgActivity: async (...args: unknown[]) => {
    mockActivity.push(args)
  },
  readOrgBilling: async () => ({}),
  registerConsoleDomain: async () => ({ claim: true }),
  releasePendingConsoleDomain: async () => true,
  resolveOrgMembership: async (uid: string, orgId: string) => {
    const member = mockDocs.get(`orgs/${orgId}/members/${uid}`)
    return member ? { orgId, member: { $id: uid, ...member } } : null
  },
  transferOrgOwnership: async () => undefined,
  validateConsoleDomain: (domain: string) => ({ domain }),
}))

const { POST } = require('./route') as {
  POST: (request: Request) => Promise<Response>
}

function post(body: unknown) {
  return new Request('https://app.aglyn.com/api/orgs/settings', {
    method: 'POST',
    headers: {
      authorization: 'Bearer staff-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

const ORG = 'org-7'
const TYPO = 'org-7x'

function seedOrg(): void {
  mockDocs.set(`orgs/${ORG}`, {
    name: 'Seven',
    slug: 'seven',
    ownerUid: 'owner-1',
    plan: 'pro',
  })
  mockDocs.set(`orgs/${ORG}/members/owner-1`, { role: 'owner', allHosts: true })
}

beforeEach(() => {
  mockDocs = new Map()
  mockActivity = []
  mockDeferred = []
  mockLockdownResponse = null
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })
  mockFetch.mockReset()
  mockFetch.mockImplementation(() => {
    throw new Error('no network call may happen in this suite')
  })
  global.fetch = mockFetch as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('org settings refuse a workspace that does not exist (AGL-1766)', () => {
  it('rename: 404s a mistyped orgId and writes NOTHING', async () => {
    seedOrg()

    const response = await POST(post({ orgId: TYPO, action: 'rename', name: 'Eight' }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'No such workspace' })
    expect(mockDocs.has(`orgs/${TYPO}`)).toBe(false)
    // The rename also fans out to every member's reverse-index row; none of
    // that ran either.
    expect([...mockDocs.keys()].some((path) => path.includes(TYPO))).toBe(false)
    expect(mockActivity).toHaveLength(0)
    // The real workspace is untouched, field by field.
    expect(mockDocs.get(`orgs/${ORG}`)).toEqual({
      name: 'Seven',
      slug: 'seven',
      ownerUid: 'owner-1',
      plan: 'pro',
    })
  })

  it('set-default-resource-scope: same guard, one line above all four branches', async () => {
    seedOrg()

    const response = await POST(
      post({
        orgId: TYPO,
        action: 'set-default-resource-scope',
        defaultResourceScope: 'org',
      }),
    )

    expect(response.status).toBe(404)
    expect(mockDocs.has(`orgs/${TYPO}`)).toBe(false)
  })

  it('set-enabled-plugins: the phantom would have carried a plugin list only', async () => {
    seedOrg()

    const response = await POST(
      post({
        orgId: TYPO,
        action: 'set-enabled-plugins',
        enabledPlugins: ['commerce', 'marketing'],
      }),
    )

    expect(response.status).toBe(404)
    expect(mockDocs.get(`orgs/${TYPO}`)?.['enabledPlugins']).toBe(undefined)
    expect(mockDocs.has(`orgs/${TYPO}`)).toBe(false)
  })

  it('update-profile: refused before anything is scheduled against Stripe', async () => {
    seedOrg()

    const response = await POST(
      post({
        orgId: TYPO,
        action: 'update-profile',
        contactEmail: 'billing@example.com',
        logoUrl: 'https://example.com/logo.png',
      }),
    )

    expect(response.status).toBe(404)
    expect(mockDocs.has(`orgs/${TYPO}`)).toBe(false)
    // The branch's `after()` sync never even got queued, and no request left
    // the process on any path.
    expect(mockDeferred).toHaveLength(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('BEHAVIOUR PIN: a real rename still lands, every stored field checked', async () => {
    seedOrg()

    const response = await POST(post({ orgId: ORG, action: 'rename', name: 'Eight' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, name: 'Eight' })

    const org = mockDocs.get(`orgs/${ORG}`) as Record<string, unknown>
    expect(org['name']).toBe('Eight')
    expect(org['updatedAt']).toBe('__now__')
    // The merge PATCHES: fields it never mentions survive.
    expect(org['slug']).toBe('seven')
    expect(org['ownerUid']).toBe('owner-1')
    expect(org['plan']).toBe('pro')
    // And the denormalised copy the switcher reads was carried across.
    expect(mockDocs.get(`users/owner-1/orgs/${ORG}`)?.['orgName']).toBe('Eight')
    expect(mockActivity).toHaveLength(1)
  })

  it('BEHAVIOUR PIN: a platform lockdown still wins over the 404', async () => {
    // Ordering, deliberately: the guard sits AFTER the lockdown verdict, so a
    // panic answers 423 for every id rather than turning the settings route
    // into an org-existence oracle.
    seedOrg()
    mockLockdownResponse = Response.json({ error: 'Locked down' }, { status: 423 })

    const response = await POST(post({ orgId: TYPO, action: 'rename', name: 'Eight' }))

    expect(response.status).toBe(423)
    expect(mockDocs.has(`orgs/${TYPO}`)).toBe(false)
  })

  it('NEGATIVE CONTROL: a non-staff caller is refused before the org is read', async () => {
    // The exposure is staff-only, and this is why: membership cannot resolve
    // for an org that was never created, so `canManageOrg(undefined)` refuses.
    // Only the `decoded['staff'] !== true` disjunct skips it.
    seedOrg()
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })

    const response = await POST(post({ orgId: TYPO, action: 'rename', name: 'Eight' }))

    expect(response.status).toBe(403)
    expect(mockDocs.has(`orgs/${TYPO}`)).toBe(false)
  })
})
