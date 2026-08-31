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
 * WHO GETS A SENDING DOMAIN OF THEIR OWN.
 *
 * A site's mail leaves on one of three kinds of identity, and this module
 * decides which of them a plan may reach:
 *
 *   shared pool     `notifications@shared{n}.mail.aglyn.app`. Every site,
 *                   every tier, no provisioning, no DNS. Transactional only.
 *   dedicated       `hello@{label}.mail.aglyn.app`. One provider domain object
 *                   and three records in OUR zone, per site. **This module.**
 *   customer-owned  `hello@acme.com`. One provider domain object and records
 *                   the customer publishes in THEIR zone. Gated separately, on
 *                   the `customSendingDomain` feature flag, and available from
 *                   a LOWER tier than this one — it is the option that costs
 *                   the platform no zone records at all.
 *
 * ## Why the dedicated tier is a gate at all
 *
 * Not because a domain object has a price — it does not; the provider meters
 * emails and contacts and bundles domains as a quota. Because it is `O(hosts)`
 * in resources that do not stretch:
 *
 *   - **Records in our own zone.** Three per site, forever. Nothing about a
 *     customer-owned domain costs us this, which is why the two are separate
 *     decisions rather than one "custom domain" feature.
 *   - **The provider's account-wide domain allowance**, which is a bundled
 *     quota with a real ceiling and no self-serve way past a certain size.
 *   - **A place in the re-verification sweep, permanently.** Every dedicated
 *     domain has to be re-checked on a schedule, against DNS and against the
 *     provider, at an account-wide rate limit the SENDS share. That cost
 *     recurs; the provisioning cost is paid once.
 *
 * Provisioning by SIGNUP spends all three on sites that may never send a
 * message. Provisioning by PLAN spends them on sites whose revenue covers
 * them, and — more to the point — keeps the totals proportional to a number
 * that grows slowly instead of one that grows with every free signup.
 *
 * ## Why a plan comparison and not an entitlement flag
 *
 * It should be an entitlement flag. `OrgFeatureFlags` is where every other
 * capability of this kind lives, `checkEntitlement` is how they are read, and a
 * flag would let a single org be granted one without moving its plan — which is
 * exactly what staff need for a support case.
 *
 * The flag does not exist yet and `plan-entitlements.ts` is owned elsewhere
 * right now, so this is a ladder comparison in the meantime. It is deliberately
 * ONE function so that adding the field is a one-line change here and nothing
 * at any call site: the moment `OrgFeatureFlags.dedicatedSendingDomain` exists,
 * the body becomes `checkEntitlement(org, 'dedicatedSendingDomain')` and every
 * caller keeps working. Nothing outside this file compares a plan.
 */

import { SELF_SERVE_PLANS } from './plan-entitlements'
import type { OrgPlan } from '../foundation/definitions/org-billing.types'

/**
 * The lowest self-serve plan whose sites get a domain of their own.
 *
 * Named rather than inlined because it is the one number in this decision, and
 * because a reader looking for "which tier is this" should find it without
 * reading a comparison.
 */
export const DEDICATED_SENDING_DOMAIN_MIN_PLAN: OrgPlan = 'pro'

/**
 * Whether a plan's sites may hold a dedicated platform sending domain.
 *
 * `enterprise` is not a rung of {@link SELF_SERVE_PLANS} — it is priced by
 * contract and sits above the ladder — so it is admitted explicitly rather than
 * by index. Falling through the ladder comparison would have answered `false`
 * for the largest customers on the platform, which is the shape of bug an
 * `indexOf` on a list that does not contain every value produces.
 *
 * An unknown or absent plan answers `false`. A site whose plan cannot be read
 * still sends — on the pool, like every other site — so the cost of failing
 * closed here is that a domain is not provisioned until the plan resolves,
 * which the sweep then corrects. Failing open would spend a zone record and a
 * provider slot on a plan nobody could name.
 */
export function planHoldsDedicatedSendingDomain(
  plan: string | null | undefined,
): boolean {
  const name = String(plan ?? '').trim() as OrgPlan
  if (!name) return false
  if (name === 'enterprise') return true

  const at = SELF_SERVE_PLANS.indexOf(name)
  const floor = SELF_SERVE_PLANS.indexOf(DEDICATED_SENDING_DOMAIN_MIN_PLAN)
  return at >= 0 && floor >= 0 && at >= floor
}
