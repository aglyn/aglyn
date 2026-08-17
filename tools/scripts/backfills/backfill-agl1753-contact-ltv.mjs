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

// AGL-1753: contacts written before AGL-1748/1755 understate ltvCents (POS,
// draft, reservation and booking money never counted) and some buyers have
// no contact row at all. The rebuild SETS the RFM fields from the source
// documents — orders ∪ subscriptions ∪ their invoices ∪ reservations
// (paidCents ONLY, never totalCents) ∪ bookings — so a re-run can never
// compound the `FieldValue.increment` error it is fixing.
//
//   node tools/scripts/backfills/backfill-agl1753-contact-ltv.mjs \
//     [--host <hostId>] [--create-missing] [--apply --yes-i-mean-production]
//
// Env: FIREBASE_* (admin). NO Stripe access — every figure survives on our
// own documents (the issue's table), which is the point of the sources.
//
// Contacts are ORG-scoped (`orgs/{orgId}/contacts`, AGL-237) and keyed by
// NORMALIZED email; orders store the raw one, so both sides normalize here.
//
// What CANNOT be reconstructed is reported, never silently skipped:
//  - anonymous money (no usable email on the source doc — POS cash, and
//    pre-AGL-1755 reservations whose session email was never stored);
//  - buyers with no contact row: CREATING one is band-gated on the live
//    path (`checkContactQuota`), and whether historical restoration is
//    exempt from the audience band is Zach's call — so creation only
//    happens under the separate `--create-missing` flag, and the dry run
//    prints the org's plan beside the would-create count;
//  - subscriptions with no recorded opening amount (run AGL-1745 first);
//  - refunds ride BESIDE gross ltvCents (the shipped AGL-1754 shape),
//    never netted out of it.
//
// Sequencing: run AGL-1745 and AGL-1752 applies before this one — the
// subscription totals and invoice ledger are two of its sources.

import {
  aggregateContactPurchases,
  applyPlan,
  normalizeContactEmail,
  num,
  planContactUpdate,
} from './lib/backfill-core.mjs'
import {
  announceMode,
  dollars,
  initFirestoreAdmin,
  parseBackfillArgs,
} from './lib/backfill-io.mjs'

const args = parseBackfillArgs()
const { db, projectId } = initFirestoreAdmin()
announceMode('backfill-agl1753-contact-ltv', args, projectId)

const toMs = (value) =>
  value?.toMillis?.() ?? (typeof value === 'number' ? value : null)

// --- Group hosts by org via the hostIndex mirror ---------------------------
const hostIndex = await db.collection('hostIndex').get()
const hostsByOrg = new Map()
for (const doc of hostIndex.docs) {
  const orgId = doc.get('orgId')
  if (typeof orgId !== 'string' || !orgId) continue
  if (args.hostFilter && doc.id !== args.hostFilter) continue
  const list = hostsByOrg.get(orgId) ?? []
  list.push(doc.id)
  hostsByOrg.set(orgId, list)
}

const stats = {
  orgs: hostsByOrg.size,
  hosts: 0,
  buyers: 0,
  contactsMatched: 0,
  contactsToUpdate: 0,
  contactsUpToDate: 0,
  contactsMissing: 0,
  duplicateEmailContacts: 0,
}
const operations = []
const cannotReconstruct = []

