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
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import { cartCheckoutHandler } from './cart-checkout'
import { checkoutHandler } from './checkout'

/**
 * The merchant's payment method choices reach the Checkout Session, and the
 * page the shopper pays on is registered for wallets (AGL-3629).
 *
 * Proved at the handler, on the form body Stripe would receive: a choice that
 * is saved and never sent is the state AGL-3629 found ("checkout does not
 * choose payment methods"). Stripe is captured, never reached.
 */

const docs = new Map<string, Record<string, any>>()
let autoId = 0

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value)
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) throw Object.assign(new Error('exists'), { code: 6 })
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id?: string) => makeDocRef(`${path}/${id ?? `auto-${++autoId}`}`),
    limit: () => ref,
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
  }
  return ref
}

async function runTransaction(body: (transaction: any) => Promise<any>): Promise<any> {
  const writes: Array<() => Promise<void>> = []
  const result = await body({
    get: async (ref: any) => ref.get(),
    set: (ref: any, value: any, options?: any) => writes.push(() => ref.set(value, options)),
    update: (ref: any, value: any) => writes.push(() => ref.set(value, { merge: true })),
    create: (ref: any, value: any) => writes.push(() => ref.set(value)),
  })
  for (const write of writes) await write()
  return result
}

const fakeFirestore = { collection: (name: string) => makeCollectionRef(name), runTransaction }

const mockOrg: any = {
  org: { id: 'org-1', plan: 'business', subscriptionStatus: 'active', ownerUid: 'owner-1', slug: 'acme' },
}
let flagOn = false

jest.mock('@aglyn/tenant-data-admin', () => ({
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  getOrgForHost: async () => mockOrg,
  isServerReleaseFlagOnForOrg: async () => flagOn,
}))

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
/** What `payment_method_domains` answers; `null` = an outage. */
let registeredDomains: Array<{ id: string; domain_name: string; enabled: boolean }> | null = []

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.startsWith('https://api.stripe.com')) throw new Error(`Unexpected fetch ${target}`)
  const method = String(init?.method ?? 'GET')
  const params = new URLSearchParams(String(init?.body ?? ''))
  calls.push({ method, url: target, params, headers: (init?.headers ?? {}) as Record<string, string> })
  if (target.includes('/v1/payment_method_domains')) {
    if (registeredDomains === null) {
      return { ok: false, status: 500, json: async () => ({ error: { message: 'Stripe is down' } }) }
    }
    if (method === 'GET') {
      const name = new URL(target).searchParams.get('domain_name')
      return {
        ok: true,
        json: async () => ({ data: registeredDomains!.filter((entry) => entry.domain_name === name) }),
      }
    }
    const created = {
      id: `pmd_${registeredDomains.length + 1}`,
      domain_name: String(params.get('domain_name')),
      enabled: true,
      apple_pay: { status: 'active' },
      google_pay: { status: 'active' },
      link: { status: 'active' },
    }
    registeredDomains.push(created)
    return { ok: true, json: async () => created }
  }
  if (target.includes('/v1/checkout/sessions')) {
    const native = params.get('ui_mode')
    return {
      ok: true,
      json: async () =>
        native
          ? { id: 'cs_1', client_secret: 'cs_1_secret_x' }
          : { id: 'cs_1', url: 'https://checkout.stripe.com/pay/cs_1' },
    }
  }
  if (target.includes('/v1/tax_rates')) return { ok: true, json: async () => ({ id: 'txr_1' }) }
  if (target.includes('/v1/coupons')) return { ok: true, json: async () => ({ id: 'co_1' }) }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

const sessionParams = () => {
  const session = calls.filter((call) => call.url.endsWith('/v1/checkout/sessions'))
  expect(session).toHaveLength(1)
  return session[0].params
}
const domainCalls = () => calls.filter((call) => call.url.includes('payment_method_domains'))

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader() {
      /* unused */
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

const SITE_HOST = `acme.${TENANT_APEX}`

function seed(paymentMethods?: Record<string, boolean>) {
  docs.clear()
  docs.set('hosts/host-1', { name: 'Acme', subdomain: 'acme' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Widget',
    type: 'digital',
    status: 'active',
    priceUsd: 80,
    variants: [{ id: 'v1', priceUsd: 80, inventory: 10 }],
  })
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [{ productId: 'product-1', variantId: 'v1', quantity: 1 }],
  })
  docs.set('hosts/host-1/settings/store', {
    tax: { mode: 'none' },
    ...(paymentMethods ? { paymentMethods } : {}),
  })
  docs.set('profiles/owner-1', { stripeAccountId: 'acct_merchant', stripeChargesEnabled: true })
}

