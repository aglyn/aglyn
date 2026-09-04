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

import { FieldValue } from 'firebase-admin/firestore'
import {
  EMAIL_ATTRIBUTION_MODEL,
  EMAIL_ATTRIBUTION_WINDOW_DAYS,
  EMAIL_ATTRIBUTION_WINDOW_MS,
  emailTouchIsInWindow,
} from '@aglyn/shared-util-email'
import { readEmailCampaignTouch } from './email-delivery-log'
import { isDocumentId } from './document-id'
import firebaseAdmin from './firebase-admin'

const defaultFirestore = () => firebaseAdmin.app().firestore()

/**
 * THE COMMERCE↔EMAIL JOIN — an order, credited to the campaign that led to it.
 *
 * ## Why this is a join
 *
 * Every compared ESP attributes revenue through an integration into a store
 * it does not own: a catalog sync, an on-site tracking snippet, an identity
 * graph, and a window wide enough to absorb what the reconciliation misses.
 * Commerce here is first-party and runs on the merchant's own Stripe Connect
 * account, so the click and the order are two rows in one database keyed the
 * same way. The window is not a fudge factor here — it is the model, and
 * nothing else about the number is estimated.
 *
 * ## Three writes, and what each one is for
 *
 *  - **The touch**, `emailDeliveries/{personKey}.campaignTouches[hostId]`,
 *    written by the delivery webhook on a click. Owned by
 *    `email-delivery-log.ts`, because it lives on the person's document and
 *    the erasure path has to be able to remove it.
 *  - **The attribution record**, `hosts/{hostId}/emailAttributions/{orderId}`,
 *    written here when an order is credited. It is the audit trail — which
 *    campaign, which click, which model, which window — and it is what the
 *    refund path reads to find out which campaign to take the money back off.
 *  - **The rollup**, `campaigns/{campaignId}/reports/revenue`, incremented
 *    here. One document per campaign, so the report reads it whole.
 *
 * ## Why the record is a document and not a field on the order
 *
 * Three reasons, and the first is decisive. `create()` fails when the
 * document already exists, which is exact idempotency for free: webhook
 * delivery is at-least-once, and a redelivered purchase must not be able to
 * credit a campaign twice. Second, not every purchase door writes an order —
 * a booking is a sale with no order document — and a field would have had to
 * either skip those or conjure the document, and conjuring is the
 * phantom-document shape this codebase spent a sweep removing. Third, the
 * order document is read by the console list, the fulfilment path, the
 * supplier outbox and the CSV export, and none of them wants a field about
 * email.
 *
 * ## Never throws
 *
 * Same contract as `upsertHostContact`, which calls it, and for the same
 * reason: the money has already moved and the order already records it, so
 * nothing here may fail a sale. A lost attribution understates a campaign; a
 * thrown one loses a checkout.
 */

/** The per-host collection of attribution records. */
export const EMAIL_ATTRIBUTIONS_COLLECTION = 'emailAttributions'

/** The single rollup document under a campaign. */
export const CAMPAIGN_REVENUE_REPORT_DOC = 'revenue'

/**
 * The currency an amount is recorded under when the caller does not say.
 *
 * Every checkout door in this repo — cart, buy-now, POS, draft orders,
 * reservations, subscriptions — writes `currency: 'usd'` onto the Stripe line
 * items, and no order document carries a currency field to read back. So this
 * is a statement about what the code charges rather than a guess about the
 * money. The parameter exists so a door that ever charges in something else
 * says so and lands in its own bucket, because the one thing the report may
 * never do is add two currencies together.
 */
export const DEFAULT_ATTRIBUTION_CURRENCY = 'usd'

/** What one attribution record holds. */
export interface EmailAttributionRecord {
  campaignId: string
  /** When the credited click happened. */
  clickedAtMs: number
  /** When the order was placed. */
  orderedAtMs: number
  /** Minor units credited, gross — the amount the buyer was charged. */
  amountCents: number
  /** Lowercase currency code the amount is in. */
  currency: string
  /** The model this credit was decided under. */
  model: string
  /** The window, in days, it was decided inside. */
  windowDays: number
}

/** Normalizes a currency code to the key its bucket is stored under. */
function currencyKey(raw: unknown): string {
  const code = String(raw ?? '')
    .trim()
    .toLowerCase()
  // Letters only: the code becomes a MAP KEY, and a key carrying a dot would
  // be unreachable by any dotted field path a later reader wants to use.
  return /^[a-z]{3}$/.test(code) ? code : DEFAULT_ATTRIBUTION_CURRENCY
}

