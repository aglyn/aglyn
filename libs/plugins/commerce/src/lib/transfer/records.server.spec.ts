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

/*
 * Orders, discounts, coupons, gift cards and categories on the transfer
 * framework (AGL-3531), against a fake that answers queries the way
 * Firestore does. The order money assertions of the CSV export it replaces
 * (`buildOrdersCsv`, AGL-1747) live here now: each case is one real writer's
 * stored shape, and every figure is asserted on its own.
 */

import {
  type QueryFakeFirestore,
  queryFakeFirestore,
} from '@aglyn/tenant-data-admin/server/test-firestore-queries'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  buildTransferFieldCatalog,
  createTransferPolicy,
  matchLookupRequests,
  matchRows,
  type MatchKeySpec,
  type TransferField,
  type TransferPlanRow,
  type TransferRowResult,
  type TransferUndoEntry,
} from '@aglyn/aglyn/data-transfer'
import {
  transferInvariantFailures,
  type PluginTransferResource,
  type TransferApplyWriter,
  type TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'

let fake: QueryFakeFirestore

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fake }),
    firestore: { FieldPath, FieldValue, Timestamp },
  },
}))

import {
  categoriesTransfer,
  couponsTransfer,
  discountsTransfer,
  giftCardsTransfer,
  ordersTransfer,
} from './records.server'
import {
  CATEGORY_TRANSFER_FIELDS,
  COUPON_TRANSFER_FIELDS,
  DISCOUNT_TRANSFER_FIELDS,
  ORDER_TRANSFER_FIELDS,
  orderRecord,
} from './records-transfer'
import { commerceListFilter } from './list-filter'

const HOST = 'hosts/h1'
const ctx = (resource: string): TransferResourceContext => ({ resource, orgId: 'org-1', hostId: 'h1', actorUid: 'uid-1' })

function memoryWriter(): TransferApplyWriter {
  const ledger = new Map<number, TransferRowResult>()
  return {
    alreadyApplied: async (row) => ledger.get(row) ?? null,
    markApplied: async (result) => void ledger.set(result.row, result),
    timeLeftMs: () => 60_000,
  }
}

/** Rows (values by field id) through a resource's lookup, match, plan and apply, as the job runs them. */
async function importRows(
  resource: PluginTransferResource,
  key: string,
  fields: readonly TransferField[],
  values: Array<Record<string, unknown>>,
  overwrite = false,
) {
  const c = ctx(key)
  // Every commerce resource names its keys as a list.
  const keys = (resource.matchKeys ?? []) as readonly MatchKeySpec[]
  const found = await resource.lookup!(c, matchLookupRequests(values, keys))
  const rows: TransferPlanRow[] = values.map((row, index) => ({ index, values: row }))
  const plan = await resource.plan!(c, {
    fields: buildTransferFieldCatalog({ standard: fields }).fields,
    rows,
    matches: matchRows(values, keys, found.lookup),
    existing: found.records,
    policy: createTransferPolicy(overwrite ? { fieldDefault: { mode: 'overwrite', blank: 'leave' } } : {}),
  })
  const writes = plan.rows.filter((row) => row.verdict === 'create' || row.verdict === 'update')
  const applied = await resource.apply!(c, { jobId: 'j', index: 0, start: 0, end: rows.length, rows: writes }, memoryWriter())
  return { plan, ...applied }
}

beforeEach(() => {
  fake = queryFakeFirestore()
})

