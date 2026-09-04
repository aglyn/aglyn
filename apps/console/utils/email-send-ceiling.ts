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
 * THE HOURLY SEND CEILING, AS A CUSTOMER-READABLE READING.
 *
 * A workspace is paced by two independent limits and could only ever see one
 * of them. `emailSendsPerMonth` has a meter on the billing page; the hourly
 * ceiling `claimOrgEmailSendBudget` enforces has had none, so an org throttled
 * at its share of the platform hour learned the number from a deferral notice
 * and nowhere else.
 *
 * ## The two windows are NOT one number
 *
 * The monthly meter counts a calendar month — the org's `campaignEmailSends`
 * counter, keyed `YYYY-MM` in UTC. The hourly counter counts one clock hour —
 * a per-org, per-window document in `rateLimits`, TTL-swept. They
 * measure the same unit — one message per recipient address — over windows
 * three orders of magnitude apart, and neither is a rate the other can be
 * divided into. Every figure here therefore carries the window it was measured
 * over, and no consumer may combine them into a single fraction.
 *
 * ## Why the reading crosses the wire and is not computed here
 *
 * `rateLimits` is deny-all to every client — the collection inherits the rule
 * that serves the abuse limiter — so the hourly counter and the live platform
 * ceiling are unreachable from a browser. `/api/billing/email-ceiling` reads
 * both with the Admin SDK behind the same `billing.view` gate the section
 * uses, and hands back the two numbers plus the ceilings derived from them.
 *
 * Derived THERE and not here: `orgHourlyCampaignCeiling` and
 * `deliverableMonthlyCeiling` are functions of the live platform ceiling,
 * which this module cannot see. Re-deriving a ceiling from a share on the
 * client would be a second implementation that drifts the first time an
 * operator ramps the platform.
 */

// The specific module, not either entry barrel: this file is imported from
// BOTH App Router graphs — the billing usage card (client) and
// `api/billing/email-ceiling` (server) — and `@aglyn/aglyn` carries the
// client-only React contexts while `@aglyn/aglyn/server` carries the
// `node:stream` adapter. Same constraint, and the same resolution, as
// `usage-metering.ts` one directory over.
import { UNLIMITED } from '@aglyn/aglyn/app-utils/plan-entitlements'

/**
 * What `/api/billing/email-ceiling` answers.
 *
 * **Every field is a finite number.** `UNLIMITED` is
 * `Number.POSITIVE_INFINITY`, `JSON.stringify(Infinity)` is `null`, and
 * `Number(null)` is `0` — so a sentinel that crossed this wire would arrive as
 * a ceiling of ZERO and render as 100% spent on the most expensive plan
 * (AGL-2482). Nothing here can be unlimited: every ceiling is derived from a
 * finite platform-hour ramp. {@link parseOrgEmailSendCeiling} enforces that
 * rather than assuming it, so a future field that could be infinite fails the
 * parse instead of rendering as spent.
 */
export interface OrgEmailSendCeiling {
  /** Campaign messages this workspace has sent in the CURRENT CLOCK HOUR. */
  hourUsed: number
  /** Campaign messages it may send in an hour — its share of the platform hour. */
  hourLimit: number
  /** When the hourly window rolls and the count returns to zero, ms since epoch. */
  hourResetMs: number
  /**
   * The most this workspace could get out in a projected month at that pace.
   *
   * An upper bound, not a forecast: it assumes flat-out sending around the
   * clock for 30 days. Its job is to say whether a plan's monthly allowance is
   * physically spendable, which is the only question it is used for below.
   */
  deliverableMonthly: number
  /** Recipients ONE campaign send may address. */
  perSend: number
  /**
   * Whether the pacing control is currently enforcing.
   *
   * The platform governor carries an operator kill switch, and
   * `claimOrgEmailSendBudget` grants every claim while it is off. A ceiling
   * shown as binding while nothing enforces it is a number the customer would
   * plan around for no reason, so the surface says which state it is in.
   */
  paced: boolean
}

