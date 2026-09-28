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
 * `POST /api/crm/email-check` — what the platform knows about one address
 * before somebody writes to it (AGL-3328).
 *
 * Body: `{ hostId, email }`, or `{ orgId, hostId?, email }` at the
 * organization level. Answers `{ ok: true, checked, code, message, gateway,
 * chip }` — see `readAddressDeliverability`.
 *
 * Two surfaces ask it. A record page draws the gateway chip beside the
 * address: which mail gateway stands in front of it, and what that gateway
 * did with this site's mail this week. The one-to-one composer warns before
 * Send: a domain with no mail server, or a gateway that refused this site's
 * sending domain twice this month and delivered nothing.
 *
 * ## Why a route
 *
 * The answer is DNS and the platform ledger. The browser does neither: the
 * MX cache and the ledger are server-written and closed to members, and a
 * cold domain is looked up here, once, into the cache every organization
 * reads. The ledger is read for the sending domain of the site the mail
 * would leave from — the mounted site, or at the organization level a site
 * of that organization the body names — so a member reads their own
 * sender's standing and never another workspace's.
 *
 * ## Who may ask
 *
 * Whoever may read the site's people: `data.manage`, the key the contacts
 * read rule gates on, reaching the site; at the organization level an
 * org-wide member holding it. Staff pass, as on every CRM route.
 */

import {
  type AglynOrgMember,
  isOrgWideMember,
  normalizeContactEmail,
  type PluginApiHandler,
  type PluginApiRequest,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  hostSendingIdentity,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
// The leaf, so a spec that stands a partial barrel in still reaches it.
import { readAddressDeliverability } from '@aglyn/tenant-data-admin/server/capture-email-check'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { authorizeOrgCaller, readCrmRouteScope } from './org-caller'
import { crmSuiteRefusal } from './suite-gate'

/** The route key, as `registerCrmConsoleApi` registers it. */
export const CRM_EMAIL_CHECK_ROUTE = 'crm/email-check'

type Refusal = { ok: false; status: number; error: string }

const READ_REFUSAL = 'Checking an address requires the data.manage permission on this site'

/** A site-level reader: a verified session reaching the site with `data.manage`. */
async function authorizeSiteReader(
  req: PluginApiRequest,
  hostId: string,
): Promise<{ ok: true; orgId: string; org: Record<string, unknown> } | Refusal> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return { ok: false, status: 401, error: 'Unauthenticated' }
  let decoded: { uid: string; staff?: unknown }
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch (error) {
    if (isRefusedIdToken(error)) return { ok: false, status: 401, error: 'Unauthenticated' }
    console.error('[crm] email-check could not verify the reader', error)
    return { ok: false, status: 500, error: 'The sign-in could not be checked. Try again.' }
  }
  const resolved = await getOrgForHost(hostId).catch(() => null)
  if (!resolved) return { ok: false, status: 404, error: 'Unknown site' }
  if (decoded.staff !== true) {
    const membership = await resolveOrgMembership(decoded.uid, resolved.orgId).catch(() => null)
    const member = (membership?.member ?? null) as Partial<AglynOrgMember> | null
    const reaches = isOrgWideMember(member) || Boolean(member?.hostAccess?.[hostId])
    const allowed =
      member && reaches && (await memberHasOrgPermission(resolved.orgId, member, 'data.manage'))
    if (!allowed) return { ok: false, status: 403, error: READ_REFUSAL }
  }
  return { ok: true, orgId: resolved.orgId, org: (resolved.org ?? {}) as Record<string, unknown> }
}

/**
 * The address mail from `hostId` leaves on, or `null` when the site has no
 * identity in effect — then no ledger is read, and only the MX is.
 */
async function sendingAddressOf(hostId: string): Promise<string | null> {
  if (!hostId) return null
  const identity = await hostSendingIdentity(hostId).catch(() => null)
  return identity && !identity.refusal ? (identity.from ?? null) : null
}

export const crmEmailCheckHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const scope = readCrmRouteScope(body)
  if (!scope) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const email = normalizeContactEmail(body['email'])
  if (!email) {
    res.status(400).json({ error: 'Name the address to check.' })
    return
  }
  try {
    let sendingHostId = ''
    let org: Record<string, unknown>
    if (scope.level === 'org') {
      const caller = await authorizeOrgCaller(req, scope.orgId, {
        needs: 'data.manage',
        refusal: 'Checking an address at the organization level requires the data.manage permission across the whole workspace',
      })
      if (caller.ok === false) {
        res.status(caller.status).json({ error: caller.error })
        return
      }
      org = caller.org as Record<string, unknown>
      // A site named beside the org is used only when it is the org's own:
      // its sending domain's ledger is that workspace's standing.
      if (scope.hostId) {
        const owner = await getOrgForHost(scope.hostId).catch(() => null)
        if (owner?.orgId === scope.orgId) sendingHostId = scope.hostId
      }
    } else {
      const reader = await authorizeSiteReader(req, scope.hostId)
      if (reader.ok === false) {
        res.status(reader.status).json({ error: reader.error })
        return
      }
      sendingHostId = scope.hostId
      org = reader.org
    }
    // The plan after the reader, as every CRM read asks it (AGL-2851): the
    // record pages and the composer this serves are the suite's.
    const suite = crmSuiteRefusal(org, 'Checking an address')
    if (suite) {
      res.status(suite.status).json(suite.body)
      return
    }
    const answer = await readAddressDeliverability({ email, from: await sendingAddressOf(sendingHostId) })
    res.status(200).json({ ok: true, ...answer })
  } catch (error) {
    console.error('[crm] email-check failed', scope, error)
    res.status(500).json({ error: 'The address could not be checked.' })
  }
}

export default crmEmailCheckHandler
