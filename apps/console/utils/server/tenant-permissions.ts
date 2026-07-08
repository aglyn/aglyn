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

import {
  isBuiltInRole,
  resolveRolePermissions,
  type TenantCustomRole,
  type TenantPermissionSet,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

export type { TenantPermissionSet }

export interface ResolvedTenantPermissions {
  /** True when the uid has no manager-membership record anywhere. */
  isOwner: boolean
  /** Owner uid whose tenant the permissions apply to (self for owners). */
  ownerUid: string
  permissions: TenantPermissionSet
}

const ALL_TRUE: TenantPermissionSet = resolveRolePermissions('admin')

/**
 * Tenant permission resolver (AGL-108): a uid with a manager-membership
 * record (`tenants/{owner}/members`, doc keyed by uid once the account
 * exists) acts under that record's permission flags; every other account
 * is a single-user owner with full access — which keeps today's accounts
 * unaffected (dark-launch). Fails OPEN on lookup errors so a missing
 * collection-group index cannot lock owners out; the flags are a
 * product-tier boundary, not the security boundary (host access still
 * rides the `admins` rules map).
 */
export async function resolveTenantPermissions(
  uid: string,
): Promise<ResolvedTenantPermissions> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const snapshot = await firestore
      .collectionGroup('members')
      .where('uid', '==', uid)
      .limit(5)
      .get()
    // Only tenant memberships count — host member docs share the
    // collection id.
    const membership = snapshot.docs.find(
      (docSnapshot) => docSnapshot.ref.parent.parent?.parent.id === 'tenants',
    )
    if (!membership) {
      return { isOwner: true, ownerUid: uid, permissions: ALL_TRUE }
    }
    const data = membership.data()
    const ownerUid = membership.ref.parent.parent?.id ?? uid
    // Custom roles (AGL-133): a non-built-in role id resolves against the
    // owner's roles collection; missing docs fall back to viewer.
    let customRoles: Record<string, TenantCustomRole | undefined> | null = null
    const roleId = data['role']
    if (roleId && !isBuiltInRole(roleId)) {
      const roleSnapshot = await firestore
        .collection('tenants')
        .doc(ownerUid)
        .collection('roles')
        .doc(String(roleId))
        .get()
      if (roleSnapshot.exists) {
        customRoles = { [String(roleId)]: roleSnapshot.data() as any }
      }
    }
    // Role defaults + per-user overrides (AGL-120). Members created before
    // roles have no `role` and resolve as viewer + their stored flags —
    // identical effective permissions to the pre-role behavior.
    return {
      isOwner: false,
      ownerUid,
      permissions: resolveRolePermissions(
        data['role'],
        data['permissions'],
        customRoles,
      ),
    }
  } catch (error) {
    console.error('tenant-permissions resolve failed (failing open)', error)
    return { isOwner: true, ownerUid: uid, permissions: ALL_TRUE }
  }
}

export default resolveTenantPermissions
