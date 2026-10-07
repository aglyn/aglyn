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

import { LOG_PAGE_LIMIT, OAUTH_STATE_TTL_MS, SYNC_NOW_MAX_PAGES } from '../constants'
import {
  isMarketingProviderId,
  MARKETING_PROVIDERS,
  marketingConnectionId,
  readConnectionSettings,
  type MarketingProviderId,
} from '../model/connections'
import { isProviderError, type ProviderHttp } from '../providers/http'
import type { MarketingProvider } from '../providers/provider'
import { providerAvailability, sealCredential, type MarketingPlatformsConfig } from './config'
import {
  authorizeUrl,
  exchangeOAuthCode,
  newOAuthSecrets,
  OAUTH_ENDPOINTS,
  readOAuthState,
  safeReturnTo,
  sha256,
  type OAuthGrant,
} from './oauth'
import { connectionView, emptyConnection, type ConnectionStore, type StoredConnection } from './store'

/**
 * The console routes of the connections card (AGL-3639). Every route but the
 * provider's redirect back is behind {@link MarketingRouteDeps.gate}: a
 * signed-in, verified member of the site, at `editor` to read and `admin` to
 * change anything, on a plan with the CRM, the site not locked. The redirect
 * back is authenticated by the single-use state its connect stored.
 *
 * No answer ever carries a credential: the page sees {@link connectionView}.
 */

export type MarketingRole = 'editor' | 'admin'

export interface MarketingGateResult {
  orgId: string
  hostId: string
  uid: string
  body: Record<string, unknown>
}

export interface MarketingRouteDeps {
  now(): number
  config(): MarketingPlatformsConfig
  store: ConnectionStore
  provider(id: MarketingProviderId): MarketingProvider
  http: ProviderHttp
  gate(request: Request, role: MarketingRole): Promise<MarketingGateResult | Response>
  redirectUri(requestUrl: string): string | null
  /** Runs a connection's sync now, a few pages at most; the job continues it. */
  syncNow(connectionId: string, maxPages: number): Promise<unknown>
  /** Records a connect or a disconnect on the workspace's activity log. Must not throw. */
  logActivity(input: { orgId: string; uid: string; action: 'connected' | 'disconnected'; provider: MarketingProviderId; hostId: string }): Promise<void>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE })
export const fail = (status: number, error: string): Response => json({ error }, status)

function readProvider(body: Record<string, unknown>, request: Request): MarketingProviderId | null {
  const raw = body['provider'] ?? new URL(request.url).searchParams.get('provider')
  return isMarketingProviderId(raw) ? raw : null
}

function refusedConnect(error: unknown, label: string): Response {
  if (isProviderError(error)) {
    if (error.kind === 'auth') return fail(400, `${label} did not accept that key. Check it and try again.`)
    if (error.kind === 'rate-limit') return fail(429, `${label} asked us to slow down. Try again in a minute.`)
    if (error.kind === 'invalid') return fail(400, error.message)
    return fail(502, `${label} could not be reached. Try again in a minute.`)
  }
  console.error('[marketing-platforms] connect failed', error)
  return fail(500, 'The connection could not be made')
}

