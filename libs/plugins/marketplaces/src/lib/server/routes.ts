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

import { MARKETPLACES_API_ROUTES, OAUTH_STATE_TTL_MS, ORDERS_FIRST_LOOKBACK_MS } from '../constants'
import {
  isMarketplaceId,
  MARKETPLACES,
  marketplaceConnectionId,
  readMarketplaceSettings,
  type ListingProblemView,
  type MarketplaceId,
} from '../model/marketplaces'
import { isProviderError } from '../providers/http'
import type { MarketplaceAccount, MarketplaceGrant, MarketplaceProvider } from '../providers/provider'
import { offeredMarketplaces, openGrant, sealGrant, type MarketplacesConfig } from './config'
import type { Engine } from './engine'
import { newSecret, pkcePair, readOAuthState, safeReturnTo, sha256 } from './oauth'
import {
  connectionView,
  emptyConnection,
  LISTING_CHUNK_IDS,
  marketplaceOrderView,
  type MarketplaceStore,
  type StoredConnection,
} from './store'

/**
 * The console routes (AGL-3638). Every route but the marketplace's redirect
 * back is behind {@link MarketplaceRouteDeps.gate}: a signed-in, verified
 * member of the site at the role it names, on a plan that sells, with
 * commerce and this plugin on for the site and the site not locked. The
 * redirect back is authenticated by the single-use state its connect stored.
 *
 * With no marketplace configured, every gated route answers 404 and the
 * console draws nothing.
 *
 * No answer ever carries a credential or an account's ids: the page sees
 * {@link connectionView} and {@link marketplaceOrderView}.
 */

export type MarketplaceRole = 'viewer' | 'editor' | 'admin'

export interface MarketplaceGateResult {
  orgId: string
  hostId: string
  uid: string
  body: Record<string, unknown>
}

export interface MarketplaceRouteDeps {
  now(): number
  config(): MarketplacesConfig
  store: MarketplaceStore
  provider(id: MarketplaceId): MarketplaceProvider
  engine: Engine
  gate(request: Request, role: MarketplaceRole): Promise<MarketplaceGateResult | Response>
  /** The console address of a path, or `null` when the deployment has none. */
  consoleAddress(path: string, requestUrl: string): string | null
  /** Records a connect or a disconnect on the workspace's activity log. Must not throw. */
  logActivity(input: {
    orgId: string
    uid: string
    action: 'connected' | 'disconnected'
    marketplace: MarketplaceId
    hostId: string
  }): Promise<void>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE })
export const fail = (status: number, error: string): Response => json({ error }, status)

function readMarketplace(body: Record<string, unknown>, request: Request): MarketplaceId | null {
  const raw = body['marketplace'] ?? new URL(request.url).searchParams.get('marketplace')
  return isMarketplaceId(raw) ? raw : null
}

const RECORD_ID = /^[A-Za-z0-9_-]{1,200}$/

function readRecordId(body: Record<string, unknown>, request: Request): string | null {
  const raw = String(body['recordId'] ?? new URL(request.url).searchParams.get('recordId') ?? '')
  return RECORD_ID.test(raw) && !/^__.*__$/.test(raw) ? raw : null
}

/** The parameter a marketplace's redirect carries its code in: each names it its own way. */
const CODE_PARAMS = ['code', 'spapi_oauth_code', 'authorizationCode', 'auth_code'] as const

