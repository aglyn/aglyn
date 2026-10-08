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

/**
 * The self-service kiosk's route (AGL-3623): paired like a display but only
 * with a kiosk code, re-gated on every call by the pairing member's standing,
 * the plan and lockdown; a catalog with nothing a customer should not see;
 * a cart priced only by the register's own sale route; card payments for
 * the server's balance through the register's Terminal flow, with the tip
 * recomputed here; "pay at counter" into the register's queue; a receipt
 * that never echoes an address; the idle reset's void; and a staff PIN
 * unlock with a claimed attempt budget. Stripe is a fake keyed by
 * idempotency key, as in the register's own payment spec.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'

const mockSalesOpened: Array<{ body: any; principal: any; key: string }> = []
const mockState = {
  rateAllowed: true,
  locked: false,
  entitled: true,
  managePos: true,
  orderCounter: 0,
}

jest.mock('./order-notifications', () => ({
  notifyOrderBuyer: async (_ref: any, _event: string, options: any) => ({
    outcome: 'handled',
    channels: [{ channel: options?.email ? 'email' : 'sms', outcome: 'sent' }],
  }),
  sendOrderReceipt: async (_ref: any, input: any) => ({ outcome: 'sent', channel: input.channel }),
}))
jest.mock('./order-events', () => ({ raiseOrderEvent: async () => undefined }))
jest.mock('./reserve-stock', () => ({
  decrementVariantStock: async () => ({ before: { variants: [] }, after: { variants: [] } }),
}))
jest.mock('./low-stock', () => ({ alertLowStockCrossing: () => undefined }))
jest.mock('@aglyn/aglyn/plugin-manager/record-captured-contact', () => ({
  __esModule: true,
  default: async () => undefined,
}))
jest.mock('@aglyn/shared-util-email', () => ({ isEmailConfigured: () => false, sendEmail: async () => undefined }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: mockState.managePos } }),
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({ merchantAccountIsReady: () => true }))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'cashier-1' }) }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    consumeRateLimit: async () => ({ allowed: mockState.rateAllowed }),
    getLockdownVerdict: async () => (mockState.locked ? { scope: 'host', reason: 'suspended' } : null),
    getOrgForHost: async () => ({
      orgId: 'org-1',
      org: {
        id: 'org-1',
        plan: mockState.entitled ? 'business' : 'free',
        subscriptionStatus: 'active',
        ownerUid: 'owner-1',
        slug: 'acme',
      },
    }),
    getPluginConfig: async () => ({
      posTippingEnabled: true,
      posTipPercentages: '15,20,25',
      posKioskIdleSeconds: 45,
    }),
    meterHostEmail: async () => undefined,
    renderHostEmailWithTokens: async () => null,
    hostSendingIdentity: async () => null,
  }
})
// The register's sale route, faked to its open-sale contract: it receives the
// kiosk principal and writes a pending sale with an empty ledger.
jest.mock('./pos-order', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  const { posKioskPrincipal } = jest.requireActual('./pos-kiosk-principal')
  return {
    posOrderHandler: async (req: any, res: any) => {
      const principal = posKioskPrincipal(req)
      mockSalesOpened.push({ body: req.body, principal, key: req.headers['idempotency-key'] })
      if (!principal) return res.status(401).json({ error: 'Unauthenticated' })
      const orderId = `kiosk-order-${++mockState.orderCounter}`
      const items = (req.body.lines as any[]).reduce((sum, line) => sum + line.quantity * 450, 0)
      fake.fakeDocs.set(`hosts/${req.body.hostId}/orders/${orderId}`, {
        number: 100 + mockState.orderCounter,
        status: 'pending',
        channel: 'pos',
        registerId: req.body.registerId,
        cashierId: principal.uid,
        posSource: 'kiosk',
        kioskDeviceId: principal.deviceId,
        lineItems: (req.body.lines as any[]).map((line) => ({
          productId: line.productId,
          name: 'Flat white',
          quantity: line.quantity,
          unitAmountCents: 450,
        })),
        totals: {
          itemsCents: items,
          shippingCents: 0,
          taxCents: 50,
          discountCents: 0,
          totalCents: items + 50,
          feeCents: 10,
        },
        posTakeFeeCents: 10,
        posFeeOrgId: 'org-1',
        payments: [],
        timeline: [],
      })
      return res.status(200).json({ orderId })
    },
  }
})

import { hashMemberPassword } from './membership'
import { posDisplayHandler } from './pos-display'
import { posKioskHandler } from './pos-kiosk'

/*==========================================
 * A fake Stripe.
 *=========================================*/

