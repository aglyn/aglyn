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

import { collectDynamicListCandidates } from '@aglyn/tenant-data-admin/server/dynamic-list-materialize'
import { stampRecordEmailState } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import { lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import {
  logOrgActivity,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin/server/organizations'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'

/**
 * The platform's heavier server modules the Outreach routes reach
 * (AGL-2980): the permission resolver, the lockdown verdict, the activity
 * log and the saved-view sweep.
 *
 * Imported here statically, and this module is loaded by
 * `register-routes.ts` the first time a request needs one of them: the
 * manifest loads Outreach's server bundle into every console API process
 * whether or not an Outreach route is ever called, and `org-permissions`
 * alone reaches the whole tenant data barrel. Loading them through one
 * module of this plugin keeps every import of the platform's libraries a
 * static one.
 */

export { lockdownRefusal, logOrgActivity, resolveOrgPermissions, stampRecordEmailState }

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

/**
 * The addresses a saved Contacts view selects among one site's contacts,
 * read by the dynamic-list sweep's own scan, and whether it reached the
 * whole view.
 */
export async function crmViewEmails(input: {
  hostId: string
  viewId: string
}): Promise<{ emails: string[]; complete: boolean }> {
  const scan = await collectDynamicListCandidates({
    hostId: input.hostId,
    rule: { sources: ['contacts'], viewId: input.viewId },
  })
  return { emails: scan.candidates.map((candidate) => candidate.email), complete: scan.complete }
}
