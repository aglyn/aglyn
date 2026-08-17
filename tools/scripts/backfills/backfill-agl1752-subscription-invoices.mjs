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

// AGL-1752: subscription renewals charged before AGL-1743 are recorded
// nowhere — no invoice doc, no paidCents/invoicesCount roll-up, no
// paidThroughMs. The subscription doc id IS the Stripe subscription id, so
// `GET /v1/invoices?subscription={id}` enumerates every historical cycle.
//
//   node tools/scripts/backfills/backfill-agl1752-subscription-invoices.mjs \
//     [--host <hostId>] [--apply --yes-i-mean-production]
//
// Env: FIREBASE_* (admin), STRIPE_SECRET_KEY (LIVE, GET-only).
//
// The two hazards the issue names are structural here:
//  1. Idempotency — the invoice DOC is the key: missing docs are written
//     with create() (which fails on an existing one, never overwrites),
//     and the roll-up is recomputed deterministically from the full doc
//     set rather than incremented, so a re-run lands on identical numbers.
//  2. No re-notification — this script never calls notifyHostManagers and
//     never touches contacts; AGL-1753's SET rebuild (run after this)
//     carries the renewal money into ltvCents exactly once.
//
// Sequencing: run AGL-1745 first — the invoice line-item snapshot reads the
// subscription's stored lineItems, exactly as the live branch does.

import {
  invoiceDocFromStripeInvoice,
  num,
  subscriptionRollup,
  applyPlan,
} from './lib/backfill-core.mjs'
import {
  announceMode,
  dollars,
  initFirestoreAdmin,
  parseBackfillArgs,
  stripeList,
} from './lib/backfill-io.mjs'

const args = parseBackfillArgs()
const { db, projectId } = initFirestoreAdmin()
announceMode('backfill-agl1752-subscription-invoices', args, projectId)

const stats = {
  hosts: 0,
  subscriptions: 0,
  stripeInvoices: 0,
  invoiceDocsExisting: 0,
  invoiceDocsToCreate: 0,
  rollupsToUpdate: 0,
  upToDate: 0,
  testModeSubscriptions: 0,
  notOnStripe: 0,
}
const operations = []
const notes = []

