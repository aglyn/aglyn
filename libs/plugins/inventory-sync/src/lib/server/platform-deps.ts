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
import { pluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { pluginProductWriter } from '@aglyn/aglyn/plugin-manager/plugin-product-writer'
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
import { INVENTORY_SYNC_ENTITLEMENT, INVENTORY_SYNC_PLUGIN_ID, SELLER_PLUGIN_ID } from '../constants'
import { INVENTORY_PROVIDERS, inventoryConnectionId, type InventoryProviderId } from '../model/inventory-sync'
import { createBrightpearlProvider } from '../providers/brightpearl'
import { createCin7CoreProvider } from '../providers/cin7-core'
import { defaultProviderHttp, type ProviderHttp } from '../providers/http'
import { createInflowProvider } from '../providers/inflow'
import type { InventorySystemProvider } from '../providers/provider'
import { offeredProviders, readInventorySyncConfig } from './config'
import { createCredentialOpener } from './credentials'
import { createEngine, type EngineDeps, type SourcedProductWriterLike } from './engine'
import type { IntakeDeps } from './intake'
import { consoleAddress } from './oauth'
import {
  createInventoryRoutes,
  fail,
  type InventoryGateResult,
  type InventoryRole,
  type InventoryRouteDeps,
} from './routes'
import { createFirestoreInventoryStore, type InventoryStore } from './store'

/**
 * The production wiring (AGL-3642): the Admin SDK's Firestore, core's
 * stock-level, product-catalog and product-writer seams (each the seller's,
 * never imported), and `fetch`. Every module above takes these as arguments,
 * so a spec drives them with fakes and this file is the only one that reaches
 * the real services.
 */

const firestore = () => firebaseAdmin.app().firestore()

let httpOverride: ProviderHttp | null = null

/** Test seam: the HTTP every system and OAuth call made through these deps uses. */
export function setInventorySyncHttpForTests(http: ProviderHttp | null): void {
  httpOverride = http
}

const http = (): ProviderHttp => httpOverride ?? defaultProviderHttp()

let store: InventoryStore | null = null
export const platformInventoryStore = (): InventoryStore => (store ??= createFirestoreInventoryStore(firestore))

export function platformProvider(id: InventoryProviderId): InventorySystemProvider {
  if (id === 'cin7-core') return createCin7CoreProvider({ http: http() })
  if (id === 'inflow') return createInflowProvider({ http: http() })
  const app = readInventorySyncConfig().brightpearl
  return createBrightpearlProvider({ http: http(), app: { appRef: app?.appRef ?? '', devRef: app?.devRef ?? '' } })
}

/**
 * The products' keeper, through core's `core.product-writer` (AGL-3641).
 * Resolved by name at call time, so a deployment whose seller has not
 * registered one answers `undefined` and the import is not offered.
 */
export function platformProductWriter(): SourcedProductWriterLike | undefined {
  return pluginProductWriter()
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
      checkEntitlement(org as never, INVENTORY_SYNC_ENTITLEMENT as never) &&
      enabled.includes(INVENTORY_SYNC_PLUGIN_ID) &&
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
 * entitled and not locked, on a deployment that offers a system.
 */
export async function inventorySyncGate(request: Request, role: InventoryRole): Promise<InventoryGateResult | Response> {
  if (!offeredProviders(readInventorySyncConfig()).length) return fail(404, 'Not found')
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
  if (!site.entitled) return fail(404, 'Inventory sync is not available for this site')
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
    store: platformInventoryStore(),
    config: () => readInventorySyncConfig(),
    http: http(),
    now: Date.now,
  })

export function platformEngineDeps(): EngineDeps {
  return {
    now: Date.now,
    store: platformInventoryStore(),
    provider: platformProvider,
    credential: (id, connection) => credentialOpener()(id, connection),
    stockLevels: () => pluginStockLevels(),
    catalog: () => pluginProductCatalog(),
    productWriter: platformProductWriter,
    siteOpen: async (hostId) => {
      const site = await siteContext(hostId)
      if (!site?.entitled) return false
      return !(await getLockdownVerdict({ org: site.org as never, host: site.host as never, request: { method: 'POST' } }))
    },
  }
}

export function platformRouteDeps(): InventoryRouteDeps {
  return {
    now: Date.now,
    config: () => readInventorySyncConfig(),
    store: platformInventoryStore(),
    provider: platformProvider,
    http: http(),
    engine: createEngine(platformEngineDeps()),
    credential: (id, connection) => credentialOpener()(id, connection),
    gate: inventorySyncGate,
    canImportProducts: () => platformProductWriter() !== undefined,
    consoleAddress,
    logActivity: async (input) => {
      try {
        await logOrgActivity(input.orgId, { uid: input.uid }, `inventory-sync.${input.action}`, {
          type: 'inventory-sync:connection' as never,
          id: inventoryConnectionId(input.hostId),
          name: INVENTORY_PROVIDERS[input.provider].label,
        })
      } catch (error) {
        console.error('[inventory-sync] activity not logged', error)
      }
    },
  }
}

export const platformRoutes = () => createInventoryRoutes(platformRouteDeps())

export function platformIntakeDeps(): IntakeDeps {
  return { store: platformInventoryStore(), now: Date.now }
}
