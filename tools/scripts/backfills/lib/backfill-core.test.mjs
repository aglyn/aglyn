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

// Unit tests for the backfill transforms (AGL-1727/1745/1752/1753).
//
//   node --test tools/scripts/backfills/lib/backfill-core.test.mjs
//
// Red/green decomposed: every scenario first pins the WRONG pre-fix record
// (the red — the transform must detect and change it), then the
// accidentally-correct record (the green — the transform must leave it
// alone). The Firestore double models the real write semantics the plan
// executor depends on — `update()` rejects a missing doc, `create()`
// rejects an existing one — because an unfaithful fake fabricates false
// greens AND false reds.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aggregateContactPurchases,
  applyPlan,
  computeSubscriptionInvoiceOrder,
  diffBuyNowOrder,
  inventoryDriftForOrder,
  invoiceDocFromStripeInvoice,
  isBuyNowOrder,
  normalizeContactEmail,
  planContactUpdate,
  reconstructBuyNowOrder,
  subscriptionInvoiceInterval,
  subscriptionRollup,
} from './backfill-core.mjs'

// --- Firestore double with REAL update()/create() semantics ---------------

function fakeFirestore(seed = {}) {
  const docs = new Map(Object.entries(seed))
  const setDotted = (target, key, value) => {
    const parts = key.split('.')
    let cursor = target
    for (const part of parts.slice(0, -1)) {
      if (typeof cursor[part] !== 'object' || cursor[part] === null) {
        cursor[part] = {}
      }
      cursor = cursor[part]
    }
    cursor[parts[parts.length - 1]] = value
  }
  return {
    docs,
    doc(path) {
      return {
        async update(data) {
          const existing = docs.get(path)
          // Real Firestore: NOT_FOUND — update never conjures a document.
          if (!existing) throw new Error(`NOT_FOUND: no document ${path}`)
          for (const [key, value] of Object.entries(data)) {
            setDotted(existing, key, value)
          }
        },
        async create(data) {
          // Real Firestore: ALREADY_EXISTS — create never overwrites.
          if (docs.has(path)) throw new Error(`ALREADY_EXISTS: ${path}`)
          docs.set(path, structuredClone(data))
        },
        async set() {
          throw new Error(
            'set() reached the double — backfill plans must never use set',
          )
        },
      }
    },
  }
}

// --- AGL-1727: the worked example from the AGL-1711 docstring -------------
// 3 × $100 units, 10% host coupon, manual destination tax at 8.25%.
// Stripe was sent unit 9000 (post-coupon) ×3 plus a 2228c tax line.

const workedSession = {
  amount_total: 29228,
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  // Pre-AGL-1711 session: `quantity` was always sent, the three new keys
  // were not.
  metadata: { type: 'commerce-order', productId: 'prod1', quantity: '3' },
  line_items: {
    data: [
      { quantity: 3, amount_total: 27000, price: { unit_amount: 9000 } },
      {
        quantity: 1,
        amount_total: 2228,
        description: 'Tax (8.25%)',
        price: { unit_amount: 2228 },
      },
    ],
  },
}

/** The record the pre-fix webhook wrote for that purchase: 1 × 29228. */
const preFixOrder = {
  channel: 'online',
  status: 'paid',
  productId: 'prod1',
  couponCode: 'SAVE10',
  feeCents: 0,
  checkoutSessionId: 'cs_test_worked',
  lineItems: [
    { productId: 'prod1', name: 'Widget', quantity: 1, unitAmountCents: 29228 },
  ],
  totals: {
    itemsCents: 29228,
    shippingCents: 0,
    taxCents: 0,
    discountCents: 0,
    feeCents: 0,
    totalCents: 29228,
  },
}

