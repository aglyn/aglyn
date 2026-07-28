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
'use client'

import {
  resolveOrgPermissions,
  type AglynOrgCustomRole,
  type AglynOrgMember,
  type OrgPermission,
  type OrgRole,
  type OrgPermissions,
} from '@aglyn/aglyn'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import useOrgScope from './use-org-scope'
import firestoreOneShotRetry from '../utils/firestore-one-shot-retry'

export type { OrgPermissions }

const ALL_TRUE: OrgPermissions = {
  createHosts: true,
  editHosts: true,
  editBilling: true,
  publishToCommunity: true,
  installPlugins: true,
  manageMembers: true,
}

const ALL_GRANTED = resolveOrgPermissions({ role: 'owner' })

/** Legacy boolean map derived from the granular permission set. */
function toLegacyPermissions(
  granted: Record<OrgPermission, boolean>,
  role: OrgRole | undefined,
): OrgPermissions {
  return {
    createHosts: granted['hosts.create'],
    editHosts: role !== 'viewer',
    editBilling: granted['billing.manage'],
    publishToCommunity: granted['community.publish'],
    installPlugins: granted['plugins.install'],
    manageMembers: granted['members.manage'],
  }
}

/**
 * Signed-in user's permissions in the current org workspace: the org role
 * decides the defaults; a custom role (`orgs/{orgId}/roles`, AGL-243) and
 * per-member overrides refine them. Accounts without an org yet act as
 * owners (the org is created on first need). Defaults to full access
 * while loading and on failure — the server APIs are the enforcement
 * point, this hook only hides/disables surfaces.
 */
export function useOrgPermissions(): {
  permissions: OrgPermissions
  /** Granular permission check (AGL-243). */
  can: (permission: OrgPermission) => boolean
  /** The full resolved permission map. */
  granted: Record<OrgPermission, boolean>
  isOwner: boolean
  /** Org the permissions were resolved in (undefined pre-first-org). */
  orgId: string | undefined
  role: OrgRole | undefined
  loaded: boolean
} {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { currentOrg, loading: orgsLoading } = useOrgScope()
  const orgId = currentOrg?.$id
  const [state, setState] = useState<{
    granted: Record<OrgPermission, boolean>
    isOwner: boolean
    orgId: string | undefined
    role: OrgRole | undefined
    loaded: boolean
  }>({
    granted: ALL_GRANTED,
    isOwner: true,
    orgId: undefined,
    role: undefined,
    loaded: false,
  })

  useEffect(() => {
    const uid = (user as any)?.uid as string | undefined
    if (orgsLoading || !uid) return
    if (!orgId) {
      // No org yet — fresh account, full access (owner of its future org).
      setState({
        granted: ALL_GRANTED,
        isOwner: true,
        orgId: undefined,
        role: undefined,
        loaded: true,
      })
      return
    }
    let active = true
    void (async () => {
      try {
        // Retried, and named for the session-health verdict (AGL-1063): a
        // member reading their OWN member doc is always allowed, so a
        // denial that survives the retries is about the session, not about
        // authorization. This read happens on every console page, which is
        // what makes it a useful second collection alongside whatever the
        // page itself reads.
        const snapshot = await firestoreOneShotRetry(
          () => getDoc(doc(firestore, 'orgs', orgId, 'members', uid)),
          'orgs/members',
        )
        const member = (snapshot.data() ?? {}) as Partial<AglynOrgMember>
        const role = (member.role ?? 'viewer') as OrgRole
        // Custom role layer (AGL-243): one extra read, only when assigned.
        let customRole: AglynOrgCustomRole | null = null
        if (member.roleId) {
          try {
            const roleSnapshot = await getDoc(
              doc(firestore, 'orgs', orgId, 'roles', member.roleId),
            )
            if (roleSnapshot.exists()) {
              customRole = roleSnapshot.data() as AglynOrgCustomRole
            }
          } catch {
            // Dangling roleId — fall back to the role defaults.
          }
        }
        if (!active) return
        setState({
          granted: resolveOrgPermissions(member, customRole),
          isOwner: role === 'owner' || role === 'admin',
          orgId,
          role,
          loaded: true,
        })
      } catch {
        // Fail open — surfaces stay visible; APIs still enforce.
        if (active) setState((prev) => ({ ...prev, orgId, loaded: true }))
      }
    })()
    return () => {
      active = false
    }
  }, [user, firestore, orgId, orgsLoading])

  return {
    permissions: state.loaded
      ? toLegacyPermissions(state.granted, state.role)
      : ALL_TRUE,
    can: (permission) => state.granted[permission],
    granted: state.granted,
    isOwner: state.isOwner,
    orgId: state.orgId,
    role: state.role,
    loaded: state.loaded,
  }
}

export default useOrgPermissions
