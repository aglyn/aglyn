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

/**
 * The signed-in user's tenant doc. Billing v1 keys tenants by the owner's
 * uid (`tenants/{uid}`, single-user tenancy) — a missing doc simply resolves
 * as the free plan through `resolveTenantEntitlements`. Multi-user tenancy
 * (memberships) evolves this lookup later without changing consumers.
 */
export function useCurrentTenant(): {
  tenant: Partial<AglynTenant> | undefined
  tenantId: string | undefined
} {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const tenantId = user?.uid
  const { data } = useFirestoreDocData<any>(
    doc(firestore, 'tenants', tenantId ?? '-anonymous-'),
    { idField: '$id' },
  )
  return { tenant: tenantId ? data : undefined, tenantId }
}

export default useCurrentTenant
