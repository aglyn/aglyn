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
import { findPluginPerson, pluginPeopleChangedSince } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { getHostDocAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  firebaseAdmin,
  isEmailVerified,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { getLockdownVerdict, lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import {
  listSiteSuppressionChanges,
  readSiteMarketingStatuses,
  recordSiteUnsubscribes,
  releaseSiteUnsubscribes,
} from '@aglyn/tenant-data-admin/server/site-marketing-sync'
import { MARKETING_PLATFORMS_ENTITLEMENT, MARKETING_PLATFORMS_PLUGIN_ID } from '../constants'
import { MARKETING_PROVIDERS } from '../model/connections'
import { defaultProviderHttp, type ProviderHttp } from '../providers/http'
import { createMarketingProvider } from '../providers/registry'
import { readMarketingPlatformsConfig } from './config'
import { createCredentialOpener } from './credentials'
import type { IntakeDeps } from './intake'
import { marketingOAuthRedirectUri } from './oauth'
import { fail, type MarketingGateResult, type MarketingRole, type MarketingRouteDeps } from './routes'
import { createFirestoreConnectionStore, type ConnectionStore } from './store'
import { runConnectionSync, type SyncRunDeps } from './sync-engine'

/**
 * The production wiring (AGL-3639): the Admin SDK's Firestore, the person
 * records seam the CRM registers, the site consent module in core, and
 * `fetch`. Every module above takes these as arguments, so a spec drives
 * them with fakes and this file is the only one that reaches the real
 * services.
 */

const firestore = () => firebaseAdmin.app().firestore()

let httpOverride: ProviderHttp | null = null

/** Test seam: the HTTP every provider and OAuth call made through these deps uses. */
export function setMarketingPlatformsHttpForTests(http: ProviderHttp | null): void {
  httpOverride = http
}

const http = (): ProviderHttp => httpOverride ?? defaultProviderHttp()

let store: ConnectionStore | null = null
export const platformConnectionStore = (): ConnectionStore => (store ??= createFirestoreConnectionStore(firestore))

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

/** A site's org, and whether it may hold a connection: on a CRM plan, with this plugin on for it. */
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
      checkEntitlement(org as never, MARKETING_PLATFORMS_ENTITLEMENT as never) &&
      enabled.includes(MARKETING_PLATFORMS_PLUGIN_ID),
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

/** Who may use a route: a verified member of the site at `role`, the site entitled and not locked. */
export async function marketingPlatformsGate(
  request: Request,
  role: MarketingRole,
): Promise<MarketingGateResult | Response> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return fail(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch {
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
  if (!site.entitled) return fail(403, 'Email platform connections come with the plans that include the CRM')
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

const CONCURRENCY = 8

async function mapLimited<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await run(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return out
}

export function platformSyncDeps(): SyncRunDeps {
  const deps: SyncRunDeps = {
    now: Date.now,
    store: platformConnectionStore(),
    provider: (id) => createMarketingProvider(id, http()),
    credential: (id, connection) =>
      createCredentialOpener({
        store: platformConnectionStore(),
        config: () => readMarketingPlatformsConfig(),
        http: http(),
        now: Date.now,
      })(id, connection),
    isLocked: async (hostId) => {
      const site = await siteContext(hostId)
      if (!site) return true
      return Boolean(
        await getLockdownVerdict({ org: site.org as never, host: site.host as never, request: { method: 'POST' } }),
      )
    },
    org: async (hostId) => {
      const site = await siteContext(hostId)
      return site ? { orgId: site.orgId, org: site.org, entitled: site.entitled } : null
    },
    peopleChangedSince: (request) => pluginPeopleChangedSince(request),
    readStatuses: (input) => readSiteMarketingStatuses({ ...input, firestore: firestore() }),
    currentStatuses: async (input) => {
      const emails = [...new Set(input.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
      const people = await mapLimited(emails, async (email) => {
        const person = await findPluginPerson({
          hostId: input.hostId,
          orgId: input.orgId,
          email,
          onlyVisibleToSite: true,
          anyKind: true,
        })
        return { email, data: person?.data ?? null }
      })
      const statuses = await readSiteMarketingStatuses({
        hostId: input.hostId,
        org: input.org,
        people,
        firestore: firestore(),
      })
      return new Map(people.map((person, index) => [person.email, statuses[index] ?? null]))
    },
    suppressionChanges: (input) => listSiteSuppressionChanges({ ...input, firestore: firestore() }),
    recordUnsubscribes: (input) => recordSiteUnsubscribes({ ...input, firestore: firestore() }),
    releaseUnsubscribes: (input) => releaseSiteUnsubscribes({ ...input, firestore: firestore() }),
  }
  return deps
}

export function platformRouteDeps(): MarketingRouteDeps {
  return {
    now: Date.now,
    config: () => readMarketingPlatformsConfig(),
    store: platformConnectionStore(),
    provider: (id) => createMarketingProvider(id, http()),
    http: http(),
    gate: marketingPlatformsGate,
    redirectUri: marketingOAuthRedirectUri,
    syncNow: (id, maxPages) => runConnectionSync(platformSyncDeps(), id, { maxPages }),
    logActivity: async (input) => {
      try {
        await logOrgActivity(
          input.orgId,
          { uid: input.uid },
          `marketing-platforms.${input.action}`,
          {
            type: 'marketing-platforms:connection' as never,
            id: `${input.hostId}_${input.provider}`,
            name: MARKETING_PROVIDERS[input.provider].label,
          },
        )
      } catch (error) {
        console.error('[marketing-platforms] activity not logged', error)
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
