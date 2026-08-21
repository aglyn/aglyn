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

/**
 * Billing auto-lock predicate (AGL-1501) — **DISABLED BY DEFAULT**.
 *
 * TO TURN IT ON: set `AUTO_LOCK_BILLING_FROM` to the first month it applies,
 * e.g. `AUTO_LOCK_BILLING_FROM=2026-10`. Anything else — unset, empty, or
 * malformed — and this predicate answers `false` for every org: locking
 * paying-ish customers automatically is a policy Zach flips deliberately,
 * never a default. Same design as `BILL_ORG_LIBRARY_STORAGE_FROM`
 * (usage-metering.ts): a start MONTH rather than a boolean, so flipping it
 * on is also a record of when, and it FAILS CLOSED on garbage.
 *
 * What qualifies, given the fields the org doc actually has (there is no
 * "delinquent since" timestamp anywhere): the subscription status says the
 * money stopped (`past_due` / `unpaid`) AND the paid period ended more than
 * `BILLING_LOCK_GRACE_DAYS` ago — i.e. the org has been running on an
 * unpaid, expired period for 30+ days. Already-suspended orgs are skipped
 * (idempotent), and orgs with no subscription at all are Free, not
 * delinquent.
 *
 * The manual button is /admin/lockdown (reason `billing`); this predicate
 * is consumed only by the env-gated sweep in
 * apps/console/app/api/billing/usage-alerts/route.ts.
 */

/**
 * Reconciled against the live dunning schedule, or rather against the fact
 * that there isn't one to reconcile against yet (AGL-2430).
 *
 * 30 stands, and the reason is that it is safe under **every** configuration
 * Stripe's Dashboard can hold, not that it matches a number someone read:
 *
 * - If live cancels at ~21 days as test mode does, 30 sits nine days past the
 *   terminal state — the sweep fires on `canceled` + `payment_failed`, which
 *   is reachable, and the extra nine days is slack in the customer's favour.
 * - If live is instead set to *mark unpaid*, the org sits `unpaid`
 *   indefinitely and the sweep fires at day 30 on the `unpaid` branch.
 * - If live is set to *leave past_due*, same, on the `past_due` branch.
 *
 * All three land somewhere reachable, so no live reading can make this
 * constant unsafe — only more or less generous. That is why this is not a
 * blocker on the live Dashboard read, and why the read is still owed: the
 * banner copy and the customer docs are what actually depend on the number,
 * and both have been made to stop quoting it. See
 * `LIVE_MODE_DUNNING_SCHEDULE` in ./stripe-dunning-schedule.ts.
 */
export const BILLING_LOCK_GRACE_DAYS = 30

/**
 * The statuses that mean the money stopped WHILE the subscription still
 * exists.
 *
 * These alone are not enough, and the reason is measured rather than
 * reasoned about (AGL-1877). A test-clock drill of a failed renewal on the
 * test account: the subscription sat `past_due` through five attempts over
 * **21.08 days** and Stripe then CANCELLED it — `canceled`, with
 * `cancellation_details.reason: 'payment_failed'`. It never became `unpaid`.
 *
 * So with a 30-day grace and this set alone the predicate could not fire for
 * any org, ever: nine days before the clock ran out the status had already
 * left the set. A guard with no reachable true branch, shipped behind an env
 * flag nobody had turned on, so nothing ever noticed.
 */
const DELINQUENT_STATUSES = new Set(['past_due', 'unpaid'])

/**
 * Stripe's word for "I gave up retrying", on
 * `customer.subscription.deleted.cancellation_details.reason`.
 *
 * This is the whole difference between a workspace that left and one that
 * stopped paying: both arrive as `status: 'canceled'` with the same
 * `plan: 'free'` mirror, and locking the first would be suspending a
 * customer for the crime of cancelling.
 */
const DUNNING_CANCELLATION_REASON = 'payment_failed'
const MONTH_PATTERN = /^\d{4}-\d{2}$/

/** Is the sweep armed for this month? Fails CLOSED on any malformed value. */
export function billingAutoLockEnabled(
  currentMonth: string,
  configuredStart: string | undefined,
): boolean {
  if (!configuredStart || !MONTH_PATTERN.test(configuredStart)) return false
  if (!MONTH_PATTERN.test(currentMonth)) return false
  return currentMonth >= configuredStart
}

/**
 * `org` is the org doc (`suspendedAt`, plus the `billingStatus` mirror the
 * webhook writes back for the dunning banner); `billingSubscription` is
 * `subscription` off the `orgs/{id}/billing/stripe` subdoc, where the
 * status and `currentPeriodEnd` moved with AGL-1028.
 */
export function shouldAutoLockOrgForBilling(
  org: {
    suspendedAt?: unknown
    billingStatus?: string
  },
  billingSubscription: {
    status?: string
    canceledReason?: string | null
    currentPeriodEnd?: { seconds?: number } | null
  } | null,
  nowMs: number,
): boolean {
  if (org.suspendedAt != null) return false
  const status = billingSubscription?.status ?? org.billingStatus
  if (!status) return false
  // A subscription Stripe cancelled for non-payment is the terminal form of
  // exactly the state the two statuses above describe, and on this account it
  // is the ONLY form the org ever reaches (see `DELINQUENT_STATUSES`). Read
  // off the subdoc only: `billingStatus` is a bare status string with no room
  // for a reason, so an org known only through the mirror can never satisfy
  // this — which is the right way round. An unknown reason is not a proven
  // payment failure, so every pre-AGL-1877 cancellation, and every voluntary
  // one, fails closed here.
  const dunningCanceled =
    status === 'canceled' &&
    billingSubscription?.canceledReason === DUNNING_CANCELLATION_REASON
  if (!dunningCanceled && !DELINQUENT_STATUSES.has(status)) return false
  const periodEndSeconds = billingSubscription?.currentPeriodEnd?.seconds
  if (typeof periodEndSeconds !== 'number' || !Number.isFinite(periodEndSeconds)) {
    // No period end on record: we cannot prove 30 days have passed, and a
    // grace clock that starts "whenever" locks people early. Fail closed.
    return false
  }
  const graceMs = BILLING_LOCK_GRACE_DAYS * 24 * 60 * 60 * 1000
  return periodEndSeconds * 1000 + graceMs < nowMs
}
