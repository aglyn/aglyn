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
 * The org-agnostic billing entry point's one decision (AGL-2430).
 *
 * Stripe's "Payment method updates" setting takes ONE custom link for the
 * whole account — the same URL is mailed to every customer whose card is
 * expiring, whose renewal failed, or whose trial is ending. Console routing
 * is org-scoped (`buildRoute` needs an `orgSlug`), so no existing URL can be
 * pasted into that box and still land the right customer on the right
 * workspace's billing page.
 *
 * `/billing` closes that gap by resolving the workspace from the SESSION
 * rather than from the URL. This module is that resolution, kept separate
 * from the page so every branch is drivable without a DOM.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: filter suspended, past-due or
 * otherwise delinquent workspaces out of the answer. A lock caused by
 * non-payment that also hides the page where payment happens is a deadlock,
 * and this entry point is precisely the surface a locked customer arrives
 * on. The billing SURFACE stays reachable through a lock by design —
 * `apps/console/app/api/billing/subscription/route.ts` carries the
 * `lockdown-423: exempt` marker for the same reason — so a filter here would
 * be the one line that re-closes the door.
 */

import { buildRoute, Route } from '../constants/route-links'

/** One workspace the signed-in account can reach, as the picker needs it. */
export interface BillingEntryOrg {
  $id?: string
  slug?: string
  orgName?: string
}

export type BillingEntryDestination =
  /** Exactly one reachable workspace — go there, no picker. */
  | { kind: 'billing'; href: string; org: BillingEntryOrg }
  /** Several — the customer picks, because we cannot know which card failed. */
  | { kind: 'choose'; orgs: BillingEntryOrg[] }
  /**
   * Signed in, but no workspace with a usable slug. Says so rather than
   * dropping the visitor on a dashboard: someone who followed a billing
   * email needs to be told the account has nothing to bill, not handed a
   * console and left to guess.
   */
  | { kind: 'no-workspace' }

/**
 * A membership row with no `slug` cannot be linked to — `buildRoute` would
 * emit `/undefined/billing`. Such a row is a broken projection rather than a
 * workspace the customer can act on, so it is dropped before the count is
 * taken. Dropping it BEFORE counting is the point: one good org beside one
 * broken row must still be a straight-through redirect, not a picker with a
 * dead card in it.
 */
export function resolveBillingEntry(
  orgs: readonly BillingEntryOrg[] | null | undefined,
): BillingEntryDestination {
  const linkable = (orgs ?? []).filter(
    (org): org is BillingEntryOrg & { slug: string } =>
      typeof org?.slug === 'string' && org.slug.length > 0,
  )
  if (linkable.length === 0) return { kind: 'no-workspace' }
  if (linkable.length === 1) {
    const org = linkable[0]
    return {
      kind: 'billing',
      href: buildRoute(Route.MANAGE_BILLING, { orgSlug: org.slug }),
      org,
    }
  }
  return { kind: 'choose', orgs: linkable }
}

/** The billing page for one workspace, for the picker's links. */
export function billingHrefFor(orgSlug: string): string {
  return buildRoute(Route.MANAGE_BILLING, { orgSlug })
}

export default resolveBillingEntry
