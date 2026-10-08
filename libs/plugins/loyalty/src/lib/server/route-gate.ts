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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { isDocumentId } from './db'
import { resolveLoyaltySite, type LoyaltySiteContext } from './site-context'

/**
 * THE GATE EVERY CONSOLE ROUTE CLIMBS (AGL-3640). The console's dispatcher
 * has already refused a site with this plugin off, an unverified account, a
 * lockdown and a caller over the write limit. What it cannot know is the
 * member:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  unverified address (impersonation exempt)
 *   400  no site named
 *   404  the site does not sell, or has loyalty switched off
 *   403  not a collaborator with the role the route needs
 *
 * Reading needs any role on the site. Moving a member's balance needs editor,
 * the bar the store's gift cards hold; changing the program needs admin.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

export type LoyaltyRole = 'viewer' | 'editor' | 'admin'

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

export interface LoyaltyGateResult {
  site: LoyaltySiteContext
  orgId: string
  hostId: string
  uid: string
  email: string | null
  role: string
  body: Record<string, unknown>
}

type TokenVerifier = (token: string) => Promise<Record<string, unknown> & { uid: string }>

let verifierOverride: TokenVerifier | null = null

/** Test seam. */
export function setLoyaltyTokenVerifierForTests(verifier: TokenVerifier | null): void {
  verifierOverride = verifier
}

export async function loyaltyGate(
  request: Request,
  options: { role: LoyaltyRole },
): Promise<LoyaltyGateResult | Response> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return refuse(401, 'Unauthenticated')
  let decoded: Record<string, unknown> & { uid: string }
  try {
    const token = authorization.slice('Bearer '.length)
    decoded = verifierOverride
      ? await verifierOverride(token)
      : ((await firebaseAdmin.app().auth().verifyIdToken(token)) as unknown as Record<string, unknown> & { uid: string })
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return refuse(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded as never) && !isImpersonationSession(decoded as never)) {
    return refuse(403, 'Verify your email address first')
  }
  let body: Record<string, unknown> = {}
  if (request.method !== 'GET') {
    const parsed = await request.json().catch(() => null)
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  }
  const hostId = String(body['hostId'] ?? new URL(request.url).searchParams.get('hostId') ?? '')
  if (!isDocumentId(hostId)) return refuse(400, 'Missing hostId')
  const site = await resolveLoyaltySite(hostId)
  if (!site) return refuse(404, 'Rewards are not available for this site')
  const role = String((site.host['memberRoles'] as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  if (decoded['staff'] !== true && (ROLE_RANK[role] ?? 0) < ROLE_RANK[options.role]) {
    return refuse(403, 'Not permitted')
  }
  return {
    site,
    orgId: site.orgId,
    hostId,
    uid: decoded.uid,
    email: typeof decoded['email'] === 'string' ? (decoded['email'] as string) : null,
    role: decoded['staff'] === true ? 'staff' : role,
    body,
  }
}
