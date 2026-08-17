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
  mergeContactInteraction,
  normalizeContactEmail,
  type ContactInteraction,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  orgDataCollectionForHost,
  scopedToHost,
} from '@aglyn/tenant-data-admin'
// Leaf import, not the barrel: `refund.spec.ts` and most specs in this
// library mock `@aglyn/tenant-data-admin` wholesale, and a permissive stub of
// this function would turn every case below green without a document ever
// having to exist.
import { updateExisting } from '@aglyn/tenant-data-admin/server/update-existing'

/**
 * Money going BACK to a customer, recorded on their contact (AGL-1754).
 *
 * `upsertHostContact` accumulates `ltvCents` and nothing anywhere decremented
 * it, so a customer who bought $500 and returned all of it read identically to
 * one who bought $500 and kept it — and the first surface built on the field
 * (RFM segmentation, a lifetime-value column, a best-customers list) would have
 * ranked a serial returner among the merchant's best customers.
 *
 * WHAT THIS WRITES, AND WHY IT IS NOT A DECREMENT
 *
 * `ltvCents` is left exactly as it is and the reversal is recorded BESIDE it:
 *
 * | field | meaning |
 * | -- | -- |
 * | `ltvCents` | gross money handed over, unchanged (AGL-1748) |
 * | `refundedCents` | gross money handed back |
 * | `ordersCount` | orders placed, unchanged |
 * | `refundedOrdersCount` | of those, how many ended fully reversed |
 * | `lastRefundAtMs` | when money last went back |
 *
 * This is the shape AGL-1747 chose two days earlier for the same question on
 * the orders CSV — `amountUsd` stayed gross under its existing name and
 * `refundedUsd`/`netUsd` were appended — and it is the shape AGL-1748 named
 * when it recorded the gross semantics in `upsert-contact.ts`. Netting in
 * place would make a stored number mean one thing for rows written before this
 * commit and another for rows written after, with nothing on the document to
 * tell the two apart. Two fields cost one number's worth of storage and keep
 * both facts, and a reader that wants the net has `ltvCents - refundedCents`.
 *
 * It also answers "can it go negative?" by moving the question off storage.
 * Both figures are monotonic counters of money that actually moved in one
 * direction, so neither can go negative. The DERIVED net can, for exactly one
 * reason: an order placed before AGL-1748 taught POS, drafts, reservations and
 * bookings to pass `purchaseCents` at all, whose sale was never added and whose
 * refund is subtracted here. That is a true statement about the data, and
 * clamping it away at write time would erase the only evidence that a purchase
 * is missing. AGL-1753 is the backfill that reconciles it, by SETTING both
 * fields from the orders — which already carry `refundedCents`, so whatever a
 * reader decides here costs the rebuild nothing. A merchant-facing reader
 * should show gross and refunded, and clamp only the net it ranks on.
 *
 * `ordersCount` is deliberately NOT decremented. A fully refunded order still
 * happened, and a decrement cannot be undone by a reader that would rather
 * count it — while `refundedOrdersCount` beside it lets RFM's frequency term
 * net the two, or not, at the point of display. Same argument as the amount,
 * one field along.
 *
 * WHEN THE CONTACT IS MISSING, THIS REFUSES — and records the refusal.
 *
 * Refusing is right on AGL-1732's test, "does refusing discard money or work
 * that already happened?", because it does not: the refund is durable on the
 * order (`refundedCents`, the timeline entry, Stripe), and the contact is a
 * derived aggregate that AGL-1753's rebuild reads back out of those same
 * orders. Creating one here would be worse three ways — creation is audience
 * BAND gated, so it hard-bands a Free org (raising the AGL-891 dropped-contacts
 * alert for a record the merchant never had) or meters onto a paid invoice; the
 * contact it created would hold a refund and no purchase, which is the negative
 * lifetime value above with nothing to reconcile it against; and it is the
 * phantom-document shape the `updateExisting` sweep spent yesterday closing.
 *
 * So the write is an `update()`, never `set(…, { merge: true })` — the contact
 * may have been deleted between the query and the write, and a merge-set would
 * resurrect it as a document holding nothing but a refund. Every refusal
 * increments `hosts/{hostId}/counters/contactRefundsUnmatched`, the counter
 * shape `contactsDropped` already uses, so a refund that reached no contact is
 * countable rather than silent.
 *
 * CHARGEBACKS (AGL-1554) are a separate decision and are NOT handled here.
 * This takes `kind` so the handler that eventually answers
 * `charge.dispute.closed` can record a lost dispute through the same writer
 * with the same fields: money reversed is money reversed, whichever door it
 * left by, and only the wording of the timeline entry differs.
 */
