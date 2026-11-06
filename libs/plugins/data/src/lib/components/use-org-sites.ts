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

import { HOST_ACCESS_ROLES } from '@aglyn/aglyn'
import { useFirestore, useFirestoreCollection, useUser } from '@aglyn/tenant-feature-instance'
import { collection, limit, query, where } from 'firebase/firestore'
import { useMemo } from 'react'

/** A site of the workspace the reader is a member of, as the Data page names it. */
export interface OrgSite {
  $id: string
  name?: string
  subdomain?: string
}

const NO_SITES: OrgSite[] = []

/**
 * The workspace's sites this reader is a member of, for naming who a dataset
 * is shared with (AGL-1145, AGL-4047).
 *
 * Queried here rather than via the console's `useOrgHosts`, because this
 * plugin is a lib and cannot import from an app, so it repeats that hook's
 * membership filter. `/hosts/{hostId}` is gated per document on
 * `memberRoles.{uid}`, and Firestore evaluates a LIST against the QUERY rather
 * than its results: filtering on `orgId` alone is a flat denial for every
 * non-staff reader (cloud/hosts-list-constraint.spec.mjs).
 *
 * ONE query, word for word, for the Data card and its Schema dialog: the SDK
 * serves two listeners of the same query from one target, so naming the
 * sites in the rail costs no read the dialog was not already making.
 */
export function useOrgSites(orgId: string | null | undefined): {
  sites: OrgSite[]
  /** Site id → the name the console shows for it. */
  hostNames: Readonly<Record<string, string>>
  ready: boolean
} {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | undefined)?.uid
  const { data } = useFirestoreCollection<OrgSite>(
    // Held rather than substituted while the uid resolves: a placeholder is
    // still a question asked of the server, and here one that is denied.
    () =>
      uid && orgId
        ? query(
            collection(firestore, 'hosts'),
            where(`memberRoles.${uid}`, 'in', HOST_ACCESS_ROLES),
            where('orgId', '==', orgId),
            limit(200),
          )
        : null,
    [firestore, orgId, uid],
    { idField: '$id' },
  )
  const sites = useMemo(() => data ?? NO_SITES, [data])
  const hostNames = useMemo(
    () => Object.fromEntries(sites.map((site) => [site.$id, site.name ?? site.subdomain ?? site.$id])),
    [sites],
  )
  return { sites, hostNames, ready: Array.isArray(data) }
}
