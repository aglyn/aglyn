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

import type { AglynTenant } from '@aglyn/aglyn'
import { doc } from 'firebase/firestore'
import { useFirestore, useFirestoreDocData, useUser } from 'reactfire'
import useTenantPermissions from './use-tenant-permissions'

/**
 * The tenant the signed-in user ACTS IN. Owners resolve their own doc
 * (`tenants/{uid}`); team members (AGL-127) resolve the OWNER's tenant via
 * their membership record, so plan/entitlements come from the account they
 * belong to — a member is a user of a single tenant, not a tenant of their
 * own. Rules grant members read on the owner doc via the members
 * subcollection.
 */
export function useCurrentTenant(): {
  tenant: Partial<AglynTenant> | undefined
  tenantId: string | undefined
} {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { ownerUid } = useTenantPermissions()
  const tenantId = ownerUid ?? user?.uid
  const { data } = useFirestoreDocData<any>(
    doc(firestore, 'tenants', tenantId ?? '-anonymous-'),
    { idField: '$id' },
  )
  return { tenant: tenantId ? data : undefined, tenantId }
}

export default useCurrentTenant
