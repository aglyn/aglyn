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
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import { MARKETPLACES_ENTITLEMENT, MARKETPLACES_PLUGIN_ID, SELLER_PLUGIN_ID } from '../constants'
import { MARKETPLACES, type MarketplaceId } from '../model/marketplaces'
import { createAmazonProvider } from '../providers/amazon'
import { createEbayProvider } from '../providers/ebay'
import { createEtsyProvider } from '../providers/etsy'
import { createFaireProvider } from '../providers/faire'
import { defaultProviderHttp, type ProviderHttp } from '../providers/http'
import type { MarketplaceProvider } from '../providers/provider'
import { createTiktokProvider } from '../providers/tiktok'
import { createWalmartProvider } from '../providers/walmart'
import { offeredMarketplaces, readMarketplacesConfig } from './config'
import { createCredentialOpener } from './credentials'
import { createEngine, type EngineDeps } from './engine'
import { consoleAddress } from './oauth'
import { createMarketplaceRoutes, fail, type MarketplaceGateResult, type MarketplaceRole, type MarketplaceRouteDeps } from './routes'
import { createFirestoreMarketplaceStore, type MarketplaceStore } from './store'

/**
 * The production wiring (AGL-3638): the Admin SDK's Firestore, core's
 * product-catalog and channel-orders seams (each the seller's, never
 * imported), and `fetch`. Every module above takes these as arguments, so a
 * spec drives them with fakes and this file is the only one that reaches the
 * real services.
 */

const firestore = () => firebaseAdmin.app().firestore()

let httpOverride: ProviderHttp | null = null

/** Test seam: the HTTP every marketplace call made through these deps uses. */
export function setMarketplacesHttpForTests(http: ProviderHttp | null): void {
  httpOverride = http
}

const http = (): ProviderHttp => httpOverride ?? defaultProviderHttp()

let store: MarketplaceStore | null = null
export const platformMarketplaceStore = (): MarketplaceStore => (store ??= createFirestoreMarketplaceStore(firestore))

export function platformProvider(id: MarketplaceId): MarketplaceProvider {
  switch (id) {
    case 'amazon':
      return createAmazonProvider({ http: http() })
    case 'ebay':
      return createEbayProvider({ http: http() })
    case 'etsy':
      return createEtsyProvider({ http: http() })
    case 'tiktok':
      return createTiktokProvider({ http: http() })
    case 'walmart':
      return createWalmartProvider({ http: http() })
    case 'faire':
      return createFaireProvider({ http: http() })
  }
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
      checkEntitlement(org as never, MARKETPLACES_ENTITLEMENT as never) &&
      enabled.includes(MARKETPLACES_PLUGIN_ID) &&
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
 * entitled and not locked, on a deployment that offers a marketplace.
 */
export async function marketplacesGate(request: Request, role: MarketplaceRole): Promise<MarketplaceGateResult | Response> {
  if (!offeredMarketplaces(readMarketplacesConfig()).length) return fail(404, 'Not found')
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
  if (!staff && (ROLE_RANK[memberRole] ?? 0) < ROLE_RANK[role]) return fail(403, 'Not permitted')
  if (!site.entitled) return fail(404, 'Marketplaces are not available for this site')
  const locked = await lockdownRefusal({ request, staff, uid: decoded.uid, org: site.org as never, host: site.host as never })
  if (locked) return locked
  return { orgId: site.orgId, hostId, uid: decoded.uid, body }
}

export function platformEngineDeps(): EngineDeps {
  const opener = createCredentialOpener({
    store: platformMarketplaceStore(),
    config: () => readMarketplacesConfig(),
    provider: platformProvider,
    now: Date.now,
  })
  return {
    now: Date.now,
    store: platformMarketplaceStore(),
    config: () => readMarketplacesConfig(),
    provider: platformProvider,
    credential: (id, connection) => opener(id, connection),
    catalog: () => pluginProductCatalog(),
    channelOrders: () => pluginChannelOrders(),
    siteOpen: async (hostId) => {
      const site = await siteContext(hostId)
      if (!site?.entitled) return false
      return !(await getLockdownVerdict({ org: site.org as never, host: site.host as never, request: { method: 'POST' } }))
    },
  }
}

export function platformRouteDeps(): MarketplaceRouteDeps {
  return {
    now: Date.now,
    config: () => readMarketplacesConfig(),
    store: platformMarketplaceStore(),
    provider: platformProvider,
    engine: createEngine(platformEngineDeps()),
    gate: marketplacesGate,
    consoleAddress,
    logActivity: async (input) => {
      try {
        await logOrgActivity(input.orgId, { uid: input.uid }, `marketplaces.${input.action}`, {
          type: 'marketplaces:connection' as never,
          id: `${input.hostId}_${input.marketplace}`,
          name: MARKETPLACES[input.marketplace].label,
        })
      } catch (error) {
        console.error('[marketplaces] activity not logged', error)
      }
    },
  }
}

export const platformRoutes = () => createMarketplaceRoutes(platformRouteDeps())
