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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import type { HostStatus } from '@aglyn/aglyn/app-utils/host-status'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import type { ChipTone } from '@aglyn/mobile-ui'

/*==========================================
 * A SITE, AS THE CONSOLE'S SITES CARDS DRAW IT.
 *
 * Status is `describeHostStatus` over the host document (Live, Draft,
 * Maintenance, Suspended), the same pill the console's Sites cards show. The
 * addresses follow the console's `hostDisplayDomain` and
 * `hostPlatformDomain` (apps/console/constants/tenant-links.ts): the custom
 * domain when connected, else `{subdomain}.{TENANT_APEX}`; that module lives
 * in the console app, so its two one-line rules are restated here over the
 * same shared apex.
 *=========================================*/

/** The host document fields a site's screens read. */
export interface HostDoc {
  $id: string
  displayName?: string
  subdomain?: string
  cname?: string
  orgId?: string
  screens?: Record<string, unknown>
  defaultHomeScreenId?: string
  maintenance?: boolean
  suspendedAt?: number
  suspendedUntilMs?: number
  memberRoles?: Record<string, string>
  createdAt?: unknown
}

/** A row of the reader's `users/{uid}/hostMemberships`, which the Sites list queries. */
export interface SiteMembershipRow {
  $id: string
  orgId?: string
  displayName?: string
  subdomain?: string
  role?: string
  hasCustomDomain?: boolean
  createdAt?: unknown
}

/** The site's public address: its custom domain, else its platform address. */
export function hostDisplayDomain(host: { cname?: string; subdomain?: string } | null | undefined): string | undefined {
  if (!host) return undefined
  return host.cname || hostPlatformDomain(host)
}

/** `{subdomain}.{apex}`, ignoring any custom domain. */
export function hostPlatformDomain(host: { subdomain?: string } | null | undefined): string | undefined {
  return host?.subdomain ? `${host.subdomain}.${TENANT_APEX}` : undefined
}

/** The live site, as the console's Visit button opens it. */
export function siteLiveUrl(host: { cname?: string; subdomain?: string } | null | undefined): string | null {
  const domain = hostDisplayDomain(host)
  return domain ? `https://${domain}/` : null
}

/** The status pill's color as the app's chip tone. */
export function statusTone(status: HostStatus): ChipTone {
  return status.color === 'default' ? 'default' : status.color
}

/** A site's name as the console prints it. */
export function siteName(site: { displayName?: string; subdomain?: string; $id: string }): string {
  return site.displayName || site.subdomain || site.$id
}

/** The console pages a site's screen links to, by the console's own route table. */
export function siteConsolePaths(orgSlug: string, subdomain: string) {
  const at = { orgSlug, host: subdomain }
  return {
    dashboard: buildRoute(Route.HOST_DASHBOARD, at),
    pages: buildRoute(Route.HOST_SCREENS, at),
    besigner: (screenId: string, versionId: string) =>
      buildRoute(Route.SCREEN_BESIGNER, { ...at, screenId, versionId }),
  }
}