const stripeCalls: Array<{ method: string; path: string; params: URLSearchParams }> = []
const intents = new Map<string, any>()
const replays = new Map<string, any>()
let intentCounter = 0

function stripeAnswer(method: string, path: string, params: URLSearchParams): any {
  if (method === 'POST' && path === 'payment_intents') {
    const id = `pi_test_${++intentCounter}`
    const intent = {
      id,
      amount: Number(params.get('amount')),
      status: 'requires_payment_method',
      client_secret: `${id}_secret`,
      livemode: false,
      metadata: Object.fromEntries(
        [...params.entries()]
          .filter(([key]) => key.startsWith('metadata['))
          .map(([key, value]) => [key.slice(9, -1), value]),
      ),
    }
    intents.set(id, intent)
    return intent
  }
  const capture = /^payment_intents\/(pi_test_\d+)\/capture$/.exec(path)
  if (method === 'POST' && capture) {
    const intent = intents.get(capture[1])
    intent.status = 'succeeded'
    intent.latest_charge = { payment_method_details: { card_present: { brand: 'visa', last4: '4242' } } }
    return intent
  }
  const cancel = /^payment_intents\/(pi_test_\d+)\/cancel$/.exec(path)
  if (method === 'POST' && cancel) {
    intents.get(cancel[1]).status = 'canceled'
    return intents.get(cancel[1])
  }
  const get = /^payment_intents\/(pi_test_\d+)$/.exec(path)
  if (method === 'GET' && get) return intents.get(get[1])
  if (method === 'POST' && /^terminal\/readers\/tmr_\w+\/process_payment_intent$/.test(path)) {
    return { id: path.split('/')[2], action: { status: 'in_progress' } }
  }
  if (method === 'POST' && /^terminal\/readers\/tmr_\w+\/cancel_action$/.test(path)) return { id: 'tmr' }
  if (method === 'GET' && /^terminal\/readers\/tmr_\w+$/.test(path)) {
    return { id: path.split('/')[2], status: 'online', action: null }
  }
  if (method === 'POST' && path === 'terminal/connection_tokens') return { secret: 'pst_test_secret' }
  return {}
}

const fetchMock = jest.fn(async (url: any, init: any) => {
  const target = new URL(String(url))
  const path = target.pathname.replace(/^\/v1\//, '')
  const method = String(init?.method ?? 'GET')
  const params = new URLSearchParams(method === 'GET' ? target.search : String(init?.body ?? ''))
  const key = (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
  stripeCalls.push({ method, path, params })
  if (key && replays.has(key)) return { ok: true, status: 200, json: async () => replays.get(key) }
  const body = stripeAnswer(method, path, params)
  if (key) replays.set(key, body)
  return { ok: true, status: 200, json: async () => body }
})

/*==========================================
 * Harness.
 *=========================================*/

function response() {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send() {},
    setHeader() {},
    redirect() {},
    end() {},
  } as unknown as PluginApiResponse
  return { res, result }
}

function request(
  body: Record<string, unknown>,
  options: { token?: string; staff?: boolean; key?: string; method?: 'GET' | 'POST' } = {},
): PluginApiRequest {
  const method = options.method ?? 'POST'
  return {
    method,
    query: method === 'GET' ? (body as Record<string, string>) : {},
    body: method === 'POST' ? body : undefined,
    headers: {
      ...(options.token ? { 'x-pos-display-token': options.token } : {}),
      ...(options.staff ? { authorization: 'Bearer staff' } : {}),
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    },
    cookies: {},
    socket: { remoteAddress: '203.0.113.7' },
  }
}

async function kiosk(
  body: Record<string, unknown>,
  options: { token?: string; staff?: boolean; key?: string; method?: 'GET' | 'POST' } = {},
) {
  const { res, result } = response()
  await posKioskHandler(request(body, options), res)
  return result
}

async function display(body: Record<string, unknown>, options: { token?: string; staff?: boolean; method?: 'GET' | 'POST' } = {}) {
  const { res, result } = response()
  await posDisplayHandler(request(body, options), res)
  return result
}

const SITE = { hostId: 'host-1', registerId: 'register-1' }

async function pair(mode: 'kiosk' | 'display' = 'kiosk'): Promise<string> {
  const code = await display({ action: 'pairing-code', ...SITE, mode }, { staff: true })
  const paired = await display({ action: 'pair', code: code.body.code, mode })
  expect(paired.status).toBe(200)
  return paired.body.token
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Flat white',
    nameLower: 'flat white',
    type: 'physical',
    status: 'active',
    deletedAt: null,
    categoryIds: ['drinks'],
    supplierId: 'supplier-secret',
    lowStockThreshold: 3,
    variants: [{ id: 'default', priceUsd: 4.5, inventory: 12, options: {}, sku: 'FW-1' }],
    modifierGroups: [
      { id: 'milk', name: 'Milk', min: 0, max: 1, options: [{ id: 'oat', name: 'Oat milk', priceCents: 75 }] },
    ],
    ...overrides,
  }
}

