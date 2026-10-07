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

import {
  firebaseAdmin,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { readShippingConfig, SHIPPING_NOT_CONFIGURED_MESSAGE, type ShippingConfig } from './config'
import { isDocumentId } from './db'
import type { ShippingActor } from './labels'
import { resolveShippingSite } from './site-context'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'

/**
 * THE GATE EVERY CONSOLE ROUTE CLIMBS (AGL-3612). The console's dispatcher
 * has already refused a request for a site with this plugin switched off, an
 * unverified account, a lockdown and a caller over the write limit. What it
 * cannot know is the member:
 *
 *   404  the deployment is not configured — the surface does not exist
 *   401  no bearer token, or one the verifier refused
 *   403  unverified address (impersonation exempt)
 *   400  no site named
 *   404  the site does not sell, or has shipping switched off
 *   403  not a collaborator with the role the route needs — or, for a
 *        workspace-level change, without the org permission it names
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

export function shippingJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function shippingError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

export type ShippingRole = 'viewer' | 'editor' | 'admin'

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

export interface ShippingGateResult {
  actor: ShippingActor
  config: ShippingConfig
  body: Record<string, unknown>
}

export async function shippingGate(
  request: Request,
  options: { role: ShippingRole; orgPermission?: string },
): Promise<ShippingGateResult | Response> {
  const configured = readShippingConfig()
  if (!configured.configured) return shippingError(404, SHIPPING_NOT_CONFIGURED_MESSAGE)
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return shippingError(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return shippingError(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return shippingError(403, 'Verify your email address first')
  }
  const body = await readJsonBody(request)
  const hostId = String(body['hostId'] ?? new URL(request.url).searchParams.get('hostId') ?? '')
  if (!isDocumentId(hostId)) return shippingError(400, 'Missing hostId')
  const site = await resolveShippingSite(hostId)
  if (!site) return shippingError(404, 'Shipping is not available for this site')
  const memberRole = String((site.host['memberRoles'] as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  const staff = decoded['staff'] === true
  if (!staff && (ROLE_RANK[memberRole] ?? 0) < ROLE_RANK[options.role]) {
    return shippingError(403, 'Not permitted')
  }
  if (options.orgPermission && !staff) {
    const membership = await resolveOrgMembership(decoded.uid, site.orgId)
    if (!membership || !(await memberHasOrgPermission(site.orgId, membership.member, options.orgPermission as never))) {
      return shippingError(403, 'Only a workspace member who manages billing can change this')
    }
  }
  return {
    actor: {
      orgId: site.orgId,
      org: site.org,
      hostId,
      uid: decoded.uid,
      email: String(decoded.email ?? ''),
      name: String(decoded['name'] ?? decoded.email ?? 'Merchant'),
    },
    config: configured.config,
    body,
  }
}
