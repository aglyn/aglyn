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
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import useOrgWorkspace from './use-org-workspace'
import useTenantPermissions from './use-tenant-permissions'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

/**
 * The tenant the signed-in user ACTS IN. Owners resolve their own doc
 * (`tenants/{uid}`); team members (AGL-127) resolve the OWNER's tenant via
 * their membership record, so plan/entitlements come from the account they
 * belong to — a member is a user of a single tenant, not a tenant of their
 * own. Rules grant members read on the owner doc via the members
 * subcollection.
 *
 * Subscribes with a raw `onSnapshot` (with its own retry) rather than
 * reactfire's `useFirestoreDocData` — that hook's cached Observable is a
 * *terminated* RxJS stream once it errors, so it can't recover from the one
 * transient `permission-denied` this read can hit right after sign-in, when
 * `useUser()` reports a signed-in user a beat before Firestore's own
 * credential provider has attached that user's ID token (AGL-216).
 */
export function useCurrentTenant(): {
  tenant: Partial<AglynTenant> | undefined
  tenantId: string | undefined
  /** The org the billing data came from, once orgs carry it (AGL-237). */
  orgId: string | undefined
} {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { ownerUid } = useTenantPermissions()
  const { currentOrg, loading: orgsLoading } = useOrgWorkspace()
  const tenantId = ownerUid ?? user?.uid
  // Billing re-key (AGL-237): the org doc mirrors plan/entitlements
  // (backfill + webhook), so it is preferred as the source once the user
  // has an org; uid-keyed tenants remain the fallback until AGL-238
  // retires them. The returned tenantId stays uid-keyed for the legacy
  // billing APIs either way.
  const orgId = currentOrg?.$id
  const sourcePath = orgsLoading
    ? null
    : orgId
      ? (['orgs', orgId] as const)
      : tenantId
        ? (['tenants', tenantId] as const)
        : null
  const [tenant, setTenant] = useState<Partial<AglynTenant> | undefined>(
    undefined,
  )

  useEffect(() => {
    if (!sourcePath) {
      setTenant(undefined)
      return
    }
    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const [collectionName, docId] = sourcePath
    const subscribe = () => {
      unsubscribe = onSnapshot(
        doc(firestore, collectionName, docId),
        (snapshot) => {
          if (cancelled) return
          attempt = 0
          setTenant(
            snapshot.exists()
              ? ({ $id: snapshot.id, ...snapshot.data() } as Partial<AglynTenant>)
              : undefined,
          )
        },
        () => {
          if (cancelled) return
          unsubscribe?.()
          if (attempt < MAX_RETRIES) {
            attempt += 1
            timer = setTimeout(subscribe, RETRY_DELAY_MS)
          }
        },
      )
    }
    subscribe()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsubscribe?.()
    }
    // sourcePath is derived state; its parts are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, sourcePath?.[0], sourcePath?.[1]])

  return { tenant, tenantId, orgId }
}

export default useCurrentTenant
