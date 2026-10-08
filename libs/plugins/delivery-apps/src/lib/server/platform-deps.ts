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
import { pluginChannelOrders } from '@aglyn/aglyn/plugin-manager/plugin-channel-orders'
import { pluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { getHostDocAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { firebaseAdmin, isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { getLockdownVerdict, lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { DELIVERY_APPS_ENTITLEMENT, DELIVERY_APPS_PLUGIN_ID, SELLER_PLUGIN_ID } from '../constants'
import type { DeliveryServiceId } from '../model/delivery-apps'
import { createDoordashProvider } from '../providers/doordash'
import { createGrubhubProvider } from '../providers/grubhub'
import { defaultProviderHttp, type ProviderHttp } from '../providers/http'
import type { DeliveryProvider } from '../providers/provider'
import { createUberEatsProvider } from '../providers/uber-eats'
import { offeredServices, readDeliveryAppsConfig } from './config'
import { createEngine, type EngineDeps } from './engine'
import { createDeliveryRoutes, fail, type DeliveryGateKind, type DeliveryGateResult } from './routes'
import { createFirestoreDeliveryStore, type DeliveryStore } from './store'

/**
 * The production wiring (AGL-3644): the Admin SDK's Firestore, core's
 * channel-orders and product-catalog seams (each the seller's, never
 * imported), and `fetch`. Every module above takes these as arguments, so a
 * spec drives them with fakes and this file is the only one that reaches the
 * real services.
 */

const firestore = () => firebaseAdmin.app().firestore()

let httpOverride: ProviderHttp | null = null

/** Test seam: the HTTP every service call made through these deps uses. */
export function setDeliveryAppsHttpForTests(http: ProviderHttp | null): void {
  httpOverride = http
}

const http = (): ProviderHttp => httpOverride ?? defaultProviderHttp()

let store: DeliveryStore | null = null
export const platformDeliveryStore = (): DeliveryStore => (store ??= createFirestoreDeliveryStore(firestore))

/** Kept per service while its credentials stand, so Uber's token is reused between requests. */
const providers = new Map<DeliveryServiceId, { key: string; provider: DeliveryProvider }>()

export function platformProvider(service: DeliveryServiceId): DeliveryProvider | null {
  const config = readDeliveryAppsConfig()
  const key = JSON.stringify(config[service])
  const kept = providers.get(service)
  if (kept && kept.key === key && !httpOverride) return kept.provider
  let provider: DeliveryProvider | null = null
  switch (service) {
    case 'doordash':
      provider = config.doordash ? createDoordashProvider({ config: config.doordash, http: http() }) : null
      break
    case 'uber-eats':
      provider = config['uber-eats'] ? createUberEatsProvider({ config: config['uber-eats'], http: http() }) : null
      break
    case 'grubhub':
      provider = config.grubhub ? createGrubhubProvider({ config: config.grubhub, http: http() }) : null
      break
  }
  if (provider && !httpOverride) providers.set(service, { key, provider })
  return provider
}

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

/** A site's org, and whether it may take delivery orders: the register's plan, commerce and this plugin on. */
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
      checkEntitlement(org as never, DELIVERY_APPS_ENTITLEMENT as never) &&
      enabled.includes(DELIVERY_APPS_PLUGIN_ID) &&
      enabled.includes(SELLER_PLUGIN_ID),
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

/**
 * Who may use a route. `settings`: a verified ADMIN of the site. `register`:
 * a verified admin or editor of the site with `managePos`, the register's
 * own gate (an allowlist of roles, so a role added later is refused until
 * someone decides otherwise). Both: the `pos` entitlement, commerce and this
 * plugin on for the site, the site not locked, and a deployment that offers
 * a service. Staff pass the role checks, as on every console route.
 */
export async function deliveryAppsGate(request: Request, kind: DeliveryGateKind): Promise<DeliveryGateResult | Response> {
  if (!offeredServices(readDeliveryAppsConfig()).length) return fail(404, 'Not found')
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return fail(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    if (!isRefusedIdToken(error)) return fail(503, 'Sign-in could not be checked. Try again.')
    return fail(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) return fail(403, 'Verify your email address first')
  const body = await readBody(request)
  const hostId = String(body['hostId'] ?? new URL(request.url).searchParams.get('hostId') ?? '')
  if (!HOST_ID.test(hostId)) return fail(400, 'Missing hostId')
  const site = await siteContext(hostId)
  if (!site) return fail(404, 'That site was not found')
  const staff = decoded['staff'] === true
  const memberRole = String((site.host['memberRoles'] as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  if (!staff) {
    if (kind === 'settings' && memberRole !== 'admin') return fail(403, 'Not permitted')
    if (kind === 'register') {
      if (memberRole !== 'admin' && memberRole !== 'editor') return fail(403, 'Not permitted')
      const membership = await resolveOrgPermissions(decoded.uid, { hostId })
      if (!membership.permissions.managePos) return fail(403, 'Not permitted')
    }
  }
  if (!site.entitled) return fail(404, 'Delivery apps are not available for this site')
  const locked = await lockdownRefusal({ request, staff, uid: decoded.uid, org: site.org as never, host: site.host as never })
  if (locked) return locked
  return { orgId: site.orgId, hostId, uid: decoded.uid, body }
}

export function platformEngineDeps(): EngineDeps {
  return {
    now: Date.now,
    store: platformDeliveryStore(),
    provider: platformProvider,
    sandbox: (service) => readDeliveryAppsConfig()[service]?.sandbox === true,
    channelOrders: () => pluginChannelOrders(),
    catalog: () => pluginProductCatalog(),
    siteOpen: async (hostId) => {
      const site = await siteContext(hostId)
      if (!site?.entitled) return false
      return !(await getLockdownVerdict({ org: site.org as never, host: site.host as never, request: { method: 'POST' } }))
    },
  }
}

export const platformRoutes = () =>
  createDeliveryRoutes({
    now: Date.now,
    config: () => readDeliveryAppsConfig(),
    store: platformDeliveryStore(),
    provider: platformProvider,
    engine: createEngine(platformEngineDeps()),
    gate: deliveryAppsGate,
  })
