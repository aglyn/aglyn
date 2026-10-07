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

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { SITE_LIST_DECLARATION, siteListBase } from '@aglyn/aglyn/app-utils/site-list-query'
import { searchWords, useLiveDoc, useMobileListQuery } from '@aglyn/mobile-core'
import type { ListFilterRequest } from '@aglyn/shared-util-tools/list-query/list-filter'
import { useMemo } from 'react'
import type { HostDoc, SiteMembershipRow } from './site-model'

/*==========================================
 * THE SITES LIST, ON THE CONSOLE'S QUERY.
 *
 * The console's Sites page asks ONE query of the reader's own
 * `users/{uid}/hostMemberships` rows (`SITE_LIST_DECLARATION`): the
 * workspace (`siteListBase`), the Custom domain clause and the search word,
 * by name. The rows are owner-readable, so the rules admit any `where` on
 * them, and a member limited to some sites holds rows only for those: the
 * list is the reader's scope by construction. Each row's status is read from
 * its host document, which the rules let a member of that site read.
 *=========================================*/

/** The Custom domain filter's three positions: any, connected, none. */
export type CustomDomainFilter = 'all' | 'true' | 'false'

export function siteListClauses(customDomain: CustomDomainFilter): ListFilterRequest[] {
  return customDomain === 'all' ? [] : [{ field: 'hasCustomDomain', op: 'is', value: customDomain }]
}

export function useSiteList(options: {
  firestore: unknown
  uid: string
  orgId: string | null
  search: string
  customDomain: CustomDomainFilter
}) {
  const { firestore, uid, orgId, search, customDomain } = options
  const request = useMemo(
    () => ({
      clauses: siteListClauses(customDomain),
      search: searchWords(search),
      base: siteListBase(orgId),
    }),
    [customDomain, search, orgId],
  )
  return useMobileListQuery<SiteMembershipRow>({
    firestore,
    path: uid ? ['users', uid, 'hostMemberships'] : null,
    declaration: SITE_LIST_DECLARATION,
    request,
    normalizers: nameSearchNormalizers,
  })
}

/** A site's host document, live. */
export function useHostDoc(firestore: unknown, hostId: string | null) {
  return useLiveDoc<Omit<HostDoc, '$id'>>(firestore, hostId ? ['hosts', hostId] : null)
}

/** The reader's own membership row for a site (their role on it), live. */
export function useSiteMembership(firestore: unknown, uid: string, hostId: string | null) {
  return useLiveDoc<Omit<SiteMembershipRow, '$id'>>(
    firestore,
    hostId && uid ? ['users', uid, 'hostMemberships', hostId] : null,
  )
}

/** A page of a site (its home page, for the Besigner and its last publish), live. */
export function useScreenDoc(firestore: unknown, hostId: string | null, screenId: string | null | undefined) {
  return useLiveDoc<{ versionId?: string; publishedAt?: unknown; displayName?: string }>(
    firestore,
    hostId && screenId ? ['hosts', hostId, 'screens', screenId] : null,
  )
}
