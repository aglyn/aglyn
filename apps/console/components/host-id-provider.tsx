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

import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, useRef } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useHostResolution } from '../hooks/use-host-resolution'
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
/**
 * Whether resolution gave up after exhausting its retries (AGL-813). Distinct
 * from "resolved to no match": the HostGuard shows a retry instead of a 404
 * when this is set, so a transient read failure never masquerades as a site
 * that doesn't exist.
 */
export const HostErrorContext = createContext<boolean>(false)
/**
 * Re-runs host resolution (AGL-1200). The guard's "Try again" reloaded the
 * page, which re-entered the same cold-load window and failed identically —
 * so the error state was permanent in practice. This retries in place.
 */
export const HostRetryContext = createContext<() => void>(() => undefined)

export const useHostId = () => useContext(HostIdContext)
export const useHostSubdomain = () => useContext(HostSubdomainContext)
export const useHostReady = () => useContext(HostReadyContext)
/** Whether host resolution gave up after retries (AGL-813). */
export const useHostError = () => useContext(HostErrorContext)
/** Re-run host resolution after it gave up (AGL-1200). */
export const useHostRetry = () => useContext(HostRetryContext)

export function HostIdProvider({ children }) {
  const params = useParams<{ orgSlug?: string; host?: string }>()
  const hostSubdomain = typeof params?.host === 'string' ? params.host : null
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { currentOrg, orgs } = useOrgScope()
  const router = useRouter()
  const pathname = usePathname()

  // Resolve the URL subdomain to a host doc id within the CURRENT org via the
  // user's own `hostMemberships` projection (AGL-844) — two bounded reads with
  // a legacy fallback, replacing the scan of the org's whole host list. Scoping
  // to the current org is what the rules allow; a subdomain owned by another
  // org resolves to nothing here and the cross-org redirect below handles it.
  const { hostId, ready, error, retry } = useHostResolution(
    firestore,
    hostSubdomain,
    user?.uid,
    currentOrg?.$id ?? undefined,
  )
  const hostReady = !hostSubdomain || Boolean(currentOrg && ready)

  // Cross-org deep links (AGL-628). A subdomain belonging to ANOTHER org the
  // user is a member of resolves to nothing above — the org-scoped resolution
  // is all the rules allow — and the guard 404s a site they can actually open.
  //
  // `hostIndex` is signed-in readable and already mirrors `subdomain`, so a
  // single lookup finds the owning org without a new global index. If it is
  // an org the user belongs to, redirect to the canonical URL; if not, leave
  // the 404 standing, because that IS the right answer for a site they
  // cannot open. Either way we never sign anyone out (AGL-623).
  const redirectedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!hostSubdomain || !ready || hostId || !currentOrg) return
    if (redirectedRef.current === hostSubdomain) return
    let active = true
    void getDocs(
      query(
        collection(firestore, 'hostIndex'),
        where('subdomain', '==', hostSubdomain),
        limit(1),
      ),
    )
      .then((snapshot) => {
        if (!active) return
        const owningOrgId = snapshot.docs[0]?.get('orgId') as string | undefined
        if (!owningOrgId || owningOrgId === currentOrg.$id) return
        const target = (orgs ?? []).find((org) => org.$id === owningOrgId)
        if (!target?.slug || !pathname) return
        // Swap only the org segment; the rest of the deep link is still valid.
        const next = pathname.replace(/^\/[^/]+/, `/${target.slug}`)
        redirectedRef.current = hostSubdomain
        router.replace(next)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [
    hostSubdomain,
    ready,
    hostId,
    currentOrg,
    orgs,
    firestore,
    pathname,
    router,
  ])

  return (
    <HostReadyContext.Provider value={hostReady}>
      <HostErrorContext.Provider value={Boolean(hostSubdomain) && error}>
        <HostRetryContext.Provider value={retry}>
          <HostSubdomainContext.Provider value={hostSubdomain}>
            <HostIdContext.Provider value={hostId ?? null}>
              {children}
            </HostIdContext.Provider>
          </HostSubdomainContext.Provider>
        </HostRetryContext.Provider>
      </HostErrorContext.Provider>
    </HostReadyContext.Provider>
  )
}
HostIdProvider.displayName = 'HostIdProvider'

export default HostIdProvider
