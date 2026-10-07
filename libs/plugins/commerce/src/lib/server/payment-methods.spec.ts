/**
 * @jest-environment node
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
 * `GET|POST /api/commerce/payment-methods` — the merchant's payment methods
 * card (AGL-3629).
 *
 * Pinned here: who may read and who may change; that a save writes the
 * toggles AND asks Stripe for the capability of each method turned on, once,
 * with an idempotency key; that a method the platform does not offer is never
 * requested; that Stripe refusing the request is a warning rather than a lost
 * save; and that "Finish in Stripe" is the owner's alone.
 */

const mockVerifyIdToken = jest.fn()
const docs = new Map<string, Record<string, any>>()
let entitled = true
let locked: Response | null = null

function snapshot(path: string) {
  const data = docs.get(path)
  return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

function docRef(path: string): any {
  return {
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value)
    },
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
  }
}

const fakeFirestore = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => fakeFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  getOrgForHost: async () => ({ orgId: 'org-1', org: { ownerUid: 'owner-1', plan: 'business' } }),
  lockdownRefusal: async () => locked,
}))

jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  invalidIdTokenResponse: () => null,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: () => entitled,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    const text = request.method === 'POST' ? await request.text() : ''
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
        origin: request.headers.get('origin') ?? undefined,
        referer: request.headers.get('referer') ?? undefined,
        host: url.host,
      },
      body: text,
    }
  },
}))

import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import {
  capabilitiesToRequest,
  consoleReturnUrl,
  paymentMethodsHandler,
  resetPlatformPaymentMethodCacheForTests,
} from './payment-methods'

// ---------------------------------------------------------------------------
// Stripe boundary
// ---------------------------------------------------------------------------

interface Call {
  method: string
  url: string
  params: URLSearchParams
  headers: Record<string, string>
}
const calls: Call[] = []
let platformConfig: Record<string, any> | null = null
let capabilities: Record<string, string> = {}
let capabilityRefusal: string | null = null

const on = { available: true, display_preference: { value: 'on' } }
const off = { available: true, display_preference: { value: 'off' } }

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  const method = String(init?.method ?? 'GET')
  const params = new URLSearchParams(String(init?.body ?? ''))
  calls.push({ method, url: target, params, headers: (init?.headers ?? {}) as Record<string, string> })
  if (target.includes('/v1/payment_method_configurations')) {
    if (!platformConfig) {
      return { ok: false, status: 500, json: async () => ({ error: { message: 'down' } }) }
    }
    return {
      ok: true,
      json: async () => ({
        data: [
          // Another Connect application's configuration: never ours to read.
          { id: 'pmc_other', application: 'ca_other', is_default: true, klarna: off },
          { id: 'pmc_platform', application: null, is_default: true, ...platformConfig },
        ],
      }),
    }
  }
  if (target.includes('/v1/account_links')) {
    return { ok: true, json: async () => ({ url: 'https://connect.stripe.com/setup/x' }) }
  }
  if (target.includes('/v1/accounts/')) {
    if (method === 'POST') {
      if (capabilityRefusal) {
        return { ok: false, status: 400, json: async () => ({ error: { message: capabilityRefusal } }) }
      }
      for (const [key, value] of params.entries()) {
        const match = /^capabilities\[(.+)\]\[requested\]$/.exec(key)
        if (match && value === 'true') capabilities[match[1]] = 'pending'
      }
    }
    return { ok: true, json: async () => ({ id: 'acct_merchant', capabilities: { ...capabilities } }) }
  }
  throw new Error(`Unexpected fetch ${target}`)
})

const accountUpdates = () =>
  calls.filter((call) => call.method === 'POST' && call.url.includes('/v1/accounts/'))

function seed(roles: Record<string, string> = { 'owner-1': 'admin', 'admin-2': 'admin', 'editor-3': 'editor' }) {
  docs.clear()
  docs.set('hosts/host-1', { name: 'Acme', subdomain: 'acme', cname: 'shop.acme.com', memberRoles: roles })
  docs.set('profiles/owner-1', { stripeAccountId: 'acct_merchant' })
}

