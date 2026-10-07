/**
 * @jest-environment node
 */
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

import {
  registerPluginShipmentRecords,
  type PluginShipmentRecords,
  type PluginShipmentWrite,
  type PluginTrackingUpdate,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  registerPluginFulfillmentProvider,
  type PluginFulfillmentHold,
} from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import { randomBytes } from 'node:crypto'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { shippingAccountDocId, writeDebitConsent } from './account-store'
import { readShippingConfig, setShippingFetchForTests } from './config'
import { setShippingDbForTests } from './db'
import { setLabelBillingFetchForTests } from './label-billing'
import { buyLabel, labelIdFor, rateRecord, voidLabel, type ShippingActor, type StoredLabel } from './labels'
import { applyTrackingEvent, trackerDocId } from './trackers'
import { measureShippingMonth } from './usage-meter'

/**
 * A label, end to end, against an in-memory Firestore, a recording Shippo
 * and a recording Stripe — nothing leaves the process. What is held: a
 * purchase is claimed once per attempt and replays; a quote belongs to the
 * workspace and the order it was made for; the cost is recovered by a debit
 * keyed to the label, or deferred to the invoice, or the purchase is refused
 * before anything is bought; a void is credited once refunded; the shipment
 * is written back through the seller's contract; tracking moves forward only.
 */

const TOKEN_KEY = randomBytes(32).toString('base64')
const ORG = 'org-candles'
const OTHER_ORG = 'org-other'
const HOST = 'host-candles'

let db: MemoryFirestore
let billingDoc: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles'
      ? { orgId: 'org-candles', org: { name: 'Candles', ownerUid: 'owner-1', plan: 'pro', enabledPlugins: undefined } }
      : hostId === 'host-other'
        ? { orgId: 'org-other', org: { name: 'Other', ownerUid: 'owner-2', plan: 'pro' } }
        : null,
  getHostDocAdmin: async () => ({ memberRoles: { 'uid-editor': 'editor' } }),
  readOrgBilling: async () => billingDoc,
}))

jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  merchantAccountIsReady: (input: { accountId?: unknown }) => Boolean(input.accountId),
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => true,
}))

/** Shippo, recorded: a quote, a SUCCESS transaction, a refund. */
const shippoCalls: Array<{ url: string; body: any }> = []
const shippoFetch = (async (url: string, init: RequestInit = {}) => {
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  shippoCalls.push({ url: String(url), body })
  const path = new URL(String(url)).pathname
  const answer =
    path === '/shippo-accounts'
      ? { object_id: 'acct_candles' }
      : path === '/shipments/'
        ? {
            object_id: `shp_${shippoCalls.length}`,
            rates: [
              { object_id: 'rate_cheap', amount: '6.25', currency: 'USD', provider: 'USPS', servicelevel: { name: 'Ground Advantage', token: 'usps_ground_advantage' }, estimated_days: 4, attributes: ['CHEAPEST'], carrier_account: 'ca_shippo' },
              { object_id: 'rate_own', amount: '9.10', currency: 'USD', provider: 'UPS', servicelevel: { name: 'Ground', token: 'ups_ground' }, estimated_days: 3, attributes: [], carrier_account: 'ca_own_ups' },
            ],
          }
        : path === '/transactions'
          ? {
              object_id: `txn_${body.rate}`,
              status: 'SUCCESS',
              tracking_number: `TRK_${body.rate}`,
              tracking_url_provider: 'https://tools.usps.com/t',
              label_url: 'https://shippo-delivery.s3.amazonaws.com/l.pdf',
              rate: { object_id: body.rate, amount: body.rate === 'rate_own' ? '9.10' : '6.25', currency: 'USD', provider: body.rate === 'rate_own' ? 'UPS' : 'USPS', servicelevel: { name: 'Ground', token: 'g' } },
            }
          : path === '/refunds'
            ? { status: 'SUCCESS' }
            : path === '/carrier_accounts'
              ? { results: [{ object_id: 'ca_shippo', carrier: 'usps', is_shippo_account: true }, { object_id: 'ca_own_ups', carrier: 'ups', account_id: '94567e', is_shippo_account: false }] }
              : {}
  return new Response(JSON.stringify(answer), { status: 200 })
}) as typeof fetch