describe('orders, exported', () => {
  const at = (iso: string) => Timestamp.fromDate(new Date(iso))

  it('exports a POS order at what it actually charged, not $0.00', () => {
    const record = orderRecord('pos1', {
      number: 12,
      status: 'paid',
      channel: 'pos',
      lineItems: [
        { productId: 'pad', name: 'Brake Pads', quantity: 2, unitAmountCents: 1250 },
        { productId: 'lev', name: 'Levers', quantity: 1, unitAmountCents: 4000 },
      ],
      totals: { itemsCents: 6500, shippingCents: 0, taxCents: 536, discountCents: 0, feeCents: 195, totalCents: 7036 },
      customerEmail: 'walkin@example.com',
      createdAt: at('2026-08-14T15:04:05.000Z'),
    })
    expect(record).toMatchObject({
      number: 12,
      date: '2026-08-14T15:04:05.000Z',
      // Two lines, so the first is named and the rest counted.
      product: 'Brake Pads +1 more',
      items: '2 × Brake Pads; 1 × Levers',
      itemCount: 3,
      subtotal: 65,
      tax: 5.36,
      total: 70.36, // `amountCents` is never written on a POS order
      fee: 1.95, // nor is `feeCents`
      customerEmail: 'walkin@example.com',
      coupon: null,
      status: 'Paid',
      channel: 'POS',
      refunded: 0,
      net: 70.36,
    })
  })

  it('exports a draft order at its totals, dated by its milliseconds, and keeps it pending', () => {
    const record = orderRecord('draft1', {
      status: 'pending',
      channel: 'draft',
      lineItems: [{ productId: 'kit', name: 'Tune-up Kit', quantity: 1, unitAmountCents: 8900 }],
      totals: { itemsCents: 8900, shippingCents: 0, taxCents: 0, discountCents: 0, feeCents: 267, totalCents: 8900 },
      createdAtMs: Date.parse('2026-08-13T09:00:00.000Z'),
    })
    expect(record).toMatchObject({ date: '2026-08-13T09:00:00.000Z', product: 'Tune-up Kit', total: 89, fee: 2.67, status: 'Pending', channel: 'Draft' })
  })

  it('splits a refunded order into gross, refunded and net', () => {
    const record = orderRecord('ref1', {
      status: 'refunded',
      lineItems: [{ productId: 'p', name: 'Jersey', quantity: 1, unitAmountCents: 9000 }],
      totals: { itemsCents: 9000, shippingCents: 0, taxCents: 0, discountCents: 0, feeCents: 270, totalCents: 9000 },
      refundedCents: 3000,
    })
    expect(record).toMatchObject({ total: 90, status: 'Refunded', refunded: 30, net: 60 })
  })

  it('names a legacy flat row by its product, and reads its flat money', () => {
    const record = orderRecord('legacy1', { productId: 'p9', amountCents: 2500, feeCents: 75 }, { p9: 'Vintage Bell' })
    expect(record).toMatchObject({ product: 'Vintage Bell', total: 25, fee: 0.75, status: 'Paid', channel: 'Online', date: null })
  })

  it("streams every order the list's query matches, past any page, and names legacy rows from the store", async () => {
    for (let index = 0; index < 7; index += 1) {
      fake.seed(`${HOST}/orders/o${index}`, {
        status: index % 2 ? 'paid' : 'refunded',
        createdAtMs: 1_000 + index,
        searchTokens: ['mug'],
        lineItems: [{ productId: 'mug', name: 'Mug', quantity: 1, unitAmountCents: 1200 }],
        totals: { itemsCents: 1200, shippingCents: 0, taxCents: 0, discountCents: 0, feeCents: 36, totalCents: 1200 },
      })
    }
    fake.seed(`${HOST}/orders/legacy`, { productId: 'p9', amountCents: 2500, createdAtMs: 999, status: 'paid' })
    fake.seed(`${HOST}/products/p9`, { name: 'Vintage Bell' })
    const c = ctx('commerce.orders')
    const filter = commerceListFilter({
      filters: [{ path: 'status', op: '==', value: 'paid' }],
      orderBy: { path: 'createdAtMs', direction: 'desc' },
    })
    expect(await ordersTransfer.count!(c, { filter: filter as never })).toBe(4)
    const seen: unknown[] = []
    let cursor: string | null = null
    do {
      const page = await ordersTransfer.readPage!(c, cursor, ['id', 'product', 'total'], { filter: filter as never, pageSize: 2 })
      seen.push(...page.rows.map((row) => row['id']))
      cursor = page.next
    } while (cursor)
    // Newest first, the list's own order.
    expect(seen).toEqual(['o5', 'o3', 'o1', 'legacy'])
    const all = await ordersTransfer.readPage!(c, null, ['id', 'product'], {})
    expect(all.rows.find((row) => row['id'] === 'legacy')?.['product']).toBe('Vintage Bell')
  })

  it('refuses every row a file would write, at the dry run and at apply', async () => {
    expect(ORDER_TRANSFER_FIELDS.every((field) => field.readOnly || field.system)).toBe(true)
    const failures = transferInvariantFailures(
      ordersTransfer.invariants,
      [{ index: 0, verdict: 'create', recordId: null, diff: [], heldBack: [], warnings: [], match: { kind: 'new' } }],
      new Map(),
    )
    expect(failures[0]?.message).toMatch(/exported, never imported/)
    const applied = await giftCardsTransfer.apply!(
      ctx('commerce.gift-cards'),
      { jobId: 'j', index: 0, start: 0, end: 1, rows: [{ index: 0, verdict: 'create', recordId: null, diff: [], heldBack: [], warnings: [], match: { kind: 'new' } }] },
      memoryWriter(),
    )
    expect(applied.results[0]).toMatchObject({ outcome: 'failed' })
  })
})

