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

// Controls for `audit-money-back-book.mjs` (AGL-2361, AGL-2323).
//
//   node tools/scripts/audit-money-back-book.test.mjs
//
// THE FAILURE MODE THIS EXISTS TO CATCH: an audit that reports a comfortable
// zero because its query can never match anything. Both audits answer "how much
// money is owed", and "none" is the answer everyone wants, so a filter typo
// reads as good news and is never questioned. Every POSITIVE case below is
// built to the exact shape the BROKEN code produced — a pre-AGL-2315 booking
// session and a pre-AGL-1751 subscription — so if the classifier stops
// recognising the thing it hunts, this suite goes red instead of the audit
// going quiet.
//
// Verified by mutation, 2026-08-19 — each of these was applied to a COPY under
// /private/tmp and the named control failed:
//
//   `metadata.type !== 'booking-payment'` -> `'booking-payment-XX'`
//        the never-matches typo: 3 controls fail, positive returns undefined
//   `pi.transfer_data?.destination` -> `null`
//        every paid booking looks misrouted: post-fix negative fails
//   `items.filter(i => i.tax_rates.length > 0)` -> `[]`
//        AGL-1751's fix stops counting: taxed-subscription negative fails
//   `sub.automatic_tax?.enabled === true` -> `false`
//        Stripe Tax stores falsely flagged: automatic_tax negative fails
//
// If you change a classifier, re-run that mutation exercise. A suite that
// cannot fail is exactly the thing being guarded against.

import {
  classifyBookingSession,
  classifySubscription,
} from './audit-money-back-book.mjs'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  if (actual === expected) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name} — got ${String(actual)}, want ${String(expected)}`)
  }
}

console.log('AGL-2361 — booking Connect classifier')

// POSITIVE. Exactly what the pre-AGL-2315 path produced: booking metadata, the
// guest paid, and a PaymentIntent with no Connect wiring of any kind. This is
// the row that means a merchant is owed money.
check(
  'pre-fix paid booking with no transfer_data is MISROUTED',
  classifyBookingSession({
    id: 'cs_prefix',
    payment_status: 'paid',
    amount_total: 12000,
    currency: 'usd',
    metadata: { type: 'booking-payment', hostId: 'host_a', bookingId: 'bk_1' },
    payment_intent: { id: 'pi_1' },
  }).misrouted,
  true,
)

// NEGATIVE. The post-fix shape — a destination charge. Must not be flagged, or
// every correctly-paid booking becomes a false debt.
check(
  'post-fix paid booking with transfer_data is not misrouted',
  classifyBookingSession({
    id: 'cs_postfix',
    payment_status: 'paid',
    amount_total: 12000,
    currency: 'usd',
    metadata: {
      type: 'booking-payment',
      hostId: 'host_a',
      bookingId: 'bk_2',
      feeCents: '600',
    },
    payment_intent: {
      id: 'pi_2',
      transfer_data: { destination: 'acct_merchant' },
      application_fee_amount: 600,
    },
  }).misrouted,
  false,
)

// NEGATIVE. A storefront sale is a different money path and must never be
// counted as a booking debt.
check(
  'a storefront sale is not relevant to the booking audit',
  classifyBookingSession({
    id: 'cs_store',
    payment_status: 'paid',
    metadata: { type: 'commerce-buy-now', hostId: 'host_a' },
    payment_intent: { id: 'pi_3' },
  }).relevant,
  false,
)

// NEGATIVE. An abandoned session moved no money, so nothing is owed.
check(
  'an unpaid booking session owes nothing',
  classifyBookingSession({
    id: 'cs_unpaid',
    payment_status: 'unpaid',
    metadata: { type: 'booking-payment', hostId: 'host_a', bookingId: 'bk_3' },
  }).misrouted,
  false,
)

// An unreadable PaymentIntent is UNKNOWN, never "fine" — the audit counts these
// separately so they cannot be silently absorbed into the reassuring zero.
check(
  'an unexpanded payment_intent is indeterminate, not clean',
  classifyBookingSession({
    id: 'cs_unexpanded',
    payment_status: 'paid',
    metadata: { type: 'booking-payment', hostId: 'host_a', bookingId: 'bk_4' },
    payment_intent: 'pi_string_only',
  }).misrouted,
  null,
)

console.log('AGL-2323 — storefront subscription tax classifier')

// POSITIVE. The pre-AGL-1751 shape: a live storefront subscription whose item
// carries no tax rate, so every cycle after the first bills untaxed forever.
check(
  'pre-1751 subscription with no item tax_rates is UNTAXED',
  classifySubscription({
    id: 'sub_prefix',
    metadata: { type: 'commerce-subscription', hostId: 'host_a', productId: 'p1' },
    automatic_tax: { enabled: false },
    items: {
      data: [{ id: 'si_1', tax_rates: [], price: { unit_amount: 5000 }, quantity: 1 }],
    },
  }).untaxed,
  true,
)

// NEGATIVE. What AGL-1751 attaches. If this is ever flagged, the audit is
// claiming the fix does not work.
check(
  'post-1751 subscription carrying a Tax Rate is taxed',
  classifySubscription({
    id: 'sub_postfix',
    metadata: { type: 'commerce-subscription', hostId: 'host_a' },
    automatic_tax: { enabled: false },
    items: {
      data: [
        {
          id: 'si_2',
          tax_rates: [{ percentage: 8.25, display_name: 'Sales Tax' }],
          price: { unit_amount: 5000 },
          quantity: 1,
        },
      ],
    },
  }).untaxed,
  false,
)

// NEGATIVE. A Stripe Tax store carries tax the other way. Checking only
// `tax_rates` would flag every one of them.
check(
  'a Stripe Tax subscription is taxed even with no item tax_rates',
  classifySubscription({
    id: 'sub_autotax',
    metadata: { type: 'commerce-subscription', hostId: 'host_b' },
    automatic_tax: { enabled: true },
    items: {
      data: [{ id: 'si_3', tax_rates: [], price: { unit_amount: 5000 }, quantity: 1 }],
    },
  }).untaxed,
  false,
)

// NEGATIVE. Aglyn's OWN platform subscriptions (an org paying Aglyn) share the
// account and must never appear in a MERCHANT tax exposure number.
check(
  'a platform-billing subscription is not a storefront subscription',
  classifySubscription({
    id: 'sub_platform',
    metadata: { orgId: 'org_1', plan: 'pro' },
    automatic_tax: { enabled: true },
    items: { data: [] },
  }).relevant,
  false,
)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
