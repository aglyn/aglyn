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

import { memoryFirestoreModule } from '../testing/pos-ops-memory-firestore'
import { posOpsHarness, type PosOpsHarness } from '../testing/pos-ops-harness'
import {
  posOfflineSaleTotals,
  POS_OFFLINE_LATE_SYNC_MS,
  POS_OFFLINE_SYNC_BATCH_MAX,
  type PosOfflineSale,
  type PosOfflineSaleOutcome,
} from '../model/commerce-pos-offline'
import { mintPosAssertion } from './pos-ops-gate'
import { posCardApplicationFeeCents } from './pos-stripe'
import type { PosOfflineCardIntent } from './pos-terminal'
import {
  handlePosOfflineSync,
  posInPersonTax,
  POS_OFFLINE_CAPTURE_SETTLE_MS,
  posOfflineCaptureKey,
  posOfflineCaptureRefused,
  type PosOfflineAfterSale,
  type PosOfflineSyncDeps,
} from './pos-offline-sync'

jest.mock('firebase-admin/firestore', () =>
  jest.requireActual('../testing/pos-ops-memory-firestore').memoryFirestoreModule,
)
jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))
jest.mock('@aglyn/aglyn/plugin-manager/record-captured-contact', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./order-notifications', () => ({ notifyOrderBuyer: jest.fn() }))
jest.mock('./order-events', () => ({ raiseOrderEvent: jest.fn() }))
jest.mock('./low-stock', () => ({ alertLowStockCrossing: jest.fn() }))
jest.mock('./reserve-stock', () => ({ decrementVariantStock: jest.fn() }))
jest.mock('./pos-sale', () => ({ notifyPosSaleCompleted: jest.fn() }))
jest.mock('./pos-terminal', () => ({}))
jest.mock('./pos-offline-card-reconcile', () => ({
  ...jest.requireActual('./pos-offline-card-reconcile'),
  reportPosOfflineCardWrongAccount: jest.fn(),
}))

/**
 * The offline register's sync (AGL-3625): a cash sale rung offline lands as
 * one paid order, once — however many times a flapping connection sends it —
 * in the shift it was rung in, under the member who rang it, and with every
 * mismatch the server finds flagged rather than dropping the sale.
 */

void memoryFirestoreModule

let h: PosOpsHarness
let deps: PosOfflineSyncDeps
let after: PosOfflineAfterSale[]
/** Units on the shelf per product; a product absent here is untracked. */
let shelf: Record<string, number>
let failStock: Set<string>
let keySeq = 0

const NOW = 1_800_000_000_000

const tax = { pct: 8, pricesIncludeTax: false }

function sale(overrides: Partial<PosOfflineSale> = {}): PosOfflineSale {
  const lines = overrides.lines ?? [
    { productId: 'p-mug', variantId: 'v1', name: 'Mug', quantity: 2, unitAmountCents: 1200 },
    { productId: 'p-tee', name: 'Tee', quantity: 1, unitAmountCents: 2500 },
  ]
  const discountPct = overrides.discountPct ?? 10
  const totals = posOfflineSaleTotals({ lines, discountPct, tax })
  return {
    v: 1,
    saleKey: `sale${String(++keySeq).padStart(16, '0')}`,
    hostId: 'shop',
    orgId: 'org-1',
    signedInUid: 'cashier',
    registerId: 'front',
    shiftId: 'shift-1',
    soldAtMs: NOW - 60_000,
    lines,
    discountPct,
    totals,
    cashTenderedCents: 5000,
    changeCents: 5000 - totals.totalCents,
    customer: { email: 'dana@acme.com', name: 'Dana' },
    ...overrides,
  }
}

const post = (sales: unknown[], uid = 'cashier') =>
  handlePosOfflineSync(deps, h.request(uid, { hostId: 'shop', sales }))

const results = async (sales: unknown[], uid = 'cashier') => {
  const outcome = await post(sales, uid)
  expect(outcome.status).toBe(200)
  return outcome.body['results'] as PosOfflineSaleOutcome[]
}

const order = (id: string) => h.memory.read(`hosts/shop/orders/${id}`) as Record<string, any> | undefined

beforeEach(() => {
  h = posOpsHarness()
  h.clock.now = NOW
  after = []
  shelf = { 'p-mug': 10 }
  failStock = new Set()
  h.memory.seed('hosts/shop/settings/store', {
    tax: { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', pct: 8 }] },
    receiptFooter: 'Thanks!',
  })
  h.memory.seed('hosts/shop', {
    memberRoles: { owner: 'admin', cashier: 'editor', cashier2: 'editor', viewer: 'viewer' },
    displayName: 'Corner Shop',
  })
  h.memory.seed('hosts/shop/registers/front', { name: 'Front', locationId: 'loc-1', openShiftId: 'shift-1' })
  h.memory.seed('hosts/shop/registers/front/shifts/shift-1', { status: 'open', registerId: 'front' })
  h.memory.seed('hosts/shop/registers/front/shifts/shift-0', { status: 'closed', registerId: 'front' })
  h.memory.seed('hosts/shop/products/p-mug', {
    name: 'Mug',
    type: 'physical',
    variants: [{ id: 'v1', priceUsd: 12, inventory: 10, options: { color: 'Blue' } }],
  })
  h.memory.seed('hosts/shop/products/p-tee', {
    name: 'Tee',
    type: 'physical',
    variants: [{ id: 'default', priceUsd: 25 }],
  })
  h.memory.seed('hosts/shop/counters/orders', { next: 1001 })
  deps = {
    ...h.deps,
    feePct: () => 2,
    registerWithinCap: () => true,
    decrementStock: async (input) => {
      if (failStock.has(input.productId)) {
        return { applied: 0, requested: -input.quantity, before: null, after: null, failed: true }
      }
      if (!(input.productId in shelf)) {
        return { applied: 0, requested: -input.quantity, before: null, after: null, failed: false }
      }
      const before = shelf[input.productId]
      const applied = -Math.min(before, input.quantity)
      shelf[input.productId] = before + applied
      const product = { name: input.productId } as any
      return { applied, requested: -input.quantity, before: product, after: product, failed: false }
    },
    afterSale: async (input) => void after.push(input),
  }
})

describe('the offline kit', () => {
  it('hands the register the store rate, the rules, the registers and the receipt', async () => {
    h.config['posMaxDiscountPct'] = 20
    h.config['posRequireOpenShift'] = true
    const outcome = await handlePosOfflineSync(deps, {
      ...h.request('cashier', {}),
      method: 'GET',
      query: { hostId: 'shop' },
    } as any)
    expect(outcome.status).toBe(200)
    const kit = outcome.body['kit'] as any
    expect(kit).toMatchObject({
      v: 1,
      hostId: 'shop',
      orgId: 'org-1',
      available: true,
      tax: { pct: 8, pricesIncludeTax: false },
      maxDiscountPct: 20,
      receipt: { name: 'Corner Shop', footer: 'Thanks!' },
    })
    expect(kit.registers).toEqual(
      expect.arrayContaining([{ id: 'front', name: 'Front', locationId: 'loc-1', openShiftId: 'shift-1' }]),
    )
  })

  it('says offline selling is unavailable while the store has not decided its tax', async () => {
    h.memory.seed('hosts/shop/settings/store', {})
    const outcome = await handlePosOfflineSync(deps, {
      ...h.request('cashier', {}),
      method: 'GET',
      query: { hostId: 'shop' },
    } as any)
    const kit = outcome.body['kit'] as any
    expect(kit.available).toBe(false)
    expect(kit.unavailableReason).toEqual(expect.any(String))
  })

  it('refuses a store on Stripe Tax in person, as the online till does', () => {
    expect(posInPersonTax({ mode: 'stripe' } as any).ok).toBe(false)
    expect(posInPersonTax({ mode: 'none' } as any)).toMatchObject({ ok: true, pct: null })
  })
})

describe('who may sync', () => {
  it('asks the register gate: a token, the role, managePos and the plan', async () => {
    expect((await post([sale()], null as any)).status).toBe(401)
    expect((await post([sale()], 'viewer')).status).toBe(403)
    h.entitled.pos = false
    expect((await post([sale()], 'cashier')).status).toBe(403)
    expect(h.memory.read('hosts/shop/counters/orders')).toEqual({ next: 1001 })
  })

  it('keeps a sale signed for another member on the device, unsynced', async () => {
    const [result] = await results([sale({ signedInUid: 'cashier2' })])
    expect(result).toMatchObject({ status: 'refused', reason: 'wrong-staff', retry: true })
    expect(h.memory.read('hosts/shop/counters/orders')).toEqual({ next: 1001 })
  })

  it('refuses a sale rung for another site or workspace', async () => {
    const [site, workspace] = await results([sale({ hostId: 'other' }), sale({ orgId: 'org-2' })])
    expect(site).toMatchObject({ status: 'refused', reason: 'wrong-site', retry: false })
    expect(workspace).toMatchObject({ status: 'refused', reason: 'wrong-workspace', retry: false })
  })

  it('refuses a batch above the limit and a body with no sales', async () => {
    const many = Array.from({ length: POS_OFFLINE_SYNC_BATCH_MAX + 1 }, () => sale())
    expect((await post(many)).status).toBe(400)
    expect((await handlePosOfflineSync(deps, h.request('cashier', { hostId: 'shop' }))).status).toBe(400)
    expect(await results([])).toEqual([])
  })

  it('answers an unreadable sale as invalid without touching the order book', async () => {
    const [result] = await results([{ saleKey: 'short', lines: [] }])
    expect(result).toMatchObject({ status: 'refused', reason: 'invalid', retry: false })
  })
})

describe('recording a sale', () => {
  it('records one paid cash order under the sale key, as it was rung', async () => {
    const queued = sale()
    const [result] = await results([queued])
    expect(result).toMatchObject({ status: 'recorded', orderId: queued.saleKey, number: 1001, flags: [] })
    const recorded = order(queued.saleKey)!
    expect(recorded).toMatchObject({
      number: 1001,
      status: 'paid',
      channel: 'pos',
      registerId: 'front',
      shiftId: 'shift-1',
      cashierId: 'cashier',
      customerEmail: 'dana@acme.com',
      customerName: 'Dana',
      discountPct: 10,
      createdAtMs: queued.soldAtMs,
      offline: { saleKey: queued.saleKey, soldAtMs: queued.soldAtMs, syncedAtMs: NOW, syncedBy: 'cashier', flags: [] },
    })
    // 2×12 + 25 = 49.00, 10% off = 44.10, 8% tax = 3.53 → 47.63.
    expect(recorded['totals']).toMatchObject({ itemsCents: 4900, discountCents: 490, taxCents: 353, totalCents: 4763 })
    expect(recorded['payments']).toEqual([
      expect.objectContaining({
        method: 'cash',
        amountCents: 4763,
        status: 'succeeded',
        cashTenderedCents: 5000,
        changeCents: 237,
        atMs: queued.soldAtMs,
      }),
    ])
    expect(recorded['timeline'].map((event: any) => event.event)).toEqual(['paid', 'offline-synced'])
    expect(h.memory.read('hosts/shop/counters/orders')).toEqual({ next: 1002 })
    expect(shelf['p-mug']).toBe(8)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ orderId: queued.saleKey, email: 'dana@acme.com', name: 'Dana' })
    expect(h.memory.read(`hosts/shop/posOfflineSales/${queued.saleKey}`)).toMatchObject({
      status: 'settled',
      stockDone: true,
      notified: true,
      signedInUid: 'cashier',
    })
  })

  it('charges a synced cash sale no platform fee and accrues nothing, as every cash sale (AGL-4036)', async () => {
    const queued = sale()
    await results([queued])
    // The plan would take 2% of the goods after the discount (88¢) on a
    // fee-carrying tender; cash carries none.
    expect(order(queued.saleKey)!['totals'].feeCents).toBe(0)
    expect(order(queued.saleKey)!['feeCollection']).toBeUndefined()
    expect(order(queued.saleKey)!['payments'][0]).toMatchObject({ method: 'cash', takeFeeCents: 0, feeCents: 0 })
    const month = new Date(NOW).toISOString().slice(0, 7)
    expect(h.memory.read(`orgs/org-1/offlineFees/${month}`)).toBeUndefined()
  })

  it('lands a sale sent twice once, and answers the second with the first', async () => {
    const queued = sale()
    const [first] = await results([queued])
    const [second] = await results([queued])
    const [inBatch, again] = await results([queued, queued])
    expect(first.status).toBe('recorded')
    for (const replay of [second, inBatch, again]) {
      expect(replay).toMatchObject({ status: 'replayed', orderId: queued.saleKey, number: 1001 })
    }
    expect(h.memory.read('hosts/shop/counters/orders')).toEqual({ next: 1002 })
    expect(shelf['p-mug']).toBe(8)
    expect(after).toHaveLength(1)
  })

  it('never overwrites an existing order that shares the key', async () => {
    const queued = sale()
    h.memory.seed(`hosts/shop/orders/${queued.saleKey}`, { number: 7, status: 'paid' })
    const [result] = await results([queued])
    expect(result).toMatchObject({ status: 'refused', reason: 'conflict' })
    expect(order(queued.saleKey)).toEqual({ number: 7, status: 'paid' })
  })

  it('records the next sale when one in the batch fails', async () => {
    const good = sale()
    const [bad, ok] = await results([{ saleKey: 'x' }, good])
    expect(bad.status).toBe('refused')
    expect(ok.status).toBe('recorded')
  })
})

