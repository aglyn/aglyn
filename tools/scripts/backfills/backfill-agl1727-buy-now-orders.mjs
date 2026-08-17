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

// AGL-1727: historical buy-now orders recorded quantity 1, the whole charge
// as the unit price, and tax/discount 0 (the pre-AGL-1711 webhook). The data
// is reconstructible — the order doc id IS the Checkout Session id, the
// session's line_items carry the real quantity and charged unit price, the
// manual tax line is the only line past [0], and a priced-in coupon reverses
// through hosts/{h}/coupons/{CODE}.percentOff.
//
//   node tools/scripts/backfills/backfill-agl1727-buy-now-orders.mjs \
//     [--host <hostId>] [--apply --yes-i-mean-production]
//
// Env: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY,
// STRIPE_SECRET_KEY (LIVE key, GET-only reads of checkout sessions).
//
// Default is a dry run printing the per-order plan. Idempotent: the plan is
// a recompute-and-diff, so a second apply finds zero diffs and writes
// nothing; every write is an update() on an existing order doc stamping
// `backfills.agl1727AtMs` (never set(merge) — no phantom docs). Inventory
// drift (the same hardcoded 1 under-decremented stock) is REPORTED, not
// fixed — that reconciliation is its own decision per the issue.

import {
  diffBuyNowOrder,
  inventoryDriftForOrder,
  isBuyNowOrder,
  num,
  reconstructBuyNowOrder,
  applyPlan,
} from './lib/backfill-core.mjs'
import {
  announceMode,
  dollars,
  initFirestoreAdmin,
  parseBackfillArgs,
  stripeGet,
} from './lib/backfill-io.mjs'

const args = parseBackfillArgs()
const { db, projectId } = initFirestoreAdmin()
announceMode('backfill-agl1727-buy-now-orders', args, projectId)

const stats = {
  hosts: 0,
  ordersScanned: 0,
  buyNowOrders: 0,
  alreadyCorrect: 0,
  alreadyBackfilled: 0,
  toRewrite: 0,
  manualReview: 0,
  sessionMissing: 0,
  testModeOrders: 0,
}
const operations = []
const manualReview = []
const inventoryDrift = []

const hostsSnapshot = args.hostFilter
  ? { docs: [await db.collection('hosts').doc(args.hostFilter).get()] }
  : await db.collection('hosts').select().get()

