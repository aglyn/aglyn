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

export interface OrgWorkspaceContextValue {
  /** Every org the user belongs to, from the reverse index. */
  orgs: UserOrgMembership[]
  /** The org the console is currently scoped to (null pre-resolution). */
  currentOrg: UserOrgMembership | null
  /** Selects an org on the apex console (persisted locally). */
  selectOrg: (orgId: string) => void
  /** The workspace slug the page was opened under, when subdomain-scoped. */
  workspaceSlug: string | null
  loading: boolean
}

const OrgWorkspaceContext = createContext<OrgWorkspaceContextValue>({
  orgs: [],
  currentOrg: null,
  selectOrg: () => undefined,
  workspaceSlug: null,
  loading: true,
})

/**
 * Org workspace context (AGL-236): the
 * Slack-style scope the console operates in. Precedence — the workspace
 * subdomain ({slug}.aglyn.com, resolved via the public orgSlugs doc),
 * then the locally remembered selection, then the user's first org.
 */
export function OrgWorkspaceProvider(props: { children?: ReactNode }) {
  const { children } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const [orgs, setOrgs] = useState<UserOrgMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [subdomainOrgId, setSubdomainOrgId] = useState<string | null>(null)
  const workspaceSlug = useMemo(subdomainSlugFromLocation, [])

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
    if (!workspaceSlug) return
    let active = true
    void getDoc(doc(firestore, 'orgSlugs', workspaceSlug))
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
  }, [firestore, workspaceSlug])

  const selectOrg = useCallback((orgId: string) => {
    setSelectedOrgId(orgId)
    try {
      window.localStorage.setItem(SELECTED_ORG_STORAGE_KEY, orgId)
    } catch {
      // storage unavailable (private mode) — selection lives for the session
    }
  }, [])

  const currentOrg = useMemo(() => {
    const byId = (orgId: string | null) =>
      (orgId && orgs.find((org) => org.$id === orgId)) || null
    return byId(subdomainOrgId) ?? byId(selectedOrgId) ?? orgs[0] ?? null
  }, [orgs, subdomainOrgId, selectedOrgId])

  const context = useMemo(
    () => ({ orgs, currentOrg, selectOrg, workspaceSlug, loading }),
    [orgs, currentOrg, selectOrg, workspaceSlug, loading],
  )

  return (
    <OrgWorkspaceContext.Provider value={context}>
      {children}
    </OrgWorkspaceContext.Provider>
  )
}
OrgWorkspaceProvider.displayName = 'OrgWorkspaceProvider'

export function useOrgWorkspace(): OrgWorkspaceContextValue {
  return useContext(OrgWorkspaceContext)
}

export default useOrgWorkspace