describe('what the server flags, never refuses', () => {
  it('flags stock that went short on the order and back to the register', async () => {
    shelf['p-mug'] = 1
    const queued = sale()
    const [result] = await results([queued])
    expect(result).toMatchObject({
      status: 'recorded',
      flags: ['stock-short'],
      stockConflicts: [{ productId: 'p-mug', requested: 2, applied: 1, shortUnits: 1 }],
    })
    const recorded = order(queued.saleKey)!
    expect(recorded['offline'].flags).toEqual(['stock-short'])
    expect(recorded['offline'].stockConflicts).toHaveLength(1)
    expect(recorded['timeline'].map((event: any) => event.event)).toContain('offline-stock-short')
  })

  it('keeps the rung price when the catalog changed, and says what it is now', async () => {
    h.memory.seed('hosts/shop/products/p-tee', { name: 'Tee', type: 'physical', variants: [{ id: 'default', priceUsd: 30 }] })
    const queued = sale()
    const [result] = await results([queued])
    expect(result.status === 'recorded' && result.flags).toEqual(['price-changed'])
    const recorded = order(queued.saleKey)!
    expect(recorded['lineItems'][1].unitAmountCents).toBe(2500)
    expect(recorded['offline'].priceDrift).toEqual([{ index: 1, rungCents: 2500, currentCents: 3000 }])
    expect(recorded['totals'].totalCents).toBe(queued.totals.totalCents)
  })

  it('keeps a line whose product was deleted', async () => {
    const queued = sale({
      lines: [{ productId: 'p-gone', name: 'Old candle', quantity: 1, unitAmountCents: 900 }],
      discountPct: 0,
    })
    const [result] = await results([queued])
    expect(result.status === 'recorded' && result.flags).toEqual(['unknown-product'])
    expect(order(queued.saleKey)!['lineItems'][0]).toMatchObject({ name: 'Old candle', unitAmountCents: 900 })
  })

  it('flags a sale whose shift closed before it synced, and keeps it in that shift', async () => {
    const queued = sale({ shiftId: 'shift-0' })
    const [result] = await results([queued])
    expect(result.status === 'recorded' && result.flags).toEqual(['shift-closed'])
    expect(order(queued.saleKey)!['shiftId']).toBe('shift-0')
  })

  it('flags a sale with no shift on a site that requires one', async () => {
    h.config['posRequireOpenShift'] = true
    const queued = sale({ shiftId: null })
    const [result] = await results([queued])
    expect(result.status === 'recorded' && result.flags).toEqual(['no-shift'])
  })

  it('restates totals that do not add up, from the lines', async () => {
    const queued = sale()
    const tampered = { ...queued, totals: { ...queued.totals, totalCents: 100 } }
    const [result] = await results([tampered])
    expect(result.status === 'recorded' && result.flags).toEqual(
      expect.arrayContaining(['totals-restated']),
    )
    expect(order(queued.saleKey)!['totals'].totalCents).toBe(queued.totals.totalCents)
  })

  it('flags tax that differs from the store rate, keeping what was collected', async () => {
    const queued = sale()
    const lowTax = posOfflineSaleTotals({ lines: queued.lines, discountPct: 10, tax: { pct: 5, pricesIncludeTax: false } })
    const [result] = await results([{ ...queued, totals: lowTax }])
    expect(result.status === 'recorded' && result.flags).toEqual(['tax-differs'])
    expect(order(queued.saleKey)!['totals'].taxCents).toBe(lowTax.taxCents)
  })

  it('flags a discount above the ceiling and cash short of the total', async () => {
    h.config['posMaxDiscountPct'] = 5
    const queued = sale({ cashTenderedCents: 100 })
    const [result] = await results([queued])
    expect(result.status === 'recorded' && result.flags).toEqual(
      expect.arrayContaining(['discount-over-limit', 'cash-short']),
    )
  })

  it('flags an unknown or over-cap register', async () => {
    const [unknown] = await results([sale({ registerId: 'gone', shiftId: null })])
    expect(unknown.status === 'recorded' && unknown.flags).toEqual(['unknown-register'])
    deps.registerWithinCap = () => false
    const [over] = await results([sale()])
    expect(over.status === 'recorded' && over.flags).toEqual(['register-over-cap'])
  })

  it('dates a sale by the server when the device clock is unbelievable, and flags a late one', async () => {
    const future = sale({ soldAtMs: NOW + 60 * 60 * 1000 })
    const late = sale({ soldAtMs: NOW - POS_OFFLINE_LATE_SYNC_MS - 1000 })
    const [ahead, behind] = await results([future, late])
    expect(ahead.status === 'recorded' && ahead.flags).toEqual(['clock-adjusted'])
    expect(order(future.saleKey)!['createdAtMs']).toBe(NOW)
    expect(behind.status === 'recorded' && behind.flags).toEqual(['late-sync'])
  })
})

