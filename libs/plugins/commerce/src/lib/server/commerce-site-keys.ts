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

import { hostStampedSitePermission, hostStampedWorkspaceSitePermission } from '@aglyn/aglyn/app-utils/host-permissions'
import type { HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { COMMERCE_SITE_PERMISSIONS, type CommerceSitePermission } from '../model/plugin-permissions'
import {
  COMMERCE_WORKSPACE_SITE_PERMISSIONS,
  type CommerceWorkspaceSitePermission,
} from '../model/workspace-site-permissions'

/** Each commerce site key's site-role preset: the declarations' own table. */
const COMMERCE_SITE_PRESETS: Readonly<Record<string, Readonly<Partial<Record<HostAccessRole, boolean>>>>> =
  Object.fromEntries(
    [...COMMERCE_SITE_PERMISSIONS, ...COMMERCE_WORKSPACE_SITE_PERMISSIONS].map((entry) => [
      entry.key,
      entry.hostRoleDefaults ?? {},
    ]),
  )

/**
 * Does this member hold one of commerce's site keys on this site, as the
 * rules would read it (AGL-4047): the site's `memberPermissions` stamp, else
 * the preset of their `memberRoles` entry. `host` is the host snapshot or its
 * data, which every door here reads already.
 */
export function holdsCommerceSiteKey(
  host: { get(field: string): unknown } | { memberPermissions?: unknown; memberRoles?: unknown } | null | undefined,
  uid: string,
  key: CommerceSitePermission,
): boolean {
  if (!host || !uid) return false
  const read = (field: string): unknown =>
    typeof (host as { get?: unknown }).get === 'function'
      ? (host as { get(field: string): unknown }).get(field)
      : (host as Record<string, unknown>)[field]
  return hostStampedSitePermission(
    { memberPermissions: read('memberPermissions'), memberRoles: read('memberRoles') },
    uid,
    key,
    COMMERCE_SITE_PRESETS[key] ?? {},
  )
}

/**
 * Does this member hold one of commerce's keys whose preset holds for
 * members of the whole workspace only (AGL-4047): refunds, the register's
 * over-limit approvals, order webhooks. The site's stamp when the
 * projection wrote one, else exactly the gate the key replaced: the site's
 * Admin in `memberRoles`, a member of the whole workspace (`orgWide`), and
 * Admin on the site as resolved now (`hostRole`). `membership` is the
 * resolution every one of those doors reads already.
 */
export function holdsCommerceWorkspaceSiteKey(
  hostDoc: { get(field: string): unknown } | { memberPermissions?: unknown; memberRoles?: unknown } | null | undefined,
  uid: string,
  key: CommerceWorkspaceSitePermission,
  membership: { orgWide: boolean; hostRole: string | null | undefined },
): boolean {
  if (!hostDoc || !uid) return false
  const read = (field: string): unknown =>
    typeof (hostDoc as { get?: unknown }).get === 'function'
      ? (hostDoc as { get(field: string): unknown }).get(field)
      : (hostDoc as Record<string, unknown>)[field]
  return hostStampedWorkspaceSitePermission(
    { memberPermissions: read('memberPermissions'), memberRoles: read('memberRoles') },
    uid,
    key,
    COMMERCE_SITE_PRESETS[key] ?? {},
    membership,
  )
}