test('AGL-1727 red: the pre-fix 1×29228 record is detected and rebuilt to 3×10000 with tax and discount', () => {
  const rebuilt = reconstructBuyNowOrder({
    order: preFixOrder,
    session: workedSession,
    couponPercentOff: 10,
  })
  assert.equal(rebuilt.error, undefined)
  assert.equal(rebuilt.lineItems[0].quantity, 3)
  assert.equal(rebuilt.lineItems[0].unitAmountCents, 10000)
  assert.deepEqual(rebuilt.totals, {
    itemsCents: 30000,
    shippingCents: 0,
    taxCents: 2228,
    discountCents: 3000,
    feeCents: 0,
    totalCents: 29228, // Stripe's amount_total, verbatim — the invariant.
  })
  const diffs = diffBuyNowOrder(preFixOrder, rebuilt)
  // The dangerous property AGL-1711 named: the wrong record's parts sum, so
  // the diff must flag the COMPONENTS, not the total.
  assert.ok(diffs.some((diff) => diff.field === 'lineItems[0].quantity'))
  assert.ok(diffs.some((diff) => diff.field === 'totals.taxCents'))
  assert.ok(diffs.some((diff) => diff.field === 'totals.discountCents'))
  assert.ok(!diffs.some((diff) => diff.field === 'totals.totalCents'))
})

test('AGL-1727 red: inventory drift reports the 2 units the webhook never decremented', () => {
  const rebuilt = reconstructBuyNowOrder({
    order: preFixOrder,
    session: workedSession,
    couponPercentOff: 10,
  })
  assert.deepEqual(inventoryDriftForOrder(preFixOrder, rebuilt), {
    productId: 'prod1',
    overstatedUnits: 2,
  })
})

test('AGL-1727 green: a single-unit no-coupon no-tax order is accidentally correct — zero diffs, no drift', () => {
  const session = {
    amount_total: 5000,
    total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
    metadata: { type: 'commerce-order', productId: 'prod2', quantity: '1' },
    line_items: {
      data: [{ quantity: 1, amount_total: 5000, price: { unit_amount: 5000 } }],
    },
  }
  const order = {
    channel: 'online',
    productId: 'prod2',
    feeCents: 0,
    checkoutSessionId: 'cs_test_single',
    lineItems: [
      { productId: 'prod2', name: 'Mug', quantity: 1, unitAmountCents: 5000 },
    ],
    totals: {
      itemsCents: 5000,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      feeCents: 0,
      totalCents: 5000,
    },
  }
  const rebuilt = reconstructBuyNowOrder({ order, session, couponPercentOff: 0 })
  assert.deepEqual(diffBuyNowOrder(order, rebuilt), [])
  assert.equal(inventoryDriftForOrder(order, rebuilt), null)
})

test('AGL-1727: a post-fix session metadata snapshot is authoritative over line reconstruction', () => {
  const session = {
    ...workedSession,
    metadata: {
      ...workedSession.metadata,
      unitAmountCents: '10000',
      taxCents: '2228',
      discountCents: '3000',
    },
  }
  const rebuilt = reconstructBuyNowOrder({
    order: preFixOrder,
    session,
    couponPercentOff: 0, // even without the coupon doc, metadata wins
  })
  assert.equal(rebuilt.lineItems[0].unitAmountCents, 10000)
  assert.equal(rebuilt.totals.discountCents, 3000)
  assert.equal(rebuilt.totals.taxCents, 2228)
})

test('AGL-1727: an unresolvable coupon is REPORTED, not silently zeroed', () => {
  const rebuilt = reconstructBuyNowOrder({
    order: preFixOrder,
    session: workedSession,
    couponPercentOff: 0, // coupon doc deleted since the sale
  })
  // The discount stays folded (the documented pre-metadata limitation)…
  assert.equal(rebuilt.totals.discountCents, 0)
  assert.equal(rebuilt.lineItems[0].unitAmountCents, 9000)
  // …and the note says so, which is what the dry run surfaces.
  assert.ok(rebuilt.notes.some((note) => note.includes('CANNOT')))
})

test('AGL-1727: buy-now classification — cart, POS and draft orders are excluded', () => {
  assert.equal(isBuyNowOrder(preFixOrder, 'cs_x'), true)
  // Cart orders carry no legacy flat productId.
  assert.equal(isBuyNowOrder({ channel: 'online', amountCents: 100 }, 'cs_x'), false)
  assert.equal(isBuyNowOrder({ channel: 'pos', productId: 'p' }, 'abc'), false)
  assert.equal(isBuyNowOrder({ channel: 'draft', productId: 'p' }, 'cs_x'), false)
  // Legacy AGL-90 rows: no lineItems, doc id IS the session id.
  assert.equal(isBuyNowOrder({ productId: 'p', amountCents: 100 }, 'cs_live_1'), true)
})

