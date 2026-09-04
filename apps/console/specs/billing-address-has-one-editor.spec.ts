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
 * The platform billing address has ONE editor.
 *
 * `contact.address` is what Aglyn's invoices are issued to and what Stripe's
 * `automatic_tax` computes from, and it had two editors writing it by two
 * different code paths: `set-billing-address` on `/api/billing/profile`
 * (Billing → Settings), and `update-profile` on `/api/orgs/settings`
 * (Settings → Profile, plus the staff org page, which posts the same action).
 *
 * Two writers on one field is a last-write-wins race, and the losing write is
 * the one nobody made: `update-profile` posts the WHOLE profile object on
 * every save, so correcting a country on the billing page and then changing
 * the logo on the settings page pushed the old address back to Stripe. The
 * customer changed a picture and moved their tax jurisdiction.
 *
 * Billing → Settings is the single editor now. This suite pins the other side
 * of that: `update-profile` neither writes the address nor sends one to
 * Stripe, and — the half that is easy to get wrong — it does not ERASE the
 * address either, because `set({ merge: true })` deep-merges a map and the
 * key is simply absent from the payload.
 *
 * NO NETWORK. `global.fetch` is replaced for the whole file, and the Stripe
 * key is a fixture — localhost carries the LIVE key, so a suite that let a
 * real request out would be talking to production Stripe.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

/** Every document, keyed by its full path. */
let mockDocs = new Map<string, Record<string, unknown>>()
/** Every `set()` the route made, in order, exactly as it was called. */
let mockWrites: Array<{
  path: string
  data: Record<string, unknown>
  merge: boolean
}> = []
/** Callbacks handed to `after()` — recorded, and run only on request. */
let mockDeferred: Array<() => Promise<void>> = []

const mockVerifyIdToken = jest.fn()
const mockFetch = jest.fn()

/** The real role ladder, not a re-typed copy (AGL-1715). */
const mockOrganizations = jest.requireActual(
  '../../../libs/aglyn/src/lib/app-utils/organizations',
)
/** The real phone normalizer, so the control below asserts a real value. */
const mockContactTypes = jest.requireActual(
  '../../../libs/aglyn/src/lib/foundation/definitions/contact.types',
)

/**
 * `set({ merge: true })` DEEP-merges a map, and that is the whole mechanism
 * under test — a shallow `{ ...previous, ...data }` double would replace
 * `contact` wholesale and report the address as erased when production
 * preserves it, failing this suite for a reason that does not exist.
 *
 * The reverse mistake is worse and is why this is written out rather than
 * borrowed: a double that deep-merged when production replaced would pass a
 * suite whose subject is an erasure.
 */
function mockDeepMerge(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = mockDeepMerge(
        out[key] as Record<string, unknown> | undefined,
        value as Record<string, unknown>,
      )
    } else {
      out[key] = value
    }
  }
  return out
}

function mockMakeFirestore() {
  const makeDoc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => ({
      exists: mockDocs.has(path),
      id: path.split('/').pop(),
      data: () => mockDocs.get(path),
    }),
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      mockWrites.push({ path, data, merge: Boolean(options?.merge) })
      mockDocs.set(
        path,
        options?.merge ? mockDeepMerge(mockDocs.get(path), data) : { ...data },
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
              options?.merge
                ? mockDeepMerge(mockDocs.get(ref.path), data)
                : { ...data },
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
  after: (callback: () => Promise<void>) => {
    mockDeferred.push(callback)
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__', delete: () => '__delete__' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  canManageOrg: mockOrganizations.canManageOrg,
  checkEntitlement: () => true,
  isValidOrgSlug: () => true,
  normalizePhone: mockContactTypes.normalizePhone,
  strandedDependents: () => [],
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
    firestore: {
      FieldValue: {
        serverTimestamp: () => '__now__',
        delete: () => '__delete__',
      },
    },
  },
  getOrgDoc: async (orgId: string) => {
    const stored = mockDocs.get(`orgs/${orgId}`)
    return stored ? { $id: orgId, ...stored } : null
  },
  OrgSlugTakenError: class extends Error {},
  changeOrgSlug: async () => ({ previousSlug: 'old' }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  listOrgMembers: async () => [],
  lockdownRefusal: async () => null,
  logOrgActivity: async () => undefined,
  memberHasOrgPermission: async () => true,
  // A customer with a Stripe customer, so the deferred sync gets past its
  // guards and the assertions below are about what it SENDS.
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_fixture' }),
  registerConsoleDomain: async () => ({ claim: true }),
  releasePendingConsoleDomain: async () => true,
  resolveOrgMembership: async (uid: string, orgId: string) => {
    const member = mockDocs.get(`orgs/${orgId}/members/${uid}`)
    return member ? { orgId, member: { $id: uid, ...member } } : null
  },
  transferOrgOwnership: async () => undefined,
  validateConsoleDomain: (domain: string) => ({ domain }),
}))

const { POST } = require('../app/api/orgs/settings/route') as {
  POST: (request: Request) => Promise<Response>
}

const ORG = 'org-7'

