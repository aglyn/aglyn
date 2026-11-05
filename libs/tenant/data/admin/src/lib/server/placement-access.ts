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

import { oneSitePlacement, placementVerdict, stampedPlacementKey } from '@aglyn/aglyn/app-utils/site-placement'
import { isLockdownActive } from '@aglyn/aglyn/app-utils/lockdown'
import type { AglynOrgMember, HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'

/**
 * May this member act on a workspace resource placed at `visibleTo` (AGL-4047),
 * by the verdict in `site-placement`? The Admin SDK evaluates no rules, so this
 * repeats the rule for the routes, reading what it reads: the site's stamp, the
 * workspace it belongs to and its suspension. One read of the site, and none for
 * a member the workspace key already admitted.
 */
export async function memberMayActOnPlaced(input: {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  uid: string
  member: Partial<AglynOrgMember>
  visibleTo: unknown
  /** The member's answer on the workspace key, which the caller has resolved. */
  workspace: boolean
  siteKey: string
  sitePreset: Readonly<Partial<Record<HostAccessRole, boolean>>>
}): Promise<boolean> {
  const { firestore, orgId, uid, member, visibleTo, workspace, siteKey, sitePreset } = input
  return placementVerdict<Promise<boolean>>({
    member,
    visibleTo,
    workspace,
    site: async (hostId) => {
      const site = await firestore.collection('hosts').doc(hostId).get()
      if (!site.exists || site.get('orgId') !== orgId) return false
      const memberRoles = site.get('memberRoles') as Record<string, unknown> | undefined
      if (memberRoles?.[uid] == null) return false
      if (site.get('suspendedAt') != null && isLockdownActive({ untilMs: site.get('suspendedUntilMs') }, Date.now())) {
        return false
      }
      return stampedPlacementKey(
        { memberPermissions: site.get('memberPermissions'), memberRoles },
        uid,
        siteKey,
        sitePreset,
        member.role,
      )
    },
  })
}

/** The key a refusal names: the site's for a resource on one site, else the workspace's. */
export function placedRefusalPermission(visibleTo: unknown, workspaceKey: string, siteKey: string): string {
  return oneSitePlacement(visibleTo) ? siteKey : workspaceKey
}
