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
 * rather than from the URL. The three cases, and the reasoning that says a
 * delinquent workspace is never filtered out of them, are `utils/org-entry` —
 * shared with `/support` since AGL-3265, because the decision was identical
 * and a second copy would have had to restate that reasoning.
 *
 * `kind: 'billing'` rather than the shared `'one'`, and that is a deliberate
 * hold rather than an oversight: this module's shape is what the page and
 * `billing-entry.spec.ts` are written against, and renaming a branch to match
 * an extraction is churn in the files that were already correct.
 */

import { buildRoute, Route } from '../constants/route-links'
import { type OrgEntryOrg, resolveOrgEntry } from './org-entry'

/** One workspace the signed-in account can reach, as the picker needs it. */
export type BillingEntryOrg = OrgEntryOrg

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

/** Which workspace's billing the session resolves to, if any. */
export function resolveBillingEntry(
  orgs: readonly BillingEntryOrg[] | null | undefined,
): BillingEntryDestination {
  const entry = resolveOrgEntry(orgs, billingHrefFor)
  return entry.kind === 'one'
    ? { kind: 'billing', href: entry.href, org: entry.org }
    : entry
}

/** The billing page for one workspace, for the picker's links. */
export function billingHrefFor(orgSlug: string): string {
  return buildRoute(Route.MANAGE_BILLING, { orgSlug })
}

export default resolveBillingEntry
