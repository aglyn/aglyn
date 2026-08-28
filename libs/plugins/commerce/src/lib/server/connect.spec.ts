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
 * Storefront Connect onboarding (AGL-284), hardened by AGL-1994.
 *
 * The account-creation request is the contract. The storefront charge is a
 * DESTINATION charge — `checkout.ts` sends
 * `payment_intent_data[transfer_data][destination]` — so the merchant's
 * Express account must hold the `transfers` capability or the sale takes
 * money that can never reach them. Requesting it explicitly is the only way
 * that does not depend on unverified dashboard platform-profile defaults.
 *
 * This route had NO spec before AGL-1994, which is why the marketplace twin
 * could be fixed (AGL-1547) while the commerce path stayed broken: nothing
 * here could go red.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  buildRoute: (_route: string, params: Record<string, string>) =>
    `/${params.orgSlug}/${params.host}/${params.pluginSlug}`,
  Route: { HOST_PLUGIN: '/:orgSlug/:host/:pluginSlug' },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = {
    profile: undefined as Record<string, unknown> | undefined,
    profileWrites: [] as Array<Record<string, unknown>>,
    ownerUid: 'owner-1' as string | undefined,
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
  const hostIndexRef = {
    get: async () => ({ get: () => 'shop' }),
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
            doc: () => (name === 'hostIndex' ? hostIndexRef : profileRef),
          }),
        }),
      }),
    },
    getOrgForHost: async () => ({
      orgId: 'merchant-org',
      org: { ownerUid: state.ownerUid, slug: 'acme' },
    }),
  }
})

import { connectHandler } from './connect'

const state = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: {
      profile: Record<string, unknown> | undefined
      profileWrites: Array<Record<string, unknown>>
      ownerUid: string | undefined
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
    body: { hostId: 'host-1' },
  }) as any

const creationCall = () =>
  stripeCalls.find(
    (call) => call.url.endsWith('/accounts') && call.method === 'POST',
  )

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
})

beforeEach(() => {
  stripeCalls.length = 0
  state.profile = {}
  state.profileWrites.length = 0
  state.ownerUid = 'owner-1'
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
          : target.includes('/login_links')
            ? { url: 'https://connect.stripe.com/express/dash/y' }
            : { id: 'acct_new', ...accountState }
      return { ok: true, json: async () => payload }
    },
  ) as unknown as typeof fetch
})

describe('Storefront Connect onboarding hardening (AGL-1994)', () => {
  it('requests card_payments AND transfers when creating the account', async () => {
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    const creation = creationCall()
    expect(creation).toBeDefined()
    expect(creation?.params.get('type')).toBe('express')
    // `transfers` is the load-bearing one: checkout.ts pays the merchant
    // with `transfer_data[destination]`, and a destination without the
    // capability takes money that can never pay out.
    expect(creation?.params.get('capabilities[card_payments][requested]')).toBe(
      'true',
    )
    expect(creation?.params.get('capabilities[transfers][requested]')).toBe(
      'true',
    )
    // The commerce metadata the marketplace twin does not carry survives.
    expect(creation?.params.get('metadata[purpose]')).toBe('commerce')
    expect(creation?.params.get('metadata[profileId]')).toBe('owner-1')
  })

  // Positive control for the guard above: a merchant mid-onboarding still
  // gets a usable account link. If the capability assertion were satisfied
  // by the route simply refusing to create accounts, this would fail.
  it('still hands a mid-onboarding merchant their account link', async () => {
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ accountId: 'acct_new' })
    expect((res.body as { chargesEnabled: boolean }).chargesEnabled).toBe(false)
    expect((res.body as { url?: string }).url).toContain('connect.stripe.com')
  })

  it('persists payouts readiness beside charges readiness on refresh', async () => {
    state.profile = { stripeAccountId: 'acct_new' }
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
    // Positive control: a merchant who IS ready is not re-onboarded — the
    // existing account is reused, so the fix cannot be "create every time".
    expect(creationCall()).toBeUndefined()
  })

  it('records charges-yes/payouts-no rather than leaving it unwritten', async () => {
    state.profile = { stripeAccountId: 'acct_new' }
    accountState = { charges_enabled: true, payouts_enabled: false }
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    // The stranded-funds shape: the merchant can take money and cannot be
    // paid it. It has to be `false` on the profile, not absent — an absent
    // field reads the same as "not checked yet" to every console surface.
    const write = state.profileWrites.find(
      (candidate) => 'stripePayoutsEnabled' in candidate,
    )
    expect(write).toBeDefined()
    expect(write?.['stripePayoutsEnabled']).toBe(false)
    expect(res.body).toMatchObject({
      chargesEnabled: true,
      payoutsEnabled: false,
    })
  })

  // AGL-2471 -----------------------------------------------------------------

  it('records WHICH STRIPE WORLD the account belongs to', async () => {
    // The field the money doors compare against the platform's own mode. It
    // did not exist, which is why three production linkages naming TEST
    // accounts read as payments-ready. `sk_test_spec` is the key this suite
    // runs under, so `false` is the correct verdict here.
    state.profile = { stripeAccountId: 'acct_new' }
    accountState = { charges_enabled: true, payouts_enabled: true }
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    const write = state.profileWrites.find(
      (candidate) => 'stripeAccountLivemode' in candidate,
    )
    expect(write).toBeDefined()
    expect(write?.['stripeAccountLivemode']).toBe(false)
  })

  it('re-records the mode on EVERY refresh, so a new account cannot inherit one', async () => {
    // Re-onboarding rewrites `stripeAccountId` on a document that may still
    // carry the previous account's verdict. The write is unconditional for
    // exactly that reason — a stale `true` here is a test account wearing a
    // live account's clearance.
    state.profile = {
      stripeAccountId: 'acct_new',
      stripeAccountLivemode: true,
    }
    accountState = { charges_enabled: true, payouts_enabled: true }
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(state.profile?.['stripeAccountLivemode']).toBe(false)
  })

  // Positive control on the authorization gate: the route must still refuse
  // a non-owner, so the tests above are not passing because everything 200s.
  it('refuses a caller who does not own the site', async () => {
    state.ownerUid = 'someone-else'
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(403)
    expect(creationCall()).toBeUndefined()
  })
})

