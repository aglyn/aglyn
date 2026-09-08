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
  type AglynOrgMember,
  canManageOrg,
  crmInboundAddress,
  crmInboundDomain,
  isOrgWideMember,
  type PluginApiHandler,
  type PluginApiRequest,
} from '@aglyn/aglyn/server'
import {
  ensureCrmInboundToken,
  firebaseAdmin,
  getOrgForHost,
  logOrgActivity,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { CRM_API_ROUTES } from '../constants/api-routes'
import { authorizeOrgCaller, readCrmRouteScope } from './org-caller'

/**
 * `POST /api/crm/inbound-address` — the workspace's email capture address
 * (AGL-2657).
 *
 * Body: `{ hostId }` under a site, `{ orgId, hostId? }` at the organization
 * level, and `rotate: true` to replace the token. Answers
 * `{ ok: true, address, createdAtMs, rotatedAtMs?, rotated }`.
 *
 * ## Why a route and not a read of the org document
 *
 * The token is on the org document, which every member may read, and the
 * address is the token in a fixed shape — but the shape's domain is the
 * deployment's, `CRM_INBOUND_DOMAIN`, which a browser does not know, and
 * the token does not exist until somebody asks for the address. So the
 * first ask mints it, inside a transaction, and every ask answers the
 * whole address. The org document is the read side for nothing but the
 * rules, which deny the key to every client.
 *
 * ## Who may ask, and who may rotate
 *
 * Asking takes what opening the CRM takes: `data.manage` on the site's
 * org, for a member who reaches the site — the sender's own gate in
 * `email-send.ts`, restated — or, at the organization level, org-wide
 * reach with the same permission. Rotating is a workspace OWNER or ADMIN's
 * act, because the old address stops filing the moment the new token is
 * written and every mailbox rule that carried it goes quiet: the same bar
 * every CRM setting has, and the erasure route's. Staff are admitted to
 * read as they are on every CRM route, and refused the rotation as the
 * erasure route refuses them — it is the workspace's address to retire.
 */

export const CRM_INBOUND_ADDRESS_ROUTE = CRM_API_ROUTES.inboundAddress

/** What a successful call answers with. */
export interface CrmInboundAddressResponse {
  ok: true
  /** `crm+<token>@<capture domain>`. */
  address: string
  createdAtMs: number
  rotatedAtMs?: number
  /** True when this call replaced the token. */
  rotated: boolean
}

export const CRM_INBOUND_ROTATE_REFUSAL =
  'Rotating the capture address requires a workspace owner or admin.'

type Refusal = { ok: false; status: number; error: string }

interface Caller {
  ok: true
  uid: string
  email: string | null
  orgId: string
  /** Whether this caller may replace the token. */
  canRotate: boolean
}

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error })

/**
 * The site variant's caller: a verified token, then `data.manage` on the
 * site's org for a member who reaches the site, staff passing as they do
 * on every CRM route. Rotation needs the org role itself.
 */
async function authorizeSiteCaller(
  req: PluginApiRequest,
  hostId: string,
): Promise<Caller | Refusal> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return refuse(401, 'Unauthenticated')
  let decoded: { uid: string; email?: string; staff?: unknown }
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch {
    return refuse(401, 'Unauthenticated')
  }
  const resolved = await getOrgForHost(hostId).catch(() => null)
  if (!resolved) return refuse(404, 'Unknown site')
  const { orgId } = resolved
  const membership = await resolveOrgMembership(decoded.uid, orgId).catch(() => null)
  const member = (membership?.member ?? null) as Partial<AglynOrgMember> | null
  if (decoded.staff !== true) {
    const reaches =
      isOrgWideMember(member) || Boolean(member?.hostAccess?.[hostId])
    const allowed =
      member && reaches && (await memberHasOrgPermission(orgId, member, 'data.manage'))
    if (!allowed) {
      return refuse(
        403,
        'Reading the capture address requires the data.manage permission on this site',
      )
    }
  }
  return {
    ok: true,
    uid: decoded.uid,
    email: decoded.email ?? null,
    orgId,
    canRotate: canManageOrg(member?.role ?? null),
  }
}

/** The organization variant's caller, by the org the body names (AGL-2634). */
async function authorizeOrgLevelCaller(
  req: PluginApiRequest,
  orgId: string,
  rotate: boolean,
): Promise<Caller | Refusal> {
  const caller = await authorizeOrgCaller(req, orgId, {
    needs: rotate ? 'manage-org' : 'data.manage',
    refusal: rotate
      ? CRM_INBOUND_ROTATE_REFUSAL
      : 'Reading the capture address at the organization level requires the ' +
        'data.manage permission across the whole workspace',
  })
  if (caller.ok === false) return refuse(caller.status, caller.error)
  return {
    ok: true,
    uid: caller.uid,
    email: caller.email,
    orgId,
    // `manage-org` admitted them when they asked to rotate; a reader who
    // did not ask is not told whether they could.
    canRotate: rotate,
  }
}

export const crmInboundAddressHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body = (
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  ) as Record<string, unknown>
  const scope = readCrmRouteScope(body)
  if (!scope) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const rotate = body['rotate'] === true
  try {
    const caller =
      scope.level === 'org'
        ? await authorizeOrgLevelCaller(req, scope.orgId, rotate)
        : await authorizeSiteCaller(req, scope.hostId)
    if (caller.ok === false) {
      res.status(caller.status).json({ error: caller.error })
      return
    }
    if (rotate && !caller.canRotate) {
      res.status(403).json({ error: CRM_INBOUND_ROTATE_REFUSAL })
      return
    }
    const firestore = firebaseAdmin.app().firestore()
    const result = await ensureCrmInboundToken(firestore, caller.orgId, { rotate })
    if (result.rotated) {
      // The old address went quiet with this write; the feed says who did it.
      await logOrgActivity(
        caller.orgId,
        { uid: caller.uid, email: caller.email },
        'Rotated the email capture address',
        { type: 'org' },
      )
    }
    const answer: CrmInboundAddressResponse = {
      ok: true,
      address: crmInboundAddress(result.token, crmInboundDomain()),
      createdAtMs: result.createdAtMs,
      ...(typeof result.rotatedAtMs === 'number' ? { rotatedAtMs: result.rotatedAtMs } : {}),
      rotated: result.rotated,
    }
    res.status(200).json(answer)
  } catch (error) {
    console.error('[crm] inbound-address failed', scope, error)
    res.status(500).json({ error: 'The capture address could not be read.' })
  }
}

export default crmInboundAddressHandler