function orderDoc(orderId: string) {
  return fakeDocs.get(`hosts/host-1/orders/${orderId}`) as any
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
  process.env.TOKEN_SIGNING_SECRET = 'kiosk-spec-secret'
})

beforeEach(() => {
  resetFakeFirestore()
  stripeCalls.length = 0
  intents.clear()
  replays.clear()
  intentCounter = 0
  mockSalesOpened.length = 0
  Object.assign(mockState, { rateAllowed: true, locked: false, entitled: true, managePos: true, orderCounter: 0 })
  fakeDocs.set('hosts/host-1', { memberRoles: { 'cashier-1': 'editor', 'manager-1': 'admin' }, displayName: 'Bean Bar' })
  fakeDocs.set('hosts/host-1/registers/register-1', { name: 'Front', locationId: 'loc-main' })
  fakeDocs.set('hosts/host-1/registers/register-2', { name: 'Back' })
  fakeDocs.set('profiles/owner-1', { stripeAccountId: 'acct_merchant', stripeChargesEnabled: true })
  fakeDocs.set('hosts/host-1/terminalReaders/tmr_kiosk01', {
    label: 'Kiosk reader',
    registerId: 'register-1',
    stripeLocationId: 'tml_1',
    livemode: false,
  })
  fakeDocs.set('hosts/host-1/products/flat-white', product())
})

/*==========================================
 * Pairing and the gate.
 *=========================================*/

describe('pairing a kiosk reuses the display pairing', () => {
  it('a kiosk code opens a kiosk, and a display code never does', async () => {
    const displayCode = await display({ action: 'pairing-code', ...SITE }, { staff: true })
    const wrong = await display({ action: 'pair', code: displayCode.body.code, mode: 'kiosk' })
    expect(wrong.status).toBe(409)
    // Spent either way: the register shows a fresh code for the right device.
    expect((await display({ action: 'pair', code: displayCode.body.code })).status).toBe(404)
    const token = await pair('kiosk')
    expect([...fakeDocs.values()].some((doc) => doc['mode'] === 'kiosk' && doc['createdBy'] === 'cashier-1')).toBe(true)
    expect((await kiosk({ action: 'context' }, { token, method: 'GET' })).status).toBe(200)
  })

  it('a kiosk token never reads the register display, and cannot unpair itself without staff', async () => {
    const token = await pair('kiosk')
    expect((await display({ action: 'poll' }, { token, method: 'GET' })).status).toBe(403)
    expect((await display({ action: 'forget' }, { token })).status).toBe(403)
  })

  it('a kiosk is not the "Display connected" the register shows', async () => {
    await pair('kiosk')
    const state = await display({ action: 'state', ...SITE }, { staff: true, method: 'GET' })
    expect(state.body.connected).toBe(false)
  })

  it('a display token is refused by the kiosk route', async () => {
    const token = await pair('display')
    expect((await kiosk({ action: 'catalog' }, { token, method: 'GET' })).status).toBe(403)
  })

  it('refuses without a token, and stops when the pairing member loses the register', async () => {
    expect((await kiosk({ action: 'context' }, { method: 'GET' })).status).toBe(401)
    const token = await pair()
    mockState.managePos = false
    expect((await kiosk({ action: 'context' }, { token, method: 'GET' })).status).toBe(403)
    mockState.managePos = true
    fakeDocs.set('hosts/host-1', { memberRoles: {}, displayName: 'Bean Bar' })
    expect((await kiosk({ action: 'context' }, { token, method: 'GET' })).status).toBe(403)
  })

  it('stops on a downgrade below POS, and under a lockdown', async () => {
    const token = await pair()
    mockState.entitled = false
    expect((await kiosk({ action: 'catalog' }, { token, method: 'GET' })).status).toBe(403)
    mockState.entitled = true
    mockState.locked = true
    expect((await kiosk({ action: 'catalog' }, { token, method: 'GET' })).status).toBe(423)
  })
})

