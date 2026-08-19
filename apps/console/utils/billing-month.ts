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
 * THE BILLING MONTH (AGL-2219).
 *
 * `YYYY-MM` in **UTC** is the platform's one period key: `orgs/{id}/usage/*`,
 * `orgs/{id}/apiUsage/*`, `orgs/{id}/assistUsage/*`, the per-host counters'
 * month fields, the `usageAlerts` dedupe guards and the free-plan bandwidth
 * cap marker all use it, and a budget period the meters do not share would
 * compare a month of spend against something else.
 *
 * Three routes had grown byte-identical private copies of `previousMonth`
 * (`billing/report-usage`, `billing/usage-email`, `admin/overview`). They are
 * one function here now, alongside the predicate that decides whether a month
 * may be invoiced — which is a rule about money and had no business being
 * inline in the route that sends the meter event.
 *
 * Deliberately dependency-free: this is imported by App Routes that pull in
 * `firebase-admin`, and keeping it importable on its own is what makes it
 * testable without a Firestore double.
 */

/** The month in progress as `YYYY-MM`, UTC. */
export function currentMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/** The previous calendar month as `YYYY-MM`, UTC — the default rollup target. */
export function previousMonth(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7)
}

/**
 * Whether `month` has ENDED, and may therefore be invoiced.
 *
 * ## Why this is a named, tested predicate and not an inline comparison
 *
 * `report-usage` sends one Stripe Billing Meter event per org-month, keyed
 * `{orgId}-{month}`. Stripe treats that identifier as idempotent, and our side
 * records `reportedAt` on the rollup and then skips the org permanently. So
 * metering an OPEN month does not report early — it **freezes the month at
 * whatever partial figure the first run happened to see**, and no later run
 * can replace it. There is no correcting write; there is only a wrong invoice.
 *
 * That route accepts a month from its caller (body, and since AGL-2219 the
 * query string as well, so the daily in-progress sweep can name it). The guard
 * therefore has to live where the decision is made rather than in the caller's
 * discipline.
 *
 * **Anything that is not a well-formed `YYYY-MM` reads as OPEN.** Fail-closed,
 * the same posture as `billsOrgLibraryStorage` and `billsAssistTokens`: a
 * month wrongly withheld reports late and visibly, and a month wrongly
 * metered is a bill nobody can take back.
 */
export function monthIsClosed(
  month: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const key = String(month ?? '')
  if (!/^\d{4}-\d{2}$/.test(key)) return false
  return key < currentMonth(now)
}
