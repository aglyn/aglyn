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

import { createHash } from 'crypto'
import * as Aglyn from '@aglyn/aglyn/server'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  getHostDisabledPlugins,
  getHostDocAdmin,
  getOrgForHost,
  getServerReleaseFlagValues,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'

/*
 * THE GATES EVERY SHIPPING CONNECTOR ASKS ITSELF (AGL-3613, AGL-3633).
 *
 * A shipping app's servers call a connector's route with credentials of the
 * site's own and name no member, so each connector route is a MACHINE route:
 * the dispatcher skips its per-site enablement, release and write-limit gates
 * and the route answers them here, for the site its URL names, once the
 * credentials are proven. ShipStation's Custom Store and ShippingEasy's
 * shipment callback both stand on these; a connector that pushes orders out
 * asks `connectorSiteRefusal` before each push the same way.
 */

/** SHA-256 hex of a secret or a body. */
export function digestSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/** A plain-text answer: the shipping apps show the body of a refusal to the merchant. */
export function connectorText(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } })
}

/**
 * Whether the request arrived over HTTPS. Behind Vercel the transport is
 * stated by `x-forwarded-proto`; a local or test run (`NODE_ENV` not
 * production) is not held to it.
 */
export function requestIsSecure(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  if (env['NODE_ENV'] !== 'production') return true
  const forwarded = String(request.headers.get('x-forwarded-proto') ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  if (forwarded) return forwarded === 'https'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

/** A site id as a document id may hold it. */
export const CONNECTOR_HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

/** The `:hostId` a connector route was called with, or `null` when it is not one. */
export function connectorHostIdOf(params: Record<string, string | string[]>): string | null {
  const raw = params['hostId']
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && CONNECTOR_HOST_ID.test(value) ? value : null
}

/**
 * The gates a dispatcher would have asked, for a site whose connector proved
 * itself: commerce switched on for it, on the plan, released for the org, and
 * the site not locked down. `null` when every one passes. `request` is the
 * call being answered, or `{ method: 'POST' }` for a push the platform makes
 * on its own, which a read-only lockdown refuses like any write.
 */
export async function connectorSiteRefusal(request: { method?: string }, hostId: string): Promise<Response | null> {
  const [owner, disabledPlugins, host] = await Promise.all([
    getOrgForHost(hostId),
    getHostDisabledPlugins(hostId),
    getHostDocAdmin(hostId),
  ])
  if (!owner?.org || !host) return connectorText(404, `This site no longer exists in ${PLATFORM_BRAND_NAME}.`)
  const org = owner.org as Record<string, unknown>
  if (!Aglyn.resolveHostEnabledPlugins(owner.org as never, { disabledPlugins }).includes('commerce')) {
    return connectorText(403, `Commerce is switched off for this site in ${PLATFORM_BRAND_NAME}.`)
  }
  if (!Aglyn.checkEntitlement(owner.org as never, 'commerce')) {
    return connectorText(403, `This site’s ${PLATFORM_BRAND_NAME} plan does not include selling.`)
  }
  const flags = await getServerReleaseFlagValues()
  const released = Aglyn.isReleaseFlagOnForOrg(
    'release_commerce_v2',
    flags['release_commerce_v2'],
    owner.orgId,
    Aglyn.parseOrgReleaseFlagOverrides(org['releaseFlags']),
    Aglyn.resolveEffectivePlan(owner.org as never),
  )
  if (!released) return connectorText(403, 'Commerce is not available for this site yet.')
  return lockdownRefusal({
    request,
    staff: false,
    uid: null,
    org,
    host: host as Record<string, unknown>,
  })
}
