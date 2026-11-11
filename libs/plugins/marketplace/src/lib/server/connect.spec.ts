/**
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
 *
 * @jest-environment node
 */

/**
 * Stripe Connect onboarding for publishers (AGL-46/861, hardened by
 * AGL-1547). The account-creation request is the contract: without
 * explicitly requested capabilities, what the Express account can do
 * depends on unverified dashboard defaults — and a destination charge
 * needs the `transfers` capability on the destination or the sale can
 * never pay out.
 */

/** The caller's standing on "Manage marketplace payouts", and what was asked. */
const mockVerdict: { current: 'granted' | 'refused' | 'not-a-member' } = {
  current: 'granted',
}
const mockAsked: Array<[unknown, unknown, unknown]> = []
jest.mock('./publisher-permissions', () => ({
  publisherPermissionVerdict: async (uid: unknown, orgId: unknown, key: unknown) => {
    mockAsked.push([uid, orgId, key])
    return mockVerdict.current
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  buildRoute: (_route: string, params: Record<string, string>) =>
    `/${params.orgSlug}/marketplace`,
  Route: { ORG_MARKETPLACE: '/manage/marketplace' },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = {
    profile: undefined as Record<string, unknown> | undefined,
    profileWrites: [] as Array<Record<string, unknown>>,
  }
  const profileRef = {
    get: async () => ({
      exists: Boolean(state.profile),
      get: (field: string) => (state.profile ?? {})[field],
    }),
    set: async (data: Record<string, unknown>) => {
      state.profileWrites.push(data)
      state.profile = { ...(state.profile ?? {}), ...data }
    },
  }
  const orgRef = {
    get: async () => ({ get: () => 'acme' }),
  }
  return {
    __state: state,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({
            uid: 'owner-1',
            email: 'owner@example.com',
          }),
        }),
        firestore: () => ({
          collection: (name: string) => ({
            doc: () => (name === 'orgs' ? orgRef : profileRef),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
    getOrgForUser: async () => ({ orgId: 'seller-org', org: {} }),
  }
})

import { connectHandler } from './connect'

const state = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: {
      profile: Record<string, unknown> | undefined
      profileWrites: Array<Record<string, unknown>>
    }
  }
).__state

const stripeCalls: Array<{
  url: string
  method: string
  params: URLSearchParams
}> = []

/** What the fake Stripe account report says when the handler refreshes. */
let accountState: Record<string, unknown> = {}

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const makeReq = () =>
  ({
    method: 'POST',
    headers: {
      authorization: 'Bearer token',
      origin: 'https://console.aglyn.com',
    },
    body: { orgId: 'seller-org' },
  }) as any

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
})

beforeEach(() => {
  mockVerdict.current = 'granted'
  mockAsked.length = 0
  stripeCalls.length = 0
  state.profile = { handle: 'acme' }
  state.profileWrites.length = 0
  accountState = { charges_enabled: false, payouts_enabled: false }
  global.fetch = jest.fn(
    async (url: unknown, init?: { method?: string; body?: unknown }) => {
      const target = String(url)
      const call = {
        url: target,
        method: init?.method ?? 'GET',
        params: new URLSearchParams(String(init?.body ?? '')),
      }
      stripeCalls.push(call)
      const payload = target.endsWith('/accounts')
        ? { id: 'acct_new' }
        : target.includes('/account_links')
          ? { url: 'https://connect.stripe.com/setup/x' }
          : { id: 'acct_new', ...accountState }
      return { ok: true, json: async () => payload }
    },
  ) as unknown as typeof fetch
})

