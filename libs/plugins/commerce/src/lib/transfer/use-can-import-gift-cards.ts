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

import type { hostRoleFor } from '@aglyn/aglyn/app-utils/organizations'
import { useFirestore, useFirestoreDoc, useHostOrgId, useUser } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { canImportGiftCards } from './records-transfer'

/**
 * Whether the signed-in member may import gift cards on this site
 * (AGL-3551): the workspace's owners and admins, and the site's admins —
 * read from their own membership, the same rule the server applies. False
 * until the membership is read, so Import never flashes for somebody it
 * would refuse.
 */
export function useCanImportGiftCards(hostId: string): boolean {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | null | undefined)?.uid ?? ''
  const orgId = useHostOrgId(hostId)
  const { data: member } = useFirestoreDoc<Parameters<typeof hostRoleFor>[0]>(
    () => (orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, orgId, uid],
  )
  return Boolean(member) && canImportGiftCards(member, hostId)
}