describe('the cashier', () => {
  it('credits a PIN-switched cashier whose assertion was valid when the cash was taken', async () => {
    h.clock.now = NOW - 60_000
    const { token } = mintPosAssertion(h.deps, {
      hostId: 'shop',
      registerId: 'front',
      memberUid: 'cashier2',
      purpose: 'cashier',
    })
    // Synced an hour later: the assertion has expired since, as it will.
    h.clock.now = NOW + 60 * 60 * 1000
    const queued = sale({ cashierAssertion: token, soldAtMs: NOW - 30_000 })
    const [result] = await results([queued])
    expect(result.status === 'recorded' && result.flags).toEqual([])
    expect(order(queued.saleKey)!['cashierId']).toBe('cashier2')
  })

  it('falls back to the signed-in member, flagged, for an assertion that does not hold', async () => {
    const queued = sale({ cashierAssertion: 'forged.assertion' })
    const [result] = await results([queued])
    expect(result.status === 'recorded' && result.flags).toEqual(['cashier-unverified'])
    expect(order(queued.saleKey)!['cashierId']).toBe('cashier')
  })
})

describe('a sync that dies part-way', () => {
  it('finishes the stock and the receipt on the next sync, once', async () => {
    failStock.add('p-mug')
    const queued = sale()
    const [first] = await results([queued])
    expect(first.status).toBe('recorded')
    expect(after).toHaveLength(0)
    expect(h.memory.read(`hosts/shop/posOfflineSales/${queued.saleKey}`)).toMatchObject({
      status: 'recorded',
      stockDone: false,
      stockLines: [1],
    })
    failStock.clear()
    const [second] = await results([queued])
    expect(second.status).toBe('replayed')
    expect(shelf['p-mug']).toBe(8)
    expect(after).toHaveLength(1)
    await results([queued])
    expect(after).toHaveLength(1)
    expect(h.memory.read('hosts/shop/counters/orders')).toEqual({ next: 1002 })
  })
})