export function createMarketingRoutes(deps: MarketingRouteDeps) {
  /** The connection fields every fresh connect writes: a new credential means a new copy. */
  const freshConnection = (
    gate: MarketingGateResult,
    provider: MarketingProviderId,
    existing: StoredConnection | null,
  ): StoredConnection => {
    const nowMs = deps.now()
    const base = emptyConnection({ orgId: gate.orgId, hostId: gate.hostId, provider, nowMs })
    // A merchant's own choices survive reconnecting; everything the old
    // credential's account told us, and every cursor into it, does not.
    if (existing) {
      base.tag = existing.tag ?? base.tag
      base.syncContacts = existing.syncContacts !== false
      base.syncEvents = existing.syncEvents !== false
    }
    return { ...base, connectedAtMs: nowMs, connectedByUid: gate.uid }
  }

  const finishConnect = async (
    id: string,
    connection: StoredConnection,
    verified: Awaited<ReturnType<MarketingProvider['verify']>>,
  ) => {
    const existingList = connection.listId
    const listId =
      existingList && verified.lists.some((list) => list.id === existingList)
        ? existingList
        : verified.lists.length === 1
          ? verified.lists[0].id
          : null
    const stored: StoredConnection = {
      ...connection,
      accountName: verified.accountName ?? connection.accountName,
      lists: verified.lists.slice(0, 200),
      listId,
      apiBase: verified.apiBase ?? connection.apiBase,
      status: 'active',
      nextRunAtMs: deps.now(),
      updatedAtMs: deps.now(),
    }
    await deps.store.patch(id, stored)
    await deps.store.appendLog(id, { atMs: deps.now(), kind: 'run', message: 'Connected' })
    return connectionView(id, stored)
  }

  return {
    /** GET ?hostId — what this deployment offers, and the site's connections. */
    async list(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const available = providerAvailability(deps.config())
      const connections = (await deps.store.listForHost(gate.hostId)).map(({ id, connection }) =>
        connectionView(id, connection),
      )
      return json({ available, connections })
    },

    /** POST { hostId, provider, apiKey } — connect with the merchant's own key. */
    async connect(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a platform')
      const config = deps.config()
      const offered = providerAvailability(config).find((entry) => entry.id === provider)
      if (!offered?.apiKey || !config.keyring) return fail(404, `${MARKETING_PROVIDERS[provider].label} cannot be connected with a key here`)
      const apiKey = String(gate.body['apiKey'] ?? '').trim()
      if (!apiKey || apiKey.length > 500 || /\s/.test(apiKey)) return fail(400, 'Paste the whole key, with no spaces')
      const label = MARKETING_PROVIDERS[provider].label
      let verified: Awaited<ReturnType<MarketingProvider['verify']>>
      try {
        verified = await deps.provider(provider).verify({ kind: 'api-key', token: apiKey })
      } catch (error) {
        return refusedConnect(error, label)
      }
      const id = marketingConnectionId(gate.hostId, provider)
      const existing = await deps.store.get(id)
      const connection: StoredConnection = {
        ...freshConnection(gate, provider, existing),
        authKind: 'api-key',
        // The same account and list keep their place: no second full copy.
        ...(existing && existing.apiBase === verified.apiBase && existing.accountName === verified.accountName
          ? { listId: existing.listId, cursors: existing.cursors, backfillDone: existing.backfillDone }
          : {}),
        sealedToken: sealCredential(apiKey, id, 'token', config.keyring),
        tokenKeyId: config.keyring.current.id,
      }
      const view = await finishConnect(id, connection, verified)
      await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'connected', provider, hostId: gate.hostId })
      return json({ connection: view })
    },

    /** PATCH { hostId, provider, …settings } · DELETE { hostId, provider } */
    async connection(request: Request): Promise<Response> {
      if (request.method !== 'PATCH' && request.method !== 'DELETE') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a platform')
      const id = marketingConnectionId(gate.hostId, provider)
      const existing = await deps.store.get(id)
      if (!existing || existing.hostId !== gate.hostId) return fail(404, 'That platform is not connected')

      if (request.method === 'DELETE') {
        await deps.store.remove(id)
        await deps.store.clearEvents(id)
        await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'disconnected', provider, hostId: gate.hostId })
        return json({ ok: true })
      }

      const read = readConnectionSettings(gate.body)
      if (read.ok === false) return fail(400, read.error)
      const settings = read.settings
      const patch: Partial<StoredConnection> = { updatedAtMs: deps.now() }
      if (settings.listId !== undefined && settings.listId !== existing.listId) {
        if (settings.listId && !(existing.lists ?? []).some((list) => list.id === settings.listId)) {
          return fail(400, 'Choose a list from the menu')
        }
        patch.listId = settings.listId
        // A different list starts empty: copy everyone into it again.
        patch.cursors = { contacts: null, suppressions: null, provider: null }
        patch.backfillDone = false
        patch.nextRunAtMs = deps.now()
      }
      if (settings.tag !== undefined) patch.tag = settings.tag
      if (settings.syncContacts !== undefined) patch.syncContacts = settings.syncContacts
      if (settings.syncEvents !== undefined) patch.syncEvents = settings.syncEvents
      if (settings.paused !== undefined) {
        if (existing.status === 'reconnect') return fail(409, 'Connect again first')
        patch.status = settings.paused ? 'paused' : 'active'
        if (!settings.paused) {
          patch.nextRunAtMs = deps.now()
          patch.consecutiveFailures = 0
        }
      }
      await deps.store.patch(id, patch)
      return json({ connection: connectionView(id, { ...existing, ...patch }) })
    },

    /** POST { hostId, provider } — run the sync now; resumes one stopped by failures. */
    async syncNow(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a platform')
      const id = marketingConnectionId(gate.hostId, provider)
      const existing = await deps.store.get(id)
      if (!existing || existing.hostId !== gate.hostId) return fail(404, 'That platform is not connected')
      if (existing.status === 'reconnect') return fail(409, 'Connect again first')
      if (existing.status === 'paused') return fail(409, 'Resume the connection first')
      await deps.store.patch(id, { status: 'active', consecutiveFailures: 0, nextRunAtMs: deps.now(), leaseUntilMs: 0 })
      await deps.syncNow(id, SYNC_NOW_MAX_PAGES)
      const after = await deps.store.get(id)
      return json({ connection: after ? connectionView(id, after) : null })
    },

    /** GET ?hostId&provider&before — the connection's runs and errors, newest first. */
    async log(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a platform')
      const id = marketingConnectionId(gate.hostId, provider)
      const before = Number(new URL(request.url).searchParams.get('before'))
      const entries = await deps.store.readLog(id, LOG_PAGE_LIMIT + 1, Number.isFinite(before) && before > 0 ? before : null)
      const page = entries.slice(0, LOG_PAGE_LIMIT)
      return json({
        entries: page,
        nextBefore: entries.length > LOG_PAGE_LIMIT ? (page[page.length - 1]?.atMs ?? null) : null,
      })
    },

    /** POST { hostId, provider, returnTo } — start an OAuth connect; answers the consent page address. */
    async oauthStart(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a platform')
      const config = deps.config()
      const client = config.oauth[provider]
      const endpoints = OAUTH_ENDPOINTS[provider]
      if (!client || !endpoints || !config.keyring) {
        return fail(404, `${MARKETING_PROVIDERS[provider].label} cannot be connected that way here`)
      }
      const redirectUri = deps.redirectUri(request.url)
      if (!redirectUri) return fail(503, 'This deployment has no console address to come back to')
      const id = marketingConnectionId(gate.hostId, provider)
      const existing = await deps.store.get(id)
      const { nonce, verifier } = newOAuthSecrets(endpoints.pkce)
      const pendingOAuth = {
        nonceHash: sha256(nonce),
        expMs: deps.now() + OAUTH_STATE_TTL_MS,
        uid: gate.uid,
        verifier,
        returnTo: safeReturnTo(gate.body['returnTo']),
      }
      // A first connect creates the document now, paused until the grant
      // arrives, so the callback has somewhere to find the pending state.
      if (existing) await deps.store.patch(id, { pendingOAuth, updatedAtMs: deps.now() })
      else {
        await deps.store.patch(id, {
          ...emptyConnection({ orgId: gate.orgId, hostId: gate.hostId, provider, nowMs: deps.now() }),
          status: 'reconnect',
          authKind: 'oauth',
          pendingOAuth,
        })
      }
      return json({ url: authorizeUrl({ provider, client, redirectUri, connectionId: id, nonce, verifier }) })
    },

    /** GET ?code&state — the provider's redirect back. Sends the member back to the console. */
    async oauthCallback(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const url = new URL(request.url)
      const state = readOAuthState(url.searchParams.get('state'))
      const back = (returnTo: string, outcome: string) => {
        const target = new URL(returnTo, deps.redirectUri(request.url) ?? url.origin)
        target.searchParams.set('marketingPlatform', outcome)
        return Response.redirect(target.toString(), 303)
      }
      if (!state) return fail(400, 'This link is not valid. Start connecting again from the console.')
      const connection = await deps.store.get(state.connectionId)
      const pending = connection?.pendingOAuth
      if (!connection || !pending || pending.nonceHash !== sha256(state.nonce)) {
        return fail(400, 'This link is not valid. Start connecting again from the console.')
      }
      // Good once, whatever happens next.
      await deps.store.patch(state.connectionId, { pendingOAuth: null })
      if (pending.expMs < deps.now()) return back(pending.returnTo, 'expired')
      const code = url.searchParams.get('code')
      if (!code) return back(pending.returnTo, 'declined')
      const config = deps.config()
      const client = config.oauth[connection.provider]
      const redirectUri = deps.redirectUri(request.url)
      if (!client || !config.keyring || !redirectUri) return back(pending.returnTo, 'unavailable')
      let grant: OAuthGrant
      let verified: Awaited<ReturnType<MarketingProvider['verify']>>
      try {
        grant = await exchangeOAuthCode({
          http: deps.http,
          provider: connection.provider,
          client,
          code,
          redirectUri,
          verifier: pending.verifier,
          nowMs: deps.now(),
        })
        verified = await deps
          .provider(connection.provider)
          .verify({ kind: 'oauth', token: grant.accessToken, apiBase: grant.apiBase })
      } catch (error) {
        console.error('[marketing-platforms] OAuth connect failed', isProviderError(error) ? error.message : error)
        return back(pending.returnTo, 'failed')
      }
      const id = state.connectionId
      const gate = { orgId: connection.orgId, hostId: connection.hostId, uid: pending.uid, body: {} }
      const fresh: StoredConnection = {
        ...freshConnection(gate, connection.provider, connection),
        authKind: 'oauth',
        sealedToken: sealCredential(grant.accessToken, id, 'token', config.keyring),
        sealedRefreshToken: grant.refreshToken ? sealCredential(grant.refreshToken, id, 'refresh', config.keyring) : null,
        tokenExpiresAtMs: grant.expiresAtMs,
        tokenKeyId: config.keyring.current.id,
        apiBase: grant.apiBase ?? verified.apiBase,
        accountName: grant.accountName ?? verified.accountName,
      }
      await finishConnect(id, fresh, verified)
      await deps.logActivity({
        orgId: connection.orgId,
        uid: pending.uid,
        action: 'connected',
        provider: connection.provider,
        hostId: connection.hostId,
      })
      return back(pending.returnTo, 'connected')
    },
  }
}

export type MarketingRoutes = ReturnType<typeof createMarketingRoutes>
