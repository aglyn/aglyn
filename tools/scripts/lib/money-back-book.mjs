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
 * AGL-2323. A storefront subscription bills untaxed when NEITHER mechanism is
 * carrying tax: no `tax_rates` on any item (what AGL-1751 attaches) and
 * `automatic_tax` disabled (Stripe Tax). Checking only one of the two would
 * flag every store on the other tax mode.
 */
export function classifySubscription(sub) {
  const md = sub.metadata ?? {}
  if (md.type !== 'commerce-subscription') {
    return { relevant: false, reason: 'not-a-storefront-subscription' }
  }
  const items = sub.items?.data ?? []
  if (sub.automatic_tax?.enabled === true) {
    return { relevant: true, untaxed: false, reason: 'automatic_tax enabled' }
  }
  const withRates = items.filter((i) => (i.tax_rates ?? []).length > 0)
  if (withRates.length > 0) {
    return {
      relevant: true,
      untaxed: false,
      reason: `tax_rates on ${withRates.length}/${items.length} item(s)`,
    }
  }
  return {
    relevant: true,
    untaxed: true,
    reason: 'no item tax_rates and automatic_tax disabled',
  }
}
