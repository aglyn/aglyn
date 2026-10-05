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

import { stampRecordEmailState } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import { lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import {
  logOrgActivity,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin/server/organizations'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  listTrackingHosts,
  removeTrackingHost,
  resolveTrackingLinkOrigin,
  setUpTrackingHost,
  verifyTrackingHost,
} from '@aglyn/tenant-data-admin/server/tracking-hosts'

/**
 * The platform's heavier server modules the Outreach routes reach
 * (AGL-2980): the permission resolver, the lockdown verdict and the
 * activity log. A saved view's people are the record system's to take
 * (`plugin-person-records`).
 *
 * Imported here statically, and this module is loaded by
 * `register-routes.ts` the first time a request needs one of them: the
 * manifest loads Outreach's server bundle into every console API process
 * whether or not an Outreach route is ever called, and `org-permissions`
 * alone reaches the whole tenant data barrel. Loading them through one
 * module of this plugin keeps every import of the platform's libraries a
 * static one.
 */

export {
  listTrackingHosts,
  lockdownRefusal,
  logOrgActivity,
  removeTrackingHost,
  resolveOrgPermissions,
  resolveTrackingLinkOrigin,
  setUpTrackingHost,
  stampRecordEmailState,
  verifyTrackingHost,
}

/**
 * Whether the member holds a CATALOG permission (`data.manage`) as the
 * org's roles resolve it — custom role and per-member overrides included.
 * A lookup that failed has not shown the member holds it.
 */
export async function holdsOrgCatalogPermission(uid: string, orgId: string, key: string): Promise<boolean> {
  try {
    const membership = await resolveOrgMembership(uid, orgId)
    if (!membership?.member) return false
    return (
      (await memberHasOrgPermission(
        orgId,
        membership.member,
        key as Parameters<typeof memberHasOrgPermission>[2],
      )) === true
    )
  } catch {
    return false
  }
}
