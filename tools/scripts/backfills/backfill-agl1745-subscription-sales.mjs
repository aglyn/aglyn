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

// AGL-1745: storefront subscriptions sold before AGL-1732 carry no
// lineItems, totals, checkoutSessionId, variantId or interval — the money
// was collected and none of it recorded. The subscription doc id IS the
// Stripe subscription id, so the sale reconstructs from Stripe: the
// Checkout Session (preferred — the exact decomposition the live path
// stores) or, failing that, the opening invoice (`subscription_create`).
//
//   node tools/scripts/backfills/backfill-agl1745-subscription-sales.mjs \
//     [--host <hostId>] [--apply --yes-i-mean-production]
//
// Env: FIREBASE_* (admin), STRIPE_SECRET_KEY (LIVE, GET-only).
//
// Idempotent: only subscriptions MISSING `totals` are candidates, existing
// fields are never overwritten, and the write is an update() on the
// existing doc stamping `backfills.agl1745AtMs`. Amounts come from Stripe,
// never from the current product doc (the AGL-1711 price-edit caveat) —
// the product doc supplies only the display name for the line item.
// Deliberately NO manager notification and NO contact write: contacts are
// rebuilt by SET in the AGL-1753 pass, which runs after this one.

import {
  invoiceDocFromStripeInvoice,
  reconstructBuyNowOrder,
  subscriptionInvoiceInterval,
  applyPlan,
} from './lib/backfill-core.mjs'
import {
  announceMode,
  dollars,
  initFirestoreAdmin,
  parseBackfillArgs,
  stripeGet,
  stripeList,
} from './lib/backfill-io.mjs'

const args = parseBackfillArgs()
const { db, projectId } = initFirestoreAdmin()
announceMode('backfill-agl1745-subscription-sales', args, projectId)

const stats = {
  hosts: 0,
  subscriptions: 0,
  alreadyRecorded: 0,
  alreadyBackfilled: 0,
  toRewrite: 0,
  manualReview: 0,
  testModeSubscriptions: 0,
}
const operations = []
const manualReview = []

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
  const subscriptions = await hostRef.collection('subscriptions').get()
  for (const subscriptionDoc of subscriptions.docs) {
    const subscription = subscriptionDoc.data()
    stats.subscriptions += 1
    if (subscription.totals) {
      if (subscription.backfills?.agl1745AtMs) stats.alreadyBackfilled += 1
      else stats.alreadyRecorded += 1
      continue
    }
    const subscriptionId = subscriptionDoc.id
    // Probe the subscription itself first: a TEST-mode id 404s under the
    // live key ("a similar object exists in test mode") — an e2e artifact,
    // not a live sale, and nothing about it is reconstructible or owed.
    try {
      await stripeGet(`subscriptions/${subscriptionId}`)
    } catch (error) {
      if (error.status === 404) {
        const testMode = /test mode/i.test(error.message)
        if (testMode) stats.testModeSubscriptions += 1
        else stats.manualReview += 1
        if (!testMode) {
          manualReview.push({
            hostId: hostDoc.id,
            subscriptionId,
            reason: 'subscription id unknown to Stripe (live)',
          })
        } else {
          console.log(
            `  ${hostDoc.id}/${subscriptionId}: TEST-mode subscription — ` +
              `not a live sale, excluded`,
          )
        }
        continue
      }
      throw error
    }
    const productId = String(subscription.productId ?? '')
    const productSnapshot = productId
      ? await hostRef.collection('products').doc(productId).get()
      : null
    const productName = String(productSnapshot?.get('name') ?? 'Subscription')

    // Preferred source: the Checkout Session that sold it — the live
    // AGL-1732 decomposition, metadata snapshot included.
    let update = null
    let sourceNote = ''
    const sessions = await stripeGet('checkout/sessions', {
      subscription: subscriptionId,
      'expand[]': 'data.line_items',
      limit: 3,
    }).catch(() => null)
    const session = (sessions?.data ?? []).find(
      (item) => item?.metadata?.type === 'commerce-subscription',
    )
    if (session) {
      const rebuilt = reconstructBuyNowOrder({
        order: {
          productId,
          lineItems: [
            {
              productId,
              name: productName,
              quantity: 0,
              unitAmountCents: 0,
            },
          ],
        },
        session,
        couponPercentOff: 0,
      })
      if (!rebuilt.error) {
        const variantId = String(session.metadata?.variantId ?? '')
        update = {
          lineItems: rebuilt.lineItems,
          totals: rebuilt.totals,
          ...(variantId && !subscription.variantId ? { variantId } : {}),
          ...(subscription.checkoutSessionId
            ? {}
            : { checkoutSessionId: String(session.id) }),
        }
        sourceNote = `session ${session.id}`
      }
    }
    if (!update) {
      // Fallback: the opening invoice — same arithmetic, invoice-shaped.
      const invoices = await stripeList('invoices', {
        subscription: subscriptionId,
      }).catch(() => [])
      const opening = invoices.find(
        (invoice) =>
          invoice.billing_reason === 'subscription_create' &&
          invoice.status === 'paid',
      )
      if (!opening) {
        stats.manualReview += 1
        manualReview.push({
          hostId: hostDoc.id,
          subscriptionId,
          reason: 'no commerce-subscription session and no paid opening invoice on Stripe',
        })
        continue
      }
      const doc = invoiceDocFromStripeInvoice(opening, {
        snapshot: { productId, name: productName },
        nowMs: Date.now(),
      })
      update = { lineItems: doc.lineItems, totals: doc.totals }
      const interval = subscriptionInvoiceInterval(opening)
      if (interval) update.interval = interval
      sourceNote = `opening invoice ${opening.id}`
    }
    if (update.totals && !update.interval && !subscription.interval) {
      // The amount alone is ambiguous ($50/mo vs $50/yr) — ask Stripe's
      // subscription object rather than the (editable) product doc.
      const stripeSubscription = await stripeGet(
        `subscriptions/${subscriptionId}`,
      ).catch(() => null)
      const interval =
        stripeSubscription?.items?.data?.[0]?.price?.recurring?.interval
      if (interval === 'month' || interval === 'year') {
        update.interval = interval
      }
    }
    stats.toRewrite += 1
    console.log(
      `  ${hostDoc.id}/${subscriptionId}: record sale ` +
        `${dollars(update.totals.totalCents)}` +
        `${update.interval ? `/${update.interval}` : ''} from ${sourceNote}` +
        ` (email ${subscription.customerEmail ?? 'unknown'})`,
    )
    operations.push({
      type: 'update',
      path: `hosts/${hostDoc.id}/subscriptions/${subscriptionId}`,
      data: { ...update, 'backfills.agl1745AtMs': Date.now() },
    })
  }
}

console.log('')
console.log(`hosts scanned            ${stats.hosts}`)
console.log(`subscriptions scanned    ${stats.subscriptions}`)
console.log(`already carry totals     ${stats.alreadyRecorded}`)
console.log(`already backfilled       ${stats.alreadyBackfilled}`)
console.log(`WOULD rewrite            ${stats.toRewrite}`)
console.log(`test-mode subs excluded  ${stats.testModeSubscriptions}`)
console.log(`manual review            ${stats.manualReview}`)
for (const item of manualReview) {
  console.log(`  ${item.hostId}/${item.subscriptionId}: ${item.reason}`)
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
