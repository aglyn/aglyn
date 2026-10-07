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
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { SALES_CHANNELS_ENTITLEMENT } from '../constants/bundle-common'
import { firestore, isDocumentId } from './feed-store'

/**
 * THE GATE EVERY CONSOLE ROUTE CLIMBS (AGL-3637). The console's dispatcher
 * has already refused a site with this plugin switched off or unreleased, a
 * lockdown and a caller over the write limit. What it cannot know is the
 * member and the plan:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  an unverified address (an impersonation session is exempt)
 *   400  no site named
 *   404  no such site
 *   403  not a collaborator with the role the route needs
 *   403  a plan that does not sell (`commerce`)
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

export function routeJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function routeError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

export type ChannelRole = 'viewer' | 'editor' | 'admin'

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

export interface RouteActor {
  uid: string
  hostId: string
  orgId: string
  host: Record<string, unknown>
  staff: boolean
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'HEAD') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

export async function channelsGate(
  request: Request,
  options: { role: ChannelRole; body?: Record<string, unknown> },
): Promise<RouteActor | Response> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return routeError(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch {
    return routeError(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return routeError(403, 'Verify your email address first')
  }
  const hostId = String(options.body?.['hostId'] ?? new URL(request.url).searchParams.get('hostId') ?? '')
  if (!isDocumentId(hostId)) return routeError(400, 'Missing hostId')
  const [hostSnapshot, resolved] = await Promise.all([
    firestore().collection('hosts').doc(hostId).get(),
    getOrgForHost(hostId),
  ])
  if (!hostSnapshot.exists || !resolved) return routeError(404, 'Site not found')
  const host = hostSnapshot.data() ?? {}
  const staff = decoded['staff'] === true
  const role = String((host['memberRoles'] as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  if (!staff && (ROLE_RANK[role] ?? 0) < ROLE_RANK[options.role]) {
    return routeError(403, 'Not permitted')
  }
  if (!checkEntitlement(resolved.org as never, SALES_CHANNELS_ENTITLEMENT)) {
    return routeError(403, 'Sales channels come with the plans that include commerce.')
  }
  return { uid: decoded.uid, hostId, orgId: resolved.orgId, host, staff }
}
