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
 * decides which of them an org may reach:
 *
 *   shared pool     `notifications@shared{n}.mail.aglyn.app`. Every site,
 *                   every tier, no provisioning, no DNS. Transactional only.
 *   dedicated       `hello@{label}.mail.aglyn.app`. One provider domain object
 *                   and three records in OUR zone, per site. **This module.**
 *   customer-owned  `hello@acme.com`. One provider domain object and records
 *                   the customer publishes in THEIR zone. Gated separately, on
 *                   the `customSendingDomain` feature flag, and available from
 *                   the same tier as this one — it is the option that costs
 *                   the platform no zone records at all, so it is the one that
 *                   scales.
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
 * them — better, and still the wrong curve, because revenue is the number the
 * platform is trying to grow while the provider's allowance grows only by
 * purchase.
 *
 * So this gate is one of three conditions and not the only one. A domain is
 * claimed when a merchant ASKS for one, from the sending-identity route; this
 * decides whether their org carries what they asked for; and the provider
 * ceiling in `provision-sending-domain.ts` decides whether the claim can
 * actually be filled. Demand is therefore proportional to the merchants who
 * want an Aglyn-branded sending name rather than to everyone who pays, and a
 * site refused at any of the three keeps sending on the shared pool.
 *
 * ## An entitlement, so one org can be granted one
 *
 * `dedicatedSendingDomain` is read through `checkEntitlement` like every other
 * capability on the platform, which buys two things a plan comparison cannot.
 *
 * A per-org override GRANTS it: staff can put a single lower-tier org on a
 * dedicated domain — the support case this gate meets most often — without
 * repricing the account, and the grant is a field on the org document with an
 * audit row rather than a plan change that also moves eight quotas. The
 * override is a draw on the provider's allowance like any other claim, so it
 * is bounded by the same ceiling; what it is not bounded by is the tier.
 *
 * A dead subscription REVOKES it. `resolveEffectivePlan` reads a canceled or
 * unpaid subscription down to `free`, so an org that stops paying stops being
 * able to claim NEW domains here — while the sites it already holds keep
 * theirs, because the claim path's pinned-label early return sits above this
 * gate and a downgrade never repossesses a name that has earned reputation.
 *
 * Nothing outside this file decides who may hold a dedicated domain.
 */

import { checkEntitlement, planGrantingFeature } from './plan-entitlements'
import type {
  AglynOrgBilling,
  OrgPlan,
} from '../foundation/definitions/org-billing.types'

/**
 * The lowest plan whose sites get a domain of their own, for the surfaces that
 * have to NAME a tier — an upsell card, a refusal that says what to buy.
 *
 * Derived from `PLAN_ENTITLEMENTS` rather than declared, because a tier name
 * written down beside a gate is pricing copy that keeps rendering after the
 * gate moves. There is one decision here — the flag's column in the plan
 * table — and this is a view of it, so the two cannot disagree.
 *
 * `planGrantingFeature` walks the self-serve ladder and then `enterprise`,
 * which is priced by contract and is not a rung of `SELF_SERVE_PLANS`. It
 * answers `undefined` when no plan carries the flag on its base tier; a caller
 * naming a tier must handle that rather than substituting one.
 */
export const DEDICATED_SENDING_DOMAIN_MIN_PLAN: OrgPlan = planGrantingFeature(
  'dedicatedSendingDomain',
)

/**
 * Whether an org's sites may hold a dedicated platform sending domain.
 *
 * Takes the ORG rather than its plan name, and that is the whole point: the
 * answer is the plan's default with the org's own overrides applied, so a
 * grant on one account is honored here without moving the account's tier.
 *
 * An absent org answers `false`. `resolveOrgEntitlements(null)` resolves to
 * the free plan, which carries no dedicated domain, so a site whose org cannot
 * be read still sends — on the pool, like every other site. The cost of
 * failing closed is that a domain is not provisioned until the org resolves,
 * which the sweep then corrects. Failing open would spend a zone record and a
 * provider slot on an org nobody could name.
 */
export function holdsDedicatedSendingDomain(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  return checkEntitlement(org, 'dedicatedSendingDomain')
}
