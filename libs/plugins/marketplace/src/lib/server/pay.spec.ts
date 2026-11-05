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
 * In-app payment for a listing (AGL-4049).
 *
 * The Stripe double answers as the test-mode run answered: an invoice's
 * metadata never reaches its intent, a 3-D Secure card comes back as a 402
 * with no intent on the error, a decline leaves the invoice open, and only a
 * draft can be deleted. The calls the door made ARE the contract: their order
 * and their params are what this file pins.
 *
 * The sale gates are the real `resolveSale`, with the real fee logic. Its
 * refusals are covered one by one in `sale.spec.ts`; here they only need to
 * reach the buyer.
 */

const mockPermissions: Record<string, boolean> = { installPlugins: true, createHosts: true }
const mockMembership: { orgId: string | null } = { orgId: 'buyer-org' }
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: mockMembership.orgId,
    permissions: mockPermissions,
  }),
}))

const mockPublisher: { current: Record<string, unknown> | null } = { current: null }
jest.mock('./publisher-profile', () => ({
  isPublisherMember: async () => false,
  resolvePublisherProfile: async () => mockPublisher.current,
}))
jest.mock('./purchase-entitlement', () => ({ hasLivePurchase: async () => false }))

const mockRecord = jest.fn(async (_invoice: unknown) => undefined)
jest.mock('./billing-webhook', () => ({
  recordMarketplaceInvoicePurchase: (invoice: unknown) => mockRecord(invoice),
}))

jest.mock('@aglyn/aglyn/server', () => {
  const entitlements = jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
  const idempotency = jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
  return {
    checkEntitlement: entitlements.checkEntitlement,
    resolveMarketplaceFeePct: entitlements.resolveMarketplaceFeePct,
    claimAttempt: idempotency.claimAttempt,
    deriveStripeObjectKey: idempotency.deriveStripeObjectKey,
    isListingWideRevocation: jest.requireActual('@aglyn/aglyn/app-utils/plugin-manifest')
      .isListingWideRevocation,
  }
})

