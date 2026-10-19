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

import { normalizeNotificationLink } from '@aglyn/aglyn/app-utils/notifications'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PLATFORM_BRAND_NAME, platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { resolveHostEnabledPlugins } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { pluginPeopleChangedSince } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { pluginRecordPageLink } from '@aglyn/aglyn/plugin-manager/plugin-record-pages'
import { resolvePluginService } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { ORDER_HISTORY_CONTRACT } from '@aglyn/plugins-commerce/contracts'
import { getHostDocAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  firebaseAdmin,
  isEmailVerified,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { getLockdownVerdict, lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import { HELP_DESKS_ENTITLEMENT, HELP_DESKS_PLUGIN_ID } from '../constants'
import { HELP_DESK_PROVIDERS } from '../model/connections'
import { defaultProviderHttp, type ProviderHttp } from '../providers/http'
import { createHelpDeskProvider } from '../providers/registry'
import { readHelpDesksConfig } from './config'
import { createCredentialOpener } from './credentials'
import type { IntakeDeps } from './intake'
import { fail, type HelpDeskGateResult, type HelpDeskRole, type HelpDeskRouteDeps } from './routes'
import { createFirestoreConnectionStore, type ConnectionStore } from './store'
import { runConnectionSync, type SyncRunDeps } from './sync-engine'

/**
 * The production wiring (AGL-3824): the Admin SDK's Firestore, the person
 * records seam the CRM registers, commerce's order history service by its
 * contract, and `fetch`. Every module above takes these as arguments, so
 * a spec drives them with fakes and this file is the only one that reaches
 * the real services.
 */

const firestore = () => firebaseAdmin.app().firestore()

let httpOverride: ProviderHttp | null = null

/** Test seam: the HTTP every help desk call made through these deps uses. */
export function setHelpDesksHttpForTests(http: ProviderHttp | null): void {
  httpOverride = http
}

const http = (): ProviderHttp => httpOverride ?? defaultProviderHttp()

let store: ConnectionStore | null = null
export const platformConnectionStore = (): ConnectionStore => (store ??= createFirestoreConnectionStore(firestore))

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

/** A site's org, and whether it may hold a connection: on a plan with the store, with this plugin on for it. */
async function siteContext(hostId: string): Promise<{
  orgId: string
  org: Record<string, unknown>
  host: Record<string, unknown>
  /** The plan carries the store. */
  entitled: boolean
  /** The plugin is on for this site. */
  enabled: boolean
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
    entitled: checkEntitlement(org as never, HELP_DESKS_ENTITLEMENT as never),
    enabled: enabled.includes(HELP_DESKS_PLUGIN_ID),
  }
}

/**
 * Where an order opens in the console, for an agent with a seat there: the
 * page the plugin that shows orders declared, on today's console routes, or
 * `null` when no plugin in this build shows orders.
 */
export function consoleOrderUrl(
  site: { hostId: string; orgSlug: string | null; hostSubdomain: string | null },
  orderId: string,
): string | null {
  const link = normalizeNotificationLink(pluginRecordPageLink('order', site.hostId, orderId), {
    orgSlug: site.orgSlug,
    hostId: site.hostId,
    hostSubdomain: site.hostSubdomain,
  })
  // Only a link rewritten onto the org's routes opens a page.
  if (!link || !site.orgSlug || !site.hostSubdomain || link.startsWith(`/${site.hostId}`)) return null
  try {
    return new URL(link, platformConsoleOrigin()).toString()
  } catch {
    return null
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

/** Who may use a route: a verified member of the site at `role`, the site entitled and not locked. */
export async function helpDesksGate(request: Request, role: HelpDeskRole): Promise<HelpDeskGateResult | Response> {
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
  if (!site.entitled) return fail(403, 'Help desk connections come with the plans that include the store')
  if (!site.enabled) return fail(403, 'Help desks is switched off for this site')
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

export function platformSyncDeps(): SyncRunDeps {
  return {
    now: Date.now,
    store: platformConnectionStore(),
    provider: (id) => createHelpDeskProvider(id, http()),
    credential: (id, connection) =>
      createCredentialOpener({ store: platformConnectionStore(), config: () => readHelpDesksConfig() })(id, connection),
    isLocked: async (hostId) => {
      const site = await siteContext(hostId)
      if (!site) return true
      return Boolean(
        await getLockdownVerdict({ org: site.org as never, host: site.host as never, request: { method: 'POST' } }),
      )
    },
    site: async (hostId) => {
      const site = await siteContext(hostId)
      if (!site) return null
      const slug = site.org['slug']
      const subdomain = site.host['subdomain']
      const where = {
        hostId,
        orgSlug: typeof slug === 'string' ? slug : null,
        hostSubdomain: typeof subdomain === 'string' ? subdomain : null,
      }
      return {
        orgId: site.orgId,
        entitled: site.entitled,
        enabled: site.enabled,
        orderUrl: (orderId) => consoleOrderUrl(where, orderId),
      }
    },
    peopleChangedSince: (request) => pluginPeopleChangedSince(request),
    // Commerce's order history, by its contract (AGL-3980). A process where
    // commerce registered no reader answers `null`: nothing to copy.
    orderHistory: async (request) => {
      const reader = resolvePluginService(ORDER_HISTORY_CONTRACT)
      return reader ? reader.listOrders(request) : null
    },
    source: PLATFORM_BRAND_NAME,
  }
}

export function platformRouteDeps(): HelpDeskRouteDeps {
  return {
    now: Date.now,
    config: () => readHelpDesksConfig(),
    store: platformConnectionStore(),
    provider: (id) => createHelpDeskProvider(id, http()),
    gate: helpDesksGate,
    syncNow: (id, maxPages) => runConnectionSync(platformSyncDeps(), id, { maxPages }),
    logActivity: async (input) => {
      try {
        await logOrgActivity(
          input.orgId,
          { uid: input.uid },
          `help-desks.${input.action}`,
          {
            type: 'help-desks:connection' as never,
            id: `${input.hostId}_${input.provider}`,
            name: HELP_DESK_PROVIDERS[input.provider].label,
          },
        )
      } catch (error) {
        console.error('[help-desks] activity not logged', error)
      }
    },
  }
}

export function platformIntakeDeps(): IntakeDeps {
  return {
    store: platformConnectionStore(),
    orgOf: async (hostId) => (await getOrgForHost(hostId))?.orgId ?? null,
    now: Date.now,
  }
}