/** Stripe, recorded: each call by its idempotency key; a debit can be told to fail. */
const stripeCalls: Array<{ path: string; key: string; params: URLSearchParams }> = []
let debitFails = false
const stripeFetch = (async (url: string, init: RequestInit = {}) => {
  const path = new URL(String(url)).pathname
  const headers = init.headers as Record<string, string>
  stripeCalls.push({ path, key: headers['Idempotency-Key'], params: new URLSearchParams(String(init.body)) })
  if (path === '/v1/charges' && debitFails) {
    return new Response(JSON.stringify({ error: { message: 'Insufficient funds in Stripe account' } }), { status: 400 })
  }
  return new Response(JSON.stringify({ id: path === '/v1/charges' ? 'py_debit_1' : 're_1' }), { status: 200 })
}) as typeof fetch

/** The seller: one order with two lines that ship. */
const writes: PluginShipmentWrite[] = []
const tracking: PluginTrackingUpdate[] = []
const SELLER: PluginShipmentRecords = {
  read: async (hostId, recordId) =>
    recordId === 'order-1'
      ? {
          hostId,
          recordId,
          displayRef: '#1001',
          status: 'paid',
          shippable: true,
          currency: 'usd',
          shipTo: { name: 'Ann', line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US' },
          customerEmail: 'ann@example.com',
          lines: [
            { lineIndex: 0, name: 'Candle', quantity: 2, quantityUnshipped: 2, unitValueCents: 1_500, weightGrams: 300 },
            { lineIndex: 1, name: 'Wick', quantity: 1, quantityUnshipped: 1, unitValueCents: 500, weightGrams: 20 },
          ],
          shipments: [],
        }
      : null,
  recordShipment: async (write) => {
    writes.push(write)
    return { outcome: 'recorded', shipmentId: 'ful-1' }
  },
  recordTracking: async (update) => {
    tracking.push(update)
    return { outcome: 'recorded' }
  },
  shipFromAddresses: async () => [
    { id: 'loc-1', name: 'Studio', address: { line1: '1 A St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' } },
  ],
}

const actor = (orgId = ORG, hostId = HOST): ShippingActor => ({
  orgId,
  org: { name: 'Candles', ownerUid: orgId === ORG ? 'owner-1' : 'owner-2' },
  hostId,
  uid: 'uid-editor',
  email: 'rosa@example.com',
  name: 'Rosa Diaz',
})

function config() {
  const configured = readShippingConfig()
  if (!configured.configured) throw new Error('not configured')
  return configured.config
}

beforeEach(async () => {
  db = createMemoryFirestore()
  setShippingDbForTests(db)
  setShippingFetchForTests(shippoFetch)
  setLabelBillingFetchForTests(stripeFetch)
  shippoCalls.length = 0
  stripeCalls.length = 0
  writes.length = 0
  tracking.length = 0
  debitFails = false
  billingDoc = {}
  process.env['SHIPPO_API_TOKEN'] = 'shippo_live_platform'
  process.env['SHIPPING_TOKEN_KEY'] = TOKEN_KEY
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_never_used'
  resetPluginServicesForTests()
  registerPluginShipmentRecords(SELLER, { pluginId: 'seller' })
  await db.collection('profiles').doc('owner-1').set({ stripeAccountId: 'acct_merchant', stripeChargesEnabled: true })
})

afterAll(() => {
  setShippingDbForTests(null)
  setShippingFetchForTests(null)
  setLabelBillingFetchForTests(null)
})

async function quoteAndConsent(consent = true) {
  if (consent) await writeDebitConsent(ORG, config(), 'uid-owner', true)
  return rateRecord(actor(), config(), { recordId: 'order-1', kind: 'outbound', package: {} })
}

describe('rating an order', () => {
  it('opens the workspace’s account once, sums the lines into the default box, and marks the merchant’s own carrier', async () => {
    const quote = await quoteAndConsent()
    expect(shippoCalls.filter((call) => call.url.endsWith('/shippo-accounts'))).toHaveLength(1)
    const sealed = db.docs.get(`orgs/${ORG}/shippingAccounts/${shippingAccountDocId(config())}`)
    expect(sealed?.['status']).toBe('active')
    expect(JSON.stringify(sealed)).not.toContain('acct_candles')
    // 2 × 300 g + 20 g of goods, plus the default box's 200 g.
    expect(quote.weightGrams).toBe(820)
    expect(quote.lines).toEqual([
      { lineIndex: 0, quantity: 2 },
      { lineIndex: 1, quantity: 1 },
    ])
    expect(quote.rates.map((rate) => [rate.rateId, rate.merchantCarrierAccount])).toEqual([
      ['rate_cheap', false],
      ['rate_own', true],
    ])
    expect(quote.to.email).toBe('ann@example.com')
  })
})

describe('units an outside fulfiller holds (AGL-3634)', () => {
  const network = (holds: () => Promise<PluginFulfillmentHold[]>) =>
    registerPluginFulfillmentProvider({ id: 'network', label: 'ShipBob', holds: async () => holds() }, { pluginId: 'networks' })
  const held = (lineIndex: number, quantity: number): PluginFulfillmentHold => ({
    providerId: 'network',
    providerLabel: 'ShipBob',
    lineIndex,
    quantity,
    state: 'accepted',
  })

  it('leaves the held units off the label', async () => {
    network(async () => [held(0, 2)])
    const quote = await quoteAndConsent()
    expect(quote.lines).toEqual([{ lineIndex: 1, quantity: 1 }])
  })

  it('says who is shipping it when everything left is held', async () => {
    network(async () => [held(0, 2), held(1, 1)])
    await expect(quoteAndConsent()).rejects.toMatchObject({
      status: 409,
      message: 'Everything left on this order is being shipped by ShipBob.',
    })
  })

  it('stops rather than guess when a fulfiller cannot answer', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    network(async () => {
      throw new Error('offline')
    })
    await expect(quoteAndConsent()).rejects.toMatchObject({ status: 503 })
  })

  it('refuses a buy whose lines a fulfiller took after the quote', async () => {
    const quote = await quoteAndConsent()
    network(async () => [held(0, 1)])
    await expect(
      buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-held' }),
    ).rejects.toMatchObject({ status: 409, message: 'Some of these items are now being shipped by ShipBob. Get rates again.' })
    expect(shippoCalls.filter((call) => call.url.endsWith('/transactions'))).toHaveLength(0)
  })
})

