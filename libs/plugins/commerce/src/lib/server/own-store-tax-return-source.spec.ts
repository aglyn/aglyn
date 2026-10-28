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
 * EVERY SALE OF THE OPERATOR'S OWN IS IN ITEMS 1–2 ONCE (AGL-4038).
 *
 * Commerce answers three sections — merchants' storefront sales, the card
 * reader shop, and the operator's own stores — and the platform folds the
 * last two into the filing figures. This reads one period end to end, over
 * an in-memory Firestore, with one of every kind of sale in it, and checks
 * what the figures fold in: the shop's online sale, the own store's register
 * sale (a reader and a T-shirt) and its online apparel sale, each once; the
 * merchant's sale never; the in-person reader record not a second time; the
 * own store's tax rows not left on the storefront card.
 */

jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({ firestore: () => fake.fakeFirestore }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    hostDisplayName: (data: Record<string, unknown> | undefined, hostId: string) => String(data?.['name'] ?? hostId),
  }
})

import {
  taxReturnOperatorSalesIn,
  type TaxReturnSection,
  type TaxReturnSourceAnswer,
  type TaxReturnSourceRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'
import type { StorefrontTaxSummary } from '../model/storefront-tax-summary'
import { OWN_STORE_LOOKBACK_MS, resolveOwnStores } from './own-store-tax-return-source'
import { commerceTaxReturnSource } from './tax-return-source'

const Q4: TaxReturnSourceRequest = {
  period: '2026-Q4',
  start: new Date(Date.UTC(2026, 9, 1)),
  end: new Date(Date.UTC(2027, 0, 1)),
  filing: { code: 'US-TX', label: 'Texas', form: 'tx-webfile', figuresName: 'Items 1–3' },
  rowCap: 2000,
}
const ms = (iso: string) => Date.parse(iso)
const boothAt = ms('2026-11-07T18:00:00Z')

const answered = (sections: Awaited<ReturnType<typeof commerceTaxReturnSource.read>>): TaxReturnSection[] =>
  (Array.isArray(sections) ? sections : [sections]).map(
    (section) => ({ ...(section as TaxReturnSourceAnswer), outcome: 'answered', pluginId: 'commerce' }) as TaxReturnSection,
  )

function seedPeriod() {
  // The operator's own workspace and its store, taxed from Texas.
  fakeDocs.set('hosts/host-own', { orgId: 'org-own', name: 'Platform Shop' })
  fakeDocs.set('hosts/host-own/settings/store', { tax: { origin: { country: 'US', state: 'TX' } } })
  // A merchant's store, which is never read as the operator's own.
  fakeDocs.set('hosts/host-merchant', { orgId: 'org-merchant', name: 'Merchant Bakery' })

  // 1. A card reader bought online from the shop, shipped to Texas.
  fakeDocs.set('posHardwareSales/hw_shop', {
    orderId: 'hw_shop',
    totalCents: 25_027,
    taxCents: 1_907,
    shipTo: { country: 'US', state: 'TX', postalCode: '78701' },
    automaticTax: true,
    taxLines: [{ amountCents: 1_907, taxableAmountCents: 23_120 }],
    status: 'shipped',
    livemode: true,
    paidAtMs: ms('2026-10-20T00:00:00Z'),
    source: 'online',
  })

  // 2. At the booth: a reader and a T-shirt, rung at the own store's register
  //    and paid by its payment link, so it filed a storefront row too, and
  //    the reader became an in-person hardware record.
  fakeDocs.set('hosts/host-own/orders/pos_booth', {
    status: 'paid',
    channel: 'pos',
    totals: { totalCents: 35_181, taxCents: 2_681 },
    paidAtMs: boothAt,
    createdAtMs: boothAt,
    payments: [{ status: 'succeeded', livemode: true, checkoutSessionId: 'cs_live_booth' }],
    hardwareOrderId: 'hw_booth',
  })
  fakeDocs.set('storefrontTaxCollected/cs_live_booth', {
    hostId: 'host-own',
    orgId: 'org-own',
    taxMode: 'manual',
    taxLiability: 'merchant',
    grossCents: 35_181,
    taxCents: 2_681,
    currency: 'usd',
    customerAddress: { country: 'US', state: 'TX' },
    taxLines: [],
    paidAt: new Date(boothAt),
  })
  fakeDocs.set('posHardwareSales/hw_booth', {
    orderId: 'hw_booth',
    totalCents: 32_475,
    taxCents: 2_475,
    shipTo: { country: 'US', state: 'TX', postalCode: null },
    automaticTax: false,
    taxLines: [{ amountCents: 2_475, taxableAmountCents: 30_000 }],
    status: 'delivered',
    livemode: true,
    paidAtMs: boothAt,
    source: 'in_person',
    posHostId: 'host-own',
    storefrontTaxRowId: 'cs_live_booth',
  })

  // 3. A hoodie sold online from the own store, to Texas, under Stripe Tax.
  const hoodieAt = ms('2026-12-01T10:00:00Z')
  fakeDocs.set('hosts/host-own/orders/cs_live_hoodie', {
    status: 'fulfilled',
    channel: 'online',
    totals: { totalCents: 6_495, taxCents: 495 },
    livemode: true,
    createdAtMs: hoodieAt,
    timeline: [{ atMs: hoodieAt, event: 'paid' }],
    shippingAddress: { country: 'US', state: 'TX' },
  })
  fakeDocs.set('storefrontTaxCollected/cs_live_hoodie', {
    hostId: 'host-own',
    orgId: 'org-own',
    taxMode: 'stripe-automatic',
    taxLiability: 'platform',
    grossCents: 6_495,
    taxCents: 495,
    currency: 'usd',
    customerAddress: { country: 'US', state: 'TX' },
    taxLines: [
      { amountCents: 375, taxableAmountCents: 6_000, rateState: 'TX' },
      { amountCents: 120, taxableAmountCents: 6_000, rateState: 'TX' },
    ],
    paidAt: new Date(hoodieAt),
  })

  // 4. A test-mode sale at the own store: in no figure.
  fakeDocs.set('hosts/host-own/orders/pos_test', {
    status: 'paid',
    channel: 'pos',
    totals: { totalCents: 1_000, taxCents: 0 },
    paidAtMs: boothAt,
    createdAtMs: boothAt,
    payments: [{ status: 'succeeded', livemode: false }],
  })

  // 5. A merchant's storefront sale: facilitated, never the operator's own.
  fakeDocs.set('hosts/host-merchant/orders/cs_live_cake', {
    status: 'paid',
    channel: 'online',
    totals: { totalCents: 10_825, taxCents: 825 },
    livemode: true,
    createdAtMs: ms('2026-11-02T00:00:00Z'),
  })
  fakeDocs.set('storefrontTaxCollected/cs_live_cake', {
    hostId: 'host-merchant',
    orgId: 'org-merchant',
    taxMode: 'stripe-automatic',
    taxLiability: 'platform',
    grossCents: 10_825,
    taxCents: 825,
    currency: 'usd',
    customerAddress: { country: 'US', state: 'TX' },
    taxLines: [{ amountCents: 825, taxableAmountCents: 10_000 }],
    paidAt: new Date(ms('2026-11-02T00:00:00Z')),
  })
}

describe('the operator’s own sales on the return, once each (AGL-4038)', () => {
  const env = process.env
  beforeEach(() => {
    resetFakeFirestore()
    process.env = { ...env, POS_HARDWARE_SELLER_ORG_ID: 'org-own' }
  })
  afterEach(() => {
    process.env = env
  })

  it('reads the named workspace’s sites as the operator’s own stores, with where each taxes from', async () => {
    seedPeriod()
    expect(await resolveOwnStores()).toEqual({
      orgId: 'org-own',
      stores: [{ hostId: 'host-own', name: 'Platform Shop', origin: { country: 'US', state: 'TX' } }],
    })
    expect(await resolveOwnStores({})).toEqual({ orgId: null, stores: [] })
  })

  it('folds the shop sale, the booth sale and the online hoodie into Texas once each, and nothing of the merchant’s', async () => {
    seedPeriod()
    const sections = answered(await commerceTaxReturnSource.read(Q4))
    expect(sections.map((section) => section.id)).toEqual(['storefront', 'posHardware', 'ownStores'])
    const texas = taxReturnOperatorSalesIn(sections, 'US-TX')
    expect(texas).toEqual({
      // The shop's reader, the booth sale (reader and T-shirt together), the hoodie.
      transactionCount: 3,
      totalSalesCents: 23_120 + 32_500 + 6_000,
      // The hoodie's base is the one Stripe stated, counted once across its lines.
      taxableSalesCents: 23_120 + 32_500 + 6_000,
      taxCollectedCents: 1_907 + 2_681 + 495,
      refundCount: 0,
      refundedSalesCents: 0,
      refundedTaxCents: 0,
    })
    const [storefront, hardware, ownStores] = sections as Array<Extract<TaxReturnSection, { outcome: 'answered' }>>
    // The booth reader is not folded in again from its hardware record.
    expect(hardware.operatorSales?.map((part) => part.id)).toEqual(['posHardwareShop'])
    expect(ownStores.operatorSales?.map((part) => part.id)).toEqual([
      'ownStore:host-own:in-person',
      'ownStore:host-own:online',
    ])
    // The own store's tax rows leave the storefront card: the merchant's alone stays.
    const sold = storefront.summary as StorefrontTaxSummary
    expect(sold.aglynLiable.transactionCount).toBe(1)
    expect(sold.aglynLiable.taxCollectedCents).toBe(825)
    expect(sold.merchantManual.transactionCount).toBe(0)
    expect(storefront.figures).toEqual([expect.objectContaining({ value: '2' })])
    expect(storefront.operatorSales).toBeUndefined()
    // The test sale is counted, never folded in.
    expect(ownStores.figures.find((figure) => figure.label === 'Test-mode sales left out')?.value).toBe('1')
  })

  it('states a refund made this quarter of a sale paid last quarter in this quarter only', async () => {
    seedPeriod()
    fakeDocs.set('hosts/host-own/orders/pos_q3', {
      status: 'refunded',
      channel: 'pos',
      totals: { totalCents: 10_825, taxCents: 825 },
      paidAtMs: ms('2026-09-20T00:00:00Z'),
      createdAtMs: ms('2026-09-20T00:00:00Z'),
      refundedCents: 10_825,
      timeline: [{ atMs: ms('2026-10-05T00:00:00Z'), event: 'refund' }],
      payments: [{ status: 'succeeded', livemode: true }],
    })
    const texas = taxReturnOperatorSalesIn(answered(await commerceTaxReturnSource.read(Q4)), 'US-TX')
    expect(texas).toMatchObject({ transactionCount: 3, refundCount: 1, refundedSalesCents: 10_000, refundedTaxCents: 825 })
    const q3 = { ...Q4, period: '2026-Q3', start: new Date(Date.UTC(2026, 6, 1)), end: Q4.start }
    expect(taxReturnOperatorSalesIn(answered(await commerceTaxReturnSource.read(q3)), 'US-TX')).toMatchObject({
      refundCount: 0,
    })
  })

  it('reads an order placed long before the period, but not one past the lookback', async () => {
    fakeDocs.set('hosts/host-own', { orgId: 'org-own', name: 'Platform Shop' })
    const placed = (atMs: number) => ({
      status: 'paid',
      channel: 'draft',
      totals: { totalCents: 2_165, taxCents: 165 },
      createdAtMs: atMs,
      timeline: [{ atMs: ms('2026-11-01T00:00:00Z'), event: 'paid' }],
      shippingAddress: { country: 'US', state: 'TX' },
    })
    fakeDocs.set('hosts/host-own/orders/draft_old', placed(Q4.start.getTime() - OWN_STORE_LOOKBACK_MS + 1))
    fakeDocs.set('hosts/host-own/orders/draft_too_old', placed(Q4.start.getTime() - OWN_STORE_LOOKBACK_MS - 1))
    const ownStores = answered(await commerceTaxReturnSource.read(Q4))[2] as Extract<TaxReturnSection, { outcome: 'answered' }>
    expect((ownStores.rows as Array<{ orderId: string }>).map((row) => row.orderId)).toEqual(['draft_old'])
  })

  it('folds no store in while no workspace is named, and leaves the store’s rows where they were', async () => {
    seedPeriod()
    process.env = { ...env }
    const sections = answered(await commerceTaxReturnSource.read(Q4)) as Array<
      Extract<TaxReturnSection, { outcome: 'answered' }>
    >
    expect(sections[2].operatorSales).toEqual([])
    expect(sections[2].figures[0]).toMatchObject({ label: 'Stores read', value: 'None named' })
    // The booth reader is then folded in from its own record, out loud.
    expect(sections[1].operatorSales?.map((part) => part.id)).toEqual(['posHardwareShop', 'posHardwareInPerson'])
    expect(sections[1].findings.find((finding) => finding.id === 'posHardwareInPersonStoreNotRead')?.count).toBe(1)
  })
})
