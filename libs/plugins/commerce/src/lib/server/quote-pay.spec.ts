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

import type { PluginApiRequest } from '@aglyn/aglyn/server'
import { handleQuotePay, handleQuoteView, type QuotePayDeps } from './quote-pay'
import { mintQuoteLinkToken } from './quote-link-token'

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {},
  getOrgForHost: jest.fn(),
  consumeRateLimit: jest.fn(),
  isServerReleaseFlagOnForOrg: jest.fn(),
}))

/**
 * The customer's quote page and its Pay button (AGL-4094), through the real
 * handlers over an in-memory Firestore and a recorded Stripe: what the page
 * may read, what a press charges and from where, and every refusal.
 */

const docs = new Map<string, Record<string, any>>()

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
    get: (field: string) => field.split('.').reduce<any>((value, key) => value?.[key], data),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : JSON.parse(JSON.stringify(value)))
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return { doc: (id: string) => docRef(`${path}/${id}`) }
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async <T,>(fn: (transaction: any) => Promise<T>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => void ref.set(value, options),
    }),
}

const ORG = { id: 'org-1', plan: 'business', billingStatus: 'active', ownerUid: 'owner-1', slug: 'acme' }
let native = false
let rateAllowed = true
const created: Array<{ params: URLSearchParams; headers: Record<string, string> }> = []
const expired: string[] = []
let expiry: Awaited<ReturnType<QuotePayDeps['expireSession']>> = 'expired'
let sessionCount = 0
const taxRateId = jest.fn<Promise<string | null>, [unknown]>(async () => 'txr_store')

const deps: QuotePayDeps = {
  firestore: () => firestore,
  consumeRateLimit: async () => ({ allowed: rateAllowed, resetMs: 60_000 }),
  orgForHost: async () => ({ id: 'org-1', org: ORG }),
  nativeMode: async () => (native ? { native: true, publishableKey: 'pk_test_1' } : { native: false, publishableKey: '' }),
  taxRateId: (input) => taxRateId(input),
  createSession: async (params, headers) => {
    created.push({ params, headers })
    const id = `cs_test_new${++sessionCount}0000`
    return {
      ok: true,
      session: native
        ? { id, client_secret: `${id}_secret` }
        : { id, url: `https://checkout.stripe.com/c/pay/${id}` },
    }
  },
  expireSession: async (sessionId) => {
    expired.push(sessionId)
    return expiry
  },
  ensureDomain: async () => null,
  now: () => 10_000,
}

const QUOTE_PATH = 'hosts/site1/orders/q-1'

function storeQuote(section: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  docs.set(QUOTE_PATH, {
    number: 1042,
    status: 'pending',
    channel: 'quote',
    lineItems: [
      { productId: 'canopy', variantId: 'red', name: 'Canopy 10x10', variantLabel: 'Red', productType: 'physical', quantity: 2, unitAmountCents: 120_000 },
      { productId: '', custom: true, name: 'Installation', productType: 'service', quantity: 1, unitAmountCents: 30_000 },
      { productId: 'bag', name: 'Carry bag', productType: 'physical', quantity: 1, unitAmountCents: 0, included: true },
    ],
    totals: { itemsCents: 270_000, discountCents: 0, shippingCents: 4_500, taxCents: 22_275, feeCents: 0, totalCents: 296_775 },
    timeline: [{ atMs: 1_000, event: 'quote', detail: 'Quote created by owner@example.com' }],
    taxMode: 'manual',
    quote: {
      stage: 'draft',
      revision: 1,
      customer: { name: 'Jordan Lee', email: 'jordan@example.com', emailLower: 'jordan@example.com', phone: '+1 512 555 0100' },
      shipTo: { name: 'Jordan Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
      shipping: { amountCents: 4_500 },
      tax: { kind: 'rate', pct: 8.25, label: 'Texas sales tax' },
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
      createdBy: 'owner@example.com',
      updatedBy: 'owner@example.com',
      ...section,
    },
    ...overrides,
  })
}

const token = (version = 1) => String(mintQuoteLinkToken('site1', 'q-1', version))

function viewRequest(query: Record<string, string>): PluginApiRequest {
  return { method: 'GET', query, body: undefined, headers: {}, cookies: {}, socket: {} } as PluginApiRequest
}

function payRequest(body: Record<string, unknown>, key = 'press-1'): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body,
    headers: {
      ...(key ? { 'idempotency-key': key } : {}),
      host: 'acme.aglyn.app',
      referer: 'https://acme.aglyn.app/pay-quote?q=q-1',
    },
    cookies: {},
    socket: {},
  } as PluginApiRequest
}

