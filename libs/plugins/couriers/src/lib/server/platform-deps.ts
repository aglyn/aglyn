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
import { resolveHostEnabledPlugins } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { pluginLocalDeliveryRecords } from '@aglyn/aglyn/plugin-manager/plugin-local-deliveries'
import { getHostDocAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  firebaseAdmin,
  isEmailVerified,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import { COURIERS_ENTITLEMENT, COURIERS_PLUGIN_ID, SELLER_PLUGIN_ID } from '../constants'
import { COURIER_PROVIDERS, type CourierProviderId } from '../model/couriers'
import { createDoordashDriveProvider } from '../providers/doordash'
import { defaultProviderHttp, type ProviderHttp } from '../providers/http'
import type { CourierProvider } from '../providers/provider'
import { consoleAddress, COURIERS_NOT_CONFIGURED_MESSAGE, readCouriersKeyring } from './config'
import { createEngine, type EngineDeps } from './engine'
import { createCourierRoutes, fail, type CourierGateResult, type CourierRole, type CourierRouteDeps } from './routes'
import { createFirestoreCourierStore, type CourierStore } from './store'

/**
 * The production wiring (AGL-3695): the Admin SDK's Firestore, core's
 * `core.local-delivery-records` seam (the seller's, never imported), the
 * deployment's sealing key and `fetch`. Every module above takes these as
 * arguments, so a spec drives them with fakes and this file is the only one
 * that reaches the real services.
 */

let httpOverride: ProviderHttp | null = null

/** Test seam: the HTTP every courier call made through these deps uses. */
export function setCouriersHttpForTests(http: ProviderHttp | null): void {
  httpOverride = http
}

const http = (): ProviderHttp => httpOverride ?? defaultProviderHttp()

let store: CourierStore | null = null
export const platformCourierStore = (): CourierStore =>
  (store ??= createFirestoreCourierStore(() => firebaseAdmin.app().firestore()))

export function platformProvider(id: CourierProviderId): CourierProvider {
  switch (id) {
    case 'doordash':
      return createDoordashDriveProvider({ http: http() })
  }
}

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

/** A site's org, and whether it may run couriers: a plan that sells, commerce and this plugin on. */
async function siteContext(hostId: string): Promise<{
  orgId: string
  org: Record<string, unknown>
  host: Record<string, unknown>
  entitled: boolean
} | null> {
  const [resolved, host] = await Promise.all([getOrgForHost(hostId), getHostDocAdmin(hostId)])
  if (!resolved || !host) return null
  const org = resolved.org as Record<string, unknown>
  const enabled = resolveHostEnabledPlugins(
    org as { enabledPlugins?: string[] },
    host as { disabledPlugins?: string[]; enabledPlugins?: string[] },
  )
  return {
    orgId: resolved.orgId,
    org,
    host: host as Record<string, unknown>,
    entitled:
      checkEntitlement(org as never, COURIERS_ENTITLEMENT as never) &&
      enabled.includes(COURIERS_PLUGIN_ID) &&
      enabled.includes(SELLER_PLUGIN_ID),
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

/**
 * Who may use a route: a verified member of the site at `role`, the site
 * entitled and not locked, on a deployment that holds the sealing key.
 *
 *   404  no sealing key — the surface does not exist
 *   401  no bearer token, or one the verifier refused
 *   403  unverified address (impersonation exempt), or below the role
 *   400  no site named
 *   404  the site does not sell, or has couriers or commerce switched off
 */
export async function couriersGate(request: Request, role: CourierRole): Promise<CourierGateResult | Response> {
  if (!readCouriersKeyring()) return fail(404, COURIERS_NOT_CONFIGURED_MESSAGE)
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return fail(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return fail(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return fail(403, 'Verify your email address first')
  }
  const body = await readBody(request)
  const hostId = String(body['hostId'] ?? new URL(request.url).searchParams.get('hostId') ?? '')
  if (!HOST_ID.test(hostId)) return fail(400, 'Missing hostId')
  const site = await siteContext(hostId)
  if (!site) return fail(404, 'That site was not found')
  const staff = decoded['staff'] === true
  const memberRole = String((site.host['memberRoles'] as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  if (!staff && (ROLE_RANK[memberRole] ?? 0) < ROLE_RANK[role]) return fail(403, 'Not permitted')
  if (!site.entitled) return fail(404, 'Couriers are not available for this site')
  const locked = await lockdownRefusal({
    request,
    staff,
    uid: decoded.uid,
    org: site.org as never,
    host: site.host as never,
  })
  if (locked) return locked
  return { orgId: site.orgId, hostId, uid: decoded.uid, body }
}

export function platformEngineDeps(): EngineDeps {
  return {
    now: Date.now,
    store: platformCourierStore(),
    provider: platformProvider,
    keyring: readCouriersKeyring,
    records: pluginLocalDeliveryRecords,
  }
}

export function platformRouteDeps(): CourierRouteDeps {
  return {
    now: Date.now,
    store: platformCourierStore(),
    engine: createEngine(platformEngineDeps()),
    provider: platformProvider,
    configured: () => Boolean(readCouriersKeyring()),
    gate: couriersGate,
    consoleAddress,
    logActivity: async (input) => {
      try {
        await logOrgActivity(input.orgId, { uid: input.uid }, `couriers.${input.action}`, {
          type: 'couriers:connection' as never,
          id: input.orderId ? `${input.hostId}_${input.orderId}` : `${input.hostId}_${input.provider}`,
          name: COURIER_PROVIDERS[input.provider].label,
        })
      } catch (error) {
        console.error('[couriers] activity not logged', error)
      }
    },
  }
}

export const platformRoutes = () => createCourierRoutes(platformRouteDeps())
