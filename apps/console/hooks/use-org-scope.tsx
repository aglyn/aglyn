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

import type { UserOrgMembership } from '@aglyn/aglyn'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const SELECTED_ORG_STORAGE_KEY = 'aglyn.selectedOrgId'

/**
 * Console hostnames that are NOT org workspaces. Anything else with a
 * subdomain (e.g. business1.aglyn.io) resolves through orgSlugs.
 */
const APEX_LABELS = new Set(['console', 'www', 'app', 'localhost', 'aglyn'])

function subdomainSlugFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const [label, ...rest] = window.location.hostname.split('.')
  if (rest.length < 1) return null // localhost, bare hosts
  if (APEX_LABELS.has(label)) return null
  // Vercel previews (foo.vercel.app) and IPs are not workspaces either.
  if (window.location.hostname.endsWith('.vercel.app')) return null
  return label
}

export interface OrgScopeContextValue {
  /** Every org the user belongs to, from the reverse index. */
  orgs: UserOrgMembership[]
  /** The org the console is currently scoped to (null pre-resolution). */
  currentOrg: UserOrgMembership | null
  /** Remembers the last apex selection (used by the org jump page). */
  selectOrg: (orgId: string) => void
  /** The workspace slug the page was opened under, when subdomain-scoped. */
  orgSlug: string | null
  /**
   * The org slug in the URL path (`/[orgSlug]/…`), the source of truth for
   * the active workspace on org-scoped routes (AGL-621); null off them.
   */
  pathOrgSlug: string | null
  loading: boolean
}

const OrgScopeContext = createContext<OrgScopeContextValue>({
  orgs: [],
  currentOrg: null,
  selectOrg: () => undefined,
  orgSlug: null,
  pathOrgSlug: null,
  loading: true,
})

/**
 * Org workspace context (AGL-236/AGL-621): the Slack-style scope the
 * console operates in. The URL is the source of truth — the `/[orgSlug]/…`
 * path segment wins, so a stale local selection can never override the org
 * you navigated to (this is what killed the old switch-bounce). Precedence:
 * the path slug, then the workspace subdomain (resolved via the public
 * orgSlugs doc — the deferred subdomain form), then the locally remembered
 * selection (jump-page convenience), then the user's first org.
 */
export function OrgScopeProvider(props: { children?: ReactNode }) {
  const { children } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const params = useParams<{ orgSlug?: string | string[] }>()
  const pathOrgSlug =
    typeof params?.orgSlug === 'string' ? params.orgSlug : null
  const [orgs, setOrgs] = useState<UserOrgMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [subdomainOrgId, setSubdomainOrgId] = useState<string | null>(null)
  const orgSlug = useMemo(subdomainSlugFromLocation, [])

  useEffect(() => {
    if (!user?.uid) {
      setOrgs([])
      setLoading(false)
      return undefined
    }
    setLoading(true)
    return onSnapshot(
      query(collection(firestore, 'users', user.uid, 'orgs'), limit(50)),
      (snapshot) => {
        setOrgs(
          snapshot.docs.map(
            (entry) => ({ $id: entry.id, ...entry.data() }) as UserOrgMembership,
          ),
        )
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [firestore, user?.uid])

  useEffect(() => {
    setSelectedOrgId(
      typeof window === 'undefined'
        ? null
        : window.localStorage.getItem(SELECTED_ORG_STORAGE_KEY),
    )
  }, [])

  useEffect(() => {
    if (!orgSlug) return
    let active = true
    void getDoc(doc(firestore, 'orgSlugs', orgSlug))
      .then((snapshot) => {
        if (active) {
          setSubdomainOrgId((snapshot.data()?.['orgId'] as string) ?? null)
        }
      })
      .catch(() => {
        if (active) setSubdomainOrgId(null)
      })
    return () => {
      active = false
    }
  }, [firestore, orgSlug])

  const selectOrg = useCallback((orgId: string) => {
    setSelectedOrgId(orgId)
    try {
      window.localStorage.setItem(SELECTED_ORG_STORAGE_KEY, orgId)
    } catch {
      // storage unavailable (private mode) — selection lives for the session
    }
  }, [])

  const currentOrg = useMemo(() => {
    const bySlug = (slug: string | null) =>
      (slug && orgs.find((org) => org.slug === slug)) || null
    const byId = (orgId: string | null) =>
      (orgId && orgs.find((org) => org.$id === orgId)) || null
    // The URL path is authoritative on org-scoped routes; everything else is
    // a fallback for routes without an `[orgSlug]` (the jump page, manage/*).
    return (
      bySlug(pathOrgSlug) ??
      byId(subdomainOrgId) ??
      byId(selectedOrgId) ??
      orgs[0] ??
      null
    )
  }, [orgs, pathOrgSlug, subdomainOrgId, selectedOrgId])

  const context = useMemo(
    () => ({
      orgs,
      currentOrg,
      selectOrg,
      orgSlug,
      pathOrgSlug,
      loading,
    }),
    [orgs, currentOrg, selectOrg, orgSlug, pathOrgSlug, loading],
  )

  return (
    <OrgScopeContext.Provider value={context}>
      {children}
    </OrgScopeContext.Provider>
  )
}
OrgScopeProvider.displayName = 'OrgScopeProvider'

export function useOrgScope(): OrgScopeContextValue {
  return useContext(OrgScopeContext)
}

/**
 * The active org slug for building `/[orgSlug]/…` links (AGL-621). The URL
 * path is authoritative; the current org's slug is the fallback while the
 * path is being resolved. Empty string only before anything resolves.
 */
export function useOrgSlug(): string {
  const { pathOrgSlug, currentOrg } = useContext(OrgScopeContext)
  return pathOrgSlug ?? currentOrg?.slug ?? ''
}

export default useOrgScope
