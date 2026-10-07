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
import { pluginFulfillmentHolds } from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import { pluginShipmentRecords } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { pluginStockLevels } from '@aglyn/aglyn/plugin-manager/plugin-stock-levels'
import { getHostDocAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  firebaseAdmin,
  isEmailVerified,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { getLockdownVerdict, lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import { FULFILLMENT_NETWORKS_ENTITLEMENT, FULFILLMENT_NETWORKS_PLUGIN_ID, SELLER_PLUGIN_ID } from '../constants'
import { NETWORK_PROVIDERS, type NetworkProviderId } from '../model/networks'
import { createAmazonMcfProvider } from '../providers/amazon-mcf'
import { defaultProviderHttp, type ProviderHttp } from '../providers/http'
import type { FulfillmentNetworkProvider } from '../providers/provider'
import { createShipbobProvider } from '../providers/shipbob'
import { offeredNetworks, readFulfillmentNetworksConfig } from './config'
import { createCredentialOpener } from './credentials'
import { createEngine, type EngineDeps } from './engine'
import type { IntakeDeps } from './intake'
import { consoleAddress } from './oauth'
import { createNetworkRoutes, fail, type NetworkGateResult, type NetworkRole, type NetworkRouteDeps } from './routes'
import { createFirestoreNetworkStore, type NetworkStore } from './store'

/**
 * The production wiring (AGL-3634): the Admin SDK's Firestore, core's
 * shipment-records, fulfillment-provider and stock-level seams (each the
 * seller's or another plugin's, never imported), and `fetch`. Every module
 * above takes these as arguments, so a spec drives them with fakes and this
 * file is the only one that reaches the real services.
 */

const firestore = () => firebaseAdmin.app().firestore()

let httpOverride: ProviderHttp | null = null

/** Test seam: the HTTP every network and OAuth call made through these deps uses. */
export function setFulfillmentNetworksHttpForTests(http: ProviderHttp | null): void {
  httpOverride = http
}

const http = (): ProviderHttp => httpOverride ?? defaultProviderHttp()

let store: NetworkStore | null = null
export const platformNetworkStore = (): NetworkStore => (store ??= createFirestoreNetworkStore(firestore))

export function platformProvider(id: NetworkProviderId): FulfillmentNetworkProvider {
  const config = readFulfillmentNetworksConfig()
  return id === 'shipbob'
    ? createShipbobProvider({ http: http(), sandbox: config.shipbob?.sandbox === true })
    : createAmazonMcfProvider({
        http: http(),
        region: config.amazon?.region ?? 'na',
        sandbox: config.amazon?.sandbox === true,
      })
}

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

/** A site's org, and whether it may run this plugin: a plan that sells, commerce and this plugin on. */
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
      checkEntitlement(org as never, FULFILLMENT_NETWORKS_ENTITLEMENT as never) &&
      enabled.includes(FULFILLMENT_NETWORKS_PLUGIN_ID) &&
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
 * entitled and not locked, on a deployment that offers a network.
 */
export async function fulfillmentNetworksGate(
  request: Request,
  role: NetworkRole,
): Promise<NetworkGateResult | Response> {
  if (!offeredNetworks(readFulfillmentNetworksConfig()).length) return fail(404, 'Not found')
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
  if (!site.entitled) return fail(404, 'Fulfillment networks are not available for this site')
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

const credentialOpener = () =>
  createCredentialOpener({
    store: platformNetworkStore(),
    config: () => readFulfillmentNetworksConfig(),
    http: http(),
    now: Date.now,
  })

export function platformEngineDeps(): EngineDeps {
  return {
    now: Date.now,
    store: platformNetworkStore(),
    provider: platformProvider,
    credential: (id, connection) => credentialOpener()(id, connection),
    records: () => pluginShipmentRecords(),
    otherHolds: (hostId, recordId) =>
      pluginFulfillmentHolds(hostId, recordId, { exceptPluginId: FULFILLMENT_NETWORKS_PLUGIN_ID }),
    stockLevels: () => pluginStockLevels(),
    siteOpen: async (hostId) => {
      const site = await siteContext(hostId)
      if (!site?.entitled) return false
      return !(await getLockdownVerdict({ org: site.org as never, host: site.host as never, request: { method: 'POST' } }))
    },
  }
}

export function platformRouteDeps(): NetworkRouteDeps {
  return {
    now: Date.now,
    config: () => readFulfillmentNetworksConfig(),
    store: platformNetworkStore(),
    provider: platformProvider,
    http: http(),
    engine: createEngine(platformEngineDeps()),
    credential: (id, connection) => credentialOpener()(id, connection),
    gate: fulfillmentNetworksGate,
    consoleAddress,
    logActivity: async (input) => {
      try {
        await logOrgActivity(
          input.orgId,
          { uid: input.uid },
          `fulfillment-networks.${input.action}`,
          {
            type: 'fulfillment-networks:connection' as never,
            id: `${input.hostId}_${input.provider}`,
            name: NETWORK_PROVIDERS[input.provider].label,
          },
        )
      } catch (error) {
        console.error('[fulfillment-networks] activity not logged', error)
      }
    },
  }
}

export const platformRoutes = () => createNetworkRoutes(platformRouteDeps())

export function platformIntakeDeps(): IntakeDeps {
  return { store: platformNetworkStore(), now: Date.now }
}