// --- AGL-1745/1752: invoice decomposition and roll-up ---------------------

const renewalInvoice = {
  id: 'in_2',
  subscription: 'sub_1',
  billing_reason: 'subscription_cycle',
  number: 'F00A-0002',
  currency: 'usd',
  amount_paid: 5000,
  total: 5000,
  tax: null,
  status_transitions: { paid_at: 1_755_000_000 },
  period_start: 1_754_000_000,
  period_end: 1_756_600_000,
  customer_email: 'Sub@Example.com',
  hosted_invoice_url: 'https://stripe.example/inv',
  lines: {
    data: [
      {
        amount: 5000,
        quantity: 1,
        description: 'Monthly box',
        price: { unit_amount: 5000, recurring: { interval: 'month' } },
      },
    ],
  },
}

test('AGL-1752 red: a missing renewal decomposes into the exact live invoice-doc shape', () => {
  const doc = invoiceDocFromStripeInvoice(renewalInvoice, {
    snapshot: { productId: 'prodS', name: 'Monthly box' },
    nowMs: 111,
  })
  assert.equal(doc.invoiceId, 'in_2')
  assert.equal(doc.subscriptionId, 'sub_1')
  assert.equal(doc.paidCents, 5000)
  assert.equal(doc.billingReason, 'subscription_cycle')
  assert.equal(doc.interval, 'month')
  assert.equal(doc.paidAtMs, 1_755_000_000_000)
  assert.equal(doc.periodEndMs, 1_756_600_000_000)
  assert.equal(doc.lineItems[0].productId, 'prodS')
  assert.equal(doc.totals.totalCents, 5000)
  assert.equal(doc.backfilledAtMs, 111) // provenance, never mistaken for live
})

test('AGL-1752: a proration credit line never becomes a sold item; tax falls back to total_taxes', () => {
  const invoice = {
    ...renewalInvoice,
    tax: null,
    total_taxes: [{ amount: 400 }],
    lines: {
      data: [
        { amount: -1200, proration: true, description: 'Unused time' },
        {
          amount: 5000,
          quantity: 1,
          price: { unit_amount: 5000, recurring: { interval: 'month' } },
        },
      ],
    },
  }
  const { lineItems, totals } = computeSubscriptionInvoiceOrder(invoice, {
    productId: 'prodS',
    name: 'Monthly box',
  })
  assert.equal(lineItems.length, 1) // the credit line is dropped
  assert.equal(totals.taxCents, 400)
  assert.equal(subscriptionInvoiceInterval(invoice), 'month')
})

test('AGL-1752: the roll-up is deterministic over the doc set — re-running cannot compound', () => {
  const opening = {
    invoiceId: 'in_1',
    billingReason: 'subscription_create',
    paidCents: 5000,
    paidAtMs: 100,
    periodEndMs: 200,
    totals: { totalCents: 5000 },
    interval: 'month',
  }
  const renewal = {
    invoiceId: 'in_2',
    billingReason: 'subscription_cycle',
    paidCents: 6000, // the merchant raised the price
    paidAtMs: 300,
    periodEndMs: 400,
    totals: { totalCents: 6000 },
    interval: 'month',
  }
  const first = subscriptionRollup([opening, renewal])
  const again = subscriptionRollup([opening, renewal])
  assert.deepEqual(first, again) // idempotent by construction
  assert.equal(first.paidCents, 11000)
  assert.equal(first.invoicesCount, 2)
  assert.equal(first.lastInvoiceId, 'in_2')
  assert.equal(first.paidThroughMs, 400)
  // totals replaced from the RENEWAL, never the opening charge…
  assert.equal(first.totals.totalCents, 6000)
  // …and a trial's $0 opening alone replaces nothing.
  const trialOnly = subscriptionRollup([
    { ...opening, paidCents: 0, totals: { totalCents: 0 } },
  ])
  assert.equal(trialOnly.totals, undefined)
})

// --- AGL-1753: contact LTV aggregation ------------------------------------

