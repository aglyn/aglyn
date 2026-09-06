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
 * WHO IS CALLING AT THE ORGANIZATION LEVEL (AGL-2634).
 *
 * The CRM's host-routed actions — a stage move, a merge, an erasure, an
 * email — were written for the site hub: each resolves the org FROM the
 * site, checks the caller's role ON that site, and logs into that site's
 * feed. The organization-level hub (AGL-2630) mounts the same surfaces with
 * no site, and for a while every one of those actions ran "as the record's
 * own capturing site", which left a record nobody's site had captured with
 * nothing to run as. The org variant of each route authorizes HERE instead:
 * by the org the body names, for an org-wide member, with the permission
 * the whole CRM is gated on — the same three facts the org hub's own page
 * gate checks (`resolveOrgCrmAccess`), so what the console offers and what
 * the server admits cannot drift.
 *
 * A ROLE IS NOT A REACH. A site collaborator is a real member document
 * carrying `role: 'editor'`, and `resolveOrgPermissions` hands them
 * `data.manage` for their site — so a gate that read the permission alone
 * would admit a contractor on one microsite to act over every site in the
 * agency. `orgWide` is checked first and separately, and no permission
 * grant restores it; this is the boundary the host variants get for free
 * from the site role, spelled out for the variant that has no site.
 */

import { type AglynOrganization, canManageOrg, type PluginApiRequest } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgDoc } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'

/**
 * Which level a CRM route runs at, read off its body once.
 *
 * `orgId` present is the ORGANIZATION variant, whatever else the body
 * carries: the org-level console always names its org, and a `hostId`
 * beside it is the record's own site or the site an email leaves from —
 * never what the caller is authorized against. `hostId` alone is the site
 * variant every route has always had.
 */
export interface CrmRouteScope {
  level: 'site' | 'org'
  hostId: string
  orgId: string
}

export function readCrmRouteScope(
  body: Record<string, unknown> | null | undefined,
): CrmRouteScope | null {
  const hostId = String(body?.['hostId'] ?? '')
    .trim()
    .slice(0, 128)
  const orgId = String(body?.['orgId'] ?? '')
    .trim()
    .slice(0, 128)
  if (orgId) return { level: 'org', hostId, orgId }
  if (hostId) return { level: 'site', hostId, orgId: '' }
  return null
}

export interface OrgCaller {
  ok: true
  uid: string
  /** The token's address, or null for an account with none. */
  email: string | null
  /** The token's display name, `''` when it carries none. */
  name: string
  staff: boolean
  orgId: string
  org: Partial<AglynOrganization>
}

export interface OrgCallerRefusal {
  ok: false
  status: number
  error: string
}

/** What the caller must hold over the whole organization. */
export type OrgCallerRequirement =
  /** `data.manage`, org-wide — the key the CRM is gated on. Staff pass. */
  | 'data.manage'
  /** A workspace owner or admin, org-wide. Staff acting alone do NOT pass. */
  | 'manage-org'

/**
 * A verified session, org-wide reach in `orgId`, and the requirement — in
 * that order, the cheapest refusal first — then the org document, which
 * every org variant needs for the plan and the consent groups.
 *
 * Staff are admitted to the `data.manage` requirement as every CRM route
 * admits them, and refused the `manage-org` one as the erasure route
 * refuses them: the workspace is the controller of its people's data and
 * the instruction to erase has to come from it.
 */
export async function authorizeOrgCaller(
  req: PluginApiRequest,
  orgId: string,
  options: { needs: OrgCallerRequirement; refusal: string },
): Promise<OrgCaller | OrgCallerRefusal> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return { ok: false, status: 401, error: 'Unauthenticated' }
  let decoded: { uid: string; email?: string; name?: string; staff?: unknown }
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch {
    return { ok: false, status: 401, error: 'Unauthenticated' }
  }
  const staff = decoded.staff === true
  const membership = await resolveOrgPermissions(decoded.uid, { orgId }).catch(
    () => null,
  )
  const orgWide = Boolean(membership?.orgWide) && membership?.orgId === orgId
  const admitted =
    options.needs === 'data.manage'
      ? staff || (orgWide && membership?.permissions['data.manage'] === true)
      : orgWide && canManageOrg(membership?.role ?? null)
  if (!admitted) return { ok: false, status: 403, error: options.refusal }
  const org = await getOrgDoc(orgId).catch(() => null)
  if (!org) return { ok: false, status: 404, error: 'Unknown organization' }
  return {
    ok: true,
    uid: decoded.uid,
    email: decoded.email ?? null,
    name: String(decoded.name ?? '')
      .trim()
      .slice(0, 120),
    staff,
    orgId,
    org,
  }
}

/**
 * Every site of the organization, by document id — the host set an
 * org-level act sweeps when it needs one (AGL-2634). One equality on
 * `hosts.orgId`, the query the erasure route already ran, which needs no
 * composite index.
 */
export async function orgHostIds(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<string[]> {
  const hosts = await firestore.collection('hosts').where('orgId', '==', orgId).get()
  return hosts.docs.map((doc: { id: string }) => String(doc.id))
}