/** What Billing → Settings put on the org, and what must survive. */
const BILLING_ADDRESS = {
  line1: '4 Register Street',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
}

function post(body: unknown) {
  return new Request('https://app.aglyn.com/api/orgs/settings', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ orgId: ORG, ...(body as object) }),
  })
}

function seedOrg(): void {
  mockDocs.set(`orgs/${ORG}`, {
    name: 'Seven',
    slug: 'seven',
    ownerUid: 'owner-1',
    plan: 'pro',
    contact: {
      email: 'billing@example.test',
      phone: '+15125550101',
      website: 'https://example.test',
      address: { ...BILLING_ADDRESS },
    },
  })
  mockDocs.set(`orgs/${ORG}/members/owner-1`, { role: 'owner', allHosts: true })
}

/** The profile form's payload, plus the address fields it no longer sends. */
function profileBody(extra: Record<string, unknown> = {}) {
  return {
    action: 'update-profile',
    logoUrl: 'https://cdn.example.test/logo.png',
    contactEmail: 'billing@example.test',
    contactWebsite: 'https://example.test',
    ...extra,
  }
}

/** Run the deferred Stripe sync the route scheduled, if it scheduled one. */
async function runDeferred(): Promise<void> {
  for (const callback of mockDeferred) await callback()
}

/** The body of the one Stripe request, as a string. */
function stripeRequestBody(): string {
  expect(mockFetch).toHaveBeenCalledTimes(1)
  const [, init] = mockFetch.mock.calls[0] as [string, { body?: string }]
  return String(init?.body ?? '')
}

const originalStripeKey = process.env.STRIPE_SECRET_KEY

beforeEach(() => {
  mockDocs = new Map()
  mockWrites = []
  mockDeferred = []
  // A FIXTURE key. Localhost carries the live secret, and the deferred sync
  // returns early without one — so an unset key here would make every
  // assertion below vacuously true.
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture'
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'owner-1',
    email: 'owner@example.test',
    email_verified: true,
  })
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'cus_fixture' }),
  })
  global.fetch = mockFetch as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = originalStripeKey
  jest.restoreAllMocks()
})

describe('the org profile does not write the billing address', () => {
  it('leaves the stored address exactly as Billing → Settings left it', async () => {
    seedOrg()
    // The address fields the profile form used to post, carrying a DIFFERENT
    // address. A route that still read them would overwrite the stored one,
    // which is the production defect in its original form.
    const response = await POST(
      post(
        profileBody({
          contactAddressLine1: '99 Wrong Way',
          contactAddressCity: 'Nowhere',
          contactAddressState: 'ZZ',
          contactAddressPostalCode: '00000',
          contactAddressCountry: 'GB',
        }),
      ),
    )
    expect(response.status).toBe(200)

    const stored = mockDocs.get(`orgs/${ORG}`) as {
      contact: { address: unknown; email: string; website: string }
    }
    expect(stored.contact.address).toEqual(BILLING_ADDRESS)
    // And the rest of the profile did save, so this is not passing because
    // the whole write was refused.
    expect(stored.contact.website).toBe('https://example.test')
  })

  it('never names `address` in the write, which is what preserves it', async () => {
    seedOrg()
    await POST(post(profileBody({ contactAddressLine1: '99 Wrong Way' })))

    const profileWrite = mockWrites.find(
      (write) => write.path === `orgs/${ORG}` && 'contact' in write.data,
    )
    expect(profileWrite).toBeDefined()
    expect(profileWrite?.merge).toBe(true)
    // Named-with-an-empty-value would DELETE the stored address on a merge;
    // absent leaves it alone. The distinction is the fix, so assert the key
    // is missing rather than that its value is falsy.
    expect(Object.keys(profileWrite?.data.contact as object)).toEqual([
      'email',
      'phone',
      'website',
    ])
  })

  it('sends no address to Stripe, so the billing page stays authoritative', async () => {
    seedOrg()
    await POST(
      post(
        profileBody({
          contactPhone: '5125550199',
          contactAddressLine1: '99 Wrong Way',
          contactAddressCountry: 'GB',
        }),
      ),
    )
    await runDeferred()

    const body = stripeRequestBody()
    expect(body).not.toContain('address')
    expect(body).not.toContain('Wrong')
    expect(body).not.toContain('GB')
  })

  it('CONTROL: the same deferred call does carry the phone', async () => {
    // The point of this test is that the assertions above are about absence
    // in a call that HAPPENED. Without it, a deferred callback that returned
    // early — no customer, no key, an exception swallowed by the try — would
    // satisfy "no address was sent" while proving nothing at all.
    seedOrg()
    await POST(post(profileBody({ contactPhone: '5125550199' })))
    await runDeferred()

    expect(stripeRequestBody()).toBe('phone=%2B15125550199')
  })

  it('makes no Stripe call at all when there is no phone to push', async () => {
    // The old code read the customer back from Stripe here to record an
    // address divergence. There is no divergence to record once this action
    // cannot change the address, and a read on every logo change is a billed
    // request for an answer nobody uses.
    seedOrg()
    await POST(post(profileBody()))
    await runDeferred()

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