describe('gift cards, exported', () => {
  it("reads each card's code, balance and status", async () => {
    fake.seed(`${HOST}/giftCards/GC-1`, { initialCents: 5000, balanceCents: 1250, createdAtMs: 0, recipientEmail: 'a@b.co' })
    fake.seed(`${HOST}/giftCards/GC-2`, { initialCents: 5000, balanceCents: 0, voidedAtMs: 5 })
    const page = await giftCardsTransfer.readPage!(ctx('commerce.gift-cards'), null, ['id', 'balance', 'initial', 'status', 'recipientEmail'], {})
    expect(page.rows).toEqual([
      { id: 'GC-1', balance: 12.5, initial: 50, status: 'Active', recipientEmail: 'a@b.co' },
      { id: 'GC-2', balance: 0, initial: 50, status: 'Voided', recipientEmail: null },
    ])
    await expect(
      giftCardsTransfer.readPage!(ctx('commerce.gift-cards'), null, ['id'], { filter: { anything: 1 } }),
    ).rejects.toThrow(/exports everything/)
  })
})

describe('discounts', () => {
  it('creates a new discount switched off, updates a matched one by code, and undoes both', async () => {
    fake.seed(`${HOST}/discounts/d1`, { code: 'SPRING', kind: 'percent', valuePct: 10, enabled: true, redemptions: 4 })
    const { plan, results, undo } = await importRows(
      discountsTransfer,
      'commerce.discounts',
      DISCOUNT_TRANSFER_FIELDS,
      [
        { code: 'spring', percentOff: 15, kind: 'Percent off' },
        { code: 'SHIPFREE', kind: 'Free shipping', name: 'Free shipping' },
        { code: 'NOKIND', percentOff: 5 },
      ],
      true,
    )
    expect(plan.rows.map((row) => row.verdict)).toEqual(['update', 'create', 'fail'])
    expect(plan.rows[2]).toMatchObject({ reason: 'missingRequired', missing: ['kind'] })
    expect(fake.read(`${HOST}/discounts/d1`)).toMatchObject({ code: 'SPRING', valuePct: 15, enabled: true, redemptions: 4 })
    const created = results.find((result) => result.outcome === 'created')?.recordId as string
    expect(fake.read(`${HOST}/discounts/${created}`)).toMatchObject({
      code: 'SHIPFREE',
      kind: 'free_shipping',
      enabled: false,
      redemptions: 0,
    })
    const reverted = await discountsTransfer.revert!(ctx('commerce.discounts'), { jobId: 'j', chunk: 0, entries: undo as TransferUndoEntry[] })
    expect(reverted.conflicts).toEqual([])
    expect(fake.read(`${HOST}/discounts/${created}`)).toBeUndefined()
    expect(fake.read(`${HOST}/discounts/d1`)).toMatchObject({ valuePct: 10 })
  })

  it('refuses a discount the checkout could not apply, row by row', async () => {
    const { results } = await importRows(discountsTransfer, 'commerce.discounts', DISCOUNT_TRANSFER_FIELDS, [
      { code: 'HUGE', kind: 'Percent off', percentOff: 150 },
    ])
    expect(results).toEqual([expect.objectContaining({ outcome: 'failed', message: expect.stringMatching(/1 to 100/) })])
  })
})

