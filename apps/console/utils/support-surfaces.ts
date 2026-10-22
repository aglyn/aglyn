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
 * Which Support channel a workspace lands on (AGL-1158).
 *
 * Support is one umbrella over two features that were one page. They are
 * gated differently and always have been (AGL-1103): tickets need a tier
 * carrying a first-response commitment, which starts at Pro, while the forum
 * is open to every tier including Free. One page rendering both entitlement
 * stories is why a Starter workspace read as a half-empty screen rather than
 * as a forum page.
 *
 * Pure and separate from the page, because the decision has an edge that a UI
 * pass cannot see: it must NEVER be taken while the plan is unknown. `org` is
 * `undefined` both in flight and when there is no doc, so answering early
 * sends a paying customer to the forum and tells them that is all they have —
 * the same shape as `checkQuota(undefined)` reading as the free tier. The
 * caller holds until `ready`; this module refuses to guess.
 */

import type { SupportCommitment } from '@aglyn/aglyn'
import { buildRoute, Route } from '../constants/route-links'

export type SupportSurface = 'tickets' | 'forum'

/**
 * The channel this commitment makes primary.
 *
 * Derived from the SAME field the tickets route enforces
 * (`firstResponse !== null`) rather than from a plan list, so the landing
 * cannot drift from the gate. A tier with no first-response window has no
 * ticket channel by definition — its whole support offering is the forum, so
 * that is the page it should own.
 */
export function primarySupportSurface(
  commitment: SupportCommitment,
): SupportSurface {
  return commitment.firstResponse !== null ? 'tickets' : 'forum'
}

/** The console route for a surface. */
export function supportSurfaceRoute(
  surface: SupportSurface,
  orgSlug: string,
): string {
  return surface === 'tickets'
    ? buildRoute(Route.MANAGE_SUPPORT_TICKETS, { orgSlug })
    : buildRoute(Route.MANAGE_SUPPORT_FORUM, { orgSlug })
}

/**
 * Where `/[orgSlug]/support` forwards a workspace, or `null` to stay put.
 *
 * `null` while the plan is still unknown is the whole contract: the caller
 * renders a spinner rather than a guess. A wrong guess here is not a cosmetic
 * flash — it is an Enterprise workspace being shown the forum and told that
 * is its support channel.
 */
export function supportLandingRoute(
  commitment: SupportCommitment | null | undefined,
  orgSlug: string,
  ready: boolean,
): string | null {
  if (!ready || !commitment || !orgSlug) return null
  return supportSurfaceRoute(primarySupportSurface(commitment), orgSlug)
}

export default primarySupportSurface