function call(
  uid: string,
  init: { method?: 'GET' | 'POST' | 'PUT'; body?: Record<string, unknown>; hostId?: string } = {},
) {
  mockVerifyIdToken.mockResolvedValue({ uid, email_verified: true })
  const method = init.method ?? 'GET'
  const query = method === 'GET' ? `?hostId=${init.hostId ?? 'host-1'}` : ''
  return paymentMethodsHandler(
    new Request(`https://app.aglyn.com/api/commerce/payment-methods${query}`, {
      method,
      headers: {
        authorization: 'Bearer token',
        origin: 'https://app.aglyn.com',
        referer: 'https://app.aglyn.com/sites/host-1/commerce/settings',
      },
      ...(method !== 'GET' && {
        body: JSON.stringify({ hostId: init.hostId ?? 'host-1', ...(init.body ?? {}) }),
      }),
    }),
  )
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  calls.length = 0
  fetchMock.mockClear()
  resetPlatformPaymentMethodCacheForTests()
  platformConfig = {
    apple_pay: on,
    google_pay: on,
    link: on,
    klarna: on,
    afterpay_clearpay: on,
    affirm: on,
    cashapp: on,
    amazon_pay: on,
    crypto: { available: false, display_preference: { value: 'off' } },
  }
  capabilities = { card_payments: 'active', transfers: 'active' }
  capabilityRefusal = null
  entitled = true
  locked = null
  seed()
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('reading the card', () => {
  it('reports each method against the platform’s own configuration and the payout account', async () => {
    const response = await call('editor-3')
    expect(response.status).toBe(200)
    const body = await response.json()
    const byId = Object.fromEntries(body.methods.map((row: any) => [row.id, row]))
    // The platform's default configuration, not the other application's.
    expect(byId.klarna).toEqual({ id: 'klarna', on: true, platform: 'on', capability: 'unrequested' })
    expect(byId.crypto).toMatchObject({ on: false, platform: 'unavailable' })
    // The card wallets ride `card_payments`: no capability verdict of their own.
    expect(byId.apple_pay.capability).toBeNull()
    expect(body.accountConnected).toBe(true)
    expect(body.canEdit).toBe(false)
    expect(body.canFinish).toBe(false)
    // The site's domains, including the custom domain's `www.` twin.
    expect(body.domains.map((domain: any) => domain.domain)).toEqual(
      expect.arrayContaining([`acme.${TENANT_APEX}`, 'shop.acme.com']),
    )
    // A read never changes anything at Stripe.
    expect(accountUpdates()).toHaveLength(0)
  })

  it('shows a verdict-less toggle when Stripe cannot be asked, rather than hiding a method', async () => {
    platformConfig = null
    const body = await (await call('owner-1')).json()
    expect(body.methods.every((row: any) => row.platform === null)).toBe(true)
  })

  it('answers the owner that they may save and finish', async () => {
    const body = await (await call('owner-1')).json()
    expect(body.canEdit).toBe(true)
    expect(body.canFinish).toBe(true)
  })

  it('is not found for a stranger, and refuses a missing token or host', async () => {
    expect((await call('stranger')).status).toBe(404)
    expect((await call('owner-1', { hostId: 'host-404' })).status).toBe(404)
    const anonymous = await paymentMethodsHandler(
      new Request('https://app.aglyn.com/api/commerce/payment-methods?hostId=host-1'),
    )
    expect(anonymous.status).toBe(401)
  })

  it('is refused off a commerce plan, under lockdown, and without Stripe configured', async () => {
    entitled = false
    expect((await call('owner-1')).status).toBe(402)
    entitled = true
    locked = Response.json({ error: 'locked' }, { status: 423 })
    expect((await call('owner-1')).status).toBe(423)
    locked = null
    delete process.env.STRIPE_SECRET_KEY
    expect((await call('owner-1')).status).toBe(501)
  })

  it('refuses any other verb', async () => {
    expect((await call('owner-1', { method: 'PUT', body: {} })).status).toBe(405)
  })
})

describe('saving', () => {
  it('writes the toggles and requests each capability turned on, in one keyed update', async () => {
    const response = await call('admin-2', {
      method: 'POST',
      body: { methods: { affirm: false, cashapp: false } },
    })
    expect(response.status).toBe(200)
    expect(docs.get('hosts/host-1/settings/store')).toMatchObject({
      paymentMethods: { affirm: false, cashapp: false },
      paymentMethodsUpdatedBy: 'admin-2',
    })
    const [update, ...rest] = accountUpdates()
    expect(rest).toHaveLength(0)
    const requested = [...update.params.keys()].sort()
    // On and offered: Klarna, Afterpay, Amazon Pay. Off: Affirm, Cash App.
    // Not offered by the platform: crypto. Never: the card wallets.
    expect(requested).toEqual([
      'capabilities[afterpay_clearpay_payments][requested]',
      'capabilities[amazon_pay_payments][requested]',
      'capabilities[klarna_payments][requested]',
    ])
    expect(update.headers['Idempotency-Key']).toBe(
      'aglyn-pm-capabilities:acct_merchant:afterpay_clearpay_payments,amazon_pay_payments,klarna_payments',
    )
    expect(update.headers['Stripe-Account']).toBeUndefined()
    const body = await response.json()
    const klarna = body.methods.find((row: any) => row.id === 'klarna')
    expect(klarna.capability).toBe('pending')
  })

  it('asks for nothing already requested', async () => {
    capabilities = {
      klarna_payments: 'active',
      afterpay_clearpay_payments: 'pending',
      affirm_payments: 'inactive',
      cashapp_payments: 'active',
      amazon_pay_payments: 'active',
    }
    await call('owner-1', { method: 'POST', body: { methods: { klarna: true } } })
    expect(accountUpdates()).toHaveLength(0)
  })

  it('opting into crypto requests it once the platform offers it', async () => {
    platformConfig!.crypto = on
    capabilities = {
      klarna_payments: 'active',
      afterpay_clearpay_payments: 'active',
      affirm_payments: 'active',
      cashapp_payments: 'active',
      amazon_pay_payments: 'active',
    }
    await call('owner-1', { method: 'POST', body: { methods: { crypto: true } } })
    const [update] = accountUpdates()
    expect([...update.params.keys()]).toEqual(['capabilities[crypto_payments][requested]'])
  })

  it('keeps the save and warns when Stripe refuses the capability request', async () => {
    capabilityRefusal = 'This capability is not available for this account'
    const response = await call('owner-1', { method: 'POST', body: { methods: { affirm: true } } })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.warnings[0]).toMatch(/did not accept/)
    expect(docs.get('hosts/host-1/settings/store')?.paymentMethods).toEqual({ affirm: true })
  })

  it('drops unknown ids and non-booleans, and refuses an empty save', async () => {
    const response = await call('owner-1', {
      method: 'POST',
      body: { methods: { paypal: true, klarna: 'yes' } },
    })
    expect(response.status).toBe(400)
    expect(docs.get('hosts/host-1/settings/store')).toBeUndefined()
  })

  it('is an admin’s: an editor reads but may not change', async () => {
    const response = await call('editor-3', { method: 'POST', body: { methods: { klarna: false } } })
    expect(response.status).toBe(403)
    expect(docs.get('hosts/host-1/settings/store')).toBeUndefined()
  })

  it('saves the toggles with no payout account and asks Stripe for nothing', async () => {
    docs.delete('profiles/owner-1')
    const response = await call('owner-1', { method: 'POST', body: { methods: { klarna: false } } })
    expect(response.status).toBe(200)
    expect((await response.json()).accountConnected).toBe(false)
    expect(accountUpdates()).toHaveLength(0)
  })
})

