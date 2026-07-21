/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { useParams } from 'next/navigation'
import { createContext, useContext } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useOrgHosts } from '../hooks/use-org-hosts'
import { useOrgScope } from '../hooks/use-org-scope'

/** The resolved host DOC ID — the internal key for all host data reads. */
export const HostIdContext = createContext<string>(null)
/** The host SUBDOMAIN from the URL — used to build `/hosts/[host]` links. */
export const HostSubdomainContext = createContext<string | null>(null)
/**
 * Whether subdomain→doc-id resolution has settled for the current host route
 * (true off host routes). The in-tree HostGuard reads this to hold the spinner
 * until resolution finishes, then 404s an unknown subdomain.
 */
export const HostReadyContext = createContext<boolean>(true)

export const useHostId = () => useContext(HostIdContext)
export const useHostSubdomain = () => useContext(HostSubdomainContext)
export const useHostReady = () => useContext(HostReadyContext)

export function HostIdProvider({ children }) {
  const params = useParams<{ orgSlug?: string; host?: string }>()
  const hostSubdomain = typeof params?.host === 'string' ? params.host : null
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()

  // Resolve the URL subdomain to a host doc id within the CURRENT org
  // (AGL-622). Scoping the query by orgId is what the security rules allow (an
  // unscoped all-orgs list is denied), so a subdomain that belongs to another
  // org simply isn't found here — the in-tree HostGuard renders the designed
  // 404, never a sign-out. (Cross-org deep-link redirect would need a global
  // subdomain index; tracked separately.) This provider is global (above the
  // route not-found boundaries), so it only RESOLVES and exposes state; the
  // HostGuard inside the host route tree enforces the spinner/404.
  const { hosts, ready } = useOrgHosts(
    firestore,
    user?.uid,
    currentOrg?.$id ?? undefined,
  )
  const match = hostSubdomain
    ? hosts.find(
        (h) => (h as { subdomain?: string }).subdomain === hostSubdomain,
      )
    : undefined
  const hostReady = !hostSubdomain || Boolean(currentOrg && ready)

  return (
    <HostReadyContext.Provider value={hostReady}>
      <HostSubdomainContext.Provider value={hostSubdomain}>
        <HostIdContext.Provider value={match?.$id ?? null}>
          {children}
        </HostIdContext.Provider>
      </HostSubdomainContext.Provider>
    </HostReadyContext.Provider>
  )
}
HostIdProvider.displayName = 'HostIdProvider'

export default HostIdProvider