describe('what the kiosk reads', () => {
  it('the context: tips from the register settings, the reader, the idle reset, no staff data', async () => {
    const token = await pair()
    const result = await kiosk({ action: 'context' }, { token, method: 'GET' })
    expect(result.body).toMatchObject({
      currency: 'usd',
      tipping: { enabled: true, percentages: [15, 20, 25] },
      payments: { reader: true, cardPresent: true, payAtCounter: true },
      idleSeconds: 45,
      testMode: true,
    })
    expect(result.body.receipts).toEqual(expect.arrayContaining(['email', 'none']))
    expect(JSON.stringify(result.body)).not.toContain('cashier-1')
  })

  it('the catalog: sellable products, prices and choices — no stock count, SKU or supplier', async () => {
    fakeDocs.set('hosts/host-1/products/subscription', product({ name: 'Bean club', subscription: { interval: 'month' } }))
    fakeDocs.set('hosts/host-1/products/gift', product({ name: 'Gift card', giftCard: true }))
    fakeDocs.set('hosts/host-1/products/draft', product({ name: 'Draft', status: 'draft' }))
    fakeDocs.set('hosts/host-1/products/gone', product({ name: 'Gone', deletedAt: 123 }))
    fakeDocs.set(
      'hosts/host-1/products/sold-out',
      product({ name: 'Cortado', variants: [{ id: 'default', priceUsd: 3, inventory: 0, options: {} }] }),
    )
    const token = await pair()
    const result = await kiosk({ action: 'catalog' }, { token, method: 'GET' })
    expect(result.status).toBe(200)
    const names = result.body.products.map((item: any) => item.name).sort()
    expect(names).toEqual(['Cortado', 'Flat white'])
    const flat = result.body.products.find((item: any) => item.name === 'Flat white')
    expect(flat.variants).toEqual([{ id: 'default', options: {}, priceCents: 450, soldOut: false }])
    expect(flat.modifierGroups[0].options[0]).toMatchObject({ id: 'oat', priceCents: 75 })
    expect(result.body.products.find((item: any) => item.name === 'Cortado').variants[0].soldOut).toBe(true)
    const wire = JSON.stringify(result.body)
    for (const secret of ['supplier-secret', 'FW-1', 'lowStockThreshold', '"inventory"']) {
      expect(wire).not.toContain(secret)
    }
  })

  it('a category is a clause on the query', async () => {
    fakeDocs.set('hosts/host-1/products/muffin', product({ name: 'Muffin', categoryIds: ['food'] }))
    const token = await pair()
    const result = await kiosk({ action: 'catalog', categoryId: 'food' }, { token, method: 'GET' })
    expect(result.body.products.map((item: any) => item.name)).toEqual(['Muffin'])
  })
})

/*==========================================
 * Ordering and paying.
 *=========================================*/

async function checkout(token: string, lines: unknown = [{ productId: 'flat-white', quantity: 2 }], key = 'cart-1') {
  return await kiosk({ action: 'checkout', lines }, { token, key })
}

