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

// Isomorphic on purpose: the funnel dialog needs the same closed reason set
// and the same downsell answer the routes enforce, and a second copy on the
// client is how the two drift until the browser offers a tier the server
// refuses. Nothing here touches the Admin SDK or Stripe — those live in the
// route.
//
// Deep import rather than the `@aglyn/aglyn` barrel (AGL-1349/1350). The
// barrel re-exports `app-utils/index`, which reaches `contexts.ts` and
// `enabled-plugins-context.ts` — React contexts, client-only — and this
// module is imported by a SERVER route, so the barrel dragged a client-only
// module into a server graph. `app-router-graph.spec` caught it. The module
// this actually wants has no React in it.
import { SELF_SERVE_PLANS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'

/**
 * Retention-funnel primitives (AGL-1863 / AGL-1859 — Zach's twice-given
 * directive: commitment over churn, and we must not lose money doing it).
 *
 * Everything the cancellation/deletion funnel stores lives in
 * `orgs/{orgId}/retention` — Admin-SDK-only by construction: the orgs rules
 * block matches its subcollections BY NAME and has no wildcard, so an
 * unmatched name is default-deny for every client. The docs/data loop and
 * GA4 read it downstream; nothing in the browser ever does.
 */
export const RETENTION_COLLECTION = 'retention'

/** The two funnels — subscription cancel and account (org) delete. */
export const RETENTION_SURFACES = [
  'subscription_cancel',
  'account_delete',
] as const
export type RetentionSurface = (typeof RETENTION_SURFACES)[number]

/**
 * Closed reason set for the why-are-you-leaving survey. Closed for the same
 * reason the GA taxonomy is: a free-text-only answer cannot be broken down,
 * and a breakdown is the entire point of asking. `other` + the bounded
 * `detail` field catches everything the list misses.
 */
export const CHURN_SURVEY_REASONS = [
  'too_expensive',
  'missing_features',
  'not_using_enough',
  'switching_provider',
  'technical_issues',
  'temporary_pause',
  'other',
] as const
export type ChurnSurveyReason = (typeof CHURN_SURVEY_REASONS)[number]

/** Free-text survey detail is capped — a paragraph, not a document. */
export const CHURN_SURVEY_DETAIL_MAX_LENGTH = 500

/**
 * The winback offer, as constants rather than request inputs — the CLIENT
 * never chooses the discount. 50% for 2 months is margin-checked against the
 * plan floor: every self-serve tier's list price covers its infra cost at
 * well over 2× (metering/overage floors bill separately and are untouched by
 * a subscription coupon), so half price for two cycles keeps every retained
 * org above water while being a real offer.
 */
export const WINBACK_PERCENT_OFF = 50
export const WINBACK_DURATION_MONTHS = 2

/** The walls the guard enforces — see {@link assertBoundedWinbackCoupon}. */
export const WINBACK_MAX_PERCENT_OFF = 50
export const WINBACK_MAX_DURATION_MONTHS = 3

/** What a winback coupon is allowed to look like. */
export interface WinbackCouponShape {
  percentOff?: number
  duration: 'once' | 'repeating' | 'forever' | string
  durationInMonths?: number
}

/**
 * Refuses any winback coupon that is not strictly time-boxed and bounded
 * (AGL-1863, encoding the AGL-1620 lesson as a check that can fail).
 *
 * The failure this exists to make IMPOSSIBLE, not just unlikely: a 100%-off
 * `duration: forever` coupon — a free account minted by a retention flow and
 * never noticed again. E2ETEST100 ($0 forever, AGL-1620) was minted by hand
 * for a drill and got an expiry + a tracked issue; a coupon minted by CODE
 * gets neither unless the code refuses. So:
 *
 * - `forever` is never a legal duration, whatever the percent;
 * - `repeating` must state 1..{@link WINBACK_MAX_DURATION_MONTHS} months;
 * - the percent must be 1..{@link WINBACK_MAX_PERCENT_OFF} — 100% off is
 *   over the wall even for a single cycle;
 * - a coupon that discounts nothing is refused too: it would burn the
 *   one-per-org winback slot on a no-op.
 *
 * Throws rather than returns so a caller cannot check-and-ignore.
 */
export function assertBoundedWinbackCoupon(coupon: WinbackCouponShape): void {
  if (coupon.duration === 'forever') {
    throw new Error(
      'Winback coupons must be time-boxed — `forever` is never mintable ' +
        '(AGL-1620/AGL-1863)',
    )
  }
  if (coupon.duration !== 'once' && coupon.duration !== 'repeating') {
    throw new Error(
      `Winback coupon duration must be "once" or "repeating", got ` +
        `"${coupon.duration}"`,
    )
  }
  if (coupon.duration === 'repeating') {
    const months = coupon.durationInMonths
    if (
      typeof months !== 'number' ||
      !Number.isInteger(months) ||
      months < 1 ||
      months > WINBACK_MAX_DURATION_MONTHS
    ) {
      throw new Error(
        `A repeating winback coupon must run 1..` +
          `${WINBACK_MAX_DURATION_MONTHS} whole months, got ${months}`,
      )
    }
  }
  const percent = coupon.percentOff
  if (typeof percent !== 'number' || percent <= 0) {
    throw new Error('A winback coupon must discount something')
  }
  if (percent > WINBACK_MAX_PERCENT_OFF) {
    throw new Error(
      `Winback percent_off is capped at ${WINBACK_MAX_PERCENT_OFF}%, got ` +
        `${percent}% — a 100%-off coupon is a free account, not a retention ` +
        'offer',
    )
  }
}

/**
 * The tier to offer in the downsell step: the next PAID tier below the plan
 * being left, or null when there is none (Starter has only Free below it,
 * and free is a cancel, not a downsell — the funnel's step 3/4 handle that).
 *
 * Paid-only is the margin constraint stated structurally: every paid tier's
 * list price covers its own floor, so any answer this returns is an org we
 * keep without losing money on.
 */
export function downsellTargetPlan(plan: string | null | undefined): OrgPlan | null {
  if (!plan) return null
  const index = SELF_SERVE_PLANS.indexOf(plan as OrgPlan)
  // Index 0 is `free`; a paid downsell needs index >= 1 to land on.
  if (index < 2) return null
  return SELF_SERVE_PLANS[index - 1] ?? null
}
