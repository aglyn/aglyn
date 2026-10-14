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

import { advertisingEventId, mintAdvertisingLeadKey } from '@aglyn/aglyn/app-utils/advertising-events'
import {
  hostAsksAboutAdvertising,
  hostConsentRequired,
  resolveAdvertisingTagId,
  type VisitorConsentHost,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import { advertisingRequestFacts } from '@aglyn/aglyn/plugin-manager/plugin-advertising-conversions'
import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import {
  AD_PROVIDER_IDS,
  AD_PROVIDERS,
  adConnectionId,
  isAdProviderId,
  PINTEREST_AD_ACCOUNT_PATTERN,
  readAdConnectionSettings,
  type AdProviderId,
  type AdSiteSetup,
} from '../model/connections'
import type { ConversionEvent } from '../providers/event'
import { isProviderError, type ProviderHttp } from '../providers/http'
import { sealToken } from './config'
import { failedPatch, openConnectionToken, sendConversion, sentPatch } from './delivery'
import { testMarkerFor } from './intake'
import { connectionView, emptyConnection, type AdConversionStore, type StoredConnection } from './store'

/**
 * The console routes of the card (AGL-3694). Every route is behind
 * {@link AdRouteDeps.gate}: a signed-in, verified member of the site, at
 * `editor` to read and `admin` to change anything, with the plugin on for the
 * site, the site not locked. No answer ever carries a token: the card sees
 * {@link connectionView}.
 */

export type AdRole = 'editor' | 'admin'

export interface AdGateResult {
  orgId: string
  hostId: string
  uid: string
  body: Record<string, unknown>
}

export interface AdRouteDeps {
  now(): number
  keyring(): SecretBoxKeyring | null
  store: AdConversionStore
  http: ProviderHttp
  gate(request: Request, role: AdRole): Promise<AdGateResult | Response>
  host(hostId: string): Promise<VisitorConsentHost | null>
  /** Records a connect or a disconnect on the workspace's activity log. Must not throw. */
  logActivity(input: { orgId: string; uid: string; action: 'connected' | 'disconnected'; provider: AdProviderId; hostId: string }): Promise<void>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE })
export const fail = (status: number, error: string): Response => json({ error }, status)

function readProvider(body: Record<string, unknown>, request: Request): AdProviderId | null {
  const raw = body['provider'] ?? new URL(request.url).searchParams.get('provider')
  return isAdProviderId(raw) ? raw : null
}

/** What the card shows about the site around the connections. */
export function siteSetup(host: VisitorConsentHost | null): AdSiteSetup {
  const tagIds = Object.fromEntries(
    AD_PROVIDER_IDS.map((id) => [id, resolveAdvertisingTagId(host, id)]),
  ) as Record<AdProviderId, string | null>
  return { tagIds, asksAboutAdvertising: hostConsentRequired(host) && hostAsksAboutAdvertising(host) }
}

