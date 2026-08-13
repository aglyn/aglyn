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

export const BILLING_LOCK_GRACE_DAYS = 30

const DELINQUENT_STATUSES = new Set(['past_due', 'unpaid'])
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
    currentPeriodEnd?: { seconds?: number } | null
  } | null,
  nowMs: number,
): boolean {
  if (org.suspendedAt != null) return false
  const status = billingSubscription?.status ?? org.billingStatus
  if (!status || !DELINQUENT_STATUSES.has(status)) return false
  const periodEndSeconds = billingSubscription?.currentPeriodEnd?.seconds
  if (typeof periodEndSeconds !== 'number' || !Number.isFinite(periodEndSeconds)) {
    // No period end on record: we cannot prove 30 days have passed, and a
    // grace clock that starts "whenever" locks people early. Fail closed.
    return false
  }
  const graceMs = BILLING_LOCK_GRACE_DAYS * 24 * 60 * 60 * 1000
  return periodEndSeconds * 1000 + graceMs < nowMs
}