describe('coupons', () => {
  it('creates a coupon under its code, switched off unless the file says Active, and finds it by code', async () => {
    fake.seed(`${HOST}/coupons/LAUNCH`, { percentOff: 10, enabled: true, redemptions: 2 })
    const { plan, results } = await importRows(
      couponsTransfer,
      'commerce.coupons',
      COUPON_TRANSFER_FIELDS,
      [
        { code: 'launch', maxRedemptions: 50 },
        { code: 'Welcome 10', percentOff: 10 },
        { code: 'VIP', percentOff: 25, active: true },
      ],
    )
    expect(plan.rows.map((row) => row.verdict)).toEqual(['update', 'create', 'create'])
    expect(results.map((result) => result.recordId)).toEqual(['LAUNCH', 'WELCOME10', 'VIP'])
    expect(fake.read(`${HOST}/coupons/LAUNCH`)).toMatchObject({ percentOff: 10, maxRedemptions: 50, redemptions: 2, enabled: true })
    expect(fake.read(`${HOST}/coupons/WELCOME10`)).toMatchObject({ percentOff: 10, enabled: false, redemptions: 0 })
    expect(fake.read(`${HOST}/coupons/VIP`)).toMatchObject({ enabled: true })
  })
})

describe('categories', () => {
  it('matches by slug, puts a category under a parent the file made first, and refuses a loop', async () => {
    fake.seed(`${HOST}/productCategories/c1`, { name: 'Lighting', slug: 'lighting', parentId: null })
    const { plan, results } = await importRows(
      categoriesTransfer,
      'commerce.categories',
      CATEGORY_TRANSFER_FIELDS,
      [
        { name: 'Outdoor' },
        { name: 'Lanterns', parent: 'outdoor' },
        { slug: 'lighting', name: 'Lighting', parent: 'Lanterns' },
        { name: 'Desk', parent: 'Nowhere' },
      ],
      true,
    )
    expect(plan.rows.map((row) => row.verdict)).toEqual(['create', 'create', 'update', 'create'])
    const outdoor = results[0]?.recordId as string
    const lanterns = results[1]?.recordId as string
    expect(fake.read(`${HOST}/productCategories/${lanterns}`)).toMatchObject({ name: 'Lanterns', slug: 'lanterns', parentId: outdoor })
    expect(fake.read(`${HOST}/productCategories/c1`)).toMatchObject({ parentId: lanterns })
    expect(results[3]).toMatchObject({ outcome: 'failed', message: 'No category "Nowhere" to put it under.' })

    // Lanterns under Lighting, which now sits under Lanterns: refused.
    const loop = await importRows(categoriesTransfer, 'commerce.categories', CATEGORY_TRANSFER_FIELDS, [
      { slug: 'lanterns', name: 'Lanterns', parent: 'lighting' },
    ], true)
    expect(loop.results[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/under itself/) })
  })

  it('exports each category with its parent named by slug', async () => {
    fake.seed(`${HOST}/productCategories/c1`, { name: 'Lighting', slug: 'lighting', parentId: null })
    fake.seed(`${HOST}/productCategories/c2`, { name: 'Lamps', slug: 'lamps', parentId: 'c1', order: 2 })
    const page = await categoriesTransfer.readPage!(ctx('commerce.categories'), null, ['id', 'name', 'parent', 'order'], {})
    expect(page.rows).toEqual([
      { id: 'c1', name: 'Lighting', parent: null, order: null },
      { id: 'c2', name: 'Lamps', parent: 'lighting', order: 2 },
    ])
  })
})