describe('checkout prices the cart through the register', () => {
  it('opens a sale as the pairing member, with only ids and counts, on its own register and location', async () => {
    const token = await pair()
    const result = await checkout(token, [
      { productId: 'flat-white', quantity: 2, modifiers: [{ groupId: 'milk', optionId: 'oat' }], unitAmountCents: 1 },
    ])
    expect(result.status).toBe(200)
    expect(mockSalesOpened).toHaveLength(1)
    const opened = mockSalesOpened[0]!
    expect(opened.principal).toMatchObject({ uid: 'cashier-1', registerId: 'register-1' })
    expect(opened.body).toEqual({
      hostId: 'host-1',
      registerId: 'register-1',
      payment: 'open',
      lines: [{ productId: 'flat-white', quantity: 2, modifiers: [{ groupId: 'milk', optionId: 'oat' }] }],
      locationId: 'loc-main',
    })
    // Namespaced: a kiosk's attempt key never collides with a register's.
    expect(opened.key).toMatch(/^kiosk:[0-9a-f]{16}:cart-1$/)
    expect(result.body.sale).toMatchObject({ status: 'open', totalCents: 950, taxCents: 50, dueCents: 950 })
  })

  it('refuses an unkeyed checkout, a bad cart, a sold-out item, and a flood', async () => {
    const token = await pair()
    expect((await kiosk({ action: 'checkout', lines: [{ productId: 'flat-white', quantity: 1 }] }, { token })).status).toBe(400)
    expect((await checkout(token, [])).status).toBe(400)
    expect((await checkout(token, [{ productId: 'flat-white', quantity: 21 }])).status).toBe(400)
    expect((await checkout(token, [{ productId: '../x', quantity: 1 }])).status).toBe(400)
    expect((await checkout(token, [{ productId: 'flat-white', quantity: 13 }])).status).toBe(409)
    fakeDocs.set('hosts/host-1/products/gift', product({ giftCard: true }))
    expect((await checkout(token, [{ productId: 'gift', quantity: 1 }])).status).toBe(409)
    mockState.rateAllowed = false
    expect((await checkout(token)).status).toBe(429)
    expect(mockSalesOpened).toHaveLength(0)
  })

  it("never shows one kiosk another kiosk's order, or a register sale", async () => {
    const mine = await pair()
    const theirs = await pair()
    const opened = await checkout(mine)
    const orderId = opened.body.sale.orderId
    expect((await kiosk({ action: 'sale', orderId }, { token: theirs, method: 'GET' })).status).toBe(404)
    fakeDocs.set('hosts/host-1/orders/register-sale', { status: 'pending', channel: 'pos', payments: [] })
    expect((await kiosk({ action: 'sale', orderId: 'register-sale' }, { token: mine, method: 'GET' })).status).toBe(404)
    expect((await kiosk({ action: 'sale', orderId }, { token: mine, method: 'GET' })).status).toBe(200)
  })
})