/**
 * A CONNECTED MERCHANT STILL NEEDS A DOOR INTO STRIPE (AGL-2510).
 *
 * The route returned the moment `charges_enabled` was true, with a status and
 * no link of any kind, and the console card read `chargesEnabled` before it
 * ever looked for a url. So the state that most needs Stripe — charges on,
 * payouts NOT released, funds piling up in an account that cannot pay them out
 * — drove a button labelled "Finish payout setup in Stripe" that went nowhere.
 * An Express account has no password and no direct login, so a link minted
 * here is the merchant's only way in.
 *
 * Asserted on the CALL and the link it returns, never on anything rendered.
 */
describe('a charges-enabled merchant gets a link (AGL-2510)', () => {
  beforeEach(() => {
    state.profile = { stripeAccountId: 'acct_new' }
  })

  it('mints a remediation link when payouts are not released', async () => {
    accountState = { charges_enabled: true, payouts_enabled: false }
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      chargesEnabled: true,
      payoutsEnabled: false,
      url: 'https://connect.stripe.com/setup/x',
    })
    // The remediation flow, not the dashboard: an account with outstanding
    // requirements needs onboarding, and Stripe says so.
    expect(
      stripeCalls.some(
        (call) =>
          call.url.includes('/account_links') &&
          call.params.get('type') === 'account_onboarding',
      ),
    ).toBe(true)
  })

  it('mints an Express dashboard link when payouts are flowing', async () => {
    // The other half of the gap: Aglyn records no balance, no payout schedule
    // and handles no `payout.failed`, so this link is the only way a merchant
    // can see where their money is.
    accountState = { charges_enabled: true, payouts_enabled: true }
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      chargesEnabled: true,
      payoutsEnabled: true,
      dashboardUrl: 'https://connect.stripe.com/express/dash/y',
    })
    expect(
      stripeCalls.some((call) => call.url.includes('/login_links')),
    ).toBe(true)
  })

  it('CONTROL: a mid-onboarding merchant is unaffected', async () => {
    // The pre-existing path must keep answering exactly as it did — the change
    // is additive, and a suite that only pinned the new arms could not say so.
    accountState = { charges_enabled: false, payouts_enabled: false }
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.body).toMatchObject({
      chargesEnabled: false,
      url: 'https://connect.stripe.com/setup/x',
    })
  })

  it('still reports status when the dashboard link cannot be minted', async () => {
    // A convenience link must never turn a working status check into an error:
    // the merchant is told payouts are on, just without the shortcut.
    accountState = { charges_enabled: true, payouts_enabled: true }
    const realFetch = global.fetch
    global.fetch = jest.fn(async (url: unknown, init?: any) => {
      const target = String(url)
      if (target.includes('/login_links')) {
        return { ok: false, json: async () => ({ error: { message: 'no' } }) }
      }
      return (realFetch as any)(url, init)
    }) as unknown as typeof fetch
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ chargesEnabled: true, payoutsEnabled: true })
    expect((res.body as { dashboardUrl?: string }).dashboardUrl).toBeUndefined()
  })
})
