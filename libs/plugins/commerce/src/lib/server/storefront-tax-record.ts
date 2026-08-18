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

import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { storefrontTaxRow, type StorefrontTaxRow } from './storefront-tax'

/**
 * Writes `storefrontTaxCollected/{stripeId}` for every storefront sale that
 * carried tax (AGL-1904) — the row that makes tax collected under Aglyn's
 * registration visible to Aglyn's own quarterly return.
 *
 * ## The hole this closes
 *
 * AGL-1811 records one `platformRevenue` row per paid invoice and the Texas
 * return is their sum. That collection is deliberately scoped to AGLYN's own
 * charges: the console webhook only writes a row when the invoice's customer
 * resolves through the `stripeCustomers` index, which `writeOrgBilling` stamps
 * for Aglyn's billing customers and nothing else stamps. A storefront
 * shopper's customer is never in it.
 *
 * That scoping is correct for what it was built for and it left a gap: a
 * `mode: 'stripe'` storefront sale charges the shopper tax computed on
 * AGLYN's registrations (measured — see `storefront-tax.ts`), settles it into
 * Aglyn's platform balance, and NOTHING recorded it anywhere Aglyn's return
 * could see. The merchant's order document carries a `totals.taxCents`, but
 * that is the merchant's books, per host, and no return sums it.
 *
 * ## Why a SEPARATE collection rather than more `platformRevenue` rows
 *
 * Structural, and the reason must survive a future tidy-up: a
 * `platformRevenue` row's `netCents` is Aglyn's revenue, and a storefront
 * row's is mostly the MERCHANT's — it transfers straight out to the connected
 * account. Merging the two would make the return's "total sales" figure silently
 * include other companies' receipts. Keeping them in different collections
 * means no query, sum or future refactor can accidentally add them together;
 * the return reports the storefront figures as their own section, and what
 * belongs on which line of a filed return stays a question for the preparer
 * and for counsel rather than one this code answers.
 *
 * ## What is recorded, and what is not
 *
 * Recorded: cart, buy-now, reservation and draft-order sessions, plus every
 * storefront subscription INVOICE (opening cycle and renewals both — the
 * subscription's own `checkout.session.completed` is deliberately skipped so
 * the opening cycle is not counted twice, the same rule AGL-1811 applies).
 *
 * Manual-mode sales are recorded too, with `taxMode: 'manual'`, precisely so
 * the two modes can be told apart at read time instead of being invisible.
 * They are NOT Aglyn-collected and the return never sums them into the
 * Aglyn-liable figure.
 *
 * **Refunds are not yet reflected.** A refunded storefront sale keeps its full
 * tax on this record, so the Aglyn-liable figure is an OVER-statement of what
 * is owed rather than an under-statement. That direction is deliberate:
 * over-stating what is held for the state is correctable at filing time,
 * under-stating it is a shortfall discovered by an auditor. Stated here rather
 * than left to be discovered.
 *
 * Never throws. A recording failure logs and returns — a throw here propagates
 * through `runBillingWebhookHandlers` into a 500 that Stripe redelivers
 * forever, which is the AGL-1743 lesson.
 */

/** The commerce session types that settle money on the platform account. */
const SESSION_TYPES = new Set([
  'commerce-cart',
  'commerce-order',
  'commerce-reservation',
  'commerce-draft',
  // A paid service booking (AGL-2000). It carries no tax by a stated
  // decision (`bookings/server.ts`), but it is a storefront sale and it was
  // absent from this set entirely — so it was not merely untaxed, it did not
  // appear in the record that would let anyone NOTICE it was untaxed or
  // reconcile it later. An untaxed sale that is recorded reads
  // `taxMode: 'none'`; an unrecorded one reads as nothing at all.
  'booking-payment',
])

/**
 * Session types whose zero tax is a decision taken HERE, not by the merchant
 * (AGL-2000). Their rows are filed even at `taxMode: 'none'`, so an untaxed
 * service or stay is reconcilable instead of merely missing. See the note at
 * the `taxMode === 'none'` gate below.
 */
const PLATFORM_UNTAXED_TYPES = new Set(['booking-payment', 'commerce-reservation'])

function stripeKey(): string {
  return String(process.env.STRIPE_SECRET_KEY ?? '')
}

/**
 * A Checkout Session's tax BREAKDOWN, which the webhook payload does not
 * carry: `total_details.breakdown` is an expandable field, so the delivered
 * object states `amount_tax` and nothing about the base it was applied to.
 *
 * Returns the expanded session, or null when the read cannot be made. Null is
 * not a failure that stops the recording — the row is written from the
 * delivered object with `taxLines: []`, and a taxed row with no stated base is
 * COUNTED in the return's `attention` rather than dropped or zeroed.
 */
