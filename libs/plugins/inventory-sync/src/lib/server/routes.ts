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

import { INVENTORY_SYNC_API_ROUTES, OAUTH_STATE_TTL_MS } from '../constants'
import {
  INVENTORY_PROVIDERS,
  inventoryConnectionId,
  inventoryOrderId,
  isBrightpearlContactId,
  isInventoryProviderId,
  readInventorySettings,
  type InventoryProviderId,
} from '../model/inventory-sync'
import { isProviderError, type ProviderHttp } from '../providers/http'
import type { InventoryCredential, InventorySystemProvider } from '../providers/provider'
import { offeredProviders, sealCredential, type InventorySyncConfig, type SealedCredentialPayload } from './config'
import type { Engine } from './engine'
import {
  brightpearlAuthorizeUrl,
  exchangeBrightpearlCode,
  newSecret,
  readAccountCode,
  readOAuthState,
  safeReturnTo,
  sha256,
} from './oauth'
import { connectionView, emptyConnection, orderView, type InventoryStore, type StoredConnection } from './store'

/**
 * The console routes (AGL-3642). Every route but Brightpearl's redirect back
 * is behind {@link InventoryRouteDeps.gate}: a signed-in, verified member of
 * the site at the role it names, on a plan that sells, with commerce and this
 * plugin on for the site and the site not locked. The redirect back is
 * authenticated by the single-use state its connect stored.
 *
 * With nothing offered (no token key), every gated route answers 404 and the
 * console draws nothing.
 *
 * No answer ever carries a credential: the page sees {@link connectionView}
 * and {@link orderView}. Keys arrive in a POST body, are checked against the
 * system, sealed, and never echoed.
 */

export type InventoryRole = 'viewer' | 'editor' | 'admin'

export interface InventoryGateResult {
  orgId: string
  hostId: string
  uid: string
  body: Record<string, unknown>
}

export interface InventoryRouteDeps {
  now(): number
  config(): InventorySyncConfig
  store: InventoryStore
  provider(id: InventoryProviderId): InventorySystemProvider
  http: ProviderHttp
  engine: Engine
  /** Opens a connection's credential, refreshing a Brightpearl grant about to expire. */
  credential(connectionId: string, connection: StoredConnection): Promise<InventoryCredential>
  gate(request: Request, role: InventoryRole): Promise<InventoryGateResult | Response>
  /** Whether the deployment has a product writer to import into (`core.product-writer`). */
  canImportProducts(): boolean
  /** The console address of a path of this plugin, or `null` when the deployment has none. */
  consoleAddress(path: string, requestUrl: string): string | null
  /** Records a connect or a disconnect on the workspace's activity log. Must not throw. */
  logActivity(input: {
    orgId: string
    uid: string
    action: 'connected' | 'disconnected'
    provider: InventoryProviderId
    hostId: string
  }): Promise<void>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE })
export const fail = (status: number, error: string): Response => json({ error }, status)

const RECORD_ID = /^[A-Za-z0-9_-]{1,200}$/

function readRecordId(body: Record<string, unknown>, request: Request): string | null {
  const raw = String(body['recordId'] ?? new URL(request.url).searchParams.get('recordId') ?? '')
  return RECORD_ID.test(raw) && !/^__.*__$/.test(raw) ? raw : null
}

const KEY = /^[A-Za-z0-9_\-.:=+/]{6,200}$/

/** The pasted keys for a `keys` system, checked for shape, or what was wrong with them. */
export function readPastedKeys(
  provider: InventoryProviderId,
  body: Record<string, unknown>,
): { ok: true; payload: SealedCredentialPayload } | { ok: false; error: string } {
  const field = (name: string) => String(body[name] ?? '').trim()
  if (provider === 'cin7-core') {
    const accountId = field('accountId')
    const apiKey = field('apiKey')
    if (!KEY.test(accountId) || !KEY.test(apiKey)) return { ok: false, error: 'Paste the Account ID and the application key from Cin7 Core' }
    return { ok: true, payload: { provider, accountId, apiKey } }
  }
  if (provider === 'inflow') {
    const companyId = field('companyId')
    const apiKey = field('apiKey')
    if (!KEY.test(companyId) || !KEY.test(apiKey)) return { ok: false, error: 'Paste the company ID and the API key from inFlow' }
    return { ok: true, payload: { provider, companyId, apiKey } }
  }
  return { ok: false, error: 'Brightpearl is connected by signing in' }
}