/** A positive integer number of minor units, or 0. */
function minorUnits(raw: unknown): number {
  const value = Math.round(Number(raw))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Credits one order to the campaign whose link the buyer last clicked.
 *
 * ## What happens when there is nobody to credit
 *
 * Each case answers `null` and writes NOTHING, which is the whole design:
 *
 *  - **No email on the order.** A guest checkout that never identified its
 *    buyer cannot be joined to anybody's clicks. There is no fallback and
 *    there deliberately is not one — the alternatives are an IP or a device
 *    guess, which is the probabilistic attribution owning the checkout exists
 *    to avoid.
 *  - **A guest with an email but no contact record.** This is ATTRIBUTED
 *    normally. The join keys on the address hash, exactly as the touch and
 *    the suppression list do, so it never asks whether a contact document
 *    exists — which matters, because contact creation is audience-band gated
 *    and a Free org's dropped contact would otherwise silently drop the
 *    revenue with it.
 *  - **No touch, or a touch on another site.** Nobody clicked, so nobody is
 *    credited. The touch map is keyed by host and the send path refuses
 *    cross-site reach; the revenue join agrees with it.
 *  - **A touch outside the window**, in either direction. See
 *    {@link emailTouchIsInWindow} — a click AFTER the order is the receipt,
 *    not the cause.
 *
 * None of these is counted anywhere. A miss costs no write, which is what
 * keeps the ordinary order — placed by somebody who is not on the mailing
 * list at all — at exactly one document read. What it means for the report is
 * stated on the report: the figure counts orders it could join, and is a
 * floor.
 *
 * @returns the record written, or `null` when nothing was credited.
 */
export async function attributeOrderToEmail(
  options: {
    hostId: string
    /** The order, booking or invoice the money came in on. */
    orderId: string
    /** The buyer as the sale recorded them, raw — normalized downstream. */
    email: unknown
    /** Gross minor units the buyer was charged. */
    amountCents: number
    /** Lowercase currency code, when the door knows one. */
    currency?: string
    /** When the order was placed. Defaults to now. */
    orderedAtMs?: number
  },
  firestore?: any,
): Promise<EmailAttributionRecord | null> {
  try {
    const hostId = String(options.hostId ?? '')
    const orderId = String(options.orderId ?? '')
    const amountCents = minorUnits(options.amountCents)
    if (!isDocumentId(hostId) || !isDocumentId(orderId)) return null
    if (!amountCents) return null

    const orderedAtMs = Number(options.orderedAtMs ?? Date.now())
    const db = firestore ?? defaultFirestore()

    /*
     * `String()` on an `unknown`, then let `emailSuppressionKey` decide.
     *
     * The buyer's address arrives as the ORDER recorded it, which is not
     * consistently a string — the same rawness `recordContactRefund` takes
     * `email: unknown` for. The key derivation is the one place that knows
     * how an address becomes a document id, so nothing here tries to
     * pre-clean it; a value that is not an address answers `null` there and
     * the order is credited to nobody.
     */
    const rawEmail =
      typeof options.email === 'string' ? options.email : String(options.email ?? '')
    const touch = await readEmailCampaignTouch(rawEmail, hostId, db)
    if (!touch) return null
    if (!isDocumentId(touch.campaignId)) return null
    if (!emailTouchIsInWindow(touch.clickedAtMs, orderedAtMs)) return null

    const record: EmailAttributionRecord = {
      campaignId: touch.campaignId,
      clickedAtMs: touch.clickedAtMs,
      orderedAtMs,
      amountCents,
      currency: currencyKey(options.currency),
      model: EMAIL_ATTRIBUTION_MODEL,
      windowDays: EMAIL_ATTRIBUTION_WINDOW_DAYS,
    }

    const hostRef = db.collection('hosts').doc(hostId)
    /*
     * `create()`, never `set()`. It fails with ALREADY_EXISTS when this order
     * has been credited before, and that failure is the idempotency: a
     * webhook redelivery, a retried checkout completion and a replayed event
     * all land here a second time, and all three must leave the rollup where
     * they found it. The increment below is reached only when the create
     * succeeded, so the two can never disagree about whether this order was
     * counted.
     */
    try {
      await hostRef
        .collection(EMAIL_ATTRIBUTIONS_COLLECTION)
        .doc(orderId)
        .create({ ...record, createdAt: FieldValue.serverTimestamp() })
    } catch {
      return null
    }

    /*
     * A merge-set that CREATES, unlike the campaign counters the delivery
     * webhook writes through `updateExisting`.
     *
     * The distinction is which document is being conjured. Those counters
     * refuse to create because a merge-set against a DELETED CAMPAIGN
     * resurrects the campaign itself, as a husk holding a stats map and no
     * subject. This writes a subcollection document UNDER a campaign, so a
     * campaign that no longer exists gains an orphaned report rather than
     * coming back to life in the merchant's history — and the campaign was
     * proven to exist a moment ago, when its click wrote the touch.
     *
     * Every amount is an increment, so two orders settling at once both land.
     */
    const currency = record.currency
    await hostRef
      .collection('campaigns')
      .doc(touch.campaignId)
      .collection('reports')
      .doc(CAMPAIGN_REVENUE_REPORT_DOC)
      .set(
        {
          model: EMAIL_ATTRIBUTION_MODEL,
          windowDays: EMAIL_ATTRIBUTION_WINDOW_DAYS,
          byCurrency: {
            [currency]: {
              grossCents: FieldValue.increment(amountCents),
              orders: FieldValue.increment(1),
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

    return record
  } catch (error) {
    console.error('attributeOrderToEmail failed', error)
    return null
  }
}

/**
 * Takes back revenue a campaign was credited with, when it is refunded.
 *
 * ## Recorded beside the gross, never subtracted from it
 *
 * `grossCents` is left exactly as it is and the reversal lands in
 * `refundedCents` next to it. This is the shape `contact-refund.ts` chose for
 * `ltvCents`/`refundedCents` and the orders CSV chose for
 * `amountUsd`/`refundedUsd`, and it is chosen a third time here so all three
 * answer "what did this earn, net" identically. Decrementing would make a
 * stored number mean one thing for rollups written before a refund and
 * another after, with nothing on the document to tell them apart — and would
 * put the question "can it go negative" onto storage, where the answer cannot
 * be clamped without destroying evidence. Both stored figures are monotonic
 * counters of money that really moved in one direction; the derived net is
 * clamped at the point of display and nowhere else.
 *
 * ## The currency comes from the RECORD, not from the caller
 *
 * A refund reverses a specific sale, and the bucket it comes out of has to be
 * the bucket it went into. Reading the currency back off the attribution
 * record is what guarantees that, and it is the second thing the record is
 * for.
 *
 * ## Chargebacks come through here too
 *
 * Money reversed is money reversed, whichever door it left by, so a lost
 * dispute reverses the credit the same way a refund does. `kind` exists for
 * the caller's clarity and changes nothing about the arithmetic — the same
 * choice `recordContactRefund` made one field along.
 *
 * @returns whether a reversal was recorded.
 */
export async function reverseEmailAttributedRevenue(
  options: {
    hostId: string
    orderId: string
    /** Minor units reversed by THIS attempt, never the order total. */
    amountCents: number
    /** True only for the write that moved the order into `refunded`. */
    closedTheOrder: boolean
    kind?: 'refund' | 'chargeback'
  },
  firestore?: any,
): Promise<boolean> {
  try {
    const hostId = String(options.hostId ?? '')
    const orderId = String(options.orderId ?? '')
    const amountCents = minorUnits(options.amountCents)
    if (!isDocumentId(hostId) || !isDocumentId(orderId)) return false
    if (!amountCents) return false

    const db = firestore ?? defaultFirestore()
    const hostRef = db.collection('hosts').doc(hostId)
    const snapshot = await hostRef
      .collection(EMAIL_ATTRIBUTIONS_COLLECTION)
      .doc(orderId)
      .get()
    // The ordinary case, and not an error: most orders were never credited to
    // a campaign, so most refunds have nothing to reverse.
    if (!snapshot.exists) return false

    const record = snapshot.data() ?? {}
    const campaignId = String(record.campaignId ?? '')
    if (!isDocumentId(campaignId)) return false
    const currency = currencyKey(record.currency)

    /*
     * NOT capped against what was credited, and that is deliberate. The
     * caller already caps each attempt against what is left on the ORDER, so
     * several partials sum to at most the order total; capping again here
     * against the attributed amount would silently discard the reversal of an
     * order refunded for more than the amount the campaign was credited with
     * — which happens when the credit was the charge and the refund includes
     * something the credit did not. The stored pair keeps both true figures
     * and the reader clamps the net it prints.
     */
    await hostRef
      .collection('campaigns')
      .doc(campaignId)
      .collection('reports')
      .doc(CAMPAIGN_REVENUE_REPORT_DOC)
      .set(
        {
          byCurrency: {
            [currency]: {
              refundedCents: FieldValue.increment(amountCents),
              ...(options.closedTheOrder
                ? { refundedOrders: FieldValue.increment(1) }
                : {}),
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

    /*
     * Stamped on the record as well as counted in the rollup. The rollup is a
     * sum and cannot say WHICH orders came back; this is the per-order half
     * of the same fact, and it is what a merchant asking "why did this
     * campaign's revenue drop" is eventually going to need. Increments, so
     * two partials on one order both land.
     */
    await snapshot.ref
      .set(
        {
          refundedCents: FieldValue.increment(amountCents),
          lastRefundAtMs: Date.now(),
          ...(options.kind === 'chargeback' ? { chargedBack: true } : {}),
          ...(options.closedTheOrder ? { fullyRefunded: true } : {}),
        },
        { merge: true },
      )
      .catch(() => undefined)

    return true
  } catch (error) {
    console.error('reverseEmailAttributedRevenue failed', error)
    return false
  }
}

/** The window, re-exported so a caller needs one import for the whole join. */
export { EMAIL_ATTRIBUTION_WINDOW_MS }