test('AGL-1753 red: POS + draft + renewals + reservation deposits all count, SET not incremented', () => {
  const { byEmail, anonymousMoney, unknownOpenings } =
    aggregateContactPurchases({
      orders: [
        { id: 'o1', status: 'paid', email: 'Amy@Shop.com', totalCents: 1000, atMs: 10, channel: 'pos' },
        { id: 'o2', status: 'fulfilled', email: 'amy@shop.com', totalCents: 2000, atMs: 20, channel: 'online' },
        { id: 'o3', status: 'paid', email: null, totalCents: 700, atMs: 30, channel: 'pos' }, // cash, anonymous
        { id: 'o4', status: 'pending', email: 'amy@shop.com', totalCents: 9999, atMs: 40 }, // never paid
      ],
      subscriptions: [
        {
          id: 'sub_1',
          email: 'amy@shop.com',
          openingCents: 5000,
          atMs: 15,
          invoices: [
            { billingReason: 'subscription_create', paidCents: 5000, atMs: 15 },
            { billingReason: 'subscription_cycle', paidCents: 5000, atMs: 45 },
          ],
        },
        { id: 'sub_2', email: 'bob@shop.com', openingCents: null, atMs: 1, invoices: [] },
      ],
      reservations: [
        // paidCents is the deposit; totalCents would double-count the folio.
        { id: 'r1', email: 'amy@shop.com', paidCents: 2500, atMs: 50 },
      ],
      bookings: [{ id: 'b1', email: 'amy@shop.com', paidCents: 1500, atMs: 60 }],
    })
  const amy = byEmail.get('amy@shop.com')
  // 1000 + 2000 + 5000 (opening, once) + 5000 (renewal) + 2500 + 1500
  assert.equal(amy.ltvCents, 17000)
  assert.equal(amy.ordersCount, 6)
  assert.equal(amy.firstPurchaseAtMs, 10)
  assert.equal(amy.lastPurchaseAtMs, 60)
  // The un-reconstructable is REPORTED, never silently skipped:
  assert.deepEqual(anonymousMoney, [
    { kind: 'order', refId: 'o3', cents: 700 },
  ])
  assert.deepEqual(unknownOpenings, ['sub_2']) // needs AGL-1745 first
})

test('AGL-1753: refunded orders stay in gross LTV with refund fields beside (AGL-1754 shape)', () => {
  const { byEmail } = aggregateContactPurchases({
    orders: [
      { id: 'o1', status: 'refunded', email: 'amy@shop.com', totalCents: 3000, refundedCents: 3000, atMs: 10 },
    ],
  })
  const amy = byEmail.get('amy@shop.com')
  assert.equal(amy.ltvCents, 3000) // gross — never netted
  assert.equal(amy.refundedCents, 3000)
  assert.equal(amy.refundedOrdersCount, 1)
})

test('AGL-1753 green: a contact whose stored fields already match gets NO write', () => {
  const aggregate = {
    ltvCents: 1000,
    ordersCount: 1,
    firstPurchaseAtMs: 10,
    lastPurchaseAtMs: 10,
    refundedCents: 0,
  }
  assert.equal(
    planContactUpdate(
      { ltvCents: 1000, ordersCount: 1, firstPurchaseAtMs: 10, lastPurchaseAtMs: 10 },
      aggregate,
      999,
    ),
    null,
  )
  // Red: the pre-AGL-1748 contact (RFM fields absent entirely) IS written.
  const plan = planContactUpdate({ email: 'amy@shop.com' }, aggregate, 999)
  assert.equal(plan.ltvCents, 1000)
  assert.equal(plan['backfills.agl1753AtMs'], 999)
})

test('AGL-1753: email normalization joins the raw order email to the contact key', () => {
  assert.equal(normalizeContactEmail('  Amy@Shop.COM '), 'amy@shop.com')
  assert.equal(normalizeContactEmail('not-an-email'), null)
})

// --- Plan executor against the real-semantics double ----------------------

test('applyPlan: update() on a missing doc FAILS — the plan cannot conjure a phantom', async () => {
  const db = fakeFirestore({})
  await assert.rejects(
    applyPlan(db, [
      { type: 'update', path: 'hosts/h1/orders/cs_1', data: { x: 1 } },
    ]),
    /NOT_FOUND/,
  )
})