export function createInventoryRoutes(deps: InventoryRouteDeps) {
  const offered = () => offeredProviders(deps.config())

  const connectionFor = async (gate: InventoryGateResult) => {
    const id = inventoryConnectionId(gate.hostId)
    const connection = await deps.store.getConnection(id)
    return connection && connection.hostId === gate.hostId ? { id, connection } : null
  }

  /** A connection the gated member's site has finished connecting, or the refusal. */
  const connected = async (gate: InventoryGateResult) => {
    const found = await connectionFor(gate)
    if (!found?.connection.connectedAtMs) return fail(404, 'No inventory system is connected')
    return found
  }

  const answer = async (gate: InventoryGateResult) => {
    const found = await connectionFor(gate)
    return {
      offered: offered().map((id) => ({ id })),
      connection: found?.connection.connectedAtMs ? connectionView(found.connection) : null,
      capabilities: { importProducts: deps.canImportProducts() },
    }
  }

  /** Stores a freshly verified credential on the site's connection, keeping its settings when it is the same system. */
  const store = async (input: {
    gate: { orgId: string; hostId: string; uid: string }
    provider: InventoryProviderId
    payload: SealedCredentialPayload
    accountName: string | null
    extra?: Partial<StoredConnection>
  }) => {
    const config = deps.config()
    const id = inventoryConnectionId(input.gate.hostId)
    const existing = await deps.store.getConnection(id)
    const base =
      existing && existing.provider === input.provider
        ? existing
        : emptyConnection({ orgId: input.gate.orgId, hostId: input.gate.hostId, provider: input.provider, nowMs: deps.now() })
    const nowMs = deps.now()
    await deps.store.patchConnection(id, {
      ...base,
      status: 'active',
      accountName: input.accountName,
      sealedCredential: sealCredential(input.payload, id, config.keyring!),
      credentialKeyId: config.keyring!.current.id,
      holdUntilMs: 0,
      stockDueAtMs: nowMs,
      productsDueAtMs: nowMs,
      lastError: null,
      connectedAtMs: base.connectedAtMs ?? nowMs,
      connectedByUid: input.gate.uid,
      pendingOAuth: null,
      updatedAtMs: nowMs,
      ...(input.extra ?? {}),
    })
    await deps.store.appendLog(id, { atMs: nowMs, kind: 'connected', message: `Connected to ${INVENTORY_PROVIDERS[input.provider].label}` })
    await deps.logActivity({ orgId: input.gate.orgId, uid: input.gate.uid, action: 'connected', provider: input.provider, hostId: input.gate.hostId })
  }

  /** A site connects one system; a second is refused until the first is disconnected. */
  const otherSystem = async (gate: InventoryGateResult, provider: InventoryProviderId): Promise<Response | null> => {
    const found = await connectionFor(gate)
    if (found?.connection.connectedAtMs && found.connection.provider !== provider) {
      return fail(409, `Disconnect ${INVENTORY_PROVIDERS[found.connection.provider].label} first: a store syncs with one system.`)
    }
    return null
  }

  return {
    /** GET ?hostId — what this deployment offers, and the site's connection. */
    async connection(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      return json(await answer(gate))
    },

    /** POST { hostId, provider, accountId|companyId, apiKey } — connect with the merchant's own keys. */
    async connectKeys(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = gate.body['provider']
      if (!isInventoryProviderId(provider) || INVENTORY_PROVIDERS[provider].auth !== 'keys') return fail(400, 'Choose Cin7 Core or inFlow')
      if (!offered().includes(provider)) return fail(404, `${INVENTORY_PROVIDERS[provider].label} cannot be connected here`)
      const busy = await otherSystem(gate, provider)
      if (busy) return busy
      const read = readPastedKeys(provider, gate.body)
      if (read.ok === false) return fail(400, read.error)
      const label = INVENTORY_PROVIDERS[provider].label
      let accountName: string | null
      try {
        accountName = (await deps.provider(provider).account(read.payload as InventoryCredential)).accountName
      } catch (error) {
        if (isProviderError(error) && (error.kind === 'auth' || error.kind === 'not-found' || error.kind === 'invalid')) {
          return fail(400, `${label} did not accept those keys. Check them and try again.`)
        }
        if (isProviderError(error) && error.kind === 'rate-limit') return fail(429, `${label} asked us to slow down. Try again in a minute.`)
        console.error('[inventory-sync] key check failed', isProviderError(error) ? error.message : error)
        return fail(502, `${label} could not be reached. Try again in a minute.`)
      }
      await store({ gate, provider, payload: read.payload, accountName })
      return json(await answer(gate))
    },

    /** POST { hostId, accountCode, returnTo } — start connecting Brightpearl; answers its consent page address. */
    async connectOAuth(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const config = deps.config()
      if (!offered().includes('brightpearl') || !config.brightpearl) return fail(404, 'Brightpearl cannot be connected here')
      const busy = await otherSystem(gate, 'brightpearl')
      if (busy) return busy
      const accountCode = readAccountCode(gate.body['accountCode'])
      if (!accountCode) return fail(400, 'Enter your Brightpearl account code: the name in your Brightpearl address')
      const redirectUri = deps.consoleAddress(`/api/${INVENTORY_SYNC_API_ROUTES.oauthCallback}`, request.url)
      if (!redirectUri) return fail(503, 'This deployment has no console address to come back to')
      const id = inventoryConnectionId(gate.hostId)
      const existing = await deps.store.getConnection(id)
      const nonce = newSecret()
      // A first connect creates the document now, waiting for the grant, so
      // the redirect back has somewhere to find the pending state.
      await deps.store.patchConnection(id, {
        ...(existing ?? emptyConnection({ orgId: gate.orgId, hostId: gate.hostId, provider: 'brightpearl', nowMs: deps.now() })),
        pendingOAuth: {
          nonceHash: sha256(nonce),
          expMs: deps.now() + OAUTH_STATE_TTL_MS,
          uid: gate.uid,
          returnTo: safeReturnTo(gate.body['returnTo']),
          accountCode,
        },
        updatedAtMs: deps.now(),
      })
      return json({
        url: brightpearlAuthorizeUrl({ app: config.brightpearl, accountCode, redirectUri, connectionId: id, nonce }),
      })
    },

    /** GET ?code&state — Brightpearl's redirect back. Sends the member back to the console either way. */
    async oauthCallback(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const url = new URL(request.url)
      const state = readOAuthState(url.searchParams.get('state'))
      const invalid = () => fail(400, 'This link is not valid. Start connecting again from the console.')
      if (!state) return invalid()
      const connection = await deps.store.getConnection(state.connectionId)
      const pending = connection?.pendingOAuth
      if (!connection || !pending || pending.nonceHash !== sha256(state.nonce)) return invalid()
      // Good once, whatever happens next.
      await deps.store.patchConnection(state.connectionId, { pendingOAuth: null })
      const back = (outcome: string) => {
        const target = new URL(pending.returnTo, deps.consoleAddress('/', request.url) ?? url.origin)
        target.searchParams.set('inventorySync', outcome)
        return Response.redirect(target.toString(), 303)
      }
      if (pending.expMs < deps.now()) return back('expired')
      const code = url.searchParams.get('code')
      if (!code) return back('declined')
      const config = deps.config()
      const redirectUri = deps.consoleAddress(`/api/${INVENTORY_SYNC_API_ROUTES.oauthCallback}`, request.url)
      if (!config.keyring || !config.brightpearl || !offered().includes('brightpearl') || !redirectUri) return back('unavailable')
      // Another system connected while this consent page was open keeps the site.
      if (connection.connectedAtMs && connection.provider !== 'brightpearl') return back('unavailable')
      try {
        const grant = await exchangeBrightpearlCode({
          http: deps.http,
          app: config.brightpearl,
          accountCode: pending.accountCode,
          code,
          redirectUri,
          nowMs: deps.now(),
        })
        const credential: InventoryCredential = {
          provider: 'brightpearl',
          accountCode: pending.accountCode,
          apiDomain: grant.apiDomain,
          accessToken: grant.accessToken,
        }
        const account = await deps.provider('brightpearl').account(credential)
        await store({
          gate: { orgId: connection.orgId, hostId: connection.hostId, uid: pending.uid },
          provider: 'brightpearl',
          payload: { provider: 'brightpearl', accessToken: grant.accessToken, refreshToken: grant.refreshToken },
          accountName: account.accountName,
          extra: { accountCode: pending.accountCode, apiDomain: grant.apiDomain, accessTokenExpiresAtMs: grant.expiresAtMs },
        })
      } catch (error) {
        console.error('[inventory-sync] Brightpearl connect failed', isProviderError(error) ? error.message : error)
        return back('failed')
      }
      return back('connected')
    },

    /** PATCH { hostId, …settings } · DELETE { hostId } */
    async settings(request: Request): Promise<Response> {
      if (request.method !== 'PATCH' && request.method !== 'DELETE') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const found = await connected(gate)
      if (found instanceof Response) return found
      const { id, connection } = found
      const info = INVENTORY_PROVIDERS[connection.provider]

      if (request.method === 'DELETE') {
        // Orders not yet sent stay in the store; nothing more goes out.
        for (const { id: orderId, order } of await deps.store.activeOrdersForHost(gate.hostId, 500)) {
          await deps.store.patchOrder(orderId, {
            status: order.status === 'queued' ? 'skipped' : order.status,
            note: order.status === 'queued' ? `Not sent: ${info.label} was disconnected.` : order.note,
            active: false,
            cancelRequested: false,
            updatedAtMs: deps.now(),
          })
        }
        await deps.store.removeConnection(id)
        await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'disconnected', provider: connection.provider, hostId: gate.hostId })
        return json({ ok: true })
      }

      const read = readInventorySettings(gate.body)
      if (read.ok === false) return fail(400, read.error)
      const settings = read.settings
      const nowMs = deps.now()
      const patch: Partial<StoredConnection> = { updatedAtMs: nowMs }
      const locationId = settings.locationId !== undefined ? settings.locationId : connection.locationId
      const stockSource = settings.stockSource ?? connection.stockSource
      if (stockSource === 'store' && !locationId) {
        return fail(400, `Choose the ${info.locationLabel.toLowerCase()} whose counts follow the store’s first`)
      }
      if (settings.productSync === 'export' && !info.exportsProducts) {
        return fail(400, `${info.label} products are made in ${info.label}. Choose Import or Off.`)
      }
      if (settings.productSync === 'import' && !deps.canImportProducts()) {
        return fail(400, 'Importing products is not available on this deployment')
      }
      if (settings.orderCustomer !== undefined && settings.orderCustomer) {
        if (connection.provider === 'brightpearl' && !isBrightpearlContactId(settings.orderCustomer)) {
          return fail(400, 'Enter the number of the Brightpearl contact orders are recorded under')
        }
        if (connection.status === 'reconnect') return fail(409, 'Connect again first')
        try {
          const credential = await deps.credential(id, connection)
          if (!(await deps.provider(connection.provider).customerExists(credential, settings.orderCustomer))) {
            return fail(400, `${info.label} has no customer “${settings.orderCustomer}”. Make it there first, or check the spelling.`)
          }
        } catch (error) {
          return fail(502, `${info.label} could not be asked about that customer: ${isProviderError(error) ? error.message : 'try again'}`)
        }
      }
      if (settings.stockSource !== undefined && settings.stockSource !== connection.stockSource) {
        Object.assign(patch, { stockSource: settings.stockSource, lastCounts: {}, stockDueAtMs: nowMs, stockFullDueAtMs: nowMs })
      }
      if (settings.locationId !== undefined && settings.locationId !== connection.locationId) {
        Object.assign(patch, { locationId: settings.locationId, lastCounts: {}, stockDueAtMs: nowMs, stockFullDueAtMs: nowMs })
      }
      if (settings.productSync !== undefined && settings.productSync !== connection.productSync) {
        Object.assign(patch, {
          productSync: settings.productSync,
          productsCursor: null,
          productsSinceMs: null,
          productsRunStartedAtMs: null,
          productsDueAtMs: nowMs,
        })
      }
      if (settings.sendOrders !== undefined) patch.sendOrders = settings.sendOrders
      if (settings.orderCustomer !== undefined) patch.orderCustomer = settings.orderCustomer
      if (settings.taxRule !== undefined) patch.taxRule = connection.provider === 'cin7-core' ? settings.taxRule : ''
      if (settings.paused !== undefined) {
        if (connection.status === 'reconnect') return fail(409, 'Connect again first')
        patch.status = settings.paused ? 'paused' : 'active'
      }
      await deps.store.patchConnection(id, patch)
      return json({ connection: connectionView({ ...connection, ...patch }) })
    },

    /** GET ?hostId — the connected system's locations, for the settings menu. */
    async locations(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const found = await connected(gate)
      if (found instanceof Response) return found
      if (found.connection.status === 'reconnect') return fail(409, 'Connect again first')
      try {
        const credential = await deps.credential(found.id, found.connection)
        return json({ locations: await deps.provider(found.connection.provider).locations(credential) })
      } catch (error) {
        return fail(502, `${INVENTORY_PROVIDERS[found.connection.provider].label} could not list its locations: ${isProviderError(error) ? error.message : 'try again'}`)
      }
    },

    /** POST { hostId } — sync stock and products now, and send the orders that are due. */
    async syncNow(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const found = await connected(gate)
      if (found instanceof Response) return found
      if (found.connection.status === 'reconnect') return fail(409, 'Connect again first')
      if (found.connection.status === 'paused') return fail(409, 'Resume the connection first')
      if ((found.connection.holdUntilMs ?? 0) > deps.now()) {
        return fail(429, `${INVENTORY_PROVIDERS[found.connection.provider].label} asked us to slow down. It syncs again on its own shortly.`)
      }
      for (const { id, order } of await deps.store.activeOrdersForHost(gate.hostId, 20)) {
        if (order.status !== 'queued' && !order.cancelRequested) continue
        await deps.engine.runOrder(id, { force: true }).catch((error) => {
          console.error('[inventory-sync] sync-now order failed', id, error)
        })
      }
      await deps.engine.runStock(found.id, { force: true })
      await deps.engine.runProducts(found.id, { force: true })
      const after = await deps.store.getConnection(found.id)
      return json({ connection: after ? connectionView(after) : null })
    },

    /** GET ?hostId — the connection's activity, newest first. */
    async log(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const found = await connectionFor(gate)
      return json({ entries: found ? await deps.store.readLog(found.id, 50) : [] })
    },

    /** GET ?hostId — the site's orders that could not be sent, newest first. */
    async orders(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      return json({ orders: (await deps.store.failedOrdersForHost(gate.hostId, 25)).map(orderView) })
    },

    /** GET ?hostId&recordId — where one order stands with the connected system. */
    async order(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'viewer')
      if (gate instanceof Response) return gate
      const recordId = readRecordId(gate.body, request)
      if (!recordId) return fail(400, 'Missing recordId')
      const found = await connectionFor(gate)
      const handOff = await deps.store.getOrder(inventoryOrderId(gate.hostId, recordId))
      return json({
        connection: found?.connection.connectedAtMs
          ? { provider: found.connection.provider, status: found.connection.status }
          : null,
        order: handOff && handOff.hostId === gate.hostId ? orderView(handOff) : null,
      })
    },

    /** POST { hostId, recordId } — send an order that failed, now. */
    async orderSend(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const recordId = readRecordId(gate.body, request)
      if (!recordId) return fail(400, 'Missing recordId')
      const found = await connected(gate)
      if (found instanceof Response) return found
      const label = INVENTORY_PROVIDERS[found.connection.provider].label
      if (found.connection.status === 'reconnect') return fail(409, `Connect ${label} again first`)
      const id = inventoryOrderId(gate.hostId, recordId)
      const handOff = await deps.store.getOrder(id)
      if (!handOff || handOff.hostId !== gate.hostId) return fail(404, `This order was never queued for ${label}`)
      if (handOff.status !== 'failed' && handOff.status !== 'queued') {
        return fail(409, handOff.status === 'sent' ? `${label} already has this order` : 'This order is not waiting to be sent')
      }
      if (handOff.provider !== found.connection.provider) return fail(409, `This order was queued for another system`)
      await deps.store.patchOrder(id, { status: 'queued', active: true, attempts: 0, nextRunAtMs: deps.now(), updatedAtMs: deps.now() })
      const outcome = await deps.engine.runOrder(id, { force: true })
      if (outcome === 'leased_elsewhere') return fail(409, 'The order is already being sent')
      const after = await deps.store.getOrder(id)
      return json({ order: after ? orderView(after) : null })
    },
  }
}

export type InventoryRoutes = ReturnType<typeof createInventoryRoutes>