describe('Connect onboarding hardening (AGL-1547)', () => {
  it('requests card_payments AND transfers when creating the account', async () => {
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    const creation = stripeCalls.find(
      (call) => call.url.endsWith('/accounts') && call.method === 'POST',
    )
    expect(creation).toBeDefined()
    expect(creation?.params.get('type')).toBe('express')
    // Without these the account's abilities depend on dashboard defaults
    // nobody has verified — and a destination charge needs `transfers` on
    // the destination account or the seller can never be paid.
    expect(creation?.params.get('capabilities[card_payments][requested]')).toBe(
      'true',
    )
    expect(creation?.params.get('capabilities[transfers][requested]')).toBe(
      'true',
    )
    // Still onboarding: the caller gets the account-link URL.
    expect((res.body as { url?: string }).url).toContain('connect.stripe.com')
  })

  it('persists payouts readiness beside charges readiness on refresh', async () => {
    state.profile = { handle: 'acme', stripeAccountId: 'acct_new' }
    accountState = { charges_enabled: true, payouts_enabled: true }
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      accountId: 'acct_new',
      chargesEnabled: true,
      payoutsEnabled: true,
    })
    expect(
      state.profileWrites.some(
        (write) =>
          write['stripeChargesEnabled'] === true &&
          write['stripePayoutsEnabled'] === true,
      ),
    ).toBe(true)
  })
})

describe('setting up payouts asks "Manage marketplace payouts" (AGL-4047)', () => {
  it('asks the key of the acting workspace, never a role', async () => {
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(mockAsked).toEqual([['owner-1', 'seller-org', 'marketplace.payouts']])
  })

  it.each(['refused', 'not-a-member'] as const)(
    'a caller who is %s hears the permission named, and nothing reaches the payout account',
    async (verdict) => {
      mockVerdict.current = verdict
      const res = makeRes()
      await connectHandler(makeReq(), res)
      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({
        error:
          'Your role does not include "Manage marketplace payouts" — ask an organization admin',
        reason: 'permission',
        permission: 'marketplace.payouts',
      })
      expect(stripeCalls).toEqual([])
      expect(state.profileWrites).toEqual([])
    },
  )
})

/**
 * A test-mode payout account on a live deployment is replaced with a new live
 * one (AGL-2471), the commerce twin's rule: a live key cannot read it, so
 * resuming it failed every time. Stripe is the `global.fetch` fake.
 */
describe('a test account on a live deployment (AGL-2471)', () => {
  const TEST_ACCOUNT = 'acct_test_old'
  let realFetch: typeof fetch

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_spec'
    realFetch = global.fetch
    global.fetch = jest.fn(async (url: unknown, init?: any) => {
      const target = String(url)
      if (target.endsWith(`/accounts/${TEST_ACCOUNT}`)) {
        stripeCalls.push({ url: target, method: 'GET', params: new URLSearchParams() })
        return {
          ok: false,
          json: async () => ({
            error: {
              message:
                `The account ${TEST_ACCOUNT} was a test account created with a ` +
                'testmode key, and therefore can only be used with testmode keys.',
            },
          }),
        }
      }
      return (realFetch as any)(url, init)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
  })

  it('creates a new account and keeps the replaced id, for a recorded test account', async () => {
    state.profile = {
      handle: 'acme',
      stripeAccountId: TEST_ACCOUNT,
      stripeChargesEnabled: true,
      stripeAccountLivemode: false,
    }
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(stripeCalls.some((call) => call.url.includes(TEST_ACCOUNT))).toBe(false)
    const creation = stripeCalls.find(
      (call) => call.url.endsWith('/accounts') && call.method === 'POST',
    )
    expect(creation?.params.get('metadata[replacesAccount]')).toBe(TEST_ACCOUNT)
    expect(res.body).toMatchObject({ accountId: 'acct_new', chargesEnabled: false })
    expect(state.profile).toMatchObject({
      stripeAccountId: 'acct_new',
      previousStripeAccountIds: [TEST_ACCOUNT],
      stripeAccountLivemode: true,
    })
  })

  it('replaces an unrecorded-mode account Stripe refuses as a test account', async () => {
    state.profile = {
      handle: 'acme',
      stripeAccountId: TEST_ACCOUNT,
      stripeChargesEnabled: true,
    }
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(state.profile).toMatchObject({
      stripeAccountId: 'acct_new',
      previousStripeAccountIds: [TEST_ACCOUNT],
    })
  })
})