describe('buying a label', () => {
  it('buys once per attempt, writes the shipment, follows the parcel and debits the balance under a key of its own', async () => {
    const quote = await quoteAndConsent()
    const input = { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0001' }
    const first = await buyLabel(actor(), config(), input)
    expect(first.replayed).toBe(false)
    expect(first.label).toMatchObject({ status: 'purchased', costCents: 625, trackingNumber: 'TRK_rate_cheap' })
    expect(first.label.billing).toMatchObject({ method: 'account_debit', state: 'charged', chargeCents: 625, stripePaymentId: 'py_debit_1' })
    const debit = stripeCalls.find((call) => call.path === '/v1/charges')
    expect(debit?.key).toBe(`shipping-label:${first.label.labelId}:debit`)
    expect(debit?.params.get('source')).toBe('acct_merchant')
    expect(debit?.params.get('amount')).toBe('625')
    expect(writes).toEqual([
      expect.objectContaining({
        hostId: HOST,
        recordId: 'order-1',
        carrier: 'USPS',
        trackingNumber: 'TRK_rate_cheap',
        labelRef: first.label.labelId,
        lines: [
          { lineIndex: 0, quantity: 2 },
          { lineIndex: 1, quantity: 1 },
        ],
      }),
    ])
    expect(db.docs.get(`shippingTrackers/${trackerDocId('shippo', 'TRK_rate_cheap')}`)).toMatchObject({ orgId: ORG, recordId: 'order-1' })

    const again = await buyLabel(actor(), config(), input)
    expect(again.replayed).toBe(true)
    expect(shippoCalls.filter((call) => call.url.endsWith('/transactions'))).toHaveLength(1)
    expect(stripeCalls.filter((call) => call.path === '/v1/charges')).toHaveLength(1)
    expect(writes).toHaveLength(1)
  })

  it('refuses a second buy of the same attempt while the first is still buying', async () => {
    const quote = await quoteAndConsent()
    const labelId = labelIdFor(ORG, 'order-1', 'attempt-0002')
    await db.collection('orgs').doc(ORG).collection('shippingLabels').doc(labelId).set({ status: 'purchasing' })
    await expect(
      buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0002' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(shippoCalls.filter((call) => call.url.endsWith('/transactions'))).toHaveLength(0)
  })

  it('will not buy a quote another workspace, or another order, made', async () => {
    const quote = await quoteAndConsent()
    await expect(
      buyLabel(actor(OTHER_ORG, 'host-other'), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0003' }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      buyLabel(actor(), config(), { recordId: 'order-2', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0004' }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_forged', attemptKey: 'attempt-0005' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(shippoCalls.filter((call) => call.url.endsWith('/transactions'))).toHaveLength(0)
  })

  it('refuses before buying when the label cannot be paid for', async () => {
    const quote = await quoteAndConsent(false)
    await expect(
      buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0006' }),
    ).rejects.toMatchObject({ status: 402 })
    expect(shippoCalls.filter((call) => call.url.endsWith('/transactions'))).toHaveLength(0)
    expect(db.docs.get(`orgs/${ORG}/shippingLabels/${labelIdFor(ORG, 'order-1', 'attempt-0006')}`)).toBeUndefined()
  })

  it('puts a label on the invoice when there is a customer but no consent, and when Stripe refuses the debit', async () => {
    billingDoc = { stripeCustomerId: 'cus_1' }
    const quote = await quoteAndConsent(false)
    const invoiced = await buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0007' })
    expect(invoiced.label.billing).toMatchObject({ method: 'usage_invoice', state: 'charged' })
    expect(stripeCalls).toHaveLength(0)

    await writeDebitConsent(ORG, config(), 'uid-owner', true)
    debitFails = true
    const second = await rateRecord(actor(), config(), { recordId: 'order-1', kind: 'outbound', package: {} })
    const deferred = await buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: second.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0008' })
    expect(deferred.label.billing).toMatchObject({ method: 'usage_invoice', state: 'deferred', failure: 'Insufficient funds in Stripe account' })
  })

  it('charges nothing for a label on the merchant’s own carrier account', async () => {
    const quote = await quoteAndConsent()
    const own = await buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_own', attemptKey: 'attempt-0009' })
    expect(own.label.billing).toMatchObject({ method: 'carrier_account', state: 'not_billed', chargeCents: 0 })
    expect(stripeCalls).toHaveLength(0)
  })
})

describe('voiding a label', () => {
  it('refunds the debit once the provider refunds, under a credit key of its own', async () => {
    const quote = await quoteAndConsent()
    const { label } = await buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0010' })
    const account = { providerId: 'shippo' as const, accountId: 'acct_candles' }
    const voided = await voidLabel(actor(), config(), label.labelId, account)
    expect(voided.status).toBe('voided')
    expect(voided.billing).toMatchObject({ state: 'credited', stripeRefundId: 're_1' })
    const refund = stripeCalls.find((call) => call.path === '/v1/refunds')
    expect(refund?.key).toBe(`shipping-label:${label.labelId}:credit`)
    expect(refund?.params.get('charge')).toBe('py_debit_1')
    // Voided again: nothing moves.
    await voidLabel(actor(), config(), label.labelId, account)
    expect(stripeCalls.filter((call) => call.path === '/v1/refunds')).toHaveLength(1)
  })

  it('will not void another site’s label', async () => {
    const quote = await quoteAndConsent()
    const { label } = await buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0011' })
    await expect(
      voidLabel({ orgId: ORG, hostId: 'host-elsewhere', uid: 'u' }, config(), label.labelId, { providerId: 'shippo', accountId: 'a' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('tracking', () => {
  it('moves the order forward, ignores redeliveries and never walks a parcel back', async () => {
    const quote = await quoteAndConsent()
    await buyLabel(actor(), config(), { recordId: 'order-1', shipmentId: quote.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-0012' })
    const event = { providerId: 'shippo' as const, trackingNumber: 'TRK_rate_cheap', atMs: 1_000 }
    await expect(applyTrackingEvent({ ...event, status: 'in_transit' })).resolves.toBe('recorded')
    await expect(applyTrackingEvent({ ...event, status: 'in_transit', atMs: 1_500 })).resolves.toBe('ignored')
    await expect(applyTrackingEvent({ ...event, status: 'delivered', atMs: 2_000 })).resolves.toBe('recorded')
    await expect(applyTrackingEvent({ ...event, status: 'in_transit', atMs: 3_000 })).resolves.toBe('stale')
    await expect(applyTrackingEvent({ ...event, status: 'delivered', atMs: 500 })).resolves.toBe('stale')
    await expect(applyTrackingEvent({ ...event, trackingNumber: 'NOT_OURS', status: 'delivered' })).resolves.toBe('unknown_parcel')
    expect(tracking.map((update) => update.status)).toEqual(['in_transit', 'delivered'])
    expect(tracking[1]).toMatchObject({ hostId: HOST, recordId: 'order-1', trackingNumber: 'TRK_rate_cheap' })
  })
})

describe('the usage meter', () => {
  it('bills the month’s invoiced labels, leaves out a void credited the same month, and takes a later credit off', async () => {
    const labels = db.collection('orgs').doc(ORG).collection('shippingLabels')
    const billing = (patch: Partial<NonNullable<StoredLabel['billing']>>) => ({
      method: 'usage_invoice',
      state: 'charged',
      chargeCents: 1_000,
      markupPct: 0,
      currency: 'usd',
      month: '2026-09',
      ...patch,
    })
    await labels.doc('a').set({ month: '2026-09', billing: billing({}) })
    await labels.doc('b').set({ month: '2026-09', billing: billing({ state: 'credited', creditMonth: '2026-09' }) })
    await labels.doc('c').set({ month: '2026-09', billing: billing({ method: 'account_debit', chargeCents: 700 }) })
    await labels.doc('d').set({ month: '2026-09', billing: billing({ state: 'credited', creditMonth: '2026-10', chargeCents: 400 }) })
    await labels.doc('e').set({ month: '2026-10', billing: billing({ month: '2026-10', chargeCents: 900 }) })
    const context = (month: string) => ({ orgId: ORG, org: {}, month, closed: true, previous: {}, releaseFlagOn: () => true })
    const september = await measureShippingMonth(context('2026-09'))
    // a + d (credited in October, so September still bills it).
    expect(september.billedUsd).toBe(14)
    expect(september.fields).toEqual({ shippingLabels: 4, shippingLabelCents: 2_100 })
    const october = await measureShippingMonth(context('2026-10'))
    // e, less d's credit.
    expect(october.billedUsd).toBe(5)
  })
})