test('applyPlan: create() on an existing doc FAILS — a re-run cannot overwrite a live record', async () => {
  const db = fakeFirestore({
    'hosts/h1/subscriptions/sub_1/invoices/in_1': { paidCents: 5000 },
  })
  await assert.rejects(
    applyPlan(db, [
      {
        type: 'create',
        path: 'hosts/h1/subscriptions/sub_1/invoices/in_1',
        data: { paidCents: 9999 },
      },
    ]),
    /ALREADY_EXISTS/,
  )
  // The existing doc is untouched by the failed create.
  assert.equal(
    db.docs.get('hosts/h1/subscriptions/sub_1/invoices/in_1').paidCents,
    5000,
  )
})

test('applyPlan: dotted marker paths update nested fields without clobbering siblings', async () => {
  const db = fakeFirestore({
    'hosts/h1/orders/cs_1': { totals: { totalCents: 1 }, backfills: { other: 5 } },
  })
  await applyPlan(db, [
    {
      type: 'update',
      path: 'hosts/h1/orders/cs_1',
      data: { 'backfills.agl1727AtMs': 42 },
    },
  ])
  const doc = db.docs.get('hosts/h1/orders/cs_1')
  assert.equal(doc.backfills.agl1727AtMs, 42)
  assert.equal(doc.backfills.other, 5) // sibling survives — update, not set
})

test('applyPlan: an unknown op type is refused outright', async () => {
  const db = fakeFirestore({})
  await assert.rejects(
    applyPlan(db, [{ type: 'set', path: 'x/y', data: {} }]),
    /refusing unknown write op/,
  )
})

// --- Idempotence: the SECOND run is a NO-OP --------------------------------
//
// The tests above pin that a transform is deterministic over a fixed input.
// That is necessary but NOT sufficient: it says nothing about what happens
// when the transform is re-derived from state the FIRST run already mutated.
// These four drive the real loop — plan, applyPlan against the faithful
// double, then re-plan FROM THE MUTATED DOC — and assert run 2 plans zero
// operations. A backfill that double-counts money fails here and only here.

test('idempotence AGL-1727: re-planning from the rewritten order yields no diffs', async () => {
  const path = 'hosts/h1/orders/cs_test_worked'
  const db = fakeFirestore({ [path]: structuredClone(preFixOrder) })
  const plan = (order) => {
    const rebuilt = reconstructBuyNowOrder({
      order,
      session: workedSession,
      couponPercentOff: 10,
    })
    const diffs = diffBuyNowOrder(order, rebuilt)
    return diffs.length
      ? [
          {
            type: 'update',
            path,
            data: {
              lineItems: rebuilt.lineItems,
              totals: rebuilt.totals,
              'backfills.agl1727AtMs': 1_700_000_000_000,
            },
          },
        ]
      : []
  }

  const run1 = plan(db.docs.get(path))
  assert.equal(run1.length, 1) // red: there IS something to fix
  assert.equal(await applyPlan(db, run1), 1)

  const rewritten = db.docs.get(path)
  assert.equal(rewritten.lineItems[0].quantity, 3)
  assert.equal(rewritten.totals.taxCents, 2228)
  assert.equal(rewritten.backfills.agl1727AtMs, 1_700_000_000_000)

  const run2 = plan(rewritten) // re-derived from the MUTATED doc
  assert.deepEqual(run2, []) // no-op — quantity is not multiplied again
  assert.equal(await applyPlan(db, run2), 0)
  assert.deepEqual(db.docs.get(path), rewritten) // byte-for-byte unchanged
})