const SECRET = process.env.TOKEN_SIGNING_SECRET
const STRIPE = process.env.STRIPE_SECRET_KEY

beforeEach(() => {
  process.env.TOKEN_SIGNING_SECRET = 'quote-pay-spec-secret'
  process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
  docs.clear()
  created.length = 0
  expired.length = 0
  expiry = 'expired'
  native = false
  rateAllowed = true
  sessionCount = 0
  taxRateId.mockClear()
  docs.set('hosts/site1', { subdomain: 'acme', displayName: 'Acme Tents', businessName: 'Acme Tents' })
  docs.set('hosts/site1/settings/store', {
    currency: 'USD',
    tax: { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 8.25 }] },
  })
  docs.set('profiles/owner-1', { stripeAccountId: 'acct_merchant', stripeChargesEnabled: true, stripeAccountLivemode: false })
  storeQuote()
})

afterAll(() => {
  if (SECRET === undefined) delete process.env.TOKEN_SIGNING_SECRET
  else process.env.TOKEN_SIGNING_SECRET = SECRET
  if (STRIPE === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = STRIPE
})

describe('the quote page’s data', () => {
  it('answers the allow-listed view for the link’s quote', async () => {
    const outcome = await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'q-1', t: token() }))
    expect(outcome.status).toBe(200)
    expect(outcome.body).toMatchObject({
      state: 'quote',
      number: 'Quote #1042',
      status: 'unpaid',
      payable: true,
      version: 2_000,
      totals: { itemsCents: 270_000, shippingCents: 4_500, taxCents: 22_275, totalCents: 296_775 },
    })
    const wire = JSON.stringify(outcome.body)
    expect(wire).not.toContain('jordan@example.com')
    expect(wire).not.toContain('+1 512 555 0100')
    expect(wire).not.toContain('owner@example.com')
  })

  it('answers a wrong token exactly as a missing quote, and never reads one for it', async () => {
    const wrong = await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'q-1', t: `1.${'0'.repeat(32)}` }))
    const missing = await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'q-404', t: String(mintQuoteLinkToken('site1', 'q-404', 1)) }))
    expect(wrong).toEqual(missing)
    expect(wrong.status).toBe(404)
  })

  it('answers an order that is not a quote as missing too', async () => {
    docs.set('hosts/site1/orders/o-1', { status: 'paid', channel: 'online', lineItems: [] })
    const outcome = await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'o-1', t: String(mintQuoteLinkToken('site1', 'o-1', 1)) }))
    expect(outcome.status).toBe(404)
  })

  it('opens a link to an older version on the replaced page, with nothing of the quote', async () => {
    storeQuote({ linkVersion: 2 })
    const outcome = await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'q-1', t: token(1) }))
    expect(outcome).toEqual({ status: 200, body: { state: 'replaced', kind: 'quote', storeName: 'Acme Tents' } })
    expect((await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'q-1', t: token(2) }))).body['state']).toBe('quote')
  })

  it('is rate-limited before the token is looked at, and refuses an incomplete link', async () => {
    rateAllowed = false
    expect((await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'q-1', t: token() }))).status).toBe(429)
    expect((await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'q-1' }))).status).toBe(400)
  })

  it('links a paid quote’s order status as its receipt', async () => {
    storeQuote({ paidAtMs: 9_000 }, { status: 'paid' })
    const outcome = await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'q-1', t: token() }))
    expect(outcome.body).toMatchObject({ status: 'paid', paidAtMs: 9_000, payable: false })
    expect(String(outcome.body['receiptUrl'])).toMatch(/^https:\/\/acme\.[a-z.]+\/order-status\?o=q-1&t=[0-9a-f]{32}$/)
  })
})

