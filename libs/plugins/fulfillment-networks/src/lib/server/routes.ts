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

import { timingSafeEqual } from 'node:crypto'
import { FULFILLMENT_NETWORKS_API_ROUTES, OAUTH_STATE_TTL_MS } from '../constants'
import {
  isNetworkProviderId,
  NETWORK_PROVIDER_IDS,
  NETWORK_PROVIDERS,
  networkConnectionId,
  networkOrderId,
  readConnectionSettings,
  type NetworkProviderId,
} from '../model/networks'
import { routingHolds } from '../model/routing'
import { isProviderError, type ProviderHttp } from '../providers/http'
import type { FulfillmentNetworkProvider, NetworkCredential } from '../providers/provider'
import { networkSandbox, offeredNetworks, sealGrant, type FulfillmentNetworksConfig } from './config'
import type { Engine } from './engine'
import {
  exchangeNetworkCode,
  networkAuthorizeUrl,
  newSecret,
  readOAuthState,
  safeReturnTo,
  sha256,
  type NetworkGrant,
} from './oauth'
import {
  connectionView,
  emptyConnection,
  routingView,
  type NetworkStore,
  type StoredConnection,
  type StoredRouting,
} from './store'

/**
 * The console routes (AGL-3634). Every route but the network's redirect back
 * and ShipBob's webhook is behind {@link NetworkRouteDeps.gate}: a signed-in,
 * verified member of the site at the role it names, on a plan that sells,
 * with commerce and this plugin on for the site and the site not locked. The
 * redirect back is authenticated by the single-use state its connect stored;
 * the webhook by the token its address carries.
 *
 * With no network configured, every gated route answers 404, and the list
 * answers nothing to show, so the console draws nothing.
 *
 * No answer ever carries a credential: the page sees {@link connectionView}
 * and {@link routingView}.
 */

export type NetworkRole = 'viewer' | 'editor' | 'admin'

export interface NetworkGateResult {
  orgId: string
  hostId: string
  uid: string
  body: Record<string, unknown>
}

export interface NetworkRouteDeps {
  now(): number
  config(): FulfillmentNetworksConfig
  store: NetworkStore
  provider(id: NetworkProviderId): FulfillmentNetworkProvider
  http: ProviderHttp
  engine: Engine
  /** Opens a connection's grant, refreshing it when it is about to expire. */
  credential(connectionId: string, connection: StoredConnection): Promise<NetworkCredential>
  gate(request: Request, role: NetworkRole): Promise<NetworkGateResult | Response>
  /** The console address of a path of this plugin, or `null` when the deployment has none. */
  consoleAddress(path: string, requestUrl: string): string | null
  /** Records a connect or a disconnect on the workspace's activity log. Must not throw. */
  logActivity(input: {
    orgId: string
    uid: string
    action: 'connected' | 'disconnected'
    provider: NetworkProviderId
    hostId: string
  }): Promise<void>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE })
export const fail = (status: number, error: string): Response => json({ error }, status)

function readProvider(body: Record<string, unknown>, request: Request): NetworkProviderId | null {
  const raw = body['provider'] ?? new URL(request.url).searchParams.get('provider')
  return isNetworkProviderId(raw) ? raw : null
}

const RECORD_ID = /^[A-Za-z0-9_-]{1,200}$/

function readRecordId(body: Record<string, unknown>, request: Request): string | null {
  const raw = String(body['recordId'] ?? new URL(request.url).searchParams.get('recordId') ?? '')
  return RECORD_ID.test(raw) && !/^__.*__$/.test(raw) ? raw : null
}