const mockBilling: { customerId: string | undefined; canManage: boolean; canView: boolean } = {
  customerId: 'cus_buyer',
  canManage: true,
  canView: true,
}
const mockActivity = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('@aglyn/tenant-data-admin', () => {
  const store: Record<string, Record<string, unknown> | undefined> = {}
  const docFor = (path: string): any => ({
    collection: (name: string) => ({ doc: (id: string) => docFor(`${path}/${name}/${id}`) }),
    get: async () => ({
      exists: Boolean(store[path]),
      data: () => store[path],
      get: (field: string) => (store[path] ?? {})[field],
    }),
    // The dedupe primitive: a second create on one document is refused.
    create: async (data: Record<string, unknown>) => {
      if (store[path]) throw new Error('ALREADY_EXISTS')
      store[path] = data
    },
    set: async (data: Record<string, unknown>) => {
      store[path] = { ...(store[path] ?? {}), ...data }
    },
    delete: async () => {
      delete store[path]
    },
  })
  return {
    __store: store,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({ uid: 'buyer-1', email: 'buyer@example.com' }),
        }),
        firestore: () => ({
          collection: (name: string) => ({ doc: (id: string) => docFor(`${name}/${id}`) }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
    logOrgActivity: (...args: unknown[]) => mockActivity(...args),
    readOrgBilling: async () => ({ stripeCustomerId: mockBilling.customerId }),
    resolveOrgMembership: async () => ({ member: { role: 'member' } }),
    memberHasOrgPermission: async (_orgId: string, _member: unknown, key: string) =>
      key === 'billing.manage' ? mockBilling.canManage : mockBilling.canView,
  }
})

import { INVOICE_REQUEST_THREE_D_SECURE_PARAM } from '@aglyn/tenant-data-admin/server/stripe-card-authentication'
import { payHandler } from './pay'

const store = () =>
  (jest.requireMock('@aglyn/tenant-data-admin') as {
    __store: Record<string, Record<string, unknown> | undefined>
  }).__store

interface StripeCall {
  method: string
  path: string
  params: URLSearchParams
  key: string | undefined
}

/** One Stripe the door talks to: what each path answers, as test mode answered. */
interface StripeWorld {
  customer: Record<string, any> | null
  subscriptions: Array<Record<string, any>>
  openInvoices: Array<Record<string, any>>
  finalized: { ok: boolean; status?: number; body: Record<string, any> }
  pay: { ok: boolean; status: number; body: Record<string, any> }
  invoiceRead: Record<string, any>
  calculation: { ok: boolean; status?: number; body: Record<string, any> }
}

const stripeCalls: StripeCall[] = []
let world: StripeWorld

const reply = (ok: boolean, status: number, body: unknown) => ({
  ok,
  status,
  json: async () => body,
})

function healthyWorld(): StripeWorld {
  return {
    customer: {
      id: 'cus_buyer',
      address: { country: 'US', state: 'TX' },
      invoice_settings: {
        default_payment_method: {
          id: 'pm_card',
          type: 'card',
          card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
        },
      },
    },
    subscriptions: [],
    openInvoices: [],
    finalized: {
      ok: true,
      body: { id: 'in_1', status: 'open', amount_due: 10660, payment_intent: 'pi_1' },
    },
    pay: {
      ok: true,
      status: 200,
      body: { id: 'in_1', status: 'paid', amount_paid: 10660, payment_intent: 'pi_1' },
    },
    invoiceRead: {},
    calculation: { ok: true, body: { amount_total: 10660, tax_amount_exclusive: 660 } },
  }
}

function fakeStripe(url: unknown, init?: { method?: string; body?: unknown; headers?: any }) {
  const path = String(url).replace('https://api.stripe.com/v1/', '')
  const method = init?.method ?? 'GET'
  stripeCalls.push({
    method,
    path,
    params: new URLSearchParams(String(init?.body ?? '')),
    key: init?.headers?.['Idempotency-Key'],
  })
  if (path.startsWith('customers/')) {
    return world.customer ? reply(true, 200, world.customer) : reply(false, 404, {})
  }
  if (path.startsWith('subscriptions?')) return reply(true, 200, { data: world.subscriptions })
  if (path.startsWith('invoices?customer')) return reply(true, 200, { data: world.openInvoices })
  if (path === 'tax/calculations') {
    const { ok, status, body } = world.calculation
    return reply(ok, status ?? (ok ? 200 : 400), body)
  }
  if (path === 'invoices') return reply(true, 200, { id: 'in_1', status: 'draft' })
  if (path === 'invoiceitems') return reply(true, 200, { id: 'ii_1' })
  if (path.endsWith('/finalize')) {
    const { ok, status, body } = world.finalized
    return reply(ok, status ?? (ok ? 200 : 400), body)
  }
  if (path.startsWith('payment_intents/')) return reply(true, 200, { id: 'pi_1' })
  if (path.endsWith('/pay')) return reply(world.pay.ok, world.pay.status, world.pay.body)
  if (path.endsWith('/void')) return reply(true, 200, { status: 'void' })
  if (method === 'DELETE') return reply(true, 200, { deleted: true })
  if (path.startsWith('invoices/')) return reply(true, 200, world.invoiceRead)
  throw new Error(`unexpected Stripe call: ${method} ${path}`)
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
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

const makeReq = (body: Record<string, unknown> = {}, key: string | null = 'attempt-1') =>
  ({
    method: 'POST',
    headers: {
      authorization: 'Bearer token',
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: { listingId: 'listing-1', orgId: 'buyer-org', ...body },
  }) as any

async function send(body?: Record<string, unknown>, key?: string | null) {
  const res = makeRes()
  await payHandler(makeReq(body, key), res)
  return res
}

function seedSale(listing: Record<string, unknown> = {}, sellerOrg: Record<string, unknown> = {}) {
  store()['marketplaceListings/listing-1'] = {
    priceUsd: 100,
    profileId: 'seller-org',
    displayName: 'Fancy hero',
    reviewStatus: 'listed',
    ...listing,
  }
  store()['orgs/seller-org'] = { plan: 'pro', slug: 'acme', ...sellerOrg }
  store()['orgs/buyer-org'] = { slug: 'buyer' }
}

const created = () => stripeCalls.filter((call) => call.method !== 'GET')
const callNamed = (suffix: string) => stripeCalls.find((call) => call.path.endsWith(suffix))
const madeNothing = () =>
  expect(created().filter((call) => call.path !== 'tax/calculations')).toEqual([])

beforeAll(() => {
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_spec'
})

beforeEach(() => {
  delete process.env['AGLYN_PLATFORM_ORG_ID']
  for (const key of Object.keys(store())) delete store()[key]
  stripeCalls.length = 0
  world = healthyWorld()
  mockPermissions['installPlugins'] = true
  mockPermissions['createHosts'] = true
  mockMembership.orgId = 'buyer-org'
  mockBilling.customerId = 'cus_buyer'
  mockBilling.canManage = true
  mockBilling.canView = true
  mockPublisher.current = {
    orgId: 'seller-org',
    handle: 'acme',
    stripeAccountId: 'acct_seller',
    stripeChargesEnabled: true,
  }
  mockRecord.mockClear()
  mockActivity.mockClear()
  seedSale()
  global.fetch = jest.fn(async (url: unknown, init?: any) => fakeStripe(url, init)) as never
})

describe('the door', () => {
  it('takes a POST with a listing and a workspace, signed in', async () => {
    const res = makeRes()
    await payHandler({ ...makeReq(), method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
    expect((await send({ listingId: '' })).statusCode).toBe(400)
    expect((await send({ orgId: '' })).statusCode).toBe(400)
    expect((await send({ action: 'nonsense' })).statusCode).toBe(400)
    const anonymous = makeRes()
    await payHandler({ ...makeReq(), headers: {} }, anonymous)
    expect(anonymous.statusCode).toBe(401)
  })

  it('answers 501 where Stripe is not configured', async () => {
    delete process.env['STRIPE_SECRET_KEY']
    expect((await send()).statusCode).toBe(501)
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_spec'
  })

  it('refuses a workspace the person is not in', async () => {
    mockMembership.orgId = null
    expect((await send()).statusCode).toBe(403)
    expect(stripeCalls).toEqual([])
  })

  it('refuses a locked workspace', async () => {
    store()['orgs/buyer-org'] = { suspendedAt: 'then' }
    expect((await send()).statusCode).toBe(403)
    expect(stripeCalls).toEqual([])
  })

  it('every sale refusal reaches the buyer unchanged, and nothing is made', async () => {
    seedSale({ priceUsd: 0 })
    const res = await send()
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Listing is free' })
    expect(stripeCalls).toEqual([])
  })

  it('buying a starter asks for hosts.create, naming the permission', async () => {
    seedSale({ artifactType: 'siteStarter' })
    mockPermissions['createHosts'] = false
    const res = await send()
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toContain('Create sites')
  })

  it('buying anything else asks for plugins.install', async () => {
    mockPermissions['installPlugins'] = false
    expect((await send()).statusCode).toBe(403)
  })
})

describe('prerequisites', () => {
  it('no customer yet is card_required, without a Stripe read', async () => {
    mockBilling.customerId = undefined
    const res = await send()
    expect(res.statusCode).toBe(412)
    expect(res.body).toEqual({
      error: 'Add a card in Billing first',
      code: 'card_required',
      canManageBilling: true,
      amountCents: 10000,
    })
    expect(stripeCalls).toEqual([])
  })

  it('a customer with no default method is card_required', async () => {
    world.customer = { id: 'cus_buyer', address: { country: 'US' }, invoice_settings: {} }
    const res = await send()
    expect(res.statusCode).toBe(412)
    expect(res.body.code).toBe('card_required')
  })

  it('says whether this person can add one here', async () => {
    mockBilling.customerId = undefined
    mockBilling.canManage = false
    expect((await send({ action: 'quote' })).body.canManageBilling).toBe(false)
  })

  it('a live subscription\'s default is a card on file, and is the one charged', async () => {
    world.customer = { id: 'cus_buyer', address: { country: 'US' }, invoice_settings: {} }
    world.subscriptions = [
      { status: 'active', default_payment_method: { id: 'pm_sub', type: 'card', card: {} } },
    ]
    const res = await send()
    expect(res.statusCode).toBe(200)
    expect(callNamed('invoices')?.params.get('default_payment_method')).toBe('pm_sub')
  })

  it('no address is billing_address_required, before anything is made', async () => {
    delete world.customer?.['address']
    const res = await send()
    expect(res.statusCode).toBe(412)
    expect(res.body.code).toBe('billing_address_required')
    madeNothing()
  })

  it('a customer that cannot be read is a retry, never "add a card"', async () => {
    world.customer = null
    const res = await send()
    expect(res.statusCode).toBe(502)
    expect(res.body.code).toBeUndefined()
  })
})

describe('quote', () => {
  it('prices the sale with Stripe Tax and creates no invoice', async () => {
    const res = await send({ action: 'quote' })
    expect(res.statusCode).toBe(200)
    expect(res.body.quote).toEqual({
      listingName: 'Fancy hero',
      amountCents: 10000,
      taxCents: 660,
      totalCents: 10660,
      currency: 'usd',
      card: expect.objectContaining({ brand: 'visa', last4: '4242' }),
      canPay: true,
    })
    const params = callNamed('tax/calculations')?.params
    expect(params?.get('line_items[0][tax_code]')).toBe('txcd_10103001')
    expect(params?.get('line_items[0][tax_behavior]')).toBe('exclusive')
    madeNothing()
  })

  it('shows the card only to someone who may see billing', async () => {
    mockBilling.canView = false
    expect((await send({ action: 'quote' })).body.quote.card).toBeNull()
  })

  it('needs no idempotency key: it moves nothing', async () => {
    expect((await send({ action: 'quote' }, null)).statusCode).toBe(200)
  })

  it.each([
    ['names the code', { code: 'customer_tax_location_invalid' }],
    // What test mode answers for a country and nothing else.
    ['names the customer', { param: 'customer', type: 'invalid_request_error' }],
  ])('an address Stripe cannot place, when it %s, is billing_address_required', async (_name, error) => {
    world.calculation = { ok: false, body: { error } }
    const res = await send({ action: 'quote' })
    expect(res.statusCode).toBe(412)
    expect(res.body.code).toBe('billing_address_required')
  })

  it('any other refusal is a retry, not a thing to add', async () => {
    world.calculation = { ok: false, body: { error: { code: 'tax_id_invalid' } } }
    const res = await send({ action: 'quote' })
    expect(res.statusCode).toBe(502)
    expect(res.body.code).toBeUndefined()
  })
})

describe('pay', () => {
  it('needs an attempt key', async () => {
    expect((await send({}, null)).statusCode).toBe(400)
    madeNothing()
  })

  it('makes the invoice, its one item, finalizes, stamps the intent, then pays', async () => {
    const res = await send({ gaClientId: '123.456' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ paid: true, invoiceId: 'in_1' })
    expect(created().map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST invoices',
      'POST invoiceitems',
      'POST invoices/in_1/finalize',
      'POST payment_intents/pi_1',
      'POST invoices/in_1/pay',
    ])
  })

  it('invoices the workspace\'s customer with tax on top and a fixed transfer', async () => {
    await send({ gaClientId: '123.456' })
    const params = callNamed('invoices')?.params as URLSearchParams
    expect(Object.fromEntries(params)).toMatchObject({
      customer: 'cus_buyer',
      collection_method: 'charge_automatically',
      auto_advance: 'false',
      pending_invoice_items_behavior: 'exclude',
      default_payment_method: 'pm_card',
      'automatic_tax[enabled]': 'true',
      'transfer_data[destination]': 'acct_seller',
      'transfer_data[amount]': '8000',
      [INVOICE_REQUEST_THREE_D_SECURE_PARAM]: 'automatic',
      'metadata[type]': 'marketplace-purchase',
      'metadata[pluginSale]': 'true',
      'metadata[listingId]': 'listing-1',
      'metadata[buyerUid]': 'buyer-1',
      'metadata[buyerOrgId]': 'buyer-org',
      'metadata[sellerOrgId]': 'seller-org',
      'metadata[feeCents]': '2000',
      'metadata[transferCents]': '8000',
      'metadata[ga_client_id]': '123.456',
    })
    expect(params.has('application_fee_amount')).toBe(false)
    expect(params.has('on_behalf_of')).toBe(false)
  })

  it('drops a client id that is not GA\'s shape', async () => {
    await send({ gaClientId: 'not a client id' })
    expect(callNamed('invoices')?.params.has('metadata[ga_client_id]')).toBe(false)
  })

  it('the one item is the listing, tax on top, at the stated classification', async () => {
    await send()
    expect(Object.fromEntries(callNamed('invoiceitems')?.params as URLSearchParams)).toEqual({
      customer: 'cus_buyer',
      invoice: 'in_1',
      amount: '10000',
      currency: 'usd',
      tax_behavior: 'exclusive',
      tax_code: 'txcd_10103001',
      description: 'Fancy hero',
    })
  })

  it('stamps the intent with what the refund door reads', async () => {
    await send()
    const params = callNamed('payment_intents/pi_1')?.params as URLSearchParams
    expect(params.get('metadata[type]')).toBe('marketplace-purchase')
    expect(params.get('metadata[pluginSale]')).toBe('true')
  })

  it('gives each Stripe object its own key from one attempt', async () => {
    await send()
    const keys = created().map((call) => call.key)
    expect(keys.every(Boolean)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('records the purchase from what Stripe answered, before the buyer hears', async () => {
    await send()
    expect(mockRecord).toHaveBeenCalledWith(world.pay.body)
    expect(mockActivity).toHaveBeenCalledWith(
      'buyer-org',
      expect.objectContaining({ uid: 'buyer-1' }),
      'Bought "Fancy hero" from the marketplace',
      { type: 'org', id: 'buyer-org' },
    )
  })

  it('a failed record is a race lost to the webhook, not a failed sale', async () => {
    mockRecord.mockRejectedValueOnce(new Error('firestore down'))
    const res = await send()
    expect(res.statusCode).toBe(200)
    expect(res.body.paid).toBe(true)
  })

  it('a repeat of the attempt replays the answer and charges nothing', async () => {
    await send()
    stripeCalls.length = 0
    const again = await send()
    expect(again.statusCode).toBe(200)
    expect(again.body).toEqual({ paid: true, invoiceId: 'in_1' })
    madeNothing()
    expect(stripeCalls.filter((call) => call.path.endsWith('/pay'))).toEqual([])
  })

  it('an in-flight double click is refused, in the money direction', async () => {
    const order: string[] = []
    const fetcher = global.fetch as jest.Mock
    const original = fetcher.getMockImplementation() as (...args: unknown[]) => unknown
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fetcher.mockImplementation(async (url: unknown, init?: any) => {
      if (String(url).endsWith('/pay')) {
        order.push('pay')
        await gate
      }
      return original(url, init)
    })
    const first = send()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = await send()
    expect(second.statusCode).toBe(409)
    release()
    expect((await first).statusCode).toBe(200)
    expect(order).toEqual(['pay'])
  })

  it('voids an earlier attempt at this listing left open at the bank\'s step', async () => {
    world.openInvoices = [
      {
        id: 'in_old',
        metadata: { type: 'marketplace-purchase', listingId: 'listing-1', buyerOrgId: 'buyer-org' },
      },
      {
        id: 'in_other',
        metadata: { type: 'marketplace-purchase', listingId: 'listing-2', buyerOrgId: 'buyer-org' },
      },
      { id: 'in_subscription', metadata: {} },
    ]
    await send()
    expect(stripeCalls.filter((call) => call.path.endsWith('/void')).map((call) => call.path)).toEqual([
      'invoices/in_old/void',
    ])
  })

  it('refuses a total that moved from the one the buyer saw, and voids it', async () => {
    const res = await send({ expectedTotalCents: 10000 })
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('total_changed')
    expect(callNamed('/void')?.path).toBe('invoices/in_1/void')
    expect(callNamed('/pay')).toBeUndefined()
  })

  it('pays when the total is the one the buyer saw', async () => {
    expect((await send({ expectedTotalCents: 10660 })).statusCode).toBe(200)
  })

  it('an address Stripe cannot place deletes the draft and names the prerequisite', async () => {
    world.finalized = {
      ok: false,
      body: { error: { code: 'customer_tax_location_invalid' } },
    }
    const res = await send()
    expect(res.statusCode).toBe(412)
    expect(res.body.code).toBe('billing_address_required')
    expect(stripeCalls.find((call) => call.method === 'DELETE')?.path).toBe('invoices/in_1')
    expect(callNamed('/pay')).toBeUndefined()
  })

  it('a card that wants the bank hands back the client secret', async () => {
    world.pay = {
      ok: false,
      status: 402,
      // What test mode answered: the code, and no intent on the error.
      body: { error: { code: 'invoice_payment_intent_requires_action' } },
    }
    world.invoiceRead = {
      payment_intent: { status: 'requires_action', client_secret: 'pi_1_secret' },
    }
    const res = await send()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      requiresAction: true,
      paymentClientSecret: 'pi_1_secret',
      invoiceId: 'in_1',
    })
    expect(mockRecord).not.toHaveBeenCalled()
    expect(callNamed('/void')).toBeUndefined()
  })

  it('a decline voids the invoice and says why, in Stripe\'s words', async () => {
    world.pay = {
      ok: false,
      status: 402,
      body: { error: { code: 'card_declined', message: 'Your card was declined.' } },
    }
    const res = await send()
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'Your card was declined.', declined: true })
    expect(callNamed('/void')?.path).toBe('invoices/in_1/void')
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('a decline is a finished attempt: the same key hears it, and a new key pays', async () => {
    world.pay = {
      ok: false,
      status: 402,
      body: { error: { code: 'card_declined', message: 'Your card was declined.' } },
    }
    await send()
    stripeCalls.length = 0
    const repeat = await send()
    expect(repeat.statusCode).toBe(402)
    expect(stripeCalls.filter((call) => call.method === 'POST')).toEqual([])
    world = healthyWorld()
    expect((await send({}, 'attempt-2')).statusCode).toBe(200)
  })

  it('a failure that is not a decline reads the invoice before saying anything', async () => {
    world.pay = { ok: false, status: 500, body: { error: { type: 'api_error' } } }
    world.invoiceRead = { id: 'in_1', status: 'paid', amount_paid: 10660 }
    const res = await send()
    expect(res.statusCode).toBe(200)
    expect(res.body.paid).toBe(true)
    expect(mockRecord).toHaveBeenCalledTimes(1)
    expect(callNamed('/void')).toBeUndefined()
  })

  it('an accepted payment that has not cleared is left to the webhook', async () => {
    world.pay = { ok: true, status: 200, body: { id: 'in_1', status: 'open' } }
    const res = await send()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ submitted: true, invoiceId: 'in_1' })
    expect(mockRecord).not.toHaveBeenCalled()
  })
})

describe('charging the saved card takes billing.manage (AGL-4049)', () => {
  beforeEach(() => {
    mockBilling.canManage = false
  })

  it('a buyer without it still gets the price, and is told they cannot pay', async () => {
    const res = await send({ action: 'quote' })
    expect(res.statusCode).toBe(200)
    expect(res.body.quote).toMatchObject({ totalCents: 10660, canPay: false })
  })

  it('a buyer with it is told they can', async () => {
    mockBilling.canManage = true
    expect((await send({ action: 'quote' })).body.quote.canPay).toBe(true)
  })

  it('pay is refused, naming the permission, before anything reaches Stripe', async () => {
    const res = await send()
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({
      error: expect.stringContaining('Manage billing'),
      code: 'billing_manage_required',
    })
    expect(stripeCalls).toEqual([])
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('the buyer permission is still asked first: billing.manage alone buys nothing', async () => {
    mockBilling.canManage = true
    mockPermissions['installPlugins'] = false
    expect((await send()).statusCode).toBe(403)
    expect(stripeCalls).toEqual([])
  })

  it('a refusal burns no attempt: the same key works once the permission is held', async () => {
    expect((await send()).statusCode).toBe(403)
    mockBilling.canManage = true
    const res = await send()
    expect(res.statusCode).toBe(200)
    expect(res.body.paid).toBe(true)
  })

  it('settle is no way round it: nothing is read, recorded or voided', async () => {
    world.invoiceRead = {
      id: 'in_1',
      status: 'paid',
      customer: 'cus_buyer',
      metadata: { type: 'marketplace-purchase', listingId: 'listing-1', buyerUid: 'buyer-1' },
    }
    const res = await send({ action: 'settle', invoiceId: 'in_1' }, null)
    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBe('billing_manage_required')
    expect(stripeCalls).toEqual([])
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('staff pass, as they do at pay-invoice', async () => {
    const admin = jest.requireMock('@aglyn/tenant-data-admin') as { firebaseAdmin: any }
    const app = admin.firebaseAdmin.app
    admin.firebaseAdmin.app = () => ({
      ...app(),
      auth: () => ({ verifyIdToken: async () => ({ uid: 'buyer-1', staff: true }) }),
    })
    try {
      expect((await send()).statusCode).toBe(200)
    } finally {
      admin.firebaseAdmin.app = app
    }
  })

  it('a prerequisite states the price to someone who cannot meet it', async () => {
    mockBilling.customerId = undefined
    const res = await send({ action: 'quote' })
    expect(res.statusCode).toBe(412)
    expect(res.body).toMatchObject({
      code: 'card_required',
      canManageBilling: false,
      amountCents: 10000,
    })
  })
})

describe('the platform org at the staff waiver (AGL-4049 decision 8)', () => {
  it('invoices with no transfer, and everything else the same', async () => {
    process.env['AGLYN_PLATFORM_ORG_ID'] = 'seller-org'
    seedSale({}, { entitlements: { marketplaceFeePct: 0 } })
    mockPublisher.current = { orgId: 'seller-org', handle: 'aglyn' }
    const res = await send()
    expect(res.statusCode).toBe(200)
    const params = callNamed('invoices')?.params as URLSearchParams
    expect(params.has('transfer_data[destination]')).toBe(false)
    expect(params.has('transfer_data[amount]')).toBe(false)
    expect(params.get('automatic_tax[enabled]')).toBe('true')
    expect(params.get('metadata[feeCents]')).toBe('0')
    expect(params.get('metadata[transferCents]')).toBe('0')
  })

  it('a waiver on any other seller still pays that seller', async () => {
    process.env['AGLYN_PLATFORM_ORG_ID'] = 'platform-org'
    seedSale({}, { entitlements: { marketplaceFeePct: 0 } })
    await send()
    const params = callNamed('invoices')?.params as URLSearchParams
    expect(params.get('transfer_data[destination]')).toBe('acct_seller')
    expect(params.get('transfer_data[amount]')).toBe('10000')
  })
})

describe('settle, after the bank\'s step', () => {
  const OURS = {
    customer: 'cus_buyer',
    metadata: {
      type: 'marketplace-purchase',
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
    },
    lines: { data: [{ description: 'Fancy hero' }] },
  }

  it('records a paid invoice', async () => {
    world.invoiceRead = { ...OURS, id: 'in_1', status: 'paid' }
    const res = await send({ action: 'settle', invoiceId: 'in_1' }, null)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ paid: true, invoiceId: 'in_1' })
    expect(mockRecord).toHaveBeenCalledWith(world.invoiceRead)
  })

  it('voids an attempt the bank did not finish', async () => {
    world.invoiceRead = {
      ...OURS,
      id: 'in_1',
      status: 'open',
      payment_intent: { status: 'requires_payment_method' },
    }
    const res = await send({ action: 'settle', invoiceId: 'in_1' }, null)
    expect(res.statusCode).toBe(402)
    expect(res.body.declined).toBe(true)
    expect(callNamed('/void')?.path).toBe('invoices/in_1/void')
  })

  it.each(['succeeded', 'processing'])('never voids under an intent that is %s', async (status) => {
    world.invoiceRead = { ...OURS, id: 'in_1', status: 'open', payment_intent: { status } }
    const res = await send({ action: 'settle', invoiceId: 'in_1' }, null)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ submitted: true, invoiceId: 'in_1' })
    expect(callNamed('/void')).toBeUndefined()
  })

  it.each([
    ['another workspace\'s customer', { customer: 'cus_other' }],
    ['another listing', { metadata: { ...OURS.metadata, listingId: 'listing-2' } }],
    ['another person', { metadata: { ...OURS.metadata, buyerUid: 'someone-else' } }],
    ['not a marketplace sale', { metadata: { buyerUid: 'buyer-1', listingId: 'listing-1' } }],
  ])('%s reads as unknown', async (_name, change) => {
    world.invoiceRead = { ...OURS, id: 'in_1', status: 'paid', ...change }
    const res = await send({ action: 'settle', invoiceId: 'in_1' }, null)
    expect(res.statusCode).toBe(404)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('needs the invoice named', async () => {
    expect((await send({ action: 'settle' }, null)).statusCode).toBe(400)
  })
})
