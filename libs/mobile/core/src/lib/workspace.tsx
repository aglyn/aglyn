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

/**
 * The workspace (org) and site switcher's state (AGL-3620).
 *
 * Reads the same per-user indexes the console's switchers read, under the
 * same rules: `users/{uid}/orgs` for workspaces and
 * `users/{uid}/hostMemberships` (where `orgId ==`, by `nameLower`, the
 * console's own indexed query) for sites. The pick is remembered per person
 * on the device, and a remembered org or site the person no longer belongs
 * to is dropped rather than shown.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
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
import { useMobileAuth } from './auth'
import { getMobileFirebase } from './firebase'

export interface WorkspaceOrg {
  id: string
  name: string
  slug: string
  role: string
}

export interface WorkspaceSite {
  id: string
  orgId: string
  name: string
  subdomain: string
  role: string
}

export interface WorkspaceState {
  orgs: WorkspaceOrg[]
  sites: WorkspaceSite[]
  org: WorkspaceOrg | null
  site: WorkspaceSite | null
  /** False until the org list (and, with an org, its sites) has arrived once. */
  ready: boolean
  error: string | null
  selectOrg(orgId: string): void
  selectSite(hostId: string | null): void
}

/** The workspace window the switcher loads; matches the console's first page. */
export const ORG_WINDOW = 50
export const SITE_WINDOW = 100

const storageKey = (uid: string) => `aglyn.workspace.${uid}`

interface Picked {
  orgId: string | null
  hostId: string | null
}

export function orgFromMembership(id: string, data: Record<string, unknown>): WorkspaceOrg {
  return {
    id,
    name: String(data['orgName'] ?? data['slug'] ?? id),
    slug: String(data['slug'] ?? id),
    role: String(data['role'] ?? ''),
  }
}

export function siteFromMembership(id: string, data: Record<string, unknown>): WorkspaceSite {
  const subdomain = String(data['subdomain'] ?? '')
  return {
    id,
    orgId: String(data['orgId'] ?? ''),
    name: String(data['displayName'] ?? (subdomain || id)),
    subdomain,
    role: String(data['role'] ?? ''),
  }
}

/** Which org and site to show, given what is remembered and what exists. */
export function reconcilePick(
  picked: Picked,
  orgs: readonly WorkspaceOrg[],
  sites: readonly WorkspaceSite[] | null,
): Picked {
  const orgId = orgs.some((org) => org.id === picked.orgId)
    ? picked.orgId
    : (orgs[0]?.id ?? null)
  if (orgId !== picked.orgId) return { orgId, hostId: null }
  if (sites === null) return { orgId, hostId: picked.hostId }
  const hostId = sites.some((site) => site.id === picked.hostId)
    ? picked.hostId
    : (sites[0]?.id ?? null)
  return { orgId, hostId }
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useMobileAuth()
  const { firestore } = getMobileFirebase()
  const uid = user?.uid ?? null
  const [orgs, setOrgs] = useState<WorkspaceOrg[] | null>(null)
  const [sites, setSites] = useState<WorkspaceSite[] | null>(null)
  const [picked, setPicked] = useState<Picked>({ orgId: null, hostId: null })
  const [restored, setRestored] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Restore the remembered pick for this person.
  useEffect(() => {
    setRestored(false)
    setOrgs(null)
    setSites(null)
    if (!uid) return
    let active = true
    AsyncStorage.getItem(storageKey(uid))
      .then((raw) => {
        if (!active) return
        const parsed = raw ? (JSON.parse(raw) as Picked) : null
        setPicked({ orgId: parsed?.orgId ?? null, hostId: parsed?.hostId ?? null })
      })
      .catch(() => undefined)
      .finally(() => active && setRestored(true))
    return () => {
      active = false
    }
  }, [uid])

  useEffect(() => {
    if (!uid) return
    return onSnapshot(
      query(collection(firestore, 'users', uid, 'orgs'), limit(ORG_WINDOW)),
      (snapshot) => {
        setError(null)
        setOrgs(
          snapshot.docs
            .map((doc) => orgFromMembership(doc.id, doc.data()))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      },
      () => setError('Could not load your workspaces.'),
    )
  }, [firestore, uid])

  const orgId = restored && orgs ? reconcilePick(picked, orgs, null).orgId : null

  useEffect(() => {
    setSites(null)
    if (!uid || !orgId) return
    return onSnapshot(
      query(
        collection(firestore, 'users', uid, 'hostMemberships'),
        where('orgId', '==', orgId),
        orderBy('nameLower', 'asc'),
        limit(SITE_WINDOW),
      ),
      (snapshot) => {
        setError(null)
        setSites(snapshot.docs.map((doc) => siteFromMembership(doc.id, doc.data())))
      },
      () => setError('Could not load the sites in this workspace.'),
    )
  }, [firestore, uid, orgId])

  const effective = useMemo(
    () => (restored && orgs ? reconcilePick(picked, orgs, sites) : { orgId: null, hostId: null }),
    [restored, orgs, sites, picked],
  )

  // Remember what is actually shown, so a stale pick heals on disk too.
  useEffect(() => {
    if (!uid || !restored || !orgs) return
    AsyncStorage.setItem(storageKey(uid), JSON.stringify(effective)).catch(() => undefined)
  }, [uid, restored, orgs, effective])

  const selectOrg = useCallback((next: string) => setPicked({ orgId: next, hostId: null }), [])
  const selectSite = useCallback(
    (hostId: string | null) => setPicked((current) => ({ ...current, hostId })),
    [],
  )

  const value = useMemo<WorkspaceState>(() => {
    const orgList = orgs ?? []
    const siteList = sites ?? []
    return {
      orgs: orgList,
      sites: siteList,
      org: orgList.find((org) => org.id === effective.orgId) ?? null,
      site: siteList.find((site) => site.id === effective.hostId) ?? null,
      ready: restored && orgs !== null && (orgList.length === 0 || sites !== null),
      error,
      selectOrg,
      selectSite,
    }
  }, [orgs, sites, effective, restored, error, selectOrg, selectSite])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceState {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace needs <WorkspaceProvider> around it')
  return value
}