const sameToken = (presented: string, hash: string | null): boolean => {
  if (!hash || !presented) return false
  const a = Buffer.from(sha256(presented))
  const b = Buffer.from(hash)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** ShipBob's webhook address for one connection, before its topic. */
const webhookPrefix = (deps: NetworkRouteDeps, requestUrl: string, connectionId: string): string | null => {
  const base = deps.consoleAddress(`/api/${FULFILLMENT_NETWORKS_API_ROUTES.webhookShipbob}`, requestUrl)
  return base ? `${base}?${new URLSearchParams({ connection: connectionId }).toString()}` : null
}

export function createNetworkRoutes(deps: NetworkRouteDeps) {
  const offered = () => offeredNetworks(deps.config())

  const connectionFor = async (gate: NetworkGateResult, provider: NetworkProviderId) => {
    const id = networkConnectionId(gate.hostId, provider)
    const connection = await deps.store.getConnection(id)
    return connection && connection.hostId === gate.hostId ? { id, connection } : null
  }

  /** Where one order stands with every network the site connected. */
  const orderAnswer = async (hostId: string, recordId: string) => {
    const connections = await deps.store.connectionsForHost(hostId)
    const routings = (
      await Promise.all(NETWORK_PROVIDER_IDS.map((provider) => deps.store.getRouting(networkOrderId(hostId, recordId, provider))))
    ).filter((routing): routing is StoredRouting => routing !== null)
    return {
      connections: connections
        .filter(({ connection }) => connection.status !== 'reconnect' || connection.connectedAtMs)
        .map(({ connection }) => ({ provider: connection.provider, status: connection.status, sandbox: connection.sandbox === true })),
      routings: routings.map(routingView),
    }
  }

  return {
    /** GET ?hostId — what this deployment offers, and the site's connections. */
    async list(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const config = deps.config()
      const networks = offered()
      const connections = (await deps.store.connectionsForHost(gate.hostId))
        .filter(({ connection }) => connection.connectedAtMs)
        .map(({ id, connection }) => connectionView(id, connection))
      return json({
        offered: networks.map((id) => ({ id, sandbox: networkSandbox(config, id) })),
        connections,
      })
    },

    /** POST { hostId, provider, returnTo } — start connecting; answers the network's consent page address. */
    async connect(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a network')
      const config = deps.config()
      if (!offered().includes(provider)) return fail(404, `${NETWORK_PROVIDERS[provider].label} cannot be connected here`)
      const redirectUri = deps.consoleAddress(`/api/${FULFILLMENT_NETWORKS_API_ROUTES.oauthCallback}`, request.url)
      if (!redirectUri) return fail(503, 'This deployment has no console address to come back to')
      const id = networkConnectionId(gate.hostId, provider)
      const existing = await deps.store.getConnection(id)
      const nonce = newSecret()
      const pendingOAuth = {
        nonceHash: sha256(nonce),
        expMs: deps.now() + OAUTH_STATE_TTL_MS,
        uid: gate.uid,
        returnTo: safeReturnTo(gate.body['returnTo']),
      }
      // A first connect creates the document now, waiting for the grant, so
      // the redirect back has somewhere to find the pending state.
      await deps.store.patchConnection(id, {
        ...(existing ?? emptyConnection({ orgId: gate.orgId, hostId: gate.hostId, provider, sandbox: networkSandbox(config, provider), nowMs: deps.now() })),
        pendingOAuth,
        updatedAtMs: deps.now(),
      })
      return json({ url: networkAuthorizeUrl({ provider, config, redirectUri, connectionId: id, nonce }) })
    },

    /**
     * The network's redirect back: ShipBob posts a form, Amazon sends a GET.
     * Sends the member back to the console either way.
     */
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
        target.searchParams.set('fulfillmentNetwork', outcome)
        return Response.redirect(target.toString(), 303)
      }
      if (pending.expMs < deps.now()) return back('expired')
      const code = params.get('code') ?? params.get('spapi_oauth_code')
      if (!code) return back('declined')
      const config = deps.config()
      const redirectUri = deps.consoleAddress(`/api/${FULFILLMENT_NETWORKS_API_ROUTES.oauthCallback}`, request.url)
      if (!config.keyring || !offered().includes(connection.provider) || !redirectUri) return back('unavailable')
      const id = state.connectionId
      const provider = deps.provider(connection.provider)
      let grant: NetworkGrant
      let account: Awaited<ReturnType<FulfillmentNetworkProvider['account']>>
      let webhookToken: string | null = null
      try {
        grant = await exchangeNetworkCode({
          http: deps.http,
          provider: connection.provider,
          config,
          code,
          redirectUri,
          nowMs: deps.now(),
        })
        account = await provider.account({ accessToken: grant.accessToken })
        const prefix = webhookPrefix(deps, request.url, id)
        if (provider.syncWebhooks && prefix && account.channelId) {
          webhookToken = newSecret()
          await provider.syncWebhooks(
            { accessToken: grant.accessToken, channelId: account.channelId },
            { prefix, url: `${prefix}&${new URLSearchParams({ token: webhookToken }).toString()}` },
          )
        }
      } catch (error) {
        console.error('[fulfillment-networks] connect failed', isProviderError(error) ? error.message : error)
        return back('failed')
      }
      const marketplaces = account.marketplaces ?? []
      const marketplaceId =
        connection.marketplaceId && marketplaces.some((entry) => entry.id === connection.marketplaceId)
          ? connection.marketplaceId
          : marketplaces.length === 1
            ? marketplaces[0].id
            : null
      const stored: Partial<StoredConnection> = {
        status: 'active',
        sandbox: networkSandbox(config, connection.provider),
        accountName: account.accountName ?? connection.accountName,
        channelId: account.channelId ?? null,
        marketplaces: marketplaces.slice(0, 50),
        marketplaceId,
        sealedAccessToken: sealGrant(grant.accessToken, id, 'access', config.keyring),
        sealedRefreshToken: grant.refreshToken ? sealGrant(grant.refreshToken, id, 'refresh', config.keyring) : null,
        accessTokenExpiresAtMs: grant.expiresAtMs,
        tokenKeyId: config.keyring.current.id,
        webhookTokenHash: webhookToken ? sha256(webhookToken) : null,
        inventoryDueAtMs: deps.now(),
        lastError: null,
        connectedAtMs: connection.connectedAtMs ?? deps.now(),
        connectedByUid: pending.uid,
        updatedAtMs: deps.now(),
      }
      await deps.store.patchConnection(id, stored)
      await deps.store.appendLog(id, { atMs: deps.now(), kind: 'connected', message: `Connected to ${NETWORK_PROVIDERS[connection.provider].label}` })
      await deps.logActivity({
        orgId: connection.orgId,
        uid: pending.uid,
        action: 'connected',
        provider: connection.provider,
        hostId: connection.hostId,
      })
      return back('connected')
    },

    /** PATCH { hostId, provider, …settings } · DELETE { hostId, provider } */
    async connection(request: Request): Promise<Response> {
      if (request.method !== 'PATCH' && request.method !== 'DELETE') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a network')
      const found = await connectionFor(gate, provider)
      if (!found?.connection.connectedAtMs) return fail(404, `${NETWORK_PROVIDERS[provider].label} is not connected`)
      const { id, connection } = found

      if (request.method === 'DELETE') {
        // Stop ShipBob calling an address that no longer answers, while the
        // grant still opens. A failure here does not keep the connection.
        const prefix = webhookPrefix(deps, request.url, id)
        const network = deps.provider(provider)
        if (network.syncWebhooks && prefix && connection.status !== 'reconnect') {
          try {
            const credential = await deps.credential(id, connection)
            await network.syncWebhooks(credential, { prefix, url: null })
          } catch (error) {
            console.error('[fulfillment-networks] webhooks not removed', isProviderError(error) ? error.message : error)
          }
        }
        // What the network still holds is the merchant's to follow there:
        // its units are released here, so the order can be shipped another way.
        for (const { id: routingId, routing } of await deps.store.activeRoutingsForConnection(id, 500)) {
          await deps.store.patchRouting(routingId, {
            status: routing.status === 'queued' ? 'skipped' : routing.status === 'shipped' ? 'shipped' : 'failed',
            note:
              routing.status === 'queued'
                ? `Not sent: ${NETWORK_PROVIDERS[provider].label} was disconnected.`
                : routing.status === 'shipped'
                  ? routing.note
                  : `${NETWORK_PROVIDERS[provider].label} was disconnected before everything shipped. Check the order there.`,
            active: false,
            cancelRequested: false,
            updatedAtMs: deps.now(),
          })
        }
        await deps.store.removeConnection(id)
        await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'disconnected', provider, hostId: gate.hostId })
        return json({ ok: true })
      }

      const read = readConnectionSettings(gate.body)
      if (read.ok === false) return fail(400, read.error)
      const settings = read.settings
      const patch: Partial<StoredConnection> = { updatedAtMs: deps.now() }
      if (settings.routing !== undefined) patch.routing = settings.routing
      if (settings.shippingMethod !== undefined) patch.shippingMethod = settings.shippingMethod
      if (settings.shippingSpeed !== undefined) patch.shippingSpeed = settings.shippingSpeed
      if (settings.marketplaceId !== undefined) {
        if (!connection.marketplaces.some((entry) => entry.id === settings.marketplaceId)) {
          return fail(400, 'Choose a marketplace from the menu')
        }
        patch.marketplaceId = settings.marketplaceId
        patch.stock = {}
        patch.inventoryDueAtMs = deps.now()
      }
      if (settings.syncInventory !== undefined) {
        patch.syncInventory = settings.syncInventory
        if (settings.syncInventory) patch.inventoryDueAtMs = deps.now()
      }
      if (settings.paused !== undefined) {
        if (connection.status === 'reconnect') return fail(409, 'Connect again first')
        patch.status = settings.paused ? 'paused' : 'active'
      }
      await deps.store.patchConnection(id, patch)
      return json({ connection: connectionView(id, { ...connection, ...patch }) })
    },

    /** POST { hostId, provider } — count the stock now and read back the orders the network holds. */
    async syncNow(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a network')
      const found = await connectionFor(gate, provider)
      if (!found?.connection.connectedAtMs) return fail(404, `${NETWORK_PROVIDERS[provider].label} is not connected`)
      if (found.connection.status === 'reconnect') return fail(409, 'Connect again first')
      if (found.connection.status === 'paused') return fail(409, 'Resume the connection first')
      await deps.engine.runInventory(found.id, { force: true })
      for (const { id } of await deps.store.activeRoutingsForConnection(found.id, 20)) {
        await deps.engine.runRouting(id, { force: true }).catch((error) => {
          console.error('[fulfillment-networks] sync-now hand-off failed', id, error)
        })
      }
      const after = await deps.store.getConnection(found.id)
      return json({ connection: after ? connectionView(found.id, after) : null })
    },

    /** GET ?hostId&provider — the connection's activity, newest first. */
    async log(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a network')
      const found = await connectionFor(gate, provider)
      if (!found) return json({ entries: [] })
      return json({ entries: await deps.store.readLog(found.id, 50) })
    },

    /** GET ?hostId&recordId — where one order stands with each network. */
    async order(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'viewer')
      if (gate instanceof Response) return gate
      const recordId = readRecordId(gate.body, request)
      if (!recordId) return fail(400, 'Missing recordId')
      return json(await orderAnswer(gate.hostId, recordId))
    },

    /** POST { hostId, recordId, provider } — send one order's lines to a network now, or again. */
    async orderSend(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      const recordId = readRecordId(gate.body, request)
      if (!provider || !recordId) return fail(400, 'Choose an order and a network')
      const found = await connectionFor(gate, provider)
      const network = NETWORK_PROVIDERS[provider].label
      if (!found?.connection.connectedAtMs) return fail(404, `${network} is not connected`)
      if (found.connection.status === 'reconnect') return fail(409, `Connect ${network} again first`)
      const id = networkOrderId(gate.hostId, recordId, provider)
      const existing = await deps.store.getRouting(id)
      if (existing && (routingHolds(existing).length || existing.status === 'shipped')) {
        return fail(409, existing.status === 'queued' ? `The order is already waiting to go to ${network}` : `${network} already has this order`)
      }
      const nowMs = deps.now()
      const fresh: StoredRouting = {
        orgId: found.connection.orgId,
        hostId: gate.hostId,
        recordId,
        provider,
        connectionId: found.id,
        displayRef: existing?.displayRef ?? `#${recordId.slice(0, 8)}`,
        status: 'queued',
        // A send after one the network took is a new order there.
        attempt: existing ? (existing.reference ? (existing.attempt || 1) + 1 : existing.attempt || 1) : 1,
        reference: null,
        providerOrderId: null,
        lines: [],
        shipments: {},
        note: null,
        cancelRequested: false,
        active: true,
        nextRunAtMs: nowMs,
        leaseUntilMs: existing?.leaseUntilMs ?? 0,
        failures: 0,
        testMode: false,
        lastShippedAtMs: null,
        createdAtMs: existing?.createdAtMs ?? nowMs,
        updatedAtMs: nowMs,
      }
      if (existing) await deps.store.patchRouting(id, fresh)
      else if (!(await deps.store.createRouting(id, fresh))) return fail(409, 'The order is already being sent')
      const outcome = await deps.engine.runRouting(id, { force: true })
      if (outcome === 'leased_elsewhere') return fail(409, 'The order is already being sent')
      return json(await orderAnswer(gate.hostId, recordId))
    },

    /** POST { hostId, recordId, provider } — ask the network to cancel what it holds of one order. */
    async orderCancel(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      const recordId = readRecordId(gate.body, request)
      if (!provider || !recordId) return fail(400, 'Choose an order and a network')
      const id = networkOrderId(gate.hostId, recordId, provider)
      const existing = await deps.store.getRouting(id)
      if (!existing || existing.hostId !== gate.hostId || !routingHolds(existing).length) {
        return fail(409, `${NETWORK_PROVIDERS[provider].label} holds nothing of this order to cancel`)
      }
      await deps.store.patchRouting(id, { cancelRequested: true, active: true, nextRunAtMs: deps.now(), updatedAtMs: deps.now() })
      const outcome = await deps.engine.runRouting(id, { force: true })
      if (outcome === 'leased_elsewhere') return fail(409, 'The order is being worked on. Try again in a moment.')
      return json(await orderAnswer(gate.hostId, recordId))
    },

    /** POST ?connection&token&topic — ShipBob's webhook. Acknowledged once verified, whatever it names. */
    async webhookShipbob(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const url = new URL(request.url)
      const connectionId = String(url.searchParams.get('connection') ?? '')
      const token = String(url.searchParams.get('token') ?? '')
      const topic = String(url.searchParams.get('topic') ?? '')
      const connection = /^[A-Za-z0-9_-]{1,200}$/.test(connectionId) ? await deps.store.getConnection(connectionId) : null
      if (!connection || connection.provider !== 'shipbob' || !sameToken(token, connection.webhookTokenHash)) {
        return fail(401, 'Not a webhook this deployment registered')
      }
      const body = (await request.json().catch(() => null)) as Record<string, any> | null
      const orderId = body?.['order_id'] ?? body?.['order']?.['id'] ?? null
      const shipmentId = body?.['order_id'] !== undefined ? (body?.['id'] ?? null) : (body?.['shipment_id'] ?? null)
      const result = await deps.engine.applyShipbobEvent(connectionId, topic, {
        orderId: orderId === null || orderId === undefined ? null : String(orderId),
        shipmentId: shipmentId === null || shipmentId === undefined ? null : String(shipmentId),
      })
      return json({ ok: true, result })
    },
  }
}

export type NetworkRoutes = ReturnType<typeof createNetworkRoutes>
