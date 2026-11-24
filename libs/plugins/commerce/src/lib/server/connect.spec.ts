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
    /** `release_direct_charges` for the merchant org. */
    directCharges: false,
    /** `hosts/{hostId}`: the site's business details (AGL-4245). */
    host: undefined as Record<string, unknown> | undefined,
    /** Reading `hosts/{hostId}` fails. */
    hostReadFails: false,
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
  const hostRef = {
    get: async () => {
      if (state.hostReadFails) throw new Error('permission denied')
      return { exists: Boolean(state.host), data: () => state.host }
    },
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
            doc: () =>
              name === 'hostIndex' ? hostIndexRef : name === 'hosts' ? hostRef : profileRef,
          }),
        }),
      }),
    },
    getOrgForHost: async () => ({
      orgId: 'merchant-org',
      org: { ownerUid: state.ownerUid, slug: 'acme' },
    }),
    isServerReleaseFlagOnForOrg: async (flag: string, orgId: string | null) =>
      flag === 'release_direct_charges' && orgId === 'merchant-org' && state.directCharges,
  }
})

import { connectHandler } from './connect'

const state = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: {
      profile: Record<string, unknown> | undefined
      profileWrites: Array<Record<string, unknown>>
      ownerUid: string | undefined
      directCharges: boolean
      host: Record<string, unknown> | undefined
      hostReadFails: boolean
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
  state.host = undefined
  state.hostReadFails = false
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

  it('creates a full, Stripe-billed account when the org has direct charges on', async () => {
    state.directCharges = true
    try {
      accountState = {
        ...accountState,
        controller: { fees: { payer: 'account' }, stripe_dashboard: { type: 'full' } },
      }
      const res = makeRes()
      await connectHandler(makeReq(), res)
      expect(res.statusCode).toBe(200)
      const creation = creationCall()
      expect(creation?.params.get('type')).toBeNull()
      expect(creation?.params.get('controller[fees][payer]')).toBe('account')
      expect(creation?.params.get('controller[losses][payments]')).toBe('stripe')
      expect(creation?.params.get('controller[stripe_dashboard][type]')).toBe('full')
      expect(creation?.params.get('capabilities[transfers][requested]')).toBe('true')
      // The shape is read back off the account and recorded for every sale.
      expect(state.profile?.['stripeChargeModel']).toBe('direct')
    } finally {
      state.directCharges = false
    }
  })

  it('records an Express account as destination', async () => {
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(state.profile?.['stripeChargeModel']).toBe('destination')
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
 * A CONNECTED MERCHANT STILL NEEDS A DOOR INTO STRIPE.
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
describe('a charges-enabled merchant gets a link', () => {
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

/**
 * A TEST ACCOUNT ON A LIVE DEPLOYMENT IS REPLACED, NEVER RESUMED (AGL-2471).
 *
 * The production record that stopped a store selling: `stripeChargesEnabled:
 * true`, `stripeAccountLivemode: false`, a direct-charge account, under a live
 * key. A live key cannot even read a test account, so resuming it answered
 * "Payment setup failed" every time. The route has to start onboarding for a
 * NEW account in this deployment's mode, keep the replaced id, and never hand
 * back a link for the test account.
 *
 * Stripe is a fake here: every call is `global.fetch`, mocked below.
 */
describe('a test account on a live deployment (AGL-2471)', () => {
  const TEST_ACCOUNT = 'acct_test_old'
  const CROSS_MODE =
    `The account ${TEST_ACCOUNT} was a test account created with a testmode ` +
    'key, and therefore can only be used with testmode keys.'
  /** What the fake Stripe answers when the stored account is read. */
  let storedAccountRead: 'cross-mode' | 'ok' | 'outage' = 'cross-mode'

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_spec'
    storedAccountRead = 'cross-mode'
    accountState = { charges_enabled: false, payouts_enabled: false }
    global.fetch = jest.fn(
      async (url: unknown, init?: { method?: string; body?: unknown }) => {
        const target = String(url)
        const method = init?.method ?? 'GET'
        stripeCalls.push({
          url: target,
          method,
          params: new URLSearchParams(String(init?.body ?? '')),
        })
        if (target.endsWith('/balance')) {
          return { ok: true, json: async () => ({ livemode: true }) }
        }
        if (target.endsWith(`/accounts/${TEST_ACCOUNT}`)) {
          if (storedAccountRead === 'cross-mode') {
            return {
              ok: false,
              json: async () => ({ error: { message: CROSS_MODE } }),
            }
          }
          if (storedAccountRead === 'outage') {
            return {
              ok: false,
              json: async () => ({
                error: { message: 'An error occurred with our connection to Stripe.' },
              }),
            }
          }
          return {
            ok: true,
            json: async () => ({
              id: TEST_ACCOUNT,
              charges_enabled: true,
              payouts_enabled: true,
            }),
          }
        }
        const payload = target.endsWith('/accounts')
          ? { id: 'acct_live_new' }
          : target.includes('/account_links')
            ? { url: 'https://connect.stripe.com/setup/live' }
            : { id: 'acct_live_new', ...accountState }
        return { ok: true, json: async () => payload }
      },
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
    state.directCharges = false
  })

  const testAccountProfile = (extra: Record<string, unknown> = {}) => ({
    stripeAccountId: TEST_ACCOUNT,
    stripeChargeModel: 'direct',
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeAccountLivemode: false,
    ...extra,
  })

  it('creates a NEW live account instead of reusing the recorded test one', async () => {
    state.directCharges = true
    state.profile = testAccountProfile()
    accountState = {
      charges_enabled: false,
      payouts_enabled: false,
      controller: { fees: { payer: 'account' }, stripe_dashboard: { type: 'full' } },
    }
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    // The test account is never read (a live key cannot) and never linked.
    expect(stripeCalls.some((call) => call.url.includes(TEST_ACCOUNT))).toBe(false)
    const creation = creationCall()
    expect(creation).toBeDefined()
    // Every new setup's shape: the store's own account, direct charges.
    expect(creation?.params.get('controller[fees][payer]')).toBe('account')
    expect(creation?.params.get('metadata[replacesAccount]')).toBe(TEST_ACCOUNT)
    const link = stripeCalls.find((call) => call.url.includes('/account_links'))
    expect(link?.params.get('account')).toBe('acct_live_new')
    expect(res.body).toMatchObject({
      accountId: 'acct_live_new',
      chargesEnabled: false,
      url: 'https://connect.stripe.com/setup/live',
    })
    // The replaced id is kept; the new account's own facts are recorded.
    expect(state.profile).toMatchObject({
      stripeAccountId: 'acct_live_new',
      previousStripeAccountIds: [TEST_ACCOUNT],
      stripeChargeModel: 'direct',
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeAccountLivemode: true,
    })
  })

  it('replaces an UNRECORDED-mode account when Stripe refuses it as the other mode', async () => {
    state.profile = testAccountProfile({ stripeAccountLivemode: undefined })
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(creationCall()).toBeDefined()
    expect(state.profile).toMatchObject({
      stripeAccountId: 'acct_live_new',
      previousStripeAccountIds: [TEST_ACCOUNT],
      stripeAccountLivemode: true,
    })
    expect(res.body).toMatchObject({ url: 'https://connect.stripe.com/setup/live' })
  })

  it('CONTROL: an unrecorded-mode account the live key CAN read is kept and verified', async () => {
    // A read that succeeds is the proof the account is in this mode, so it
    // is recorded live and nothing is created.
    storedAccountRead = 'ok'
    state.profile = testAccountProfile({ stripeAccountLivemode: undefined })
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(creationCall()).toBeUndefined()
    expect(state.profile).toMatchObject({
      stripeAccountId: TEST_ACCOUNT,
      stripeAccountLivemode: true,
    })
    expect(state.profile?.['previousStripeAccountIds']).toBeUndefined()
  })

  it('CONTROL: any other Stripe failure retires nothing', async () => {
    storedAccountRead = 'outage'
    state.profile = testAccountProfile({ stripeAccountLivemode: undefined })
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(502)
    expect(creationCall()).toBeUndefined()
    expect(state.profileWrites).toHaveLength(0)
  })

  it('CONTROL: a live account recorded live is reused', async () => {
    state.profile = testAccountProfile({
      stripeAccountId: 'acct_live_new',
      stripeAccountLivemode: true,
    })
    accountState = { charges_enabled: true, payouts_enabled: true }
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(creationCall()).toBeUndefined()
    expect(state.profile?.['stripeAccountId']).toBe('acct_live_new')
  })

  it('keeps every replaced id, once', async () => {
    state.profile = testAccountProfile({
      previousStripeAccountIds: ['acct_older', TEST_ACCOUNT],
    })
    const res = makeRes()

    await connectHandler(makeReq(), res)

    expect(state.profile?.['previousStripeAccountIds']).toEqual([
      'acct_older',
      TEST_ACCOUNT,
    ])
  })
})

describe('Stripe setup prefill, return and requirements (AGL-4245)', () => {
  const site = {
    displayName: 'Acme Shop',
    subdomain: 'acme',
    seo: {
      entity: {
        name: 'Acme Goods LLC',
        email: 'hello@acme.test',
        telephone: '+1 512 555 0100',
        address: {
          streetAddress: '1 Main St',
          addressLocality: 'Austin',
          addressRegion: 'TX',
          postalCode: '78701',
          addressCountry: 'United States',
        },
      },
    },
  }

  it('creates the account with the site business details filled in', async () => {
    state.host = site
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    const params = creationCall()?.params
    expect(params?.get('business_profile[name]')).toBe('Acme Goods LLC')
    expect(params?.get('business_profile[url]')).toBe('https://acme.aglyn.app')
    expect(params?.get('business_profile[support_email]')).toBe('hello@acme.test')
    expect(params?.get('business_profile[support_phone]')).toBe('+1 512 555 0100')
    // Nothing on the legal entity: a prefilled country or address would
    // narrow which existing Stripe business the owner can reuse.
    const entityKeys = [...(params?.keys() ?? [])].filter(
      (key) =>
        key === 'country' ||
        key === 'business_type' ||
        key.startsWith('company') ||
        key.startsWith('individual') ||
        key.includes('address'),
    )
    expect(entityKeys).toEqual([])
    // The owner's sign-in email stays the account email.
    expect(params?.get('email')).toBe('owner@example.com')
  })

  it('keeps the account shape exactly when it prefills', async () => {
    state.host = site
    state.directCharges = true
    try {
      await connectHandler(makeReq(), makeRes())
      const params = creationCall()?.params
      expect(params?.get('controller[fees][payer]')).toBe('account')
      expect(params?.get('controller[losses][payments]')).toBe('stripe')
      expect(params?.get('controller[requirement_collection]')).toBe('stripe')
      expect(params?.get('controller[stripe_dashboard][type]')).toBe('full')
      expect(params?.get('type')).toBeNull()
    } finally {
      state.directCharges = false
    }
  })

  it('retries the create without the prefill when Stripe refuses a prefill field', async () => {
    state.host = site
    const realFetch = global.fetch
    let creates = 0
    global.fetch = jest.fn(async (url: unknown, init?: any) => {
      if (String(url).endsWith('/accounts') && init?.method === 'POST') {
        creates += 1
        if (creates === 1) {
          stripeCalls.push({
            url: String(url),
            method: 'POST',
            params: new URLSearchParams(String(init?.body ?? '')),
          })
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: { message: 'Invalid phone number' } }),
          }
        }
      }
      return (realFetch as any)(url, init)
    }) as unknown as typeof fetch
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const res = makeRes()
    await connectHandler(makeReq(), res)
    warn.mockRestore()
    expect(res.statusCode).toBe(200)
    expect(state.profile?.['stripeAccountId']).toBe('acct_new')
    const creates2 = stripeCalls.filter(
      (call) => call.url.endsWith('/accounts') && call.method === 'POST',
    )
    expect(creates2).toHaveLength(2)
    expect(creates2[0]?.params.get('business_profile[name]')).toBe('Acme Goods LLC')
    expect(creates2[1]?.params.get('business_profile[name]')).toBeNull()
    expect(creates2[1]?.params.get('business_profile[url]')).toBeNull()
    expect(creates2[1]?.params.get('capabilities[transfers][requested]')).toBe('true')
  })

  it('CONTROL: a refusal that is not a 400 is still the 502', async () => {
    state.host = site
    const realFetch = global.fetch
    global.fetch = jest.fn(async (url: unknown, init?: any) => {
      if (String(url).endsWith('/accounts') && init?.method === 'POST') {
        return { ok: false, status: 500, json: async () => ({ error: { message: 'down' } }) }
      }
      return (realFetch as any)(url, init)
    }) as unknown as typeof fetch
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = makeRes()
    await connectHandler(makeReq(), res)
    error.mockRestore()
    expect(res.statusCode).toBe(502)
  })

  it('sets up payments when the site cannot be read, with no prefill', async () => {
    state.hostReadFails = true
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const res = makeRes()
    await connectHandler(makeReq(), res)
    warn.mockRestore()
    expect(res.statusCode).toBe(200)
    expect(creationCall()?.params.get('business_profile[name]')).toBeNull()
  })

  it('sends Stripe back to the Payments section, done and refresh', async () => {
    await connectHandler(makeReq(), makeRes())
    const link = stripeCalls.find((call) => call.url.includes('/account_links'))
    expect(link?.params.get('return_url')).toBe(
      'https://console.aglyn.com/acme/shop/products/payments?connect=done',
    )
    expect(link?.params.get('refresh_url')).toBe(
      'https://console.aglyn.com/acme/shop/products/payments?connect=refresh',
    )
  })

  it('records what Stripe still needs, as counts and a deadline', async () => {
    accountState = {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: {
        currently_due: ['individual.verification.document', 'external_account'],
        past_due: ['external_account'],
        current_deadline: 1_900_000_000,
        disabled_reason: null,
      },
    }
    state.profile = { stripeAccountId: 'acct_new', stripeAccountLivemode: false }
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(state.profile).toMatchObject({
      stripeDetailsSubmitted: true,
      stripeRequirementsDueCount: 2,
      stripeRequirementsPastDueCount: 1,
      stripeRequirementsDeadlineMs: 1_900_000_000_000,
      stripeDisabledReason: null,
    })
    // Stripe's own keys never reach the profile.
    expect(JSON.stringify(state.profile)).not.toContain('verification.document')
    // Payouts flowing and details due: the dashboard AND the link to continue.
    expect(res.body).toMatchObject({
      chargesEnabled: true,
      payoutsEnabled: true,
      needsDetails: true,
      url: 'https://connect.stripe.com/setup/x',
      dashboardUrl: 'https://connect.stripe.com/express/dash/y',
    })
  })

  it('CONTROL: nothing due mints no onboarding link for a ready account', async () => {
    accountState = {
      charges_enabled: true,
      payouts_enabled: true,
      requirements: { currently_due: [], past_due: [], current_deadline: null },
    }
    state.profile = { stripeAccountId: 'acct_new', stripeAccountLivemode: false }
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(stripeCalls.some((call) => call.url.includes('/account_links'))).toBe(false)
    expect(res.body).toMatchObject({ needsDetails: false })
    expect((res.body as { url?: string }).url).toBeUndefined()
  })

  const updateCalls = () =>
    stripeCalls.filter(
      (call) => /\/accounts\/acct_[^/]+$/.test(call.url) && call.method === 'POST',
    )

  it('fills in the business profile on re-entry for an account mid-onboarding', async () => {
    state.host = site
    state.profile = { stripeAccountId: 'acct_old', stripeAccountLivemode: false }
    accountState = {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      business_profile: { name: 'Typed in Stripe', url: null },
    }
    const res = makeRes()
    await connectHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    const updates = updateCalls()
    expect(updates).toHaveLength(1)
    // Only what the account does not hold yet: the name typed in Stripe stays.
    expect(updates[0]?.params.get('business_profile[name]')).toBeNull()
    expect(updates[0]?.params.get('business_profile[url]')).toBe('https://acme.aglyn.app')
    expect(updates[0]?.params.get('country')).toBeNull()
  })

  it('a refused re-entry update does not stop setup', async () => {
    state.host = site
    state.profile = { stripeAccountId: 'acct_old', stripeAccountLivemode: false }
    accountState = { charges_enabled: false, payouts_enabled: false, details_submitted: false }
    const realFetch = global.fetch
    global.fetch = jest.fn(async (url: unknown, init?: any) => {
      if (/\/accounts\/acct_old$/.test(String(url)) && init?.method === 'POST') {
        return { ok: false, status: 400, json: async () => ({ error: { message: 'nope' } }) }
      }
      return (realFetch as any)(url, init)
    }) as unknown as typeof fetch
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const res = makeRes()
    await connectHandler(makeReq(), res)
    warn.mockRestore()
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ url: 'https://connect.stripe.com/setup/x' })
  })

  it('CONTROL: an account that finished onboarding is never updated', async () => {
    state.host = site
    state.profile = { stripeAccountId: 'acct_old', stripeAccountLivemode: false }
    accountState = { charges_enabled: false, payouts_enabled: false, details_submitted: true }
    await connectHandler(makeReq(), makeRes())
    expect(updateCalls()).toHaveLength(0)
  })
})
