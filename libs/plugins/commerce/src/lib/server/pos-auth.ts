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

import * as Aglyn from '@aglyn/aglyn/server'
import type { PluginApiRequest } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'

/** Who is working the register, once the gate has admitted them. */
export interface PosStaff {
  uid: string
  hostId: string
  orgId: string
  org: Record<string, any> | null
}

export type PosStaffGate =
  | { ok: true; staff: PosStaff }
  | { ok: false; status: number; error: string }

/**
 * The register's gate, shared by every POS route (AGL-3607): the same three
 * questions `pos-order.ts` asks, in the same order, so a payment, a reader or
 * a display pairing is refused to exactly the people a sale is refused to.
 *
 * 1. A Firebase ID token.
 * 2. `admin` or `editor` on THIS site (`memberRoles`), an allowlist so a role
 *    added later is refused until someone decides otherwise (AGL-2262).
 * 3. `managePos` on the member's resolved permissions (AGL-2474), and the
 *    `pos` plan entitlement on the org that owns the site.
 */
export async function authorizePosStaff(
  req: PluginApiRequest,
  hostId: string,
): Promise<PosStaffGate> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) return { ok: false, status: 401, error: 'Unauthenticated' }
  if (!hostId) return { ok: false, status: 400, error: 'Missing hostId' }
  let uid: string
  try {
    uid = (await firebaseAdmin.app().auth().verifyIdToken(idToken)).uid
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return { ok: false, status: 401, error: 'Unauthenticated' }
  }
  const hostSnapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .get()
  if (!hostSnapshot.exists) return { ok: false, status: 404, error: 'Unknown site' }
  const memberRole = (hostSnapshot.get('memberRoles') ?? {})[uid]
  if (memberRole !== 'admin' && memberRole !== 'editor') {
    return { ok: false, status: 403, error: 'Not permitted' }
  }
  const membership = await resolveOrgPermissions(uid, { hostId })
  if (!membership.permissions.managePos) {
    return { ok: false, status: 403, error: 'Not permitted' }
  }
  const ownerOrg = await getOrgForHost(hostId)
  if (!Aglyn.checkEntitlement(ownerOrg?.org as any, 'pos')) {
    return { ok: false, status: 403, error: 'POS requires the Pro plan or above' }
  }
  return {
    ok: true,
    staff: {
      uid,
      hostId,
      orgId: String(ownerOrg?.org?.id ?? ownerOrg?.orgId ?? ''),
      org: (ownerOrg?.org as Record<string, any>) ?? null,
    },
  }
}

/** A JSON body, whether the dispatcher parsed it or not. */
export function posRequestBody(req: PluginApiRequest): Record<string, any> {
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {}
}

/** A GET request's query as a flat body, first value of each key. */
export function posQueryBody(req: PluginApiRequest): Record<string, any> {
  return Object.fromEntries(
    Object.entries(req.query ?? {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  )
}

/** The request's Idempotency-Key header, trimmed and bounded. */
export function posIdempotencyKey(req: PluginApiRequest): string {
  return String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  )
    .trim()
    .slice(0, 200)
}