test('idempotence AGL-1753: a rebuilt contact re-plans to null — LTV is SET, never incremented', async () => {
  const path = 'orgs/org1/contacts/c1'
  const db = fakeFirestore({
    [path]: {
      email: 'amy@shop.com',
      ltvCents: 2000, // online only — the POS/booking money is missing
      ordersCount: 1,
      lastPurchaseAtMs: 20,
    },
  })
  const sources = {
    orders: [
      { id: 'o1', status: 'paid', email: 'Amy@Shop.com', totalCents: 1000, atMs: 10, channel: 'pos' },
      { id: 'o2', status: 'paid', email: 'amy@shop.com', totalCents: 2000, atMs: 20 },
    ],
    bookings: [{ id: 'b1', email: 'amy@shop.com', paidCents: 1500, atMs: 60 }],
  }
  const plan = (contact) => {
    const { byEmail } = aggregateContactPurchases(sources)
    const update = planContactUpdate(contact, byEmail.get('amy@shop.com'), 1_700_000_000_000)
    return update ? [{ type: 'update', path, data: update }] : []
  }

  const run1 = plan(db.docs.get(path))
  assert.equal(run1.length, 1)
  assert.equal(run1[0].data.ltvCents, 4500) // 1000 + 2000 + 1500
  await applyPlan(db, run1)

  const rebuilt = db.docs.get(path)
  assert.equal(rebuilt.ltvCents, 4500)

  // The whole hazard AGL-1745/1752 flagged: ltvCents is a FieldValue.increment
  // on the LIVE path. If this plan incremented, run 2 would read 9000.
  const run2 = plan(rebuilt)
  assert.deepEqual(run2, [])
  assert.equal(db.docs.get(path).ltvCents, 4500) // NOT 9000
})

test('idempotence AGL-1752: an invoice already written is skipped, and create() refuses to overwrite it', async () => {
  const subPath = 'hosts/h1/subscriptions/sub_1'
  const db = fakeFirestore({ [subPath]: { productId: 'prod1' } })
  const snapshot = { productId: 'prod1', name: 'Monthly box' }
  const invoicePath = `${subPath}/invoices/in_2`

  const plan = () => {
    // The script's guard: only invoices with no doc are created.
    if (db.docs.has(invoicePath)) return []
    const doc = invoiceDocFromStripeInvoice(renewalInvoice, {
      snapshot,
      nowMs: 1_700_000_000_000,
    })
    return [{ type: 'create', path: invoicePath, data: doc }]
  }

  const run1 = plan()
  assert.equal(run1.length, 1)
  assert.equal(run1[0].data.paidCents, 5000)
  assert.equal(run1[0].data.backfilledAtMs, 1_700_000_000_000) // provenance stamp
  await applyPlan(db, run1)

  const run2 = plan()
  assert.deepEqual(run2, []) // the doc's existence IS the idempotency key

  // And the guard is not the only defence — replaying run 1 blindly still
  // cannot double-count, because create() on a live doc throws.
  await assert.rejects(applyPlan(db, run1), /ALREADY_EXISTS/)
  assert.equal(db.docs.get(invoicePath).paidCents, 5000) // untouched

  // The roll-up derives from the doc SET, so re-deriving cannot compound.
  const docs = [db.docs.get(invoicePath)]
  assert.deepEqual(subscriptionRollup(docs), subscriptionRollup(docs))
  assert.equal(subscriptionRollup(docs).paidCents, 5000)
})

test('idempotence AGL-1745: a subscription that already carries totals re-plans to nothing', async () => {
  const path = 'hosts/h1/subscriptions/sub_1'
  const db = fakeFirestore({
    [path]: { productId: 'prod1', customerEmail: 'sub@example.com' },
  })
  const plan = (subscription) => {
    // The script's guard: a subscription that already has totals is done.
    if (subscription.totals) return []
    const doc = invoiceDocFromStripeInvoice(renewalInvoice, {
      snapshot: { productId: 'prod1', name: 'Monthly box' },
      nowMs: 1_700_000_000_000,
    })
    return [
      {
        type: 'update',
        path,
        data: {
          lineItems: doc.lineItems,
          totals: doc.totals,
          'backfills.agl1745AtMs': 1_700_000_000_000,
        },
      },
    ]
  }

  const run1 = plan(db.docs.get(path))
  assert.equal(run1.length, 1)
  await applyPlan(db, run1)
  assert.equal(db.docs.get(path).totals.totalCents, 5000)

  const run2 = plan(db.docs.get(path))
  assert.deepEqual(run2, [])
  assert.equal(db.docs.get(path).totals.totalCents, 5000) // not 10000
})