describe('finish in Stripe', () => {
  it('mints an onboarding link for the owner, returning to the page they were on', async () => {
    const response = await call('owner-1', { method: 'POST', body: { action: 'finish' } })
    expect(await response.json()).toEqual({ url: 'https://connect.stripe.com/setup/x' })
    const link = calls.find((entry) => entry.url.includes('account_links'))!
    expect(link.params.get('account')).toBe('acct_merchant')
    expect(link.params.get('collection_options[fields]')).toBe('currently_due')
    expect(link.params.get('return_url')).toBe('https://app.aglyn.com/sites/host-1/commerce/settings')
  })

  it('is refused to an admin who is not the owner', async () => {
    const response = await call('admin-2', { method: 'POST', body: { action: 'finish' } })
    expect(response.status).toBe(403)
    expect(calls.some((entry) => entry.url.includes('account_links'))).toBe(false)
  })
})

describe('helpers', () => {
  it('never sends Stripe back to a forged referer', () => {
    expect(
      consoleReturnUrl({ origin: 'https://app.aglyn.com', referer: 'https://evil.example/x' }),
    ).toBe('https://app.aglyn.com')
    expect(consoleReturnUrl({ host: 'app.aglyn.com' })).toBe('https://app.aglyn.com')
  })

  it('requests nothing the platform has positively turned off', () => {
    expect(
      capabilitiesToRequest({}, { klarna: 'unavailable', affirm: null }, {}),
    ).toEqual(
      expect.not.arrayContaining(['klarna_payments']),
    )
    expect(capabilitiesToRequest({}, { affirm: null }, {})).toContain('affirm_payments')
  })
})
