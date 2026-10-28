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
import {
  holdsPosPermission,
  posPermissionRefusal,
  type PosPermission,
} from '../model/plugin-permissions'

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

/** Who works the register: `managePos`, as resolved for the site (AGL-4047). */
export function worksPosRegister(
  permissions: Readonly<Record<string, boolean | undefined>> | null | undefined,
): boolean {
  return permissions?.['managePos'] === true
}

/**
 * The register's gate, shared by every POS route (AGL-3607): the same
 * questions `pos-order.ts` asks, in the same order, so a payment, a reader or
 * a display pairing is refused to exactly the people a sale is refused to.
 *
 * 1. A Firebase ID token.
 * 2. `managePos` on the member's permissions as resolved FOR THIS SITE
 *    (AGL-2474) — or what `admits` asks instead — and the `pos` plan
 *    entitlement on the org that owns the site.
 * 3. When the route names one, the finer register key its action needs
 *    (AGL-4047): `posSell`, `posDevices`, `posBuyHardware` and the rest,
 *    each following `managePos` unless a role or the member sets it.
 *
 * THE KEYS DECIDE, NOT THE SITE ROLE (AGL-4047). This asked for `admin` or
 * `editor` in the site's `memberRoles` as well, which is exactly the set the
 * key is on for by default, so nobody who had the register loses it. The
 * resolver answers for this site: an org-wide member from their org role,
 * custom role and overrides; a site collaborator from the role they hold
 * here and their overrides; and anyone without access to the site with
 * nothing. So a site viewer the workspace grants the register works it, and
 * an admin a role narrows is refused. A site no workspace owns resolves
 * against the caller's own workspace, and is refused by the plan step, which
 * reads the plan of the workspace that owns the site.
 */
export async function authorizePosStaff(
  req: PluginApiRequest,
  hostId: string,
  permission?: PosPermission,
  /**
   * Who the route admits before the finer key: whoever works the register,
   * unless the route says otherwise — the hardware shop also admits a member
   * who may buy hardware without the register.
   */
  admits: (permissions: Readonly<Record<string, boolean | undefined>>) => boolean = worksPosRegister,
  /**
   * `planRequired: false` admits a workspace whose plan does not include the
   * point of sale, for the one read that must tell such a workspace what it
   * needs first: a card reader it bought in person, waiting for that plan
   * (AGL-4038). Everything that acts still asks the plan.
   */
  options: { planRequired?: boolean } = {},
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
  const membership = await resolveOrgPermissions(uid, { hostId })
  if (!admits(membership.permissions ?? {})) {
    return { ok: false, status: 403, error: 'Not permitted' }
  }
  if (permission && !holdsPosPermission(membership.permissions, permission)) {
    return { ok: false, status: 403, error: posPermissionRefusal(permission) }
  }
  const ownerOrg = await getOrgForHost(hostId)
  if (options.planRequired !== false && !Aglyn.checkEntitlement(ownerOrg?.org as any, 'pos')) {
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