describe('paying on the card reader', () => {
  it("charges the server's balance and a tip recomputed from the store's presets, on the register's reader", async () => {
    const token = await pair()
    const orderId = (await checkout(token)).body.sale.orderId
    const paid = await kiosk(
      { action: 'pay', orderId, method: 'reader', tipChoice: 'percent', tipPercent: 20, amountCents: 1 },
      { token, key: 'pay-1' },
    )
    expect(paid.status).toBe(200)
    const create = stripeCalls.find((call) => call.path === 'payment_intents')!
    // $9.50 due + 20% tip ($1.90), whatever the kiosk claimed.
    expect(Number(create.params.get('amount'))).toBe(1140)
    expect(create.params.get('transfer_data[destination]')).toBe('acct_merchant')
    const process = stripeCalls.find((call) => call.path.endsWith('/process_payment_intent'))!
    expect(process.path).toContain('tmr_kiosk01')
    // The kiosk asked for the tip; the reader must not ask again.
    expect(process.params.get('process_config[skip_tipping]')).toBe('true')

    // The customer taps; the kiosk's poll settles the sale.
    const intent = [...intents.values()][0]
    intent.status = 'requires_capture'
    const status = await kiosk({ action: 'payment-status', orderId, paymentId: paid.body.paymentId }, { token })
    expect(status.body.sale).toMatchObject({ status: 'paid', tipCents: 190 })
    expect(orderDoc(orderId).status).toBe('paid')
  })

  it('refuses a tip the store does not offer, and a second press finds the first payment', async () => {
    const token = await pair()
    const orderId = (await checkout(token)).body.sale.orderId
    expect(
      (await kiosk({ action: 'pay', orderId, method: 'reader', tipChoice: 'percent', tipPercent: 50 }, { token, key: 'p' }))
        .status,
    ).toBe(400)
    expect(
      (await kiosk({ action: 'pay', orderId, method: 'reader', tipChoice: 'custom', tipCents: 5000 }, { token, key: 'p' }))
        .status,
    ).toBe(400)
    const first = await kiosk({ action: 'pay', orderId, method: 'reader', tipChoice: 'none' }, { token, key: 'p2' })
    const again = await kiosk({ action: 'pay', orderId, method: 'reader', tipChoice: 'none' }, { token, key: 'p2' })
    expect(again.body.paymentId).toBe(first.body.paymentId)
    // Keyed by the payment: Stripe replays the first intent rather than making a second.
    expect(intents.size).toBe(1)
  })

  it('stays behind the Terminal gate: no live card payment until it is switched on', async () => {
    const token = await pair()
    const orderId = (await checkout(token)).body.sale.orderId
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake'
    delete process.env.STRIPE_TERMINAL_LIVE_ENABLED
    try {
      const context = await kiosk({ action: 'context' }, { token, method: 'GET' })
      expect(context.body.payments).toMatchObject({ reader: false, cardPresent: false })
      const refused = await kiosk({ action: 'pay', orderId, method: 'tap', tipChoice: 'none' }, { token, key: 'live' })
      expect(refused.status).toBe(409)
      expect((await kiosk({ action: 'connection-token' }, { token })).status).toBe(409)
      expect(stripeCalls).toHaveLength(0)
    } finally {
      process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
    }
  })

  it('Tap to Pay hands the native app a server-made intent', async () => {
    const token = await pair()
    const orderId = (await checkout(token)).body.sale.orderId
    const tap = await kiosk({ action: 'pay', orderId, method: 'tap', tipChoice: 'none' }, { token, key: 'tap' })
    expect(tap.body).toMatchObject({ clientSecret: 'pi_test_1_secret', paymentIntentId: 'pi_test_1' })
    fakeDocs.set('hosts/host-1/settings/terminal', { stripeLocationId: 'tml_1' })
  })
})

describe('pay at counter', () => {
  it("queues the order for its register, oldest first, and the register takes it as an open sale", async () => {
    const token = await pair()
    const orderId = (await checkout(token)).body.sale.orderId
    const queued = await kiosk({ action: 'counter', orderId }, { token })
    expect(queued.body.sale).toMatchObject({ status: 'queued', number: 101 })
    // A queued order is the counter's now: the kiosk cannot start a card on it.
    expect((await kiosk({ action: 'pay', orderId, method: 'reader', tipChoice: 'none' }, { token, key: 'k' })).status).toBe(409)
    const queue = await kiosk({ action: 'queue', ...SITE }, { staff: true, method: 'GET' })
    expect(queue.body.entries).toEqual([expect.objectContaining({ orderId, number: 101, totalCents: 950, itemCount: 2 })])
    const taken = await kiosk({ action: 'take', ...SITE, orderId }, { staff: true })
    expect(taken.body.sale).toMatchObject({ orderId, dueCents: 950 })
    expect(taken.body.lines[0]).toMatchObject({ productId: 'flat-white', quantity: 2, unitAmountCents: 450 })
    // Another register's queue does not hold it.
    expect((await kiosk({ action: 'take', hostId: 'host-1', registerId: 'register-2', orderId }, { staff: true })).status).toBe(404)
  })

  it('the queue is the register gate’s', async () => {
    expect((await kiosk({ action: 'queue', ...SITE }, { method: 'GET' })).status).toBe(401)
  })
})

