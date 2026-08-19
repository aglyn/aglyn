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

// Every verdict in `money-back-book.mjs`, driven RED on purpose.
//
// The failure mode being guarded is an audit that reports a comfortable zero
// because its query can never match anything. So the bar here is not "a clean
// back book returns clean" — it is that each POSITIVE case is built to the
// exact shape the BROKEN code produced (a pre-AGL-2315 booking session, a
// pre-AGL-1751 subscription), so a classifier that stops recognising what it
// hunts goes red here instead of going quiet in production.
//
// Verified by mutation on 2026-08-19 — each of these was applied to a COPY
// under /private/tmp and the named test failed:
//
//   `md.type !== 'booking-payment'` -> `'booking-payment-XX'`
//        the never-matches typo; 4 tests fail, the positive returns undefined
//   `pi.transfer_data?.destination` -> `null`
//        every paid booking looks misrouted; the post-fix test fails
//   `items.filter((i) => (i.tax_rates ?? []).length > 0)` -> `[]`
//        AGL-1751's fix stops counting; the taxed-subscription test fails
//   `sub.automatic_tax?.enabled === true` -> `false`
//        Stripe Tax stores falsely flagged; the automatic_tax test fails
//   `misrouted: null` -> `misrouted: false` on an unexpanded PaymentIntent
//        an unreadable charge reads as clean; the indeterminate test fails
//   `BILLING_STATUSES` gains `'canceled'`
//        a dead subscription counts as live exposure; the canceled test fails
//   `BILLING_STATUSES` loses `'past_due'`
//        a retrying schedule is written off as history; the past_due test fails
//
// If you change a verdict, repeat that exercise. A suite that cannot fail is
// the thing this file exists to prevent.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BILLING_STATUSES,
  classifyBookingSession,
  classifySubscription,
} from './money-back-book.mjs'

test('AGL-2361: a pre-fix paid booking with no transfer_data is misrouted', () => {
  // The whole point of the audit. Booking metadata, the guest paid, and a
  // PaymentIntent with no Connect wiring of any kind — so 100% of the charge
  // stayed with the platform and this merchant is owed money.
  const verdict = classifyBookingSession({
    id: 'cs_prefix',
    payment_status: 'paid',
    amount_total: 12000,
    currency: 'usd',
    metadata: { type: 'booking-payment', hostId: 'host_a', bookingId: 'bk_1' },
    payment_intent: { id: 'pi_1' },
  })
  assert.equal(verdict.relevant, true)
  assert.equal(verdict.misrouted, true)
})

test('AGL-2361: a post-fix destination charge is not misrouted', () => {
  // What AGL-2315 now produces. Flagging this would invent a debt for every
  // booking that was in fact paid correctly.
  const verdict = classifyBookingSession({
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
  })
  assert.equal(verdict.misrouted, false)
})

test('AGL-2361: a storefront sale is not a booking debt', () => {
  const verdict = classifyBookingSession({
    id: 'cs_store',
    payment_status: 'paid',
    metadata: { type: 'commerce-buy-now', hostId: 'host_a' },
    payment_intent: { id: 'pi_3' },
  })
  assert.equal(verdict.relevant, false)
})

test('AGL-2361: an abandoned booking session owes nothing', () => {
  const verdict = classifyBookingSession({
    id: 'cs_unpaid',
    payment_status: 'unpaid',
    metadata: { type: 'booking-payment', hostId: 'host_a', bookingId: 'bk_3' },
  })
  assert.equal(verdict.relevant, true)
  assert.equal(verdict.misrouted, false)
})

test('AGL-2361: an unreadable PaymentIntent is indeterminate, never clean', () => {
  // `null` is an answer of UNKNOWN. If this ever became `false`, a charge the
  // audit could not read would be counted as correctly routed and disappear
  // into the reassuring zero.
  const verdict = classifyBookingSession({
    id: 'cs_unexpanded',
    payment_status: 'paid',
    metadata: { type: 'booking-payment', hostId: 'host_a', bookingId: 'bk_4' },
    payment_intent: 'pi_string_only',
  })
  assert.equal(verdict.misrouted, null)
})