describe('a card taken offline on the app reader (AGL-4039)', () => {
  let intents: Record<string, PosOfflineCardIntent>
  let captures: Array<{ id: string; fee: number; key: string }>
  let offlineEnabled: boolean
  /** The store's Stripe account as the server reads it at sync; null when it cannot take cards. */
  let merchant: string | null
  /** What the next captures answer instead of capturing: a Stripe status, or a thrown network error. */
  let captureFailures: Array<{ status: number; error: string } | 'network'>
  let wrongAccounts: Array<Record<string, unknown>>

  const intentFor = (queued: PosOfflineSale, overrides: Partial<PosOfflineCardIntent> = {}): PosOfflineCardIntent => ({
    id: `pi_${queued.saleKey.slice(-12)}abc`,
    status: 'requires_capture',
    amount: queued.totals.totalCents,
    currency: 'usd',
    metadata: { kind: 'pos-offline', saleKey: queued.saleKey, hostId: 'shop', orgId: 'org-1', registerId: 'front' },
    destination: 'acct_merchant',
    applicationFeeCents: 0,
    livemode: false,
    brand: 'visa',
    last4: '4242',
    ...overrides,
  })

  const cardSale = (forward: 'stored' | 'forwarded' | 'declined' | 'failed', intent?: Partial<PosOfflineCardIntent>) => {
    const queued = sale({ cashTenderedCents: 0, changeCents: 0 })
    queued.tender = 'card'
    const made = intentFor(queued, intent)
    if (forward !== 'stored' && forward !== 'failed') intents[made.id] = made
    queued.card = {
      forward,
      ...(forward === 'forwarded' || forward === 'declined' ? { paymentIntentId: made.id } : {}),
      brand: 'visa',
      last4: '4242',
    }
    return { queued, intent: made }
  }

  beforeEach(() => {
    intents = {}
    captures = []
    offlineEnabled = true
    merchant = 'acct_merchant'
    captureFailures = []
    wrongAccounts = []
    deps.card = {
      terminal: async () => ({ available: true, locationId: 'tml_1' }),
      merchantAccount: async () => merchant,
      enableOffline: async () => offlineEnabled,
      retrieve: async (id) => (intents[id] ? { ok: true, intent: intents[id] } : { ok: false, error: 'No such payment' }),
      capture: async (id, fee, key) => {
        captures.push({ id, fee, key })
        const failure = captureFailures.shift()
        if (failure === 'network') throw new Error('socket hang up')
        if (failure) return { ok: false, error: failure.error, status: failure.status }
        intents[id] = { ...intents[id], status: 'succeeded', applicationFeeCents: fee }
        return { ok: true, intent: intents[id] }
      },
      wrongAccount: async (input) => void wrongAccounts.push(input),
    }
  })

  /** The take and fee the capture of the default card sale carries. */
  const lineTake = Math.round((2400 * 2) / 100) + Math.round((2500 * 2) / 100)
  const take = Math.max(1, Math.round((lineTake * (4900 - 490)) / 4900))
  const month = new Date(NOW).toISOString().slice(0, 7)
  const charge = (saleKey: string) =>
    h.memory.read(`hosts/shop/terminal/config/offlineCardCharges/${saleKey}`) as Record<string, any> | undefined

  const kit = async () =>
    (
      await handlePosOfflineSync(deps, { ...h.request('cashier', {}), method: 'GET', query: { hostId: 'shop' } } as any)
    ).body['kit'] as any

  it('is off until the store turns it on, then hands the register the destination and its two limits (none set: Stripe’s ceiling, no daily limit)', async () => {
    expect((await kit()).card).toMatchObject({ available: false, unavailableReason: expect.stringMatching(/not turned on/) })
    h.config['posOfflineCardSales'] = true
    expect((await kit()).card).toEqual({
      available: true,
      destination: 'acct_merchant',
      currency: 'usd',
      maxSaleCents: 1_000_000,
      maxDeviceDailyCents: 0,
    })
    h.config['posOfflineCardMaxSale'] = ''
    h.config['posOfflineCardDailyLimit'] = null
    expect((await kit()).card).toMatchObject({ maxSaleCents: 1_000_000, maxDeviceDailyCents: 0 })
    h.config['posOfflineCardMaxSale'] = 250
    h.config['posOfflineCardDailyLimit'] = 2000
    expect((await kit()).card).toMatchObject({ maxSaleCents: 25_000, maxDeviceDailyCents: 200_000 })
    h.config['posOfflineCardMaxSale'] = 50_000
    h.config['posOfflineCardDailyLimit'] = 250_000
    expect((await kit()).card).toMatchObject({ maxSaleCents: 1_000_000, maxDeviceDailyCents: 25_000_000 })
  })

  it('says why not when Stripe would not turn offline mode on', async () => {
    h.config['posOfflineCardSales'] = true
    offlineEnabled = false
    expect((await kit()).card).toMatchObject({ available: false, destination: '' })
  })

  it('captures the card with the card tender’s fee and records a paid order', async () => {
    const { queued, intent } = cardSale('forwarded')
    const [result] = await results([queued])
    expect(result).toMatchObject({ status: 'recorded', flags: [] })
    const fee = posCardApplicationFeeCents({ takeShareCents: take, chargeCents: intent.amount })
    expect(captures).toEqual([{ id: intent.id, fee, key: `pos-offline-capture:shop:${queued.saleKey}` }])
    const recorded = order(queued.saleKey)!
    expect(recorded['status']).toBe('paid')
    expect(recorded['feeCollection']).toBe('payout')
    // The fee the sale settled, as an online card sale's completion counts
    // it: the take share AND Stripe's processing, not the take alone.
    expect(recorded['totals'].feeCents).toBe(fee)
    // The order-level intent the refund route and the dispute lookup read.
    expect(recorded).toMatchObject({
      paymentIntentId: intent.id,
      paymentIntentIds: [intent.id],
      paidAtMs: queued.soldAtMs,
    })
    // Nothing accrues to the month: the payout carried the whole fee.
    expect(h.memory.read(`orgs/org-1/offlineFees/${month}`)).toBeUndefined()
    expect(recorded['payments'][0]).toMatchObject({
      method: 'card_present',
      status: 'succeeded',
      paymentIntentId: intent.id,
      takeFeeCents: take,
      feeCents: fee,
      cardBrand: 'visa',
      last4: '4242',
    })
    expect(after).toHaveLength(1)
    // Replayed, it is not captured twice.
    expect((await results([queued]))[0].status).toBe('replayed')
    expect(captures).toHaveLength(1)
  })

  it('records a card the bank declined as an unpaid, flagged order with no receipt', async () => {
    const { queued } = cardSale('declined', {
      status: 'requires_payment_method',
      failureMessage: 'Your card was declined.',
    })
    const [result] = await results([queued])
    expect(result).toMatchObject({ status: 'recorded', flags: ['card-declined'] })
    const recorded = order(queued.saleKey)!
    expect(recorded['status']).toBe('pending')
    expect(recorded['payments'][0]).toMatchObject({ status: 'failed', failureMessage: 'Your card was declined.' })
    expect(captures).toHaveLength(0)
    expect(after).toHaveLength(0)
  })

  it('records a card Stripe never took as unpaid', async () => {
    const { queued } = cardSale('failed')
    const [result] = await results([queued])
    expect(result).toMatchObject({ status: 'recorded', flags: ['card-not-charged'] })
    expect(order(queued.saleKey)!['status']).toBe('pending')
  })

  it('keeps a card still on the device, and refuses an intent from another sale', async () => {
    const stored = cardSale('stored').queued
    expect((await results([stored]))[0]).toMatchObject({ status: 'refused', reason: 'failed', retry: true })
    const { queued, intent } = cardSale('forwarded')
    intents[intent.id] = { ...intent, metadata: { ...intent.metadata, saleKey: 'someoneelse0000000' } }
    expect((await results([queued]))[0]).toMatchObject({ status: 'refused', reason: 'invalid', retry: false })
    expect(order(queued.saleKey)).toBeUndefined()
  })

  it('marks the intent’s record synced in the commit that records the sale', async () => {
    const { queued, intent } = cardSale('forwarded')
    // The webhook saw the authorization first, and set the alert clock.
    h.memory.seed(`hosts/shop/terminal/config/offlineCardCharges/${queued.saleKey}`, {
      saleKey: queued.saleKey,
      status: 'requires_capture',
      synced: false,
      alertDueAtMs: NOW + 1,
    })
    await results([queued])
    expect(charge(queued.saleKey)).toMatchObject({
      hostId: 'shop',
      paymentIntentId: intent.id,
      synced: true,
      orderId: queued.saleKey,
      syncedAtMs: NOW,
    })
    expect(charge(queued.saleKey)!['alertDueAtMs']).toBeUndefined()
  })

  describe('an intent the server first meets already succeeded', () => {
    it('with no application fee: invoices the whole fee to the month and flags the order, once', async () => {
      const { queued, intent } = cardSale('forwarded', { status: 'succeeded', applicationFeeCents: 0 })
      const [result] = await results([queued])
      const fee = posCardApplicationFeeCents({ takeShareCents: take, chargeCents: intent.amount })
      expect(captures).toHaveLength(0)
      expect(result).toMatchObject({ status: 'recorded', flags: ['card-fee-short'] })
      const recorded = order(queued.saleKey)!
      expect(recorded['status']).toBe('paid')
      expect(recorded['feeCollection']).toBe('invoice')
      expect(recorded['totals'].feeCents).toBe(fee)
      expect(recorded['payments'][0]).toMatchObject({ status: 'succeeded', feeCents: 0, takeFeeCents: take })
      expect(h.memory.read(`orgs/org-1/offlineFees/${month}`)).toEqual({ month, feeCents: fee, orders: 1 })
      // Sent again, it replays: nothing captured, nothing accrued twice.
      expect((await results([queued]))[0].status).toBe('replayed')
      expect(captures).toHaveLength(0)
      expect(h.memory.read(`orgs/org-1/offlineFees/${month}`)).toEqual({ month, feeCents: fee, orders: 1 })
    })

    it('with the full fee (our capture whose answer was lost): recorded as paid, nothing invoiced', async () => {
      const { queued, intent } = cardSale('forwarded')
      const fee = posCardApplicationFeeCents({ takeShareCents: take, chargeCents: intent.amount })
      intents[intent.id] = { ...intent, status: 'succeeded', applicationFeeCents: fee }
      const [result] = await results([queued])
      expect(captures).toHaveLength(0)
      expect(result).toMatchObject({ status: 'recorded', flags: [] })
      expect(order(queued.saleKey)!['feeCollection']).toBe('payout')
      expect(h.memory.read(`orgs/org-1/offlineFees/${month}`)).toBeUndefined()
    })
  })

  describe('the destination', () => {
    it('never captures a card made out to another account: unpaid, flagged, and the operator is told', async () => {
      const { queued, intent } = cardSale('forwarded', { destination: 'acct_someone_else' })
      const [result] = await results([queued])
      expect(captures).toHaveLength(0)
      expect(result).toMatchObject({ status: 'recorded', flags: ['card-not-charged'] })
      const recorded = order(queued.saleKey)!
      expect(recorded['status']).toBe('pending')
      expect(recorded['paymentIntentId']).toBeUndefined()
      expect(recorded['payments'][0]).toMatchObject({ status: 'failed', paymentIntentId: intent.id })
      expect(recorded['payments'][0].failureMessage).toMatch(/not this store’s/)
      expect(wrongAccounts).toEqual([
        {
          hostId: 'shop',
          orderId: queued.saleKey,
          paymentIntentId: intent.id,
          status: 'requires_capture',
          amountCents: intent.amount,
          destination: 'acct_someone_else',
          expected: 'acct_merchant',
        },
      ])
      expect(after).toHaveLength(0)
    })

    it('never records as paid a card already charged to another account', async () => {
      const { queued } = cardSale('forwarded', { destination: 'acct_someone_else', status: 'succeeded' })
      await results([queued])
      expect(order(queued.saleKey)!['status']).toBe('pending')
      expect(wrongAccounts[0]).toMatchObject({ status: 'succeeded' })
    })

    it('waits, uncaptured, while the store’s account cannot take card payments', async () => {
      merchant = null
      const { queued } = cardSale('forwarded')
      expect((await results([queued]))[0]).toMatchObject({ status: 'refused', reason: 'failed', retry: true })
      expect(captures).toHaveLength(0)
      expect(order(queued.saleKey)).toBeUndefined()
    })

    it('records a declined card unpaid without asking about the account', async () => {
      merchant = null
      const { queued } = cardSale('declined', { status: 'requires_payment_method', destination: 'acct_someone_else' })
      expect((await results([queued]))[0]).toMatchObject({ status: 'recorded', flags: ['card-declined'] })
      expect(wrongAccounts).toHaveLength(0)
    })
  })

  it('compares what Stripe took with the server’s restated total, and records what Stripe took', async () => {
    const { queued, intent } = cardSale('forwarded')
    // The register's own arithmetic does not add up; the customer paid what
    // its receipt said, and that is what the intent holds.
    queued.totals = { ...queued.totals, totalCents: queued.totals.totalCents + 100 }
    intents[intent.id] = { ...intent, amount: queued.totals.totalCents }
    const [result] = await results([queued])
    expect(result.status).toBe('recorded')
    expect(result.flags).toEqual(expect.arrayContaining(['totals-restated', 'card-amount-differs']))
    const recorded = order(queued.saleKey)!
    expect(recorded['status']).toBe('paid')
    expect(recorded['payments'][0].amountCents).toBe(queued.totals.totalCents)
    expect(recorded['totals'].totalCents).not.toBe(queued.totals.totalCents)
    expect(captures[0].fee).toBe(posCardApplicationFeeCents({ takeShareCents: take, chargeCents: queued.totals.totalCents }))
  })

  it('leaves an unpaid card with the plan take, for the register to collect it by later', async () => {
    const { queued } = cardSale('declined', { status: 'requires_payment_method' })
    await results([queued])
    const recorded = order(queued.saleKey)!
    expect(recorded).toMatchObject({ status: 'pending', posTakeFeeCents: take, posFeeOrgId: 'org-1' })
    expect(recorded['totals'].feeCents).toBe(0)
  })

  describe('the capture’s idempotency key', () => {
    it('keeps the per-sale key until a capture definitely failed', () => {
      expect(posOfflineCaptureKey('shop', 'sale0001', 0)).toBe('pos-offline-capture:shop:sale0001')
      expect(posOfflineCaptureKey('shop', 'sale0001', 2)).toBe('pos-offline-capture:shop:sale0001:2')
      for (const status of [400, 402, 404]) expect(posOfflineCaptureRefused(status)).toBe(true)
      for (const status of [undefined, 409, 429, 500, 503]) expect(posOfflineCaptureRefused(status)).toBe(false)
    })

    it('moves to a new key after Stripe refused the capture, so the next sync can capture', async () => {
      const { queued, intent } = cardSale('forwarded')
      captureFailures.push({ status: 400, error: 'This PaymentIntent could not be captured.' })
      expect((await results([queued]))[0]).toMatchObject({ status: 'refused', retry: true })
      expect(charge(queued.saleKey)).toMatchObject({ captureAttempt: 1, lastCaptureStatus: 400 })
      expect((await results([queued]))[0].status).toBe('recorded')
      expect(captures.map((capture) => capture.key)).toEqual([
        `pos-offline-capture:shop:${queued.saleKey}`,
        `pos-offline-capture:shop:${queued.saleKey}:1`,
      ])
      expect(order(queued.saleKey)!['paymentIntentId']).toBe(intent.id)
    })

    it('retries on the same key after a request that got no answer, or one Stripe was still running', async () => {
      const { queued } = cardSale('forwarded')
      captureFailures.push('network', { status: 409, error: 'In progress' }, { status: 429, error: 'Too many' })
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await results([queued]))[0]).toMatchObject({ status: 'refused', retry: true })
      }
      expect((await results([queued]))[0].status).toBe('recorded')
      expect(new Set(captures.map((capture) => capture.key))).toEqual(new Set([`pos-offline-capture:shop:${queued.saleKey}`]))
      expect(captures).toHaveLength(4)
    })

    it('after a 5xx, moves on only once the intent still waits for capture a minute later', async () => {
      const { queued } = cardSale('forwarded')
      captureFailures.push({ status: 500, error: 'Stripe had a problem' }, { status: 500, error: 'Stripe had a problem' })
      await results([queued])
      // Seconds later: the outcome could still be in flight, so the same key.
      h.clock.now = NOW + 1_000
      await results([queued])
      // A minute on and the intent still waits: that attempt did not capture.
      h.clock.now = NOW + 1_000 + POS_OFFLINE_CAPTURE_SETTLE_MS
      expect((await results([queued]))[0].status).toBe('recorded')
      expect(captures.map((capture) => capture.key)).toEqual([
        `pos-offline-capture:shop:${queued.saleKey}`,
        `pos-offline-capture:shop:${queued.saleKey}`,
        `pos-offline-capture:shop:${queued.saleKey}:1`,
      ])
    })
  })
})
