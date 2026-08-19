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

// The two back-book verdicts, as PURE functions of already-fetched Stripe
// objects (AGL-2361, AGL-2323). All network access lives in
// `tools/scripts/audit-money-back-book.mjs`; everything that decides
// owed-or-not lives here, so the decision can be driven RED by a unit test
// instead of by a merchant noticing they were never paid.
//
// That split is the point. Both audits answer "how much money is owed", and
// "none" is the answer everyone wants to hear — so a filter that matches
// nothing reads as good news and is never questioned. An empty result set is
// identical whether the back book is clean or the query is broken. A verdict
// you cannot force to fail is not evidence.

/**
 * AGL-2361. A booking session is MISROUTED when the guest actually paid and
 * the resulting PaymentIntent carries no `transfer_data.destination` — i.e.
 * the whole charge stayed in Aglyn's platform balance.
 *
 * `misrouted: null` means the PaymentIntent could not be read, which is an
 * ANSWER OF "UNKNOWN", never an answer of "fine". It is counted separately.
 */
export function classifyBookingSession(session) {
  const md = session.metadata ?? {}
  if (md.type !== 'booking-payment') {
    return { relevant: false, reason: 'not-a-booking-payment' }
  }
  if (session.payment_status !== 'paid') {
    return {
      relevant: true,
      misrouted: false,
      reason: `payment_status=${session.payment_status}`,
    }
  }
  const pi =
    typeof session.payment_intent === 'object' ? session.payment_intent : null
  if (!pi) {
    return {
      relevant: true,
      misrouted: null,
      reason: 'payment_intent not expanded (indeterminate)',
    }
  }
  const destination = pi.transfer_data?.destination ?? null
  if (destination) {
    return {
      relevant: true,
      misrouted: false,
      reason: `transfer_data.destination=${destination}`,
    }
  }
  return {
    relevant: true,
    misrouted: true,
    reason: 'no transfer_data.destination — settled 100% to the platform',
  }
}

/**
 * Statuses in which a subscription will bill again. Anything else has stopped
 * charging, so it cannot ADD to the under-collection from here.
 *
 * `past_due` and `unpaid` are deliberately included: the schedule is still
 * live and Stripe will retry, so they are forward exposure, not history.
 *
 * AGL-1715-EXEMPT: this is NOT the live-subscription triple in
 * `org-billing-doc.ts`, which answers "may this org open a SECOND
 * subscription". This one asks "will this subscription bill again", and the
 * two disagree exactly on `unpaid` — an org in dunning may not subscribe
 * again, and its schedule is still live and still owes. Dropping the two
 * dunning statuses to reuse the shared predicate would hide the accounts
 * with an outstanding balance, which are the subject of the audit. This file
 * is bare `node` and never built, so it could not import that lib anyway;
 * it reads Stripe, decides nothing and writes nothing.
 */
export const BILLING_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
])

/**
 * AGL-2323. A storefront subscription bills untaxed when NEITHER mechanism is
 * carrying tax: no `tax_rates` on any item (what AGL-1751 attaches) and
 * `automatic_tax` disabled (Stripe Tax). Checking only one of the two would
 * flag every store on the other tax mode.
 *
 * `untaxed` is split by `stillBilling` because the two are different problems
 * with different owners, and a single headline number conflates them:
 *
 *   stillBilling  — FORWARD EXPOSURE. Every future cycle under-collects until
 *                   someone backfills `tax_rates` onto the item. This is the
 *                   number that decides whether a migration is urgent.
 *   !stillBilling — HISTORICAL LIABILITY ONLY. A canceled subscription bills
 *                   nothing more, so a backfill would do nothing for it, but
 *                   the cycles it already billed untaxed are still tax the
 *                   merchant showed a buyer and never collected. That is an
 *                   accounting decision, not a migration.
 *
 * Reporting one total would make a dead back book look like live exposure and
 * send someone to write Stripe updates that change nothing.
 */
export function classifySubscription(sub) {
  const md = sub.metadata ?? {}
  if (md.type !== 'commerce-subscription') {
    return { relevant: false, reason: 'not-a-storefront-subscription' }
  }
  const stillBilling = BILLING_STATUSES.has(sub.status)
  const items = sub.items?.data ?? []
  if (sub.automatic_tax?.enabled === true) {
    return {
      relevant: true,
      untaxed: false,
      stillBilling,
      reason: 'automatic_tax enabled',
    }
  }
  const withRates = items.filter((i) => (i.tax_rates ?? []).length > 0)
  if (withRates.length > 0) {
    return {
      relevant: true,
      untaxed: false,
      stillBilling,
      reason: `tax_rates on ${withRates.length}/${items.length} item(s)`,
    }
  }
  return {
    relevant: true,
    untaxed: true,
    stillBilling,
    reason: stillBilling
      ? 'no item tax_rates and automatic_tax disabled — every future cycle under-collects'
      : 'no item tax_rates and automatic_tax disabled — ended, historical liability only',
  }
}