async function expandedSession(sessionId: string): Promise<any | null> {
  const key = stripeKey()
  if (!key || !sessionId) return null
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        sessionId,
      )}?expand[]=total_details.breakdown`,
      { headers: { Authorization: `Bearer ${key}` } },
    )
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    return body?.id ? body : null
  } catch {
    return null
  }
}

/** The host this Stripe object belongs to, from whichever metadata bag. */
function hostIdOf(object: any): string {
  return String(
    object?.metadata?.hostId ??
      object?.subscription_details?.metadata?.hostId ??
      object?.parent?.subscription_details?.metadata?.hostId ??
      '',
  )
}

function metadataTypeOf(object: any): string {
  return String(
    object?.metadata?.type ??
      object?.subscription_details?.metadata?.type ??
      object?.parent?.subscription_details?.metadata?.type ??
      '',
  )
}

/**
 * Records one storefront sale's tax, or does nothing when this event is not
 * one. Returns the row written, for the specs — never for control flow.
 */
export async function recordStorefrontTax(
  type: string,
  object: any,
): Promise<StorefrontTaxRow | null> {
  try {
    const metadataType = metadataTypeOf(object)
    const hostId = hostIdOf(object)
    if (!hostId) return null

    let kind: 'session' | 'invoice'
    let taxSource = object
    let manualTaxCents = 0
    if (
      type === 'checkout.session.completed' &&
      SESSION_TYPES.has(metadataType) &&
      object?.payment_status === 'paid'
    ) {
      kind = 'session'
      // The manual tax rides as an ordinary `line_items[1]` Stripe is never
      // told is tax (AGL-1711), so the session's own metadata snapshot is the
      // only witness to it. A cart session carries no such line at all.
      manualTaxCents = Math.max(0, Number(object?.metadata?.taxCents ?? 0)) || 0
      // Expanded whenever Stripe COMPUTED tax on this session — which since
      // AGL-1953 includes a `manual`-mode cart or draft order, where the tax
      // rides a real Tax Rate and Stripe therefore states a `taxable_amount`
      // for it. Gated on the delivered `amount_tax` rather than done
      // unconditionally so the buy-now and POS constructions, which report 0
      // there and answer from metadata, still cost no extra Stripe read.
      const stripeStatedTax = Number(
        object?.total_details?.amount_tax ?? 0,
      )
      if (
        object?.automatic_tax?.enabled === true ||
        (Number.isFinite(stripeStatedTax) && stripeStatedTax > 0)
      ) {
        taxSource = (await expandedSession(String(object?.id ?? ''))) ?? object
      }
    } else if (
      (type === 'invoice.paid' || type === 'invoice.payment_succeeded') &&
      metadataType === 'commerce-subscription'
    ) {
      // Every cycle including the opening one. The subscription's own
      // `checkout.session.completed` is NOT a second source — recording both
      // would count the opening sale twice (AGL-1811's rule, same reason).
      kind = 'invoice'
    } else {
      return null
    }

    const row = storefrontTaxRow(taxSource, { kind, hostId, manualTaxCents })
    if (!row) return null
    // Nothing to file and nothing to explain: no tax computed, no tax charged.
    // A `stripe-automatic` row is kept even at zero tax — that a Stripe Tax
    // sale answered "not collecting" is itself the audit answer to why a
    // jurisdiction is absent from the return.
    //
    // EXCEPT where the absence is AGLYN'S decision rather than the merchant's
    // (AGL-2000). A zero-tax commerce sale means the merchant configured no
    // tax — their call, their liability, nothing here to explain. A booking or
    // a reservation is untaxed because THIS CODEBASE decided not to compute a
    // goods rate on a service or a room (`bookings/server.ts`, `reserve.ts`),
    // and that is exactly the kind of absence somebody has to be able to find
    // later: it is the platform answering a tax question on a merchant's
    // revenue. Dropping those rows made the decision invisible in the one
    // place anyone would go looking for it.
    if (row.taxMode === 'none' && !PLATFORM_UNTAXED_TYPES.has(metadataType)) {
      return null
    }

    const documentId = String(object?.id ?? '')
    if (!documentId) return null
    const orgId = (await getOrgForHost(hostId).catch(() => null))?.orgId ?? null
    await firebaseAdmin
      .app()
      .firestore()
      .collection('storefrontTaxCollected')
      .doc(documentId)
      .set(
        {
          ...row,
          orgId,
          recordedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        // Keyed by the Stripe object id and merged, so a redelivery — and the
        // `invoice.paid` / `invoice.payment_succeeded` pair Stripe sends for
        // ONE payment — restamps a single document instead of duplicating a
        // taxable sale.
        { merge: true },
      )
    return row
  } catch (error) {
    console.error('[AGL-1904] storefront tax recording failed', error)
    return null
  }
}