test('AGL-2323: a pre-1751 subscription with no item tax_rates is untaxed', () => {
  // The shape that bills untaxed from cycle 2 forever: manual tax was a
  // one-time line item, and Stripe bills those on the first invoice only.
  const verdict = classifySubscription({
    id: 'sub_prefix',
    metadata: {
      type: 'commerce-subscription',
      hostId: 'host_a',
      productId: 'p1',
    },
    automatic_tax: { enabled: false },
    items: {
      data: [
        {
          id: 'si_1',
          tax_rates: [],
          price: { unit_amount: 5000 },
          quantity: 1,
        },
      ],
    },
  })
  assert.equal(verdict.relevant, true)
  assert.equal(verdict.untaxed, true)
})

test('AGL-2323: a subscription carrying a Tax Rate is taxed', () => {
  // What AGL-1751 attaches. Flagging this would be the audit asserting the
  // fix does not work.
  const verdict = classifySubscription({
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
  })
  assert.equal(verdict.untaxed, false)
})

test('AGL-2323: a Stripe Tax store is taxed without item tax_rates', () => {
  // The two tax modes carry tax by different mechanisms. Checking only
  // `tax_rates` would flag every store on the other one.
  const verdict = classifySubscription({
    id: 'sub_autotax',
    metadata: { type: 'commerce-subscription', hostId: 'host_b' },
    automatic_tax: { enabled: true },
    items: {
      data: [
        {
          id: 'si_3',
          tax_rates: [],
          price: { unit_amount: 5000 },
          quantity: 1,
        },
      ],
    },
  })
  assert.equal(verdict.untaxed, false)
})

test('AGL-2323: an org paying Aglyn is not a storefront subscription', () => {
  // Platform billing shares the Stripe account. It must never land in a
  // MERCHANT tax-exposure number.
  const verdict = classifySubscription({
    id: 'sub_platform',
    metadata: { orgId: 'org_1', plan: 'pro' },
    automatic_tax: { enabled: true },
    items: { data: [] },
  })
  assert.equal(verdict.relevant, false)
})

const untaxedItems = {
  data: [
    { id: 'si_x', tax_rates: [], price: { unit_amount: 5000 }, quantity: 1 },
  ],
}

test('AGL-2323: an active untaxed subscription is forward exposure', () => {
  const verdict = classifySubscription({
    id: 'sub_active',
    status: 'active',
    metadata: { type: 'commerce-subscription', hostId: 'host_a' },
    automatic_tax: { enabled: false },
    items: untaxedItems,
  })
  assert.equal(verdict.untaxed, true)
  assert.equal(verdict.stillBilling, true)
})

test('AGL-2323: a canceled untaxed subscription is history, not exposure', () => {
  // It bills nothing more, so a `tax_rates` backfill would do nothing for it.
  // Counting it as live exposure sends someone to write Stripe updates that
  // change no future invoice.
  const verdict = classifySubscription({
    id: 'sub_canceled',
    status: 'canceled',
    metadata: { type: 'commerce-subscription', hostId: 'host_a' },
    automatic_tax: { enabled: false },
    items: untaxedItems,
  })
  assert.equal(verdict.untaxed, true)
  assert.equal(verdict.stillBilling, false)
})

test('AGL-2323: a past_due subscription is still billing', () => {
  // Stripe will retry, so the schedule is live and every future cycle still
  // under-collects. Treating a dunning subscription as dead understates it.
  const verdict = classifySubscription({
    id: 'sub_past_due',
    status: 'past_due',
    metadata: { type: 'commerce-subscription', hostId: 'host_a' },
    automatic_tax: { enabled: false },
    items: untaxedItems,
  })
  assert.equal(verdict.stillBilling, true)
})

test('AGL-2323: the billing statuses are exactly the ones that charge again', () => {
  assert.deepEqual([...BILLING_STATUSES].sort(), [
    'active',
    'past_due',
    'trialing',
    'unpaid',
  ])
  for (const dead of ['canceled', 'incomplete_expired', 'paused']) {
    assert.equal(BILLING_STATUSES.has(dead), false, dead)
  }
})