async function buyNow(headers: Record<string, string> = {}) {
  const { res, result } = makeResponse()
  await checkoutHandler(
    {
      method: 'POST',
      query: {},
      body: { hostId: 'host-1', productId: 'product-1', quantity: 1 },
      headers: {
        host: SITE_HOST,
        referer: `https://${SITE_HOST}/products/widget`,
        'idempotency-key': `attempt-${++autoId}`,
        ...headers,
      },
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

async function cartCheckout() {
  const { res, result } = makeResponse()
  await cartCheckoutHandler(
    {
      method: 'POST',
      query: {},
      body: { hostId: 'host-1' },
      headers: {
        host: SITE_HOST,
        referer: `https://${SITE_HOST}/cart`,
        'idempotency-key': `attempt-${++autoId}`,
      },
      cookies: { 'aglyn_cart_host-1': 'cart-1' },
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

const excluded = (params: URLSearchParams) =>
  [...params.keys()]
    .filter((key) => key.startsWith('excluded_payment_method_types['))
    .map((key) => params.get(key))

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  calls.length = 0
  registeredDomains = []
  fetchMock.mockClear()
  flagOn = false
  delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

function goNative() {
  flagOn = true
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_key'
}

describe.each([
  ['buy now', buyNow],
  ['cart', cartCheckout],
])('%s: the merchant’s payment methods reach the session', (_label, run) => {
  it('a store on the defaults excludes only crypto, and hides no wallet', async () => {
    seed()
    goNative()
    const result = await run()
    expect(result.status).toBe(200)
    const params = sessionParams()
    expect(excluded(params)).toEqual(['crypto'])
    expect(params.get('wallet_options[link][display]')).toBeNull()
    expect(result.body.wallets).toBeUndefined()
  })

  it('excludes what the merchant switched off, on the hosted path too', async () => {
    seed({ klarna: false, affirm: false, crypto: true })
    const result = await run()
    expect(result.status).toBe(200)
    expect(result.body.url).toContain('checkout.stripe.com')
    expect(excluded(sessionParams())).toEqual(['klarna', 'affirm'])
  })

  it('hides Link on the session and tells the Payment Element which wallets are off', async () => {
    seed({ link: false, apple_pay: false })
    goNative()
    const result = await run()
    const params = sessionParams()
    expect(params.get('wallet_options[link][display]')).toBe('never')
    // Apple Pay cannot be excluded on a session; only the element can hide it.
    expect(excluded(params)).not.toContain('apple_pay')
    expect(result.body.wallets).toEqual({ applePay: 'never', googlePay: 'auto', link: 'never' })
  })
})

describe('the page the shopper pays on is registered for wallets', () => {
  it('registers the site’s own subdomain on the platform account, once', async () => {
    seed()
    goNative()
    expect((await buyNow()).status).toBe(200)
    const created = domainCalls().filter((call) => call.method === 'POST')
    expect(created).toHaveLength(1)
    expect(created[0].params.get('domain_name')).toBe(SITE_HOST)
    expect(created[0].headers['Idempotency-Key']).toBe(`aglyn-pmd-register:${SITE_HOST}`)
    // The platform's key and NO connected account: destination charges are
    // the platform's to run, so the platform holds the registration.
    expect(created[0].headers['Stripe-Account']).toBeUndefined()
    expect(docs.get(`paymentMethodDomains/test~${SITE_HOST}`)).toMatchObject({
      enabled: true,
      stripeId: 'pmd_1',
      hostId: 'host-1',
    })

    calls.length = 0
    expect((await buyNow()).status).toBe(200)
    expect(domainCalls()).toHaveLength(0)
  })

  it('registers for the cart checkout as well', async () => {
    seed()
    goNative()
    expect((await cartCheckout()).status).toBe(200)
    expect(domainCalls().some((call) => call.method === 'POST')).toBe(true)
  })

  it('never registers a name the site does not answer on', async () => {
    seed()
    goNative()
    await buyNow({ referer: 'https://stranger.example.com/x', host: 'stranger.example.com' })
    const posted = domainCalls().filter((call) => call.method === 'POST')
    expect(posted.map((call) => call.params.get('domain_name'))).not.toContain(
      'stranger.example.com',
    )
  })

  it('sells anyway when Stripe will not register the domain', async () => {
    seed()
    goNative()
    registeredDomains = null
    const result = await buyNow()
    expect(result.status).toBe(200)
    expect(result.body.clientSecret).toBe('cs_1_secret_x')
    expect(docs.get(`paymentMethodDomains/test~${SITE_HOST}`)).toMatchObject({
      enabled: false,
      lastError: 'Stripe is down',
    })
  })

  it('registers nothing on the hosted path, where Stripe’s own page needs none', async () => {
    seed()
    await buyNow()
    expect(domainCalls()).toHaveLength(0)
  })
})
