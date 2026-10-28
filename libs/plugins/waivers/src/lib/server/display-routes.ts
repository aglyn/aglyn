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
import {
  customerDisplayShows,
  verifyCustomerDisplay,
  type VerifiedCustomerDisplay,
} from '@aglyn/aglyn/plugin-manager/plugin-customer-display-verifier'
import { consumeRateLimit } from '@aglyn/tenant-data-admin'
import { WAIVERS_DISPLAY_PAGE_PATH, WAIVERS_PERMISSIONS, WAIVERS_PLUGIN_ID } from '../constants/bundle-common'
import { signatureWindowLabel } from '../model/waiver-signature'
import { json, memberHolds, memberName, publicSite, readJsonBody, refuse } from './gate'
import { recordSignature } from './sign'
import { signedCopyPath } from './signed-copy'
import { requestAudit } from './signature-routes'

/*==========================================
 * THE CUSTOMER DISPLAY'S DOORS (AGL-4042).
 *
 * The register's paired customer display has no staff session, and needs
 * none: staff paired it to the store, so the pairing is the authorization.
 * The display's page sends its own credential, and core's display verifier
 * (registered by the plugin that pairs displays, which this plugin never
 * names) says which store it is paired to, which screen it is showing now,
 * and who put that screen there.
 *
 * So a waiver staff sent to the display signs while the display still shows
 * it, for as long as that takes: there is no grant to open or close and no
 * timer. It is gone only when the register shows something else. The
 * signature records the staff member who sent it, exactly as a tablet
 * handed over at the window does, and that member must still hold a key
 * that takes signatures on the site. What the display reads of a waiver is
 * what the public route already serves anyone, so only signing needs this.
 *=========================================*/

const SIGNERS = [WAIVERS_PERMISSIONS.collect, WAIVERS_PERMISSIONS.manage] as const
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10
const NOT_PAIRED = 'This screen isn’t this store’s customer display. Ask staff to show the waiver again.'
const MOVED_ON = 'The register is showing something else now. Ask staff to show the waiver again.'

/** Whether a verified display shows THIS site's waiver page, by the site it names. */
function showsWaiverFor(display: VerifiedCustomerDisplay | null, hostId: string): boolean {
  return (
    display !== null &&
    display.hostId === hostId &&
    customerDisplayShows(display, { pluginId: WAIVERS_PLUGIN_ID, path: WAIVERS_DISPLAY_PAGE_PATH, params: { host: hostId } })
  )
}

/**
 * `POST waivers/display-screen {hostId, display}`, for the display's page,
 * by the display's credential: whether the display still shows this site's
 * waiver (`{showing}`). The page asks so it follows the register: once the
 * register shows something else, the display goes back to it. Says nothing
 * else, and `false` for any credential that opens no display of this site.
 */
export async function displayScreenRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const body = await readJsonBody(request)
  const display = await verifyCustomerDisplay(body['display'])
  return json({ showing: showsWaiverFor(display, String(body['hostId'] ?? '')) })
}

/**
 * `POST waivers/sign-on-display {hostId, display, …signing}`: a rider signs
 * on the register's paired customer display, by the display's credential.
 *
 *   401  no credential, one that opens no display, or a display of another store
 *   409  the display is showing something else now
 *   403  the staff member who sent the waiver no longer takes signatures here
 *   429  too many signatures from this screen
 */
export async function signOnDisplayRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const body = await readJsonBody(request)
  // Honeypot filled: a success to the bot, and nothing stored.
  if (typeof body['website'] === 'string' && body['website'].trim()) return json({ received: true }, 201)
  const hostId = String(body['hostId'] ?? '')
  // The pairing is the authorization: a display paired to THIS store.
  const display = await verifyCustomerDisplay(body['display'])
  if (!display || display.hostId !== hostId) return refuse(401, NOT_PAIRED)
  // Still showing the waiver staff sent, so the signing is under that send.
  if (!showsWaiverFor(display, hostId) || !display.shownBy) return refuse(409, MOVED_ON)
  const ip = readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET
  const rate = await consumeRateLimit(`waiver-display:${hostId}:${ip}`, {
    limit: RATE_MAX,
    windowMs: RATE_WINDOW_MS,
  })
  if (!rate.allowed) {
    return Response.json(
      { error: 'Too many signatures from this screen. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000))) } },
    )
  }
  // The staff member who sent it witnesses it, so they must take signatures here.
  if (!(await memberHolds(display.shownBy, hostId, SIGNERS))) {
    return refuse(403, 'The staff member who showed this waiver can’t take signatures here. Ask them for help.')
  }
  const site = await publicSite(hostId)
  if (site.ok === false) return site.response
  // The display vouches for the workspace that owns the store; a site that moved since is refused.
  if (site.orgId !== display.orgId) return refuse(401, NOT_PAIRED)
  const outcome = await recordSignature(
    { orgId: site.orgId, hostId, host: site.host, org: site.org, timeZone: site.timeZone },
    body,
    {
      method: 'at_window',
      audit: { ...requestAudit(request), staffUid: display.shownBy, staffName: await memberName(display.shownBy) },
    },
  )
  if (outcome.ok === false) return json({ error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) }, outcome.status)
  const signature = outcome.signature
  return json(
    {
      received: true,
      people: [signature.signer.name, ...signature.minors.map((minor) => minor.name)],
      window: signatureWindowLabel(signature),
      emailed: Boolean(signature.signer.email),
      // The signer's own copy, as a code to scan from the display (AGL-4042).
      copyUrl: await signedCopyPath({ orgId: site.orgId, hostId, signature }).catch(() => null),
    },
    outcome.replayed ? 200 : 201,
  )
}
