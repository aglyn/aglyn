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

import { NO_CLIENT_ADDRESS_BUCKET, readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { consumeRateLimit } from '@aglyn/tenant-data-admin'
import { WAIVERS_PERMISSIONS } from '../constants/bundle-common'
import { signatureWindowLabel } from '../model/waiver-signature'
import { mintWaiverDisplayGrant, verifyWaiverDisplayGrant } from './display-grant'
import { json, publicSite, readJsonBody, refuse, waiversGate } from './gate'
import { recordSignature, waiversNow } from './sign'
import { requestAudit } from './signature-routes'

/*==========================================
 * THE CUSTOMER DISPLAY'S DOORS (AGL-4042). Staff who may take signatures
 * ask for a grant; the register's paired display, which has no staff
 * session, signs with it. What the display reads of a waiver is what the
 * public route already serves anyone, so only signing needs the grant.
 *=========================================*/

const READERS = [WAIVERS_PERMISSIONS.collect, WAIVERS_PERMISSIONS.manage] as const
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

/** `POST waivers/display-grant {hostId}`: a grant to sign this site's waivers on the customer display. */
export async function displayGrantRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: READERS })
  if (staff instanceof Response) return staff
  try {
    const minted = mintWaiverDisplayGrant(
      { orgId: staff.orgId, hostId: staff.hostId, staffUid: staff.uid, staffName: staff.name ?? staff.email },
      waiversNow(),
    )
    return json(minted, 201)
  } catch {
    // No signing secret on this deploy: the display can't be trusted to sign.
    return refuse(503, 'Signing on the customer display isn’t available right now. Hand over this device instead.')
  }
}

/** `POST waivers/sign-on-display {grant, hostId, …signing}`: a rider signs on the customer display. */
export async function signOnDisplayRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const body = await readJsonBody(request)
  // Honeypot filled: a success to the bot, and nothing stored.
  if (typeof body['website'] === 'string' && body['website'].trim()) return json({ received: true }, 201)
  const grant = verifyWaiverDisplayGrant(body['grant'], waiversNow())
  if (!grant || grant.hostId !== String(body['hostId'] ?? '')) {
    return refuse(401, 'This screen has expired. Ask staff to show the waiver again.')
  }
  const ip = readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET
  const rate = await consumeRateLimit(`waiver-display:${grant.hostId}:${ip}`, {
    limit: RATE_MAX,
    windowMs: RATE_WINDOW_MS,
  })
  if (!rate.allowed) {
    return Response.json(
      { error: 'Too many signatures from this screen. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000))) } },
    )
  }
  const site = await publicSite(grant.hostId)
  if (site.ok === false) return site.response
  // The grant names the workspace it was minted in; a site that moved since is refused.
  if (site.orgId !== grant.orgId) return refuse(401, 'This screen has expired. Ask staff to show the waiver again.')
  const outcome = await recordSignature(
    { orgId: site.orgId, hostId: grant.hostId, host: site.host, org: site.org, timeZone: site.timeZone },
    body,
    { method: 'at_window', audit: { ...requestAudit(request), staffUid: grant.staffUid, staffName: grant.staffName } },
  )
  if (outcome.ok === false) return json({ error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) }, outcome.status)
  const signature = outcome.signature
  return json(
    {
      received: true,
      people: [signature.signer.name, ...signature.minors.map((minor) => minor.name)],
      window: signatureWindowLabel(signature),
      emailed: Boolean(signature.signer.email),
    },
    outcome.replayed ? 200 : 201,
  )
}
