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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { WAIVERS_ENTITLEMENT, WAIVERS_PERMISSIONS } from '../constants/bundle-common'
import { isDocumentId, waiversDb } from './db'

/**
 * THE GATE EVERY CONSOLE ROUTE CLIMBS (AGL-4042). The console dispatcher has
 * already refused a site with this plugin off, an unverified account and a
 * lockdown. What it cannot know is the member:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  unverified address (impersonation exempt)
 *   400  no site named
 *   404  no such site
 *   403  not an admin or editor of the site, or without the permission the
 *        route needs (`manageWaivers` to write waivers and void, or
 *        `collectWaivers` to read signatures and take them)
 *   403  a plan that does not sell
 *
 * A signature holds a signer's date of birth, a minor's name and a drawn
 * signature, so a site's viewers are refused, and staff claims grant nothing
 * here: an Aglyn staff session reads a customer's signers only by
 * impersonating a member who may.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } })
}

export function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

export type WaiversPermission = (typeof WAIVERS_PERMISSIONS)[keyof typeof WAIVERS_PERMISSIONS]

export interface WaiversStaff {
  uid: string
  email: string | null
  name: string | null
  orgId: string
  hostId: string
  host: Record<string, unknown>
  org: Record<string, unknown> | null
  timeZone: string
  body: Record<string, unknown>
}

export interface WaiversGateDeps {
  verifyIdToken(token: string): Promise<Record<string, unknown> & { uid: string }>
  permissions(uid: string, hostId: string): Promise<Record<string, boolean | undefined>>
  orgForHost(hostId: string): Promise<{ orgId: string; org: Record<string, unknown> | null } | null>
}

const defaultDeps: WaiversGateDeps = {
  verifyIdToken: async (token) =>
    (await firebaseAdmin.app().auth().verifyIdToken(token)) as unknown as Record<string, unknown> & { uid: string },
  permissions: async (uid, hostId) =>
    ((await resolveOrgPermissions(uid, { hostId })).permissions ?? {}) as Record<string, boolean | undefined>,
  orgForHost: async (hostId) => {
    const found = await getOrgForHost(hostId)
    return found ? { orgId: found.orgId, org: (found.org as Record<string, unknown>) ?? null } : null
  },
}

let depsOverride: Partial<WaiversGateDeps> | null = null

/** Test seam. */
export function setWaiversGateDepsForTests(deps: Partial<WaiversGateDeps> | null): void {
  depsOverride = deps
}

const deps = (): WaiversGateDeps => ({ ...defaultDeps, ...(depsOverride ?? {}) })

/** A JSON body, or `{}`. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'HEAD') return {}
  const parsed = await request.json().catch(() => null)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}

/** The site's own time zone, else its workspace's, else the platform's. */
export function siteTimeZone(org: Record<string, unknown> | null, host: Record<string, unknown> | null): string {
  return resolveSiteTimeZone(org as { timeZone?: string } | null, host as { timeZone?: string } | null)
}

export async function waiversGate(
  request: Request,
  options: { permission: WaiversPermission | readonly WaiversPermission[] },
): Promise<WaiversStaff | Response> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return refuse(401, 'Unauthenticated')
  let decoded: Record<string, unknown> & { uid: string }
  try {
    decoded = await deps().verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return refuse(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded as never) && !isImpersonationSession(decoded as never)) {
    return refuse(403, 'Verify your email address first')
  }
  const body = await readJsonBody(request)
  const hostId = String(body['hostId'] ?? new URL(request.url).searchParams.get('hostId') ?? '')
  if (!isDocumentId(hostId)) return refuse(400, 'Missing hostId')
  const hostSnapshot = await waiversDb().collection('hosts').doc(hostId).get()
  if (!hostSnapshot.exists) return refuse(404, 'Unknown site')
  const host = (hostSnapshot.data() ?? {}) as Record<string, unknown>
  const role = String((host['memberRoles'] as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  if (role !== 'admin' && role !== 'editor') return refuse(403, 'Not permitted')
  const permissions = await deps().permissions(decoded.uid, hostId)
  const wanted: readonly WaiversPermission[] = Array.isArray(options.permission)
    ? options.permission
    : [options.permission as WaiversPermission]
  if (!wanted.some((key) => permissions[key] === true)) return refuse(403, 'Not permitted')
  const owner = await deps().orgForHost(hostId)
  if (!owner?.orgId) return refuse(404, 'Unknown site')
  if (!checkEntitlement(owner.org as never, WAIVERS_ENTITLEMENT as never)) {
    return refuse(403, 'Waivers come with the plans that include the store. Upgrade to use them.')
  }
  return {
    uid: decoded.uid,
    email: typeof decoded['email'] === 'string' ? (decoded['email'] as string) : null,
    name: typeof decoded['name'] === 'string' ? (decoded['name'] as string) : null,
    orgId: owner.orgId,
    hostId,
    host,
    org: owner.org,
    timeZone: siteTimeZone(owner.org, host),
    body,
  }
}

/** Whether a site's owning workspace may take waivers at all, for the public doors. */
export async function publicSite(hostId: string): Promise<
  | { ok: true; orgId: string; org: Record<string, unknown> | null; host: Record<string, unknown>; timeZone: string }
  | { ok: false; response: Response }
> {
  if (!isDocumentId(hostId)) return { ok: false, response: refuse(400, 'Missing hostId') }
  const hostSnapshot = await waiversDb().collection('hosts').doc(hostId).get()
  if (!hostSnapshot.exists) return { ok: false, response: refuse(404, 'This waiver is not available.') }
  const host = (hostSnapshot.data() ?? {}) as Record<string, unknown>
  const owner = await deps().orgForHost(hostId)
  if (!owner?.orgId || !checkEntitlement(owner.org as never, WAIVERS_ENTITLEMENT as never)) {
    return { ok: false, response: refuse(404, 'This waiver is not available.') }
  }
  return { ok: true, orgId: owner.orgId, org: owner.org, host, timeZone: siteTimeZone(owner.org, host) }
}