describe('the receipt and the reset', () => {
  async function paidOrder(token: string) {
    const orderId = (await checkout(token)).body.sale.orderId
    const paid = await kiosk({ action: 'pay', orderId, method: 'reader', tipChoice: 'none' }, { token, key: 'r' })
    ;[...intents.values()][0].status = 'requires_capture'
    await kiosk({ action: 'payment-status', orderId, paymentId: paid.body.paymentId }, { token })
    return orderId
  }

  it('a receipt waits for payment, and an emailed one never echoes the address', async () => {
    const token = await pair()
    const open = (await checkout(token, undefined, 'open-cart')).body.sale.orderId
    expect((await kiosk({ action: 'receipt', orderId: open, channel: 'email', to: 'a@b.co' }, { token })).status).toBe(409)
    const orderId = await paidOrder(token)
    const sent = await kiosk({ action: 'receipt', orderId, channel: 'email', to: 'Ann@Example.com' }, { token })
    expect(sent.status).toBe(200)
    expect(JSON.stringify(sent.body)).not.toContain('example.com')
    expect(orderDoc(orderId).receiptRequest).toMatchObject({ channel: 'email', to: 'ann@example.com' })
    const view = await kiosk({ action: 'sale', orderId }, { token, method: 'GET' })
    expect(JSON.stringify(view.body)).not.toContain('example.com')
  })

  it('the reset voids an unpaid order and leaves a queued one alone', async () => {
    const token = await pair()
    const open = (await checkout(token, undefined, 'a')).body.sale.orderId
    expect((await kiosk({ action: 'abandon', orderId: open }, { token })).body.sale.status).toBe('voided')
    expect(orderDoc(open).status).toBe('cancelled')
    const queued = (await checkout(token, undefined, 'b')).body.sale.orderId
    await kiosk({ action: 'counter', orderId: queued }, { token })
    expect((await kiosk({ action: 'abandon', orderId: queued }, { token })).body.sale.status).toBe('queued')
    expect(orderDoc(queued).status).toBe('pending')
  })
})

/*==========================================
 * Staff unlock.
 *=========================================*/

describe('staff unlock', () => {
  beforeEach(() => {
    fakeDocs.set('hosts/host-1/posStaffPins/manager-1', { pinScrypt: hashMemberPassword('2468') })
    fakeDocs.set('hosts/host-1/posStaffPins/stranger', { pinScrypt: hashMemberPassword('1357') })
  })

  it("a right PIN opens the kiosk's settings and can leave kiosk mode", async () => {
    const token = await pair()
    const unlocked = await kiosk({ action: 'unlock', pin: '2468' }, { token })
    expect(unlocked.status).toBe(200)
    expect(JSON.stringify(unlocked.body)).not.toContain('manager-1')
    const settings = await kiosk({ action: 'settings', unlock: unlocked.body.unlock }, { token })
    expect(settings.body).toMatchObject({ readers: [expect.objectContaining({ id: 'tmr_kiosk01' })], readerId: 'tmr_kiosk01' })
    const exited = await kiosk({ action: 'exit', unlock: unlocked.body.unlock }, { token })
    expect(exited.status).toBe(200)
    expect((await kiosk({ action: 'context' }, { token, method: 'GET' })).status).toBe(401)
  })

  it('an unlock is for one kiosk, and a PIN of someone not on the site unlocks nothing', async () => {
    const token = await pair()
    const other = await pair()
    const unlocked = await kiosk({ action: 'unlock', pin: '2468' }, { token })
    expect((await kiosk({ action: 'exit', unlock: unlocked.body.unlock }, { token: other })).status).toBe(401)
    expect((await kiosk({ action: 'unlock', pin: '1357' }, { token })).status).toBe(401)
  })

  it('locks after five wrong PINs, before any PIN is checked', async () => {
    const token = await pair()
    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await kiosk({ action: 'unlock', pin: '0000' }, { token })).status).toBe(401)
    }
    expect((await kiosk({ action: 'unlock', pin: '0000' }, { token })).status).toBe(423)
    // Locked: even the right PIN is refused until the window passes.
    expect((await kiosk({ action: 'unlock', pin: '2468' }, { token })).status).toBe(423)
  })
})
