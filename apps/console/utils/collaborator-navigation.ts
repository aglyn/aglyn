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
 * Where a SITE COLLABORATOR belongs in the console (AGL-1032).
 *
 * A collaborator is invited to one site but is a real `orgs/{orgId}/members`
 * doc, so they land on `/[orgSlug]/…` like anyone else and used to get the
 * whole org strip — Team, Media, Data, Billing, Settings — every page of
 * which the AGL-1026 rules now answer with nothing. An empty Team page reads
 * as a broken console, not as a boundary; their console should be their site.
 *
 * Pure and separate from the guard because this is the part with the edge
 * cases: a redirect that returns a path the guard will redirect AGAIN is an
 * infinite loop in the address bar, and that is a unit test, not a UI pass.
 *
 * NOT an access control. The rules are (AGL-1026); this only decides which
 * URL a scoped member is shown.
 */

import { buildRoute, Route } from '../constants/route-links'

/** The `hostMemberships` fields the landing decision needs. */
export interface CollaboratorSite {
  $id?: string
  subdomain?: string
}

const segmentsOf = (path: string) => path.split('/').filter(Boolean)

/**
 * Is this path inside the sites area of `/[orgSlug]`?
 *
 * `/[orgSlug]/hosts` is the org's Sites TAB — an org page — while
 * `/[orgSlug]/hosts/[host]/…` is a site, which is the same third-segment
 * distinction `resolveNavSection` makes. A collaborator keeps the sites list
 * (it is how they pick between several) but nothing else above it.
 */
export function isSitePath(pathname: string | null, orgSlug: string): boolean {
  const [first, second, third] = segmentsOf(pathname ?? '')
  return first === orgSlug && second === 'hosts' && Boolean(third)
}

/**
 * The site list URL, or the single site itself when there is exactly one.
 *
 * The `[host]` segment is the SUBDOMAIN, not the doc id (`useHostResolution`
 * resolves it back), so a row without one cannot be linked to — fall back to
 * the list rather than building `/orgSlug/hosts/undefined`.
 */
export function collaboratorLanding(
  orgSlug: string,
  sites: readonly CollaboratorSite[],
): string {
  const only = sites.length === 1 ? sites[0]?.subdomain : undefined
  return only
    ? buildRoute(Route.HOST_DASHBOARD, { orgSlug, host: only })
    : buildRoute(Route.HOST_LIST, { orgSlug })
}

/**
 * Where to send a scoped collaborator standing on `pathname`, or null to
 * leave them where they are.
 *
 * Three cases, and the third is the one that loops if it is wrong:
 * - inside a site → stay (the HostGuard 404s a site they cannot reach);
 * - on the sites list → stay, UNLESS there is exactly one site, in which
 *   case skip the list of one and go in;
 * - anywhere else under the org → the landing above.
 *
 * A collaborator with NO sites (a revoked grant, or a projection that has not
 * caught up) stays on the sites list and sees its empty state. Sending them
 * "into their site" when there is none is how a redirect loop starts.
 */
export function collaboratorRedirect(
  pathname: string | null,
  orgSlug: string,
  sites: readonly CollaboratorSite[],
): string | null {
  const segments = segmentsOf(pathname ?? '')
  // Off this org's routes entirely (`/manage`, `/admin`) — not ours to move.
  if (segments[0] !== orgSlug) return null
  if (isSitePath(pathname, orgSlug)) return null
  const landing = collaboratorLanding(orgSlug, sites)
  const isList = segments[1] === 'hosts' && segments.length === 2
  if (isList && landing === buildRoute(Route.HOST_LIST, { orgSlug })) {
    return null
  }
  return landing
}

export default collaboratorRedirect