/**
 * Reads the route's answer, or `null` when it is not a complete reading.
 *
 * `null` and never a zero-filled default: a meter that renders `0 / 0` after a
 * failed read has invented a denominator, and the surface's "not yet metered"
 * state is the honest alternative. Same posture as every other meter on the
 * billing page.
 */
export function parseOrgEmailSendCeiling(
  payload: unknown,
): OrgEmailSendCeiling | null {
  const raw = payload as Record<string, unknown> | null | undefined
  if (!raw || typeof raw !== 'object') return null
  const numeric = (value: unknown): number | null => {
    const parsed = Number(value)
    // `Number.isFinite` rejects the serialized sentinel (`null` → 0 is
    // finite, so the `typeof` guard is what actually catches it), NaN, and
    // Infinity. A ceiling this cannot vouch for holds the unmetered state.
    return typeof value === 'number' && Number.isFinite(parsed) ? parsed : null
  }
  const hourUsed = numeric(raw['hourUsed'])
  const hourLimit = numeric(raw['hourLimit'])
  const hourResetMs = numeric(raw['hourResetMs'])
  const deliverableMonthly = numeric(raw['deliverableMonthly'])
  const perSend = numeric(raw['perSend'])
  if (
    hourUsed == null ||
    hourLimit == null ||
    hourResetMs == null ||
    deliverableMonthly == null ||
    perSend == null
  ) {
    return null
  }
  // A ceiling of zero would refuse every campaign, and the server floors it at
  // 1 for exactly that reason. Arriving at zero here means the value was lost
  // on the way, not that sending is switched off.
  if (hourLimit <= 0 || deliverableMonthly <= 0 || perSend <= 0) return null
  return {
    // A corrupt or negative counter must not read as headroom — the same
    // clamp `emailSendHeadroom` and `claimOrgEmailSendBudget` both apply.
    hourUsed: Math.max(0, Math.floor(hourUsed)),
    hourLimit: Math.floor(hourLimit),
    hourResetMs: Math.max(0, Math.floor(hourResetMs)),
    deliverableMonthly: Math.floor(deliverableMonthly),
    perSend: Math.floor(perSend),
    paced: raw['paced'] !== false,
  }
}

/**
 * Whether the plan sells more monthly campaign mail than the pace can deliver.
 *
 * Surfaced rather than hidden: a customer whose plan promises 250,000 emails
 * is entitled to know the pacing control will not let them spend it in a
 * fortnight, and an operator is entitled to see it before the support ticket
 * arrives.
 *
 * **`UNLIMITED` is the case this function exists to get right.** It is
 * `Number.POSITIVE_INFINITY`, so `Infinity > deliverableMonthly` is true and
 * an unlimited plan reports `true` — correctly, since no finite pace can
 * deliver an unbounded allowance. A limit that arrived as a non-number (the
 * serialized sentinel, an absent entitlement) is NOT treated as unlimited: it
 * reports `false`, because claiming a customer's plan oversells on the
 * strength of a value we could not read is the wrong direction to guess in.
 */
export function planExceedsDeliverableMonthly(
  planMonthlyLimit: number,
  deliverableMonthly: number,
): boolean {
  if (planMonthlyLimit === UNLIMITED) return true
  if (!Number.isFinite(planMonthlyLimit) || planMonthlyLimit <= 0) return false
  if (!Number.isFinite(deliverableMonthly) || deliverableMonthly <= 0) {
    return false
  }
  return planMonthlyLimit > deliverableMonthly
}

/**
 * When the monthly campaign counter rolls over, as a local-time date string.
 *
 * The counter is keyed `YYYY-MM` in **UTC** (`currentMonth`), so the allowance
 * returns at midnight UTC on the 1st — not at midnight wherever the reader is.
 * The instant is computed in UTC and only then formatted for the reader, which
 * is why this takes the same `Date` the meter rendered from rather than
 * building one from local parts.
 */
export function monthlyAllowanceResetsAt(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  )
}
