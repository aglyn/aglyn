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

import { collection, getDocs, limit, query, type Firestore } from 'firebase/firestore'

/*==========================================
 * SITE LINKS ACROSS EVERY WORKSPACE (AGL-3618).
 *
 * The same two reverse indexes the console's org and site switchers read,
 * under the same rules (each user reads only their own):
 *
 * - `users/{uid}/orgs/{orgId}`: the workspaces, with their slug and name.
 * - `users/{uid}/hostMemberships/{hostId}`: the sites, with the org, the
 *   subdomain, the name and the member's role on it.
 *
 * Neither is an authorization source; they decide what is OFFERED. Every
 * page and route the app then opens re-checks access on the server.
 *=========================================*/

export type SiteRole = 'admin' | 'editor' | 'author' | 'viewer'

export interface SiteLink {
  hostId: string
  orgId: string
  orgSlug: string
  orgName: string
  subdomain: string
  name: string
  role: SiteRole | null
}

const ROLE_ORDER: Record<string, number> = { admin: 0, editor: 1, author: 2, viewer: 3 }

/** Joins the two indexes into sites the app can link to, sorted by workspace then name. */
export function joinWorkspaceSites(
  orgs: Array<{ id: string; slug?: string; orgName?: string }>,
  memberships: Array<{
    id: string
    orgId?: string
    subdomain?: string
    displayName?: string
    role?: string
  }>,
): SiteLink[] {
  const byId = new Map(orgs.map((org) => [org.id, org]))
  const sites: SiteLink[] = []
  for (const membership of memberships) {
    const org = membership.orgId ? byId.get(membership.orgId) : undefined
    // A site whose workspace has no slug cannot be addressed in the console
    // (every host route is `/{orgSlug}/hosts/{subdomain}`), so it is left out
    // rather than offered as a link that 404s.
    if (!org?.slug || !membership.subdomain) continue
    const role = membership.role && membership.role in ROLE_ORDER ? (membership.role as SiteRole) : null
    sites.push({
      hostId: membership.id,
      orgId: org.id,
      orgSlug: org.slug,
      orgName: org.orgName || org.slug,
      subdomain: membership.subdomain,
      name: membership.displayName || membership.subdomain,
      role,
    })
  }
  return sites.sort(
    (a, b) => a.orgName.localeCompare(b.orgName) || a.name.localeCompare(b.name),
  )
}

/** Every site the signed-in user can reach, at most `cap` of them. */
export async function listWorkspaceSites(
  firestore: Firestore,
  uid: string,
  cap = 200,
): Promise<SiteLink[]> {
  const [orgs, memberships] = await Promise.all([
    getDocs(query(collection(firestore, 'users', uid, 'orgs'), limit(cap))),
    getDocs(query(collection(firestore, 'users', uid, 'hostMemberships'), limit(cap))),
  ])
  return joinWorkspaceSites(
    orgs.docs.map((entry) => ({ id: entry.id, ...(entry.data() as object) })),
    memberships.docs.map((entry) => ({ id: entry.id, ...(entry.data() as object) })),
  )
}

/** `https://app.aglyn.com/{orgSlug}/hosts/{subdomain}/{page}`, each segment encoded. */
export function consoleSitePageUrl(
  origin: string,
  site: Pick<SiteLink, 'orgSlug' | 'subdomain'>,
  page: string,
  query?: Record<string, string>,
): string {
  const path = page
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const search = Object.entries(query ?? {})
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  return `${origin.replace(/\/+$/, '')}/${encodeURIComponent(site.orgSlug)}/hosts/${encodeURIComponent(
    site.subdomain,
  )}/${path}${search ? `?${search}` : ''}`
}
