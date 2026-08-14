/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * `release_addon_store` closes the PURCHASE PATH, not just the card
 * (AGL-1653).
 *
 * The Billing page drops the "Plan add-ons" card on
 * `useReleaseFlag('release_addon_store').visible`. Until this fix that was the
 * only gate in existence: with the flag off the card vanished while
 * `POST /api/billing/addons` kept accepting `set` and kept reaching Stripe.
 * That is the AGL-1604 shape — a flag whose name does not describe what it
 * gates — with a subscription write on the open side of the split, which is
 * why it is the one that matters. The flag defaults ON, so the leak is latent;
 * it becomes real the instant anyone uses the flag as the kill switch its
 * description promises.
 *
 * The assertion surface is `fetch`. A 404 alone would not prove much — the
 * claim is that STRIPE IS NEVER REACHED, so every case asserts the call count
 * at the network boundary as well as the status.
 *
 * The gate mirrors the card exactly, so the suite pins both halves:
 *   - flag off, non-staff  → 404, zero Stripe calls
 *   - flag on              → past the gate, Stripe reached
 *   - flag off, STAFF      → past the gate (the card is `released || isStaff`,
 *                            so the audience that still sees it can still use
 *                            it — a staff-blind gate would 404 a visible card)
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and never calls out;
 * localhost carries the LIVE key.
 */

const ORG_ID = 'org-1'

/** Whether `isServerReleaseFlagOnForOrg` should answer true. */
let mockFlagOn: boolean
/** Whether the caller's token carries the staff claim. */
let mockIsStaff: boolean
/** Every `(flagKey, orgId)` the route asked the release gate about. */
let mockGateCalls: Array<[string, string | null | undefined]>
/** Stripe URLs captured at the `fetch` boundary. */
let mockStripeCalls: string[]

const orgRef = {
  get: async () => ({
    data: () => ({ plan: 'pro' }),
  }),
  set: async () => undefined,
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'user-1',
          email_verified: true,
          staff: mockIsStaff,
        }),
      }),
      firestore: () => ({
        collection: () => ({ doc: () => orgRef }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  // Permission is granted throughout, so a 403 can never be mistaken for the
  // release gate doing its job.
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  isServerReleaseFlagOnForOrg: async (
    flagKey: string,
    orgId: string | null | undefined,
  ) => {
    mockGateCalls.push([flagKey, orgId])
    return mockFlagOn
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan model: the ceilings and the interval logic downstream of the
  // gate stay honest, so "past the gate" means the route genuinely proceeded.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { POST } from '../app/api/billing/addons/route'

async function callAddons(action: 'get' | 'preview' | 'set', extra = {}) {
  return POST(
    new Request('https://app.aglyn.com/api/billing/addons', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ orgId: ORG_ID, action, ...extra }),
    }),
  )
}

const ORIGINAL_FETCH = global.fetch

beforeEach(() => {
  // A FAKE key. The route 501s without one, so it must be set for the gate to
  // be the thing under test — but no request leaves the process.
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
  mockFlagOn = true
  mockIsStaff = false
  mockGateCalls = []
  mockStripeCalls = []
  global.fetch = jest.fn(async (url: any) => {
    mockStripeCalls.push(String(url))
    if (String(url).includes('api.stripe.com')) {
      // No subscription: enough for the route to answer, and it means every
      // "past the gate" case still stops short of a real subscription write.
      return { ok: true, json: async () => ({ data: [] }) } as any
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as any
})

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  delete process.env.STRIPE_SECRET_KEY
})

describe('the add-on store stops selling when its flag is off', () => {
  it.each(['get', 'preview', 'set'] as const)(
    'refuses `%s` and never reaches Stripe',
    async (action) => {
      mockFlagOn = false
      const response = await callAddons(action, {
        kind: 'datasets',
        quantity: 3,
      })
      expect(response.status).toBe(404)
      // The claim that matters: not merely that the caller got an error, but
      // that no Stripe request was ever attempted.
      expect(mockStripeCalls).toEqual([])
    },
  )

  it('asks about the right flag, for the right org', async () => {
    // A gate wired to the wrong key would gate on something else's rollout and
    // pass this suite's on/off cases by accident.
    mockFlagOn = false
    await callAddons('set', { kind: 'datasets', quantity: 1 })
    expect(mockGateCalls).toEqual([['release_addon_store', ORG_ID]])
  })
})

describe('the gate is conditional, not a removal', () => {
  it.each(['get', 'preview', 'set'] as const)(
    'lets `%s` through and reaches Stripe when the flag is on',
    async (action) => {
      mockFlagOn = true
      const response = await callAddons(action, {
        kind: 'datasets',
        quantity: 3,
      })
      expect(response.status).not.toBe(404)
      expect(mockStripeCalls.length).toBeGreaterThan(0)
      expect(mockStripeCalls[0]).toContain('api.stripe.com')
    },
  )

  it('lets staff through while the flag is off', async () => {
    // The card is `released || isStaff`, so staff still SEE it. A gate without
    // the bypass would 404 a button that is on screen for the one audience
    // meant to be previewing the feature.
    mockFlagOn = false
    mockIsStaff = true
    const response = await callAddons('get')
    expect(response.status).toBe(200)
    expect(mockStripeCalls.length).toBeGreaterThan(0)
    // Staff skip the gate entirely rather than being force-passed by it.
    expect(mockGateCalls).toEqual([])
  })
})