export function createAdConversionRoutes(deps: AdRouteDeps) {
  return {
    /** GET ?hostId — whether this deployment can hold a token, the site's setup, and its connections. */
    async list(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const [connections, host] = await Promise.all([
        deps.store.listConnectionsForHost(gate.hostId),
        deps.host(gate.hostId),
      ])
      return json({
        available: Boolean(deps.keyring()),
        setup: siteSetup(host),
        connections: connections.map(({ id, connection }) => connectionView(id, connection)),
      })
    },

    /** POST { hostId, provider, accessToken, adAccountId?, testEventCode? } — connect, or replace the token. */
    async connect(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a platform')
      const keyring = deps.keyring()
      if (!keyring) return fail(503, 'This deployment cannot store access tokens yet')
      const token = String(gate.body['accessToken'] ?? '').trim()
      if (!token || token.length > 2000 || /\s/.test(token)) return fail(400, 'Paste the whole access token, with no spaces')
      const read = readAdConnectionSettings(gate.body)
      if (read.ok === false) return fail(400, read.error)
      const id = adConnectionId(gate.hostId, provider)
      const existing = await deps.store.getConnection(id)
      const adAccountId =
        read.settings.adAccountId !== undefined ? read.settings.adAccountId : (existing?.adAccountId ?? null)
      if (AD_PROVIDERS[provider].adAccount && !(adAccountId && PINTEREST_AD_ACCOUNT_PATTERN.test(adAccountId))) {
        return fail(400, `Add the ${AD_PROVIDERS[provider].adAccount?.label ?? 'ad account ID'}`)
      }
      const nowMs = deps.now()
      const connection: StoredConnection = {
        ...emptyConnection({ orgId: gate.orgId, hostId: gate.hostId, provider, nowMs }),
        // What the merchant set and what was sent survive a new token.
        ...(existing
          ? {
              testEventCode: existing.testEventCode ?? null,
              lastSentAtMs: existing.lastSentAtMs ?? null,
              lastSentEvent: existing.lastSentEvent ?? null,
              lastSentTest: existing.lastSentTest === true,
              totals: existing.totals ?? { sent: 0, failed: 0 },
            }
          : {}),
        ...(read.settings.testEventCode !== undefined ? { testEventCode: read.settings.testEventCode } : {}),
        adAccountId: AD_PROVIDERS[provider].adAccount ? adAccountId : null,
        status: 'active',
        sealedToken: sealToken(token, id, keyring),
        tokenKeyId: keyring.current.id,
        lastError: null,
        lastFailedAtMs: null,
        connectedAtMs: nowMs,
        connectedByUid: gate.uid,
      }
      await deps.store.patchConnection(id, connection)
      await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'connected', provider, hostId: gate.hostId })
      return json({ connection: connectionView(id, connection) })
    },

    /** PATCH { hostId, provider, testEventCode?, adAccountId?, paused? } · DELETE { hostId, provider } */
    async connection(request: Request): Promise<Response> {
      if (request.method !== 'PATCH' && request.method !== 'DELETE') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a platform')
      const id = adConnectionId(gate.hostId, provider)
      const existing = await deps.store.getConnection(id)
      if (!existing || existing.hostId !== gate.hostId) return fail(404, 'That platform is not connected')

      if (request.method === 'DELETE') {
        await deps.store.removeConnection(id)
        await deps.store.clearEvents(id)
        await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'disconnected', provider, hostId: gate.hostId })
        return json({ ok: true })
      }

      const read = readAdConnectionSettings(gate.body)
      if (read.ok === false) return fail(400, read.error)
      const patch: Partial<StoredConnection> = { updatedAtMs: deps.now() }
      if (read.settings.testEventCode !== undefined) patch.testEventCode = read.settings.testEventCode
      if (read.settings.adAccountId !== undefined) {
        if (!AD_PROVIDERS[provider].adAccount) return fail(400, 'That platform has no ad account to set')
        if (!read.settings.adAccountId) return fail(400, 'The ad account ID is required')
        patch.adAccountId = read.settings.adAccountId
      }
      if (read.settings.paused !== undefined) {
        if (existing.status === 'reconnect') return fail(409, 'Connect again with a new access token first')
        patch.status = read.settings.paused ? 'paused' : 'active'
      }
      await deps.store.patchConnection(id, patch)
      return json({ connection: connectionView(id, { ...existing, ...patch }) })
    },

    /**
     * POST { hostId, provider } — send one Purchase marked as a test, now, so
     * the merchant sees it arrive in the vendor's test tool. Never live: with
     * no test marker for the vendor, nothing is sent.
     */
    async testEvent(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a platform')
      const id = adConnectionId(gate.hostId, provider)
      const existing = await deps.store.getConnection(id)
      if (!existing || existing.hostId !== gate.hostId) return fail(404, 'That platform is not connected')
      const marker = testMarkerFor(provider, existing, true)
      if (marker === undefined) return fail(400, 'Add a test event code first, so the event is marked as a test')
      const host = await deps.host(gate.hostId)
      const pixelId = AD_PROVIDERS[provider].needsTagId ? resolveAdvertisingTagId(host, provider) : null
      if (AD_PROVIDERS[provider].needsTagId && !pixelId) {
        return fail(400, `Set the ${AD_PROVIDERS[provider].tag} ID on Setup → Tracking first`)
      }
      const token = await openConnectionToken(deps, id, existing)
      if (!token) return fail(409, 'The stored access token could not be opened. Connect again.')
      const nowMs = deps.now()
      const facts = advertisingRequestFacts(request.headers)
      const event: ConversionEvent = {
        id: advertisingEventId('purchase', `test-${mintAdvertisingLeadKey()}`) ?? `purchase.test-${nowMs}`,
        name: 'purchase',
        occurredAtMs: nowMs,
        url: null,
        currency: 'USD',
        valueCents: 100,
        orderId: null,
        items: [{ id: 'test-event', name: 'Test event', quantity: 1, unitCents: 100 }],
        user: {},
        browser: { ip: facts.ip, userAgent: facts.userAgent },
      }
      try {
        await sendConversion(deps.http, existing, token, { pixelId, test: marker, event })
        const patch = sentPatch(existing, event, true, nowMs)
        await deps.store.patchConnection(id, patch)
        return json({ connection: connectionView(id, { ...existing, ...patch }) })
      } catch (error) {
        const label = AD_PROVIDERS[provider].label
        const message = isProviderError(error) ? error.message : `${label} could not be reached`
        const patch: Partial<StoredConnection> = {
          ...failedPatch(existing, message, nowMs),
          ...(isProviderError(error) && error.kind === 'auth' ? { status: 'reconnect' as const } : {}),
        }
        await deps.store.patchConnection(id, patch)
        return json({ connection: connectionView(id, { ...existing, ...patch }), error: message }, 502)
      }
    },
  }
}

export type AdConversionRoutes = ReturnType<typeof createAdConversionRoutes>
