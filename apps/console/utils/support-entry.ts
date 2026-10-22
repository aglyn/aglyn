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
 * The org-agnostic support entry point's one decision (AGL-3265).
 *
 * Everything that hands a person a support link — a Stripe receipt, the
 * customer portal, a system email footer, `PLATFORM_SUPPORT_URL`, a self-host
 * runbook — stores ONE URL for every customer, with no workspace to
 * interpolate into `/[orgSlug]/support`. So the only support address those
 * surfaces could carry was one outside the console entirely.
 *
 * The three cases and the reasoning behind them are `utils/org-entry`, shared
 * with `/billing`. All that is support-specific is where a chosen workspace
 * goes, which is the umbrella and NOT one of its two channels: `MANAGE_SUPPORT`
 * forwards to tickets or the forum by tier (AGL-1158), so pointing at either
 * one from here would be a second copy of a plan decision that is already made
 * in one place — and the copy would be the one that sends a Free workspace to a
 * ticket form it cannot use.
 */

import { buildRoute, Route } from '../constants/route-links'
import {
  type OrgEntryDestination,
  type OrgEntryOrg,
  resolveOrgEntry,
} from './org-entry'

/** The support umbrella for one workspace, for the picker's links. */
export function supportHrefFor(orgSlug: string): string {
  return buildRoute(Route.MANAGE_SUPPORT, { orgSlug })
}

/** Which workspace's support the session resolves to, if any. */
export function resolveSupportEntry(
  orgs: readonly OrgEntryOrg[] | null | undefined,
): OrgEntryDestination {
  return resolveOrgEntry(orgs, supportHrefFor)
}

export default resolveSupportEntry
