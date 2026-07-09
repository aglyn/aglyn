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

import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

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

/**
 * Signed-in user's tenant permissions (AGL-108). Owners (any account
 * without a manager-membership record — every account today) resolve to
 * full access; manager members get their recorded flags. Defaults to full
 * access while loading and on failure — the server APIs are the actual
 * enforcement point, this hook only hides/disables surfaces.
 */
export function useTenantPermissions(): {
  permissions: TenantPermissions
  isOwner: boolean
  /** Owner uid whose tenant the user acts in (self for owners, AGL-127). */
  ownerUid: string | undefined
  loaded: boolean
} {
  const { data: user } = useUser()
  const [state, setState] = useState<{
    permissions: TenantPermissions
    isOwner: boolean
    ownerUid: string | undefined
    loaded: boolean
  }>({ permissions: ALL_TRUE, isOwner: true, ownerUid: undefined, loaded: false })

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        if (!idToken) return
        const response = await fetch('/api/tenant/permissions', {
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!response.ok) return
        const payload = await response.json()
        if (!active) return
        setState({
          permissions: { ...ALL_TRUE, ...(payload.permissions ?? {}) },
          isOwner: payload.isOwner !== false,
          ownerUid:
            typeof payload.ownerUid === 'string' ? payload.ownerUid : undefined,
          loaded: true,
        })
      } catch {
        // Fail open — surfaces stay visible; APIs still enforce.
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  return state
}

export default useTenantPermissions