describe('Pay', () => {
  const press = (body: Record<string, unknown> = {}, key = 'press-1') =>
    handleQuotePay(deps, payRequest({ hostId: 'site1', q: 'q-1', t: token(), v: 2_000, ...body }, key))

  it('opens a session priced from the stored quote, never from the request', async () => {
    const outcome = await press({ amountCents: 1, lines: [{ unitAmountCents: 1 }] })
    expect(outcome).toEqual({ status: 200, body: { url: 'https://checkout.stripe.com/c/pay/cs_test_new10000' } })
    const params = created[0].params
    expect(params.get('mode')).toBe('payment')
    expect(params.get('payment_method_options[card][request_three_d_secure]')).toBe('automatic')
    // The taxed goods as one line, at the store's rate; the included bag is not sent.
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('270000')
    expect(params.get('line_items[0][price_data][product_data][name]')).toBe('Quote #1042')
    expect(params.get('line_items[0][tax_rates][0]')).toBe('txr_store')
    expect(params.get('line_items[1][price_data][unit_amount]')).toBeNull()
    expect(taxRateId).toHaveBeenCalledWith(expect.objectContaining({ taxPct: 8.25, taxLabel: 'Texas sales tax' }))
    // The quote's shipping, to where it ships.
    expect(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('4500')
    expect(params.get('shipping_address_collection[allowed_countries][0]')).toBe('US')
    expect(params.get('shipping_address_collection[allowed_countries][1]')).toBeNull()
    // The destination charge, its fee, and the customer prefilled.
    expect(params.get('payment_intent_data[transfer_data][destination]')).toBe('acct_merchant')
    expect(Number(params.get('payment_intent_data[application_fee_amount]'))).toBeGreaterThan(0)
    expect(params.get('customer_email')).toBe('jordan@example.com')
    // What the webhook reads.
    expect(params.get('metadata[type]')).toBe('commerce-draft')
    expect(params.get('metadata[orderId]')).toBe('q-1')
    expect(params.get('metadata[quoteId]')).toBe('q-1')
    expect(params.get('metadata[quoteLinkVersion]')).toBe('1')
    expect(params.get('metadata[quoteUpdatedAtMs]')).toBe('2000')
    expect(params.get('metadata[feeCents]')).toBe(params.get('payment_intent_data[application_fee_amount]'))
    // Back to the quote page on the site, which reads the paid state itself.
    expect(params.get('success_url')).toBe(
      `https://acme.aglyn.app/pay-quote?q=q-1&t=${encodeURIComponent(token())}&session_id={CHECKOUT_SESSION_ID}`,
    )
    expect(params.get('cancel_url')).toBe(`https://acme.aglyn.app/pay-quote?q=q-1&t=${encodeURIComponent(token())}`)
    expect(created[0].headers['Idempotency-Key']).toBeTruthy()
    expect(docs.get(QUOTE_PATH)?.['checkoutSessionId']).toBe('cs_test_new10000')
    expect(docs.get(QUOTE_PATH)?.['status']).toBe('pending')
  })

  it('opens the in-page form when in-page payments are on', async () => {
    native = true
    const outcome = await press()
    expect(outcome.body).toEqual({
      clientSecret: 'cs_test_new10000_secret',
      publishableKey: 'pk_test_1',
      sessionId: 'cs_test_new10000',
    })
    const params = created[0].params
    expect(params.get('ui_mode')).toBe('elements')
    expect(params.get('success_url')).toBeNull()
    expect(params.get('return_url')).toContain('/pay-quote?q=q-1&t=')
    expect(created[0].headers['Stripe-Version']).toBeTruthy()
  })

  it('expires the session the last press opened before it opens another', async () => {
    await press({}, 'press-1')
    await press({}, 'press-2')
    expect(expired).toEqual(['cs_test_new10000'])
    expect(docs.get(QUOTE_PATH)?.['checkoutSessionId']).toBe('cs_test_new20000')
  })

  it('replays a repeated press instead of opening a second session', async () => {
    const first = await press({}, 'same')
    expect(await press({}, 'same')).toEqual(first)
    expect(created).toHaveLength(1)
  })

  it('refuses when the last session was paid a moment ago, and opens nothing', async () => {
    storeQuote({}, { checkoutSessionId: 'cs_test_paid0000' })
    expiry = 'complete'
    const outcome = await press()
    expect(outcome.status).toBe(409)
    expect(outcome.body).toMatchObject({ reason: 'paid', confirming: true })
    expect(created).toHaveLength(0)
  })

  it('refuses when the last session cannot be closed, rather than open a second', async () => {
    storeQuote({}, { checkoutSessionId: 'cs_test_stuck0000' })
    expiry = 'open'
    expect((await press()).status).toBe(502)
    expect(created).toHaveLength(0)
  })

  it('refuses a quote changed since the page showed it', async () => {
    const outcome = await press({ v: 1_500 })
    expect(outcome).toMatchObject({ status: 409, body: { reason: 'updated' } })
    expect(created).toHaveLength(0)
  })

  it('refuses a paid quote', async () => {
    storeQuote({}, { status: 'paid' })
    expect(await press()).toMatchObject({ status: 409, body: { reason: 'paid', error: 'This quote has been paid.' } })
    expect(created).toHaveLength(0)
  })

  it('refuses a quote waiting on the customer to approve its proof, whatever the request says', async () => {
    storeQuote({ requireProofApproval: true, proofs: [{ id: 'p1', revision: 1 }] })
    const outcome = await press({ approved: true })
    expect(outcome).toMatchObject({
      status: 409,
      body: { reason: 'approval-required', error: 'Acme Tents asks you to approve the proof before you pay.' },
    })
    expect(created).toHaveLength(0)
  })

  it('refuses a replaced link, and a wrong one as a missing quote', async () => {
    storeQuote({ linkVersion: 2 })
    expect(await press()).toMatchObject({ status: 410, body: { replaced: true } })
    expect((await handleQuotePay(deps, payRequest({ hostId: 'site1', q: 'q-1', t: `2.${'0'.repeat(32)}` }))).status).toBe(404)
    expect(created).toHaveLength(0)
  })

  it('refuses plainly when the store cannot take payments', async () => {
    docs.set('profiles/owner-1', { stripeChargesEnabled: false })
    const noAccount = await press()
    expect(noAccount).toMatchObject({ status: 409, body: { reason: 'payments-unavailable' } })
    expect(String(noAccount.body['error'])).toMatch(/can’t take payments online right now/)
    docs.set('profiles/owner-1', { stripeAccountId: 'acct_merchant', stripeChargesEnabled: true, stripeAccountLivemode: false })
    docs.set('hosts/site1/settings/store', { currency: 'USD', tax: {} })
    expect(await press()).toMatchObject({ status: 409, body: { reason: 'tax-undecided' } })
    expect(created).toHaveLength(0)
  })

  it('asks Stripe Tax at payment, keeping the tax out of the merchant’s transfer', async () => {
    storeQuote({ tax: { kind: 'at-payment' } })
    docs.set('hosts/site1/settings/store', { currency: 'USD', tax: { mode: 'stripe' } })
    await press()
    const params = created[0].params
    expect(params.get('automatic_tax[enabled]')).toBe('true')
    expect(params.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(params.get('payment_intent_data[application_fee_amount]')).toBeNull()
    expect(params.get('payment_intent_data[transfer_data][amount]')).toBe(params.get('metadata[transferCents]'))
    expect(taxRateId).not.toHaveBeenCalled()
  })

  it('closes the session it opened when the quote was paid meanwhile', async () => {
    const real = deps.createSession
    const racing: QuotePayDeps = {
      ...deps,
      createSession: async (params, headers) => {
        const answer = await real(params, headers)
        docs.set(QUOTE_PATH, { ...docs.get(QUOTE_PATH), status: 'paid' })
        return answer
      },
    }
    const outcome = await handleQuotePay(racing, payRequest({ hostId: 'site1', q: 'q-1', t: token(), v: 2_000 }))
    expect(outcome).toMatchObject({ status: 409, body: { reason: 'paid' } })
    expect(expired).toEqual(['cs_test_new10000'])
  })

  it('needs an attempt key, a complete link and a configured Stripe', async () => {
    expect((await press({}, '')).status).toBe(400)
    expect((await handleQuotePay(deps, payRequest({ hostId: 'site1', q: 'q-1' }))).status).toBe(400)
    delete process.env.STRIPE_SECRET_KEY
    expect((await press()).status).toBe(501)
  })
})

describe('an invoiced draft order’s link (AGL-4099)', () => {
  const DRAFT_PATH = 'hosts/site1/orders/d-1'
  const draftToken = (version = 1) => String(mintQuoteLinkToken('site1', 'd-1', version))

  /** A draft as `draft-order.ts` writes it: one product, a promotion, the store's rate, two rates to ship by. */
  function storeDraft(overrides: Record<string, unknown> = {}) {
    docs.set(DRAFT_PATH, {
      number: 2001,
      status: 'pending',
      channel: 'draft',
      lineItems: [{ productId: 'canopy', variantId: 'red', name: 'Canopy 10x10', productType: 'physical', quantity: 2, unitAmountCents: 120_000 }],
      totals: { itemsCents: 240_000, discountCents: 24_000, shippingCents: 0, taxCents: 17_820, feeCents: 0, totalCents: 233_820 },
      taxMode: 'manual',
      customerEmail: 'jordan@example.com',
      customerEmailLower: 'jordan@example.com',
      createdAtMs: 1_000,
      timeline: [{ atMs: 1_000, event: 'draft', detail: 'Draft created by owner@example.com' }],
      checkoutSessionId: 'cs_draft_first',
      paymentLinkUrl: 'https://checkout.stripe.com/c/pay/cs_draft_first',
      discountId: 'spring',
      draftShipping: {
        countries: ['US', 'CA'],
        options: [
          { rateId: 'standard', name: 'Standard', amountCents: 1_500 },
          { rateId: 'express', name: 'Express', amountCents: 4_000 },
        ],
      },
      ...overrides,
    })
  }

  const press = (body: Record<string, unknown> = {}, key = 'press-1') =>
    handleQuotePay(deps, payRequest({ hostId: 'site1', q: 'd-1', t: draftToken(), ...body }, key))

  beforeEach(() => storeDraft())

  it('opens as "Invoice #N" with its lines and totals, and nothing a quote has', async () => {
    const outcome = await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'd-1', t: draftToken() }))
    expect(outcome.status).toBe(200)
    expect(outcome.body).toMatchObject({
      state: 'quote',
      kind: 'invoice',
      number: 'Invoice #2001',
      status: 'unpaid',
      payable: true,
      approvalRequired: false,
      respondable: false,
      proofs: [],
      shippingAtPayment: true,
      taxAtPayment: false,
      dateMs: 1_000,
      totals: { itemsCents: 240_000, discountCents: 24_000, shippingCents: 0, taxCents: 17_820, totalCents: 233_820 },
    })
    const wire = JSON.stringify(outcome.body)
    expect(wire).not.toContain('jordan@example.com')
    expect(wire).not.toContain('owner@example.com')
    expect(wire).not.toContain('cs_draft_first')
  })

  it('opens the draft as paid with its receipt once it is paid', async () => {
    storeDraft({ status: 'paid', timeline: [{ atMs: 1_000, event: 'draft' }, { atMs: 5_000, event: 'paid' }] })
    const outcome = await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'd-1', t: draftToken() }))
    expect(outcome.body).toMatchObject({ kind: 'invoice', status: 'paid', paidAtMs: 5_000, payable: false })
    expect(String(outcome.body['receiptUrl'])).toContain('/order-status?o=d-1&t=')
  })

  it('keeps its version on payLink: a link to an older one opens the replaced page, named an invoice', async () => {
    storeDraft({ payLink: { version: 2 } })
    expect(await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'd-1', t: draftToken(1) }))).toEqual({
      status: 200,
      body: { state: 'replaced', kind: 'invoice', storeName: 'Acme Tents' },
    })
    expect((await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'd-1', t: draftToken(2) }))).body['kind']).toBe('invoice')
    expect((await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'd-1', t: draftToken(3) }))).status).toBe(404)
  })

  it('opens no register sale or online order, whatever its token', async () => {
    docs.set('hosts/site1/orders/pos-1', { status: 'pending', channel: 'pos', lineItems: [] })
    const outcome = await handleQuoteView(deps, viewRequest({ hostId: 'site1', q: 'pos-1', t: String(mintQuoteLinkToken('site1', 'pos-1', 1)) }))
    expect(outcome.status).toBe(404)
  })

  it('prices a fresh session from the stored draft: its discount, its frozen tax and the rates it was made with', async () => {
    const outcome = await press({ amountCents: 1 })
    expect(outcome).toEqual({ status: 200, body: { url: 'https://checkout.stripe.com/c/pay/cs_test_new10000' } })
    const params = created[0].params
    // The goods after the draft's discount, as one taxed line under the invoice's name.
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('216000')
    expect(params.get('line_items[0][price_data][product_data][name]')).toBe('Invoice #2001')
    expect(params.get('line_items[1][price_data][unit_amount]')).toBeNull()
    // Its frozen tax as the rate that yields it on that line.
    expect(params.get('line_items[0][tax_rates][0]')).toBe('txr_store')
    expect(taxRateId).toHaveBeenCalledWith(expect.objectContaining({ taxPct: 8.25, taxLabel: 'Sales tax' }))
    // The rates the draft offered, and where they ship.
    expect(params.get('shipping_options[0][shipping_rate_data][display_name]')).toBe('Standard')
    expect(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('1500')
    expect(params.get('shipping_options[1][shipping_rate_data][display_name]')).toBe('Express')
    expect(params.get('shipping_address_collection[allowed_countries][0]')).toBe('US')
    expect(params.get('shipping_address_collection[allowed_countries][1]')).toBe('CA')
    expect(params.get('customer_email')).toBe('jordan@example.com')
    // What the draft branch reads: the order, its link version and its promotion; nothing of a quote.
    expect(params.get('metadata[type]')).toBe('commerce-draft')
    expect(params.get('metadata[orderId]')).toBe('d-1')
    expect(params.get('metadata[payLinkVersion]')).toBe('1')
    expect(params.get('metadata[discountId]')).toBe('spring')
    expect(params.get('metadata[discountHoldKey]')).toBeNull()
    expect(params.get('metadata[quoteId]')).toBeNull()
    expect(params.get('metadata[productId]')).toBeNull()
    expect(params.get('success_url')).toBe(`https://acme.aglyn.app/pay-quote?q=d-1&t=${encodeURIComponent(draftToken())}&session_id={CHECKOUT_SESSION_ID}`)
  })

  it('closes the draft’s first session before opening its own, and keeps the one it opened', async () => {
    await press()
    expect(expired).toEqual(['cs_draft_first'])
    expect(docs.get(DRAFT_PATH)?.['checkoutSessionId']).toBe('cs_test_new10000')
    await press({}, 'press-2')
    expect(expired).toEqual(['cs_draft_first', 'cs_test_new10000'])
    expect(docs.get(DRAFT_PATH)?.['checkoutSessionId']).toBe('cs_test_new20000')
  })

  it('asks Stripe Tax at payment for a draft composed under it', async () => {
    storeDraft({ taxMode: 'stripe-automatic', totals: { itemsCents: 240_000, discountCents: 24_000, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 216_000 } })
    await press()
    const params = created[0].params
    expect(params.get('automatic_tax[enabled]')).toBe('true')
    expect(params.get('line_items[0][tax_rates][0]')).toBeNull()
  })

  it('refuses a draft made before drafts kept their shipping, rather than charge none', async () => {
    const legacy = docs.get(DRAFT_PATH) as Record<string, unknown>
    delete legacy['draftShipping']
    docs.set(DRAFT_PATH, legacy)
    const outcome = await press()
    expect(outcome).toEqual({
      status: 409,
      body: { reason: 'shipping-unknown', error: 'This invoice can’t be paid online. Contact Acme Tents to pay it.' },
    })
    expect(created).toHaveLength(0)
  })

  it('refuses a paid or canceled draft in the invoice’s words', async () => {
    storeDraft({ status: 'paid' })
    expect((await press()).body).toEqual({ reason: 'paid', error: 'This invoice has been paid.' })
    storeDraft({ status: 'cancelled' })
    expect((await press({}, 'press-2')).body).toEqual({
      reason: 'closed',
      error: 'This invoice is closed. Contact Acme Tents with any questions.',
    })
    expect(created).toHaveLength(0)
  })

  it('says "invoice" when the store cannot take payments', async () => {
    docs.set('profiles/owner-1', { stripeAccountId: 'acct_merchant', stripeChargesEnabled: false, stripeAccountLivemode: false })
    const outcome = await press()
    expect(outcome.body['error']).toBe('Acme Tents can’t take payments online right now. Contact them to pay this invoice.')
  })

  it('serves no proof route: those stay a quote’s alone', async () => {
    const { loadLinkedQuote } = await import('./quote-pay')
    const linked = await loadLinkedQuote(deps, 'site1', 'd-1', draftToken())
    expect('outcome' in linked && linked.outcome.status).toBe(404)
  })
})