const ROLLUP_KEYS = [
  'lastInvoiceId',
  'lastPaymentCents',
  'lastPaymentAtMs',
  'paidCents',
  'invoicesCount',
  'paidThroughMs',
]

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
    stats.subscriptions += 1
    const subscription = subscriptionDoc.data()
    const subscriptionId = subscriptionDoc.id
    const subscriptionPath = `hosts/${hostDoc.id}/subscriptions/${subscriptionId}`

    // Product identity for reconstructed lines: what the sale recorded
    // (post-AGL-1745), falling back to the product doc name — the same
    // fallback chain as the live branch.
    const soldLine = subscription.lineItems?.[0]
    let snapshot
    if (soldLine) {
      snapshot = {
        productId: String(soldLine.productId ?? ''),
        ...(soldLine.variantId ? { variantId: soldLine.variantId } : {}),
        name: soldLine.name,
        ...(soldLine.variantLabel ? { variantLabel: soldLine.variantLabel } : {}),
        ...(soldLine.sku ? { sku: soldLine.sku } : {}),
        ...(soldLine.productType ? { productType: soldLine.productType } : {}),
      }
    } else {
      const productId = String(subscription.productId ?? '')
      const productSnapshot = productId
        ? await hostRef.collection('products').doc(productId).get()
        : null
      snapshot = {
        productId,
        name: String(productSnapshot?.get('name') ?? 'Subscription'),
      }
      if (!soldLine) {
        notes.push(
          `${subscriptionPath}: no stored lineItems (run AGL-1745 first for ` +
            `a richer snapshot) — using product-doc name "${snapshot.name}"`,
        )
      }
    }

    let allInvoices
    try {
      allInvoices = await stripeList('invoices', {
        subscription: subscriptionId,
      })
    } catch (error) {
      if (error.status === 404) {
        // A TEST-mode subscription id 404s under the live key ("a similar
        // object exists in test mode") — an e2e artifact, not a live sale.
        const testMode = /test mode/i.test(error.message)
        stats[testMode ? 'testModeSubscriptions' : 'notOnStripe'] += 1
        notes.push(
          `${subscriptionPath}: ${
            testMode
              ? 'TEST-mode subscription — not a live sale, excluded'
              : 'subscription id unknown to Stripe (live) — manual review'
          }`,
        )
        continue
      }
      throw error
    }
    const paidInvoices = allInvoices.filter(
      (invoice) => invoice.status === 'paid',
    )
    stats.stripeInvoices += paidInvoices.length

    const existingDocs = await subscriptionDoc.ref.collection('invoices').get()
    const existingById = new Map(
      existingDocs.docs.map((doc) => [doc.id, doc.data()]),
    )
    stats.invoiceDocsExisting += existingDocs.size

    const fullSet = []
    let createdHere = 0
    for (const invoice of paidInvoices) {
      const existing = existingById.get(String(invoice.id))
      if (existing) {
        fullSet.push(existing)
        continue
      }
      const doc = invoiceDocFromStripeInvoice(invoice, {
        snapshot,
        nowMs: Date.now(),
      })
      fullSet.push(doc)
      createdHere += 1
      stats.invoiceDocsToCreate += 1
      console.log(
        `  ${subscriptionPath}/invoices/${doc.invoiceId}: CREATE ` +
          `${doc.billingReason || 'unknown-reason'} ${dollars(doc.paidCents)} ` +
          `paid ${new Date(doc.paidAtMs).toISOString().slice(0, 10)}`,
      )
      operations.push({
        type: 'create',
        path: `${subscriptionPath}/invoices/${doc.invoiceId}`,
        data: doc,
      })
    }
    // Ledger docs Stripe no longer reports (should not happen) stay put —
    // the roll-up still counts them.
    for (const [id, doc] of existingById) {
      if (!paidInvoices.some((invoice) => String(invoice.id) === id)) {
        fullSet.push(doc)
        notes.push(
          `${subscriptionPath}/invoices/${id}: exists in Firestore but not in ` +
            `Stripe's paid list — kept, counted, flagged`,
        )
      }
    }

    const rollup = subscriptionRollup(fullSet)
    if (!rollup) {
      if (!createdHere) stats.upToDate += 1
      continue
    }
    const changedKeys = ROLLUP_KEYS.filter(
      (key) =>
        rollup[key] !== undefined &&
        (key === 'lastInvoiceId'
          ? subscription[key] !== rollup[key]
          : num(subscription[key]) !== num(rollup[key])),
    )
    const replaceTotals =
      rollup.totals &&
      num(subscription.totals?.totalCents) !== num(rollup.totals.totalCents)
    if (!changedKeys.length && !replaceTotals) {
      if (!createdHere) stats.upToDate += 1
      continue
    }
    stats.rollupsToUpdate += 1
    const data = { 'backfills.agl1752AtMs': Date.now() }
    for (const key of changedKeys) data[key] = rollup[key]
    if (replaceTotals) {
      data.totals = rollup.totals
      if (rollup.interval) data.interval = rollup.interval
    }
    console.log(
      `  ${subscriptionPath}: UPDATE roll-up ` +
        changedKeys
          .map((key) => `${key} ${subscription[key] ?? '∅'} -> ${rollup[key]}`)
          .join(', ') +
        (replaceTotals
          ? `, totals.totalCents ${subscription.totals?.totalCents ?? '∅'} -> ${rollup.totals.totalCents}`
          : ''),
    )
    operations.push({ type: 'update', path: subscriptionPath, data })
  }
}

console.log('')
console.log(`hosts scanned              ${stats.hosts}`)
console.log(`subscriptions scanned      ${stats.subscriptions}`)
console.log(`paid invoices on Stripe    ${stats.stripeInvoices}`)
console.log(`invoice docs already there ${stats.invoiceDocsExisting}`)
console.log(`invoice docs to CREATE     ${stats.invoiceDocsToCreate}`)
console.log(`roll-ups to UPDATE         ${stats.rollupsToUpdate}`)
console.log(`already up to date         ${stats.upToDate}`)
console.log(`test-mode subs excluded    ${stats.testModeSubscriptions}`)
console.log(`unknown to Stripe (live)   ${stats.notOnStripe}`)
for (const note of notes) console.log(`note: ${note}`)

if (args.apply) {
  const applied = await applyPlan(db, operations)
  console.log(`APPLIED ${applied} write(s)`)
} else {
  console.log(
    `DRY RUN complete — ${operations.length} write(s) planned, nothing written`,
  )
}
process.exit(0)
