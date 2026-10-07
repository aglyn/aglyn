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
import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { readTaxEnginesKeyring, TAX_ENGINES_NOT_CONFIGURED_MESSAGE } from './config'
import { resolveTaxEngineSite } from './site-context'
import { isDocumentId } from './store'

/**
 * THE GATE EVERY CONSOLE ROUTE CLIMBS (AGL-3631). The console's dispatcher
 * has already refused a request for a site with this plugin switched off, an
 * unverified account, a lockdown and a caller over the write limit. What it
 * cannot know is the member:
 *
 *   404  the deployment holds no sealing key — the surface does not exist
 *   401  no bearer token, or one the verifier refused
 *   403  unverified address (impersonation exempt)
 *   400  no site named
 *   404  the site does not sell, or has tax services switched off
 *   403  not a collaborator with the role the route needs
 *
 * Credentials and the site's tax settings are an ADMIN's; product codes,
 * exempt customers and an order's record an EDITOR's, the role that edits
 * products and works orders; the connection's public half any collaborator's.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

export function taxJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function taxError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

export type TaxEnginesRole = 'viewer' | 'editor' | 'admin'

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

export interface TaxEnginesGateResult {
  orgId: string
  hostId: string
  uid: string
  keyring: SecretBoxKeyring
  body: Record<string, unknown>
}

export async function taxEnginesGate(
  request: Request,
  options: { role: TaxEnginesRole },
): Promise<TaxEnginesGateResult | Response> {
  const keyring = readTaxEnginesKeyring()
  if (!keyring) return taxError(404, TAX_ENGINES_NOT_CONFIGURED_MESSAGE)
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return taxError(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch {
    return taxError(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return taxError(403, 'Verify your email address first')
  }
  const body = await readJsonBody(request)
  const hostId = String(body['hostId'] ?? new URL(request.url).searchParams.get('hostId') ?? '')
  if (!isDocumentId(hostId)) return taxError(400, 'Missing hostId')
  const site = await resolveTaxEngineSite(hostId)
  if (!site) return taxError(404, 'Tax services are not available for this site')
  const memberRole = String((site.host['memberRoles'] as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  const staff = decoded['staff'] === true
  if (!staff && (ROLE_RANK[memberRole] ?? 0) < ROLE_RANK[options.role]) {
    return taxError(403, 'Not permitted')
  }
  return { orgId: site.orgId, hostId, uid: decoded.uid, keyring, body }
}
