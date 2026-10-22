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
import type { ActivityDescription } from '@aglyn/aglyn/app-utils/activity-labels'
import { buildRoute, Route } from '../constants/route-links'

/** The anchor of the staff "Aglyn AI requests" card, which a job link opens. */
export const AI_REQUESTS_ANCHOR = 'aglyn-ai-requests'

/**
 * Where a staff reader can go from an activity or audit row (AGL-3660): the
 * AI job behind it — the org's AI requests card, opened on that one job —
 * the site's staff page, the organization's and the account's.
 */
export function staffActivityLinks(
  described: ActivityDescription,
): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = []
  if (described.jobId && described.orgId) {
    const org = buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: described.orgId })
    links.push({
      label: 'Open the AI job',
      href: `${org}?aiJob=${encodeURIComponent(described.jobId)}#${AI_REQUESTS_ANCHOR}`,
    })
  }
  if (described.hostId) {
    links.push({
      label: 'Open the site',
      href: buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: described.hostId }),
    })
  }
  if (described.orgId) {
    links.push({
      label: 'Open the organization',
      href: buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: described.orgId }),
    })
  }
  if (described.uid) {
    links.push({
      label: 'Open the account',
      href: buildRoute(Route.ADMIN_USER_DETAIL, { uid: described.uid }),
    })
  }
  return links
}