for (const hostDoc of hostsSnapshot.docs) {
  if (!hostDoc.exists && args.hostFilter) {
    console.error(`host ${args.hostFilter} does not exist`)
    process.exit(1)
  }
  stats.hosts += 1
  const hostRef = db.collection('hosts').doc(hostDoc.id)
  const orders = await hostRef.collection('orders').get()
  stats.ordersScanned += orders.size
  const couponCache = new Map()
  for (const orderDoc of orders.docs) {
    const order = orderDoc.data()
    if (!isBuyNowOrder(order, orderDoc.id)) continue
    stats.buyNowOrders += 1
    const sessionId = String(order.checkoutSessionId ?? orderDoc.id)
    // A `cs_test_…` id is a TEST-mode session: not a live sale, invisible
    // to the live key by construction. Reported as its own bucket so the
    // count of real affected orders stays honest.
    if (sessionId.startsWith('cs_test_')) {
      stats.testModeOrders += 1
      console.log(
        `  ${hostDoc.id}/${orderDoc.id}: TEST-mode session — not a live ` +
          `sale, excluded (${dollars(num(order.totals?.totalCents ?? order.amountCents))})`,
      )
      continue
    }
    let session
    try {
      session = await stripeGet(`checkout/sessions/${sessionId}`, {
        'expand[]': 'line_items',
      })
    } catch (error) {
      if (error.status === 404) {
        stats.sessionMissing += 1
        console.log(
          `  ${hostDoc.id}/${orderDoc.id}: session NOT FOUND on Stripe — ` +
            `cannot reconstruct, listed for manual review`,
        )
        manualReview.push({ hostId: hostDoc.id, orderId: orderDoc.id, reason: 'session 404' })
        continue
      }
      throw error
    }
    let couponPercentOff = 0
    if (order.couponCode) {
      const code = String(order.couponCode)
      if (!couponCache.has(code)) {
        const coupon = await hostRef.collection('coupons').doc(code).get()
        couponCache.set(code, num(coupon.get('percentOff')))
      }
      couponPercentOff = couponCache.get(code)
    }
    const rebuilt = reconstructBuyNowOrder({ order, session, couponPercentOff })
    if (rebuilt.error) {
      stats.manualReview += 1
      manualReview.push({ hostId: hostDoc.id, orderId: orderDoc.id, reason: rebuilt.error })
      continue
    }
    // Invariant: the rebuilt total must be Stripe's charge, and the stored
    // total must already agree with it — a mismatch means this order is not
    // the shape we think it is, and no script should auto-rewrite it.
    const sessionTotal = num(session.amount_total)
    const storedTotal = num(order.totals?.totalCents ?? order.amountCents)
    if (rebuilt.totals.totalCents !== sessionTotal || storedTotal !== sessionTotal) {
      stats.manualReview += 1
      manualReview.push({
        hostId: hostDoc.id,
        orderId: orderDoc.id,
        reason:
          `total mismatch: stored ${storedTotal}, session ${sessionTotal}, ` +
          `rebuilt ${rebuilt.totals.totalCents}`,
      })
      continue
    }
    const diffs = diffBuyNowOrder(order, rebuilt)
    if (!diffs.length) {
      if (order.backfills?.agl1727AtMs) stats.alreadyBackfilled += 1
      else stats.alreadyCorrect += 1
      continue
    }
    stats.toRewrite += 1
    const drift = inventoryDriftForOrder(order, rebuilt)
    if (drift) inventoryDrift.push({ hostId: hostDoc.id, orderId: orderDoc.id, ...drift })
    console.log(
      `  ${hostDoc.id}/${orderDoc.id} (${order.status}, ${dollars(sessionTotal)}):`,
    )
    for (const diff of diffs) {
      console.log(`    ${diff.field}: ${diff.from} -> ${diff.to}`)
    }
    for (const note of rebuilt.notes) console.log(`    note: ${note}`)
    operations.push({
      type: 'update',
      path: `hosts/${hostDoc.id}/orders/${orderDoc.id}`,
      data: {
        lineItems: rebuilt.lineItems,
        totals: rebuilt.totals,
        'backfills.agl1727AtMs': Date.now(),
      },
    })
  }
}

console.log('')
console.log(`hosts scanned                ${stats.hosts}`)
console.log(`orders scanned               ${stats.ordersScanned}`)
console.log(`buy-now (commerce-order)     ${stats.buyNowOrders}`)
console.log(`test-mode sessions excluded  ${stats.testModeOrders}`)
console.log(`accidentally correct         ${stats.alreadyCorrect}`)
console.log(`already backfilled           ${stats.alreadyBackfilled}`)
console.log(`WOULD rewrite                ${stats.toRewrite}`)
console.log(`manual review (not written)  ${stats.manualReview + stats.sessionMissing}`)
if (manualReview.length) {
  console.log('manual review detail:')
  for (const item of manualReview) {
    console.log(`  ${item.hostId}/${item.orderId}: ${item.reason}`)
  }
}
if (inventoryDrift.length) {
  console.log(
    'INVENTORY DRIFT (reported only — stock was under-decremented by these units):',
  )
  for (const item of inventoryDrift) {
    console.log(
      `  ${item.hostId}/${item.orderId}: product ${item.productId}` +
        `${item.variantId ? ` variant ${item.variantId}` : ''} ` +
        `overstated by ${item.overstatedUnits} unit(s)`,
    )
  }
}

if (args.apply) {
  const applied = await applyPlan(db, operations)
  console.log(`APPLIED ${applied} update(s)`)
} else {
  console.log(
    `DRY RUN complete — ${operations.length} update(s) planned, nothing written`,
  )
}
process.exit(0)
