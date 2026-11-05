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

import { holdsStampedSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import { PRINT_ON_DEMAND_SITE_PRESETS, type PrintOnDemandSitePermission } from '../model/print-on-demand-permissions'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { POD_NOT_CONFIGURED_MESSAGE, readPodKeyring } from './config'
import { resolvePodSite } from './site-context'
import { isDocumentId } from './store'

/**
 * THE GATE EVERY CONSOLE ROUTE CLIMBS (AGL-3641). The console's dispatcher
 * has already refused a request for a site with this plugin switched off, an
 * unverified account, a lockdown and a caller over the write limit. What it
 * cannot know is the member:
 *
 *   404  the deployment holds no sealing key — the surface does not exist
 *   401  no bearer token, or one the verifier refused
 *   403  unverified address (impersonation exempt)
 *   400  no site named
 *   404  the site does not sell, or has print on demand switched off
 *   403  not on the site, or without the key the route asks (AGL-4047)
 *
 * A connection and its settings ask "Manage print-on-demand connections": the
 * token spends the merchant's money at the service. Importing products asks
 * "Import print-on-demand products" and working an order "Work print-on-demand
 * orders" (AGL-4047), whose presets are the site's Admin and Editor; reading a
 * connection's public half, a product's source and an order's part any
 * collaborator's.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

export function podJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function podError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

export interface PodGateResult {
  orgId: string
  hostId: string
  uid: string
  keyring: SecretBoxKeyring
  body: Record<string, unknown>
  /** The caller's own `Authorization`, for a call made on their behalf. */
  authorization: string
}

export async function podGate(request: Request, options: { permission: PrintOnDemandSitePermission | null }): Promise<PodGateResult | Response> {
  const keyring = readPodKeyring()
  if (!keyring) return podError(404, POD_NOT_CONFIGURED_MESSAGE)
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return podError(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return podError(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return podError(403, 'Verify your email address first')
  }
  const body = await readJsonBody(request)
  const hostId = String(body['hostId'] ?? new URL(request.url).searchParams.get('hostId') ?? '')
  if (!isDocumentId(hostId)) return podError(400, 'Missing hostId')
  const site = await resolvePodSite(hostId)
  if (!site) return podError(404, 'Print on demand is not available for this site')
  const staff = decoded['staff'] === true
  // No key named: anyone on the site's roster reads it.
  if (!staff && !(site.host['memberRoles'] as Record<string, unknown> | undefined)?.[decoded.uid]) {
    return podError(403, 'Not permitted')
  }
  const { permission } = options
  if (!staff && permission && !holdsStampedSiteKey(site.host, decoded.uid, permission, PRINT_ON_DEMAND_SITE_PRESETS[permission])) {
    return podError(403, permissionRefusalText(permission))
  }
  return { orgId: site.orgId, hostId, uid: decoded.uid, keyring, body, authorization }
}
