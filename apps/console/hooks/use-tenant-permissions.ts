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

import type { OrgRole } from '@aglyn/aglyn'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import useOrgWorkspace from './use-org-workspace'

export interface TenantPermissions {
  createHosts: boolean
  editHosts: boolean
  editBilling: boolean
  publishToCommunity: boolean
  installPlugins: boolean
  manageMembers: boolean
}

const ALL_TRUE: TenantPermissions = {
  createHosts: true,
  editHosts: true,
  editBilling: true,
  publishToCommunity: true,
  installPlugins: true,
  manageMembers: true,
}

const EDITOR: TenantPermissions = {
  createHosts: false,
  editHosts: true,
  editBilling: false,
  publishToCommunity: true,
  installPlugins: true,
  manageMembers: false,
}

const VIEWER: TenantPermissions = {
  createHosts: false,
  editHosts: false,
  editBilling: false,
  publishToCommunity: false,
  installPlugins: false,
  manageMembers: false,
}

const ROLE_PERMISSIONS: Record<OrgRole, TenantPermissions> = {
  owner: ALL_TRUE,
  admin: ALL_TRUE,
  editor: EDITOR,
  viewer: VIEWER,
}

/**
 * Signed-in user's permissions in the current org workspace (AGL-238,
 * replacing the manager-seat flags from AGL-108): the org role decides.
 * Accounts without an org yet act as owners (the org is created on first
 * need). Defaults to full access while loading and on failure — the
 * server APIs are the actual enforcement point, this hook only
 * hides/disables surfaces.
 */
export function useTenantPermissions(): {
  permissions: TenantPermissions
  isOwner: boolean
  /** Org the permissions were resolved in (undefined pre-first-org). */
  orgId: string | undefined
  role: OrgRole | undefined
  loaded: boolean
} {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { currentOrg, loading: orgsLoading } = useOrgWorkspace()
  const orgId = currentOrg?.$id
  const [state, setState] = useState<{
    permissions: TenantPermissions
    isOwner: boolean
    orgId: string | undefined
    role: OrgRole | undefined
    loaded: boolean
  }>({
    permissions: ALL_TRUE,
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
        permissions: ALL_TRUE,
        isOwner: true,
        orgId: undefined,
        role: undefined,
        loaded: true,
      })
      return
    }
    let active = true
    void getDoc(doc(firestore, 'orgs', orgId, 'members', uid))
      .then((snapshot) => {
        if (!active) return
        const role = (snapshot.get('role') ?? 'viewer') as OrgRole
        setState({
          permissions: ROLE_PERMISSIONS[role] ?? VIEWER,
          isOwner: role === 'owner' || role === 'admin',
          orgId,
          role,
          loaded: true,
        })
      })
      .catch(() => {
        // Fail open — surfaces stay visible; APIs still enforce.
        if (active) setState((prev) => ({ ...prev, orgId, loaded: true }))
      })
    return () => {
      active = false
    }
  }, [user, firestore, orgId, orgsLoading])

  return state
}

export default useTenantPermissions