export async function recordContactRefund(options: {
  hostId: string
  /** The order the money went back on — the contact timeline's `refId`. */
  orderId: string
  /**
   * The buyer as the ORDER recorded them, raw. Normalized here, because that
   * is the key the contacts collection is stored under and orders are not
   * consistent about it (AGL-1753 item 3). No `name` rides along on purpose: a
   * refund is not a capture point and must not rewrite who the contact is.
   */
  email: unknown
  /**
   * Cents reversed by THIS attempt, never the order total. `refund.ts` caps
   * each attempt against what is left, so several partials on one order sum to
   * at most the order total; this follows that number rather than recomputing
   * it.
   */
  amountCents: number
  /**
   * True only for the write that moved the order INTO `refunded`. Two partials
   * settling concurrently can both observe a fully refunded total, so the
   * caller decides this from the status transition it made, not from the
   * total it read.
   */
  closedTheOrder: boolean
  kind?: 'refund' | 'chargeback'
}): Promise<void> {
  // Swallow-all, like `upsertHostContact`: the money has already moved and the
  // order already records it, so nothing here may fail the refund.
  try {
    const amountCents = Math.round(Number(options.amountCents))
    if (!(amountCents > 0)) return
    const email = normalizeContactEmail(options.email)
    if (!email) {
      await recordUnmatchedRefund(options.hostId, options.orderId, 'no-email')
      return
    }
    // Contacts are ORG-scoped (AGL-237), not `hosts/{h}/contacts`, and reads
    // narrow to what this host may see (AGL-1039) — the same pair
    // `upsertHostContact` uses, so both writers resolve the same document.
    const contactsRef = await orgDataCollectionForHost(
      options.hostId,
      'contacts',
    )
    const existing = await scopedToHost(contactsRef, options.hostId)
      .where('email', '==', email)
      .limit(1)
      .get()
    if (existing.empty) {
      await recordUnmatchedRefund(options.hostId, options.orderId, 'no-contact')
      return
    }

    const snapshot = existing.docs[0]
    const atMs = Date.now()
    const interaction: ContactInteraction = {
      // `refId` names an order, so the interaction is an order interaction.
      // There is no `'refund'` ContactSource and this deliberately does not
      // add one: `sources` records which capture silo produced the contact,
      // and a refund captures nobody.
      type: 'order',
      atMs,
      refId: options.orderId,
      summary:
        `$${(amountCents / 100).toFixed(2)} ` +
        (options.kind === 'chargeback' ? 'charged back' : 'refunded') +
        (options.closedTheOrder ? ' (full)' : ''),
    }
    // Reused for the newest-first ordering and the interactions cap; only the
    // timeline is taken. The `sources` half of the merge is discarded on
    // purpose, per the note above.
    const { interactions } = mergeContactInteraction(
      {
        sources: snapshot.get('sources') ?? {},
        interactions: snapshot.get('interactions') ?? [],
      },
      { source: 'order', interaction },
    )

    const FieldValue = firebaseAdmin.firestore.FieldValue
    // Every field is top-level. `update()` replaces a nested map wholesale
    // rather than merging into it, so anything under a map would have to be
    // written as a dotted path; there is nothing here that is.
    //
    // The amounts are increments, so two refunds settling at once both land.
    // `interactions` is a read-modify-write and therefore CAN lose one of two
    // concurrent entries — the same exposure `upsertHostContact` has on the
    // same array, and it costs a timeline line rather than a number.
    const landed = await updateExisting(snapshot.ref, {
      refundedCents: FieldValue.increment(amountCents),
      ...(options.closedTheOrder
        ? { refundedOrdersCount: FieldValue.increment(1) }
        : {}),
      lastRefundAtMs: atMs,
      interactions,
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (!landed) {
      await recordUnmatchedRefund(
        options.hostId,
        options.orderId,
        'contact-deleted',
      )
    }
  } catch (error) {
    console.error('recordContactRefund failed', error)
  }
}

/**
 * A refund that reached no contact, recorded rather than dropped (AGL-1754).
 *
 * The `set(…, { merge: true })` here IS meant to conjure the document — it is
 * a counter, and the shape is `counters/contactsDropped`'s, so an operator
 * reading a host's counters finds both kinds of missed contact record in one
 * place. The reason is stamped because the three cases want different answers:
 * `no-email` is an order that never identified its buyer, `no-contact` is the
 * AGL-1753 backfill's work, and `contact-deleted` is a contact removed between
 * the sale and the refund, which nothing should recreate.
 */
async function recordUnmatchedRefund(
  hostId: string,
  orderId: string,
  reason: 'no-email' | 'no-contact' | 'contact-deleted',
): Promise<void> {
  console.warn('refund reached no contact', { hostId, orderId, reason })
  const FieldValue = firebaseAdmin.firestore.FieldValue
  await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('counters')
    .doc('contactRefundsUnmatched')
    .set(
      {
        total: FieldValue.increment(1),
        lastOrderId: orderId,
        lastReason: reason,
        lastAtMs: Date.now(),
      },
      { merge: true },
    )
    .catch(() => undefined)
}