for (const [orgId, hostIds] of hostsByOrg) {
  const orgSnapshot = await db.collection('orgs').doc(orgId).get()
  const plan = String(orgSnapshot.get('plan') ?? 'free')
  console.log(`org ${orgId} (plan: ${plan}) — hosts: ${hostIds.join(', ')}`)

  const orders = []
  const subscriptions = []
  const reservations = []
  const bookings = []
  const namesByEmail = new Map()
  const rememberName = (emailRaw, name) => {
    const email = normalizeContactEmail(emailRaw)
    if (email && name && !namesByEmail.has(email)) {
      namesByEmail.set(email, String(name).slice(0, 120))
    }
  }

  for (const hostId of hostIds) {
    stats.hosts += 1
    const hostRef = db.collection('hosts').doc(hostId)
    for (const doc of (await hostRef.collection('orders').get()).docs) {
      const data = doc.data()
      rememberName(data.customerEmail, data.customerName)
      orders.push({
        id: doc.id,
        hostId,
        status: String(data.status ?? 'paid'),
        email: data.customerEmail,
        totalCents: num(data.totals?.totalCents ?? data.amountCents),
        refundedCents: num(data.refundedCents),
        atMs: num(data.createdAtMs) || toMs(data.createdAt),
        channel: data.channel ?? 'online',
      })
    }
    for (const doc of (await hostRef.collection('subscriptions').get()).docs) {
      const data = doc.data()
      rememberName(data.customerEmail, data.customerName)
      const invoices = (await doc.ref.collection('invoices').get()).docs.map(
        (invoiceDoc) => {
          const invoice = invoiceDoc.data()
          return {
            billingReason: String(invoice.billingReason ?? ''),
            paidCents: num(invoice.paidCents),
            atMs: num(invoice.paidAtMs) || null,
            email: invoice.customerEmail ?? data.customerEmail,
          }
        },
      )
      subscriptions.push({
        id: doc.id,
        hostId,
        email: data.customerEmail,
        // null = predates AGL-1732 and AGL-1745 has not run — reported.
        openingCents: data.totals ? num(data.totals.totalCents) : null,
        atMs: num(data.createdAtMs) || null,
        invoices,
      })
    }
    for (const doc of (await hostRef.collection('reservations').get()).docs) {
      const data = doc.data()
      rememberName(data.guestEmail, data.guestName)
      reservations.push({
        id: doc.id,
        hostId,
        email: data.guestEmail,
        // paidCents ONLY: the folio and stay balance settle as their own
        // POS orders (already in the orders pass); totalCents would
        // double-count them (AGL-1755's finding).
        paidCents: num(data.paidCents),
        atMs: num(data.createdAtMs) || null,
        status: String(data.status ?? ''),
      })
    }
    for (const doc of (await hostRef.collection('bookings').get()).docs) {
      const data = doc.data()
      rememberName(data.email, data.name)
      bookings.push({
        id: doc.id,
        hostId,
        email: data.email,
        paidCents: num(data.paidAmountCents),
        atMs: num(data.paidAtMs) || num(data.createdAtMs) || toMs(data.createdAt),
        name: data.name,
      })
    }
  }

  const { byEmail, anonymousMoney, cancelledOrders, unknownOpenings } =
    aggregateContactPurchases({ orders, subscriptions, reservations, bookings })
  stats.buyers += byEmail.size

  const contactDocs = await db
    .collection('orgs')
    .doc(orgId)
    .collection('contacts')
    .get()
  const contactsByEmail = new Map()
  const duplicates = new Set()
  for (const doc of contactDocs.docs) {
    const email = normalizeContactEmail(doc.get('email'))
    if (!email) continue
    if (contactsByEmail.has(email)) duplicates.add(email)
    else contactsByEmail.set(email, doc)
  }

  const wouldCreate = []
  for (const [email, aggregate] of byEmail) {
    if (duplicates.has(email)) {
      stats.duplicateEmailContacts += 1
      cannotReconstruct.push(
        `org ${orgId}: MULTIPLE contacts share ${email} — skipped, dedupe first`,
      )
      continue
    }
    const contactDoc = contactsByEmail.get(email)
    if (!contactDoc) {
      stats.contactsMissing += 1
      wouldCreate.push({ email, aggregate })
      continue
    }
    stats.contactsMatched += 1
    const update = planContactUpdate(contactDoc.data(), aggregate, Date.now())
    if (!update) {
      stats.contactsUpToDate += 1
      continue
    }
    stats.contactsToUpdate += 1
    const changedDetail = Object.entries(update)
      .filter(([key]) => !key.startsWith('backfills.'))
      .filter(([key, value]) => num(contactDoc.get(key)) !== num(value))
      .map(([key, value]) => `${key} ${contactDoc.get(key) ?? '∅'} -> ${value}`)
      .join(', ')
    console.log(
      `  UPDATE ${email} (ltv ${dollars(aggregate.ltvCents)}, ` +
        `${aggregate.ordersCount} purchase(s)): ${changedDetail}`,
    )
    operations.push({
      type: 'update',
      path: `orgs/${orgId}/contacts/${contactDoc.id}`,
      data: update,
    })
  }

  for (const { email, aggregate } of wouldCreate) {
    const eventSources = new Set(
      aggregate.events.map((event) =>
        event.kind === 'reservation' || event.kind === 'booking'
          ? 'booking'
          : 'order',
      ),
    )
    console.log(
      `  MISSING contact ${email}: ${dollars(aggregate.ltvCents)} across ` +
        `${aggregate.ordersCount} purchase(s) — ` +
        (args.createMissing
          ? 'WOULD CREATE (--create-missing)'
          : `creation withheld (band-gated on the live path; org plan "${plan}"; ` +
            `pass --create-missing to include)`),
    )
    if (!args.createMissing) continue
    const firstHostEvent = aggregate.events[0]
    const hostId =
      orders.find((order) => order.id === firstHostEvent?.refId)?.hostId ??
      hostIds[0]
    const contactId = db.collection('orgs').doc(orgId).collection('contacts')
      .doc().id
    operations.push({
      type: 'create',
      path: `orgs/${orgId}/contacts/${contactId}`,
      data: {
        hostId,
        visibleTo: ['org'],
        email,
        ...(namesByEmail.get(email) ? { name: namesByEmail.get(email) } : {}),
        sources: Object.fromEntries(
          [...eventSources].map((source) => [source, true]),
        ),
        interactions: aggregate.events
          .sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0))
          .slice(0, 50)
          .map((event) => ({
            type:
              event.kind === 'reservation' || event.kind === 'booking'
                ? 'booking'
                : 'order',
            refId: event.refId,
            atMs: event.atMs ?? Date.now(),
            summary: `Backfilled ${event.kind} (${dollars(event.cents)})`,
          })),
        tags: [],
        ltvCents: aggregate.ltvCents,
        ordersCount: aggregate.ordersCount,
        firstPurchaseAtMs: aggregate.firstPurchaseAtMs,
        lastPurchaseAtMs: aggregate.lastPurchaseAtMs,
        ...(aggregate.refundedCents > 0
          ? {
              refundedCents: aggregate.refundedCents,
              refundedOrdersCount: aggregate.refundedOrdersCount,
              lastRefundAtMs: aggregate.lastRefundAtMs,
            }
          : {}),
        createdAt: new Date(),
        updatedAt: new Date(),
        backfills: { agl1753AtMs: Date.now() },
      },
    })
  }

  for (const item of anonymousMoney) {
    cannotReconstruct.push(
      `org ${orgId}: ${item.kind} ${item.refId} carries ${dollars(item.cents)} ` +
        `with NO usable email — unattributable, no contact can ever hold it`,
    )
  }
  for (const id of unknownOpenings) {
    cannotReconstruct.push(
      `org ${orgId}: subscription ${id} has no recorded opening amount — ` +
        `run backfill-agl1745 first, then re-run this pass`,
    )
  }
  for (const order of cancelledOrders) {
    cannotReconstruct.push(
      `org ${orgId}: cancelled order ${order.id} carried ${dollars(order.totalCents)} ` +
        `— excluded from LTV (policy: cancelled ≠ kept revenue)`,
    )
  }
}

console.log('')
console.log(`orgs scanned                 ${stats.orgs}`)
console.log(`hosts scanned                ${stats.hosts}`)
console.log(`distinct buyers (by email)   ${stats.buyers}`)
console.log(`contacts matched             ${stats.contactsMatched}`)
console.log(`contacts already correct     ${stats.contactsUpToDate}`)
console.log(`contacts WOULD update        ${stats.contactsToUpdate}`)
console.log(`buyers with NO contact row   ${stats.contactsMissing}`)
console.log(`duplicate-email contacts     ${stats.duplicateEmailContacts}`)
if (cannotReconstruct.length) {
  console.log('CANNOT RECONSTRUCT (reported, not skipped):')
  for (const line of cannotReconstruct) console.log(`  ${line}`)
} else {
  console.log('CANNOT RECONSTRUCT: nothing — every source doc carried an email')
}

if (args.apply) {
  const applied = await applyPlan(db, operations)
  console.log(`APPLIED ${applied} write(s)`)
} else {
  console.log(
    `DRY RUN complete — ${operations.length} write(s) planned, nothing written`,
  )
}
process.exit(0)
