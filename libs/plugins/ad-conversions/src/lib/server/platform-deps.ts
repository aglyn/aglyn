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

import type { VisitorConsentHost } from '@aglyn/aglyn/app-utils/visitor-consent'
import { resolveHostEnabledPlugins } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { getHostDocAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  firebaseAdmin,
  isEmailVerified,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import { AD_CONVERSIONS_PLUGIN_ID } from '../constants'
import { AD_PROVIDERS } from '../model/connections'
import { defaultProviderHttp, type ProviderHttp } from '../providers/http'
import { readAdConversionsKeyring } from './config'
import type { DeliveryDeps } from './delivery'
import type { IntakeDeps } from './intake'
import { fail, type AdGateResult, type AdRole, type AdRouteDeps } from './routes'
import { createFirestoreAdConversionStore, type AdConversionStore } from './store'

/**
 * The production wiring (AGL-3694): the Admin SDK's Firestore, the host
 * document, the sealing key from env, and `fetch`. Every module above takes
 * these as arguments, so a spec drives them with fakes and this file is the
 * only one that reaches the real services.
 */

const firestore = () => firebaseAdmin.app().firestore()

let httpOverride: ProviderHttp | null = null

/** Test seam: the HTTP every vendor call made through these deps uses. */
export function setAdConversionsHttpForTests(http: ProviderHttp | null): void {
  httpOverride = http
}

const http = (): ProviderHttp => httpOverride ?? defaultProviderHttp()

let store: AdConversionStore | null = null
export const platformAdConversionStore = (): AdConversionStore => (store ??= createFirestoreAdConversionStore(firestore))

const hostDoc = async (hostId: string): Promise<VisitorConsentHost | null> =>
  ((await getHostDocAdmin(hostId)) as VisitorConsentHost | null) ?? null

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

/**
 * Who may use a route: a verified member of the site at `role`, the plugin on
 * for the site, the site not locked. No plan entitlement, for the reason the
 * browser tags have none: the Tracking settings these events pair with are on
 * every plan.
 */
export async function adConversionsGate(request: Request, role: AdRole): Promise<AdGateResult | Response> {
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
  const [resolved, host] = await Promise.all([getOrgForHost(hostId), getHostDocAdmin(hostId)])
  if (!resolved || !host) return fail(404, 'That site was not found')
  const org = resolved.org as Record<string, unknown>
  const staff = decoded['staff'] === true
  const memberRole = String(((host as Record<string, unknown>)['memberRoles'] as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  if (!staff && (ROLE_RANK[memberRole] ?? 0) < ROLE_RANK[role]) return fail(403, 'Not permitted')
  const enabled = resolveHostEnabledPlugins(
    org as { enabledPlugins?: string[] },
    host as { disabledPlugins?: string[]; enabledPlugins?: string[] },
  )
  if (!enabled.includes(AD_CONVERSIONS_PLUGIN_ID)) return fail(403, 'Ad conversions are switched off for this site')
  const locked = await lockdownRefusal({ request, staff, uid: decoded.uid, org: org as never, host: host as never })
  if (locked) return locked
  return { orgId: resolved.orgId, hostId, uid: decoded.uid, body }
}

/** Whether the plugin is on for a site: on for every workspace, off where the site says so. */
async function enabledForSite(hostId: string): Promise<boolean> {
  const [resolved, host] = await Promise.all([getOrgForHost(hostId), getHostDocAdmin(hostId)])
  if (!resolved || !host) return false
  return resolveHostEnabledPlugins(
    resolved.org as { enabledPlugins?: string[] },
    host as { disabledPlugins?: string[]; enabledPlugins?: string[] },
  ).includes(AD_CONVERSIONS_PLUGIN_ID)
}

export function platformIntakeDeps(): IntakeDeps {
  return { store: platformAdConversionStore(), host: hostDoc, enabled: enabledForSite, now: Date.now }
}

export function platformDeliveryDeps(): DeliveryDeps {
  return { store: platformAdConversionStore(), keyring: () => readAdConversionsKeyring(), http: http(), now: Date.now }
}

export function platformRouteDeps(): AdRouteDeps {
  return {
    now: Date.now,
    keyring: () => readAdConversionsKeyring(),
    store: platformAdConversionStore(),
    http: http(),
    gate: adConversionsGate,
    host: hostDoc,
    logActivity: async (input) => {
      try {
        await logOrgActivity(input.orgId, { uid: input.uid }, `ad-conversions.${input.action}`, {
          type: 'ad-conversions:connection' as never,
          id: `${input.hostId}_${input.provider}`,
          name: `${AD_PROVIDERS[input.provider].label} ${AD_PROVIDERS[input.provider].api}`,
        })
      } catch (error) {
        console.error('[ad-conversions] activity not logged', error)
      }
    },
  }
}