export function createMarketplaceRoutes(deps: MarketplaceRouteDeps) {
  const offered = () => offeredMarketplaces(deps.config())
  const callbackPath = `/api/${MARKETPLACES_API_ROUTES.oauthCallback}`

  const connectionFor = async (gate: MarketplaceGateResult, marketplace: MarketplaceId) => {
    const id = marketplaceConnectionId(gate.hostId, marketplace)
    const connection = await deps.store.getConnection(id)
    return connection && connection.hostId === gate.hostId ? { id, connection } : null
  }

  const connected = (connection: StoredConnection | null | undefined): connection is StoredConnection =>
    Boolean(connection?.connectedAtMs)

  return {
    /** GET ?hostId — what this deployment offers, and the site's connections. */
    async list(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const config = deps.config()
      const connections = (await deps.store.connectionsForHost(gate.hostId))
        .filter(({ connection }) => connected(connection))
        .map(({ id, connection }) => connectionView(id, connection))
      return json({
        offered: offered().map((id) => ({ id, sandbox: config.apps[id]?.sandbox === true })),
        connections,
      })
    },

    /** POST { hostId, marketplace, returnTo } — start connecting; answers the consent page address. */
    async connect(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const marketplace = readMarketplace(gate.body, request)
      if (!marketplace) return fail(400, 'Choose a marketplace')
      const config = deps.config()
      const app = config.apps[marketplace]
      if (!offered().includes(marketplace) || !app || !config.keyring) {
        return fail(404, `${MARKETPLACES[marketplace].label} cannot be connected here`)
      }
      const redirectUri = deps.consoleAddress(callbackPath, request.url)
      if (!redirectUri) return fail(503, 'This deployment has no console address to come back to')
      const id = marketplaceConnectionId(gate.hostId, marketplace)
      const existing = await deps.store.getConnection(id)
      const nonce = newSecret()
      const pkce = pkcePair()
      const nowMs = deps.now()
      let url: string
      try {
        url = deps.provider(marketplace).authorizeUrl(app, { redirectUri, state: `${id}.${nonce}`, codeChallenge: pkce.challenge })
      } catch (error) {
        return fail(503, isProviderError(error) ? error.message : 'This marketplace cannot be connected here')
      }
      // A first connect creates the document now, waiting for the grant, so
      // the redirect back has somewhere to find the pending state.
      await deps.store.patchConnection(id, {
        ...(existing ?? emptyConnection({ orgId: gate.orgId, hostId: gate.hostId, marketplace, sandbox: app.sandbox, nowMs })),
        pendingOAuth: {
          nonceHash: sha256(nonce),
          sealedVerifierSecret: sealGrant(pkce.verifier, id, 'verifier', config.keyring),
          expMs: nowMs + OAUTH_STATE_TTL_MS,
          uid: gate.uid,
          returnTo: safeReturnTo(gate.body['returnTo']),
        },
        updatedAtMs: nowMs,
      })
      return json({ url })
    },

    /** The marketplace's redirect back (a GET, or a form POST). Sends the member back to the console either way. */
    async oauthCallback(request: Request): Promise<Response> {
      if (request.method !== 'GET' && request.method !== 'POST') return fail(405, 'Method not allowed')
      const url = new URL(request.url)
      const params = new URLSearchParams(url.search)
      if (request.method === 'POST') {
        const form = new URLSearchParams(await request.text().catch(() => ''))
        for (const [key, value] of form) params.set(key, value)
      }
      const state = readOAuthState(params.get('state'))
      const invalid = () => fail(400, 'This link is not valid. Start connecting again from the console.')
      if (!state) return invalid()
      const connection = await deps.store.getConnection(state.connectionId)
      const pending = connection?.pendingOAuth
      if (!connection || !pending || pending.nonceHash !== sha256(state.nonce)) return invalid()
      // Good once, whatever happens next.
      await deps.store.patchConnection(state.connectionId, { pendingOAuth: null })
      const back = (outcome: string) => {
        const target = new URL(pending.returnTo, deps.consoleAddress('/', request.url) ?? url.origin)
        target.searchParams.set('marketplace', connection.marketplace)
        target.searchParams.set('marketplaceConnect', outcome)
        return Response.redirect(target.toString(), 303)
      }
      if (pending.expMs < deps.now()) return back('expired')
      const code = CODE_PARAMS.map((name) => params.get(name)).find((value) => Boolean(value)) ?? null
      if (!code) return back('declined')
      const config = deps.config()
      const app = config.apps[connection.marketplace]
      const redirectUri = deps.consoleAddress(callbackPath, request.url)
      if (!config.keyring || !app || !offered().includes(connection.marketplace) || !redirectUri) return back('unavailable')
      const id = state.connectionId
      const provider = deps.provider(connection.marketplace)
      let grant: MarketplaceGrant
      let account: MarketplaceAccount
      try {
        const verifier = openGrant(pending.sealedVerifierSecret, id, 'verifier', config.keyring).value
        grant = await provider.exchangeCode(app, { code, redirectUri, codeVerifier: verifier, params, nowMs: deps.now() })
        account = await provider.account(app, { accessToken: grant.accessToken, account: grant.account ?? {} })
      } catch (error) {
        console.error('[marketplaces] connect failed', connection.marketplace, isProviderError(error) ? error.message : error)
        return back('failed')
      }
      const nowMs = deps.now()
      const sites = (account.sites ?? []).slice(0, 50)
      const chosen = connection.settings?.marketplaceId
      const marketplaceId =
        chosen && sites.some((site) => site.id === chosen)
          ? chosen
          : (account.account.marketplaceId ?? (sites.length === 1 ? sites[0].id : null))
      // A reconnect keeps the order cursor; a first connect reads back a day.
      const first = !connection.connectedAtMs
      const stored: Partial<StoredConnection> = {
        status: 'active',
        sandbox: app.sandbox,
        accountName: account.accountName ?? connection.accountName,
        account: { ...(grant.account ?? {}), ...account.account },
        sites,
        settings: { ...connection.settings, marketplaceId },
        sealedAccessToken: sealGrant(grant.accessToken, id, 'access', config.keyring),
        sealedRefreshToken: grant.refreshToken ? sealGrant(grant.refreshToken, id, 'refresh', config.keyring) : null,
        accessTokenExpiresAtMs: grant.expiresAtMs,
        refreshTokenExpiresAtMs: grant.refreshExpiresAtMs ?? null,
        tokenKeyId: config.keyring.current.id,
        ...(first ? { ordersSinceMs: nowMs - ORDERS_FIRST_LOOKBACK_MS, ordersPage: null } : {}),
        ordersDueAtMs: nowMs,
        listingsDueAtMs: nowMs,
        dueAtMs: nowMs,
        failures: 0,
        lastError: null,
        connectedAtMs: connection.connectedAtMs ?? nowMs,
        connectedByUid: pending.uid,
        updatedAtMs: nowMs,
      }
      await deps.store.patchConnection(id, stored)
      await deps.store.appendLog(id, {
        atMs: nowMs,
        kind: 'connected',
        message: `Connected to ${MARKETPLACES[connection.marketplace].label}${account.accountName ? ` (${account.accountName})` : ''}`,
      })
      await deps.logActivity({
        orgId: connection.orgId,
        uid: pending.uid,
        action: 'connected',
        marketplace: connection.marketplace,
        hostId: connection.hostId,
      })
      return back('connected')
    },

    /** PATCH { hostId, marketplace, …settings } · DELETE { hostId, marketplace } */
    async connection(request: Request): Promise<Response> {
      if (request.method !== 'PATCH' && request.method !== 'DELETE') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const marketplace = readMarketplace(gate.body, request)
      if (!marketplace) return fail(400, 'Choose a marketplace')
      const found = await connectionFor(gate, marketplace)
      const name = MARKETPLACES[marketplace].label
      if (!connected(found?.connection)) return fail(404, `${name} is not connected`)
      const { id, connection } = found as { id: string; connection: StoredConnection }

      if (request.method === 'DELETE') {
        // Imported orders stay as they are: they are the store's orders now.
        // Shipments still waiting to be confirmed are left to the merchant.
        await deps.store.removeConnection(id)
        await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'disconnected', marketplace, hostId: gate.hostId })
        return json({ ok: true })
      }

      const read = readMarketplaceSettings(gate.body)
      if (read.ok === false) return fail(400, read.error)
      const { paused, ...settings } = read.settings
      const info = MARKETPLACES[marketplace]
      if (settings.listingMode === 'publish' && !info.canPublish) return fail(400, `${name} listings can only be linked by SKU`)
      if (settings.syncPrices && !info.canSyncPrices) return fail(400, `${name} prices are set on ${name}`)
      if (settings.marketplaceId !== undefined && !connection.sites.some((site) => site.id === settings.marketplaceId)) {
        return fail(400, 'Choose a marketplace from the menu')
      }
      const nowMs = deps.now()
      const patch: Partial<StoredConnection> = {
        settings: { ...connection.settings, ...settings },
        updatedAtMs: nowMs,
        // Whatever changed, the listings are brought in line with it now.
        listingsDueAtMs: nowMs,
        dueAtMs: nowMs,
      }
      if (paused !== undefined) {
        if (connection.status === 'reconnect') return fail(409, 'Connect again first')
        patch.status = paused ? 'paused' : 'active'
      }
      await deps.store.patchConnection(id, patch)
      return json({ connection: connectionView(id, { ...connection, ...patch } as StoredConnection) })
    },

    /** POST { hostId, marketplace } — read orders, confirm shipments and bring listings in line now. */
    async syncNow(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const marketplace = readMarketplace(gate.body, request)
      if (!marketplace) return fail(400, 'Choose a marketplace')
      const found = await connectionFor(gate, marketplace)
      if (!connected(found?.connection)) return fail(404, `${MARKETPLACES[marketplace].label} is not connected`)
      const { id, connection } = found as { id: string; connection: StoredConnection }
      if (connection.status === 'reconnect') return fail(409, 'Connect again first')
      if (connection.status === 'paused') return fail(409, 'Resume the connection first')
      const outcome = await deps.engine.runConnection(id, { force: true })
      if (outcome === 'leased_elsewhere') return fail(409, 'A sync is already running. Try again in a moment.')
      const after = await deps.store.getConnection(id)
      return json({ outcome, connection: after ? connectionView(id, after) : null })
    },

    /** GET ?hostId&marketplace — the connection's activity, newest first, and the listings to look at. */
    async activity(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const marketplace = readMarketplace(gate.body, request)
      if (!marketplace) return fail(400, 'Choose a marketplace')
      const found = await connectionFor(gate, marketplace)
      if (!found) return json({ entries: [], problems: [] })
      const [entries, state] = await Promise.all([deps.store.readLog(found.id, 50), deps.store.readListingState(found.id)])
      const problems: ListingProblemView[] = []
      for (const chunk of LISTING_CHUNK_IDS) {
        for (const [offerId, entry] of Object.entries(state[chunk] ?? {})) {
          if (entry.o !== 'failed' && entry.o !== 'not_listed') continue
          problems.push({ offerId, sku: entry.s, title: entry.t, outcome: entry.o, message: entry.m, atMs: entry.at })
        }
      }
      // Refusals first, then products with no listing, each by title.
      problems.sort((a, b) => (a.outcome === b.outcome ? a.title.localeCompare(b.title) : a.outcome === 'failed' ? -1 : 1))
      return json({ entries, problems: problems.slice(0, 500), problemsTotal: problems.length })
    },

    /** GET ?hostId&recordId — the marketplace an order came from, its fees and its shipments there. */
    async order(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'viewer')
      if (gate instanceof Response) return gate
      const recordId = readRecordId(gate.body, request)
      if (!recordId) return fail(400, 'Missing recordId')
      const found = await deps.store.orderByRecord(gate.hostId, recordId)
      return json({ order: found ? marketplaceOrderView(found.order) : null })
    },

    /** POST { hostId, recordId } — send an order's refused or failed shipments to its marketplace again. */
    async orderRetry(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const recordId = readRecordId(gate.body, request)
      if (!recordId) return fail(400, 'Missing recordId')
      const found = await deps.store.orderByRecord(gate.hostId, recordId)
      if (!found || found.order.status !== 'imported') return fail(404, 'This order did not come from a marketplace')
      const shipments = Object.fromEntries(
        Object.entries(found.order.shipments ?? {}).map(([key, shipment]) => [
          key,
          shipment.state === 'failed' ? { ...shipment, state: 'pending' as const, attempts: 0, message: null } : shipment,
        ]),
      )
      await deps.store.patchOrder(found.id, { shipments, active: true, nextRunAtMs: deps.now(), updatedAtMs: deps.now() })
      const outcome = await deps.engine.runOrder(found.id, { force: true })
      if (outcome === 'leased_elsewhere') return fail(409, 'The order is being worked on. Try again in a moment.')
      const after = await deps.store.getOrder(found.id)
      return json({ order: after ? marketplaceOrderView(after) : null })
    },
  }
}

export type MarketplaceRoutes = ReturnType<typeof createMarketplaceRoutes>
