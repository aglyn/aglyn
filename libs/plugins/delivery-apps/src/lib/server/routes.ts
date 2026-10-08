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

import { OPEN_ORDERS, RECENT_ORDERS } from '../constants'
import {
  DEFAULT_STORE_SETTINGS,
  isDeliveryServiceId,
  readStoreSettings,
  type DeliveryItemMatchView,
  type DeliveryOrderAction,
  type DeliveryServiceId,
} from '../model/delivery-apps'
import { isProviderError } from '../providers/http'
import type { DeliveryProvider } from '../providers/provider'
import { offeredServices, type DeliveryAppsConfig } from './config'
import type { Engine } from './engine'
import { itemKey, orderView, storeDocId, storeView, type DeliveryStore, type StoredStore } from './store'

/**
 * The console routes (AGL-3644).
 *
 * - The store's settings — connect a store, send the menu, match items —
 *   are behind the `settings` gate: a verified ADMIN of the site.
 * - The register's queue and its actions are behind the `register` gate:
 *   an admin or editor of the site with `managePos` — the register's own
 *   gate. Both ask for the `pos` entitlement, commerce and this plugin on
 *   for the site, and a site not locked.
 * - Each service's webhook carries no session: it is the service's own
 *   signature that admits it ({@link DeliveryProvider.verify}).
 *
 * With no service configured, every route answers 404 and the console draws
 * nothing. No answer carries a credential, and the register sees each
 * buyer's first name and last initial only.
 */

export type DeliveryGateKind = 'settings' | 'register'

export interface DeliveryGateResult {
  orgId: string
  hostId: string
  uid: string
  body: Record<string, unknown>
}

export interface DeliveryRouteDeps {
  now(): number
  config(): DeliveryAppsConfig
  store: DeliveryStore
  provider(service: DeliveryServiceId): DeliveryProvider | null
  engine: Engine
  gate(request: Request, kind: DeliveryGateKind): Promise<DeliveryGateResult | Response>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE })
export const fail = (status: number, error: string): Response => json({ error }, status)

/** A webhook body larger than any order: refused before it is read as JSON. */
const MAX_WEBHOOK_BYTES = 1_000_000

const EXTERNAL_ID = /^[A-Za-z0-9._:-]{1,120}$/
const DOC_ID = /^[A-Za-z0-9_-]{1,200}$/
const ACTIONS: readonly DeliveryOrderAction[] = ['accept', 'reject', 'ready', 'picked_up', 'retry']

function readService(body: Record<string, unknown>, request: Request): DeliveryServiceId | null {
  const raw = body['service'] ?? new URL(request.url).searchParams.get('service')
  return isDeliveryServiceId(raw) ? raw : null
}

const param = (body: Record<string, unknown>, request: Request, name: string) =>
  String(body[name] ?? new URL(request.url).searchParams.get(name) ?? '').trim()

export function createDeliveryRoutes(deps: DeliveryRouteDeps) {
  const offered = () => offeredServices(deps.config())

  const hostStore = async (hostId: string, service: DeliveryServiceId) =>
    (await deps.store.storesForHost(hostId)).find((entry) => entry.store.service === service) ?? null

  const webhook = (service: DeliveryServiceId) =>
    async function serviceWebhook(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const provider = offered().includes(service) ? deps.provider(service) : null
      if (!provider) return fail(404, 'Not found')
      const declared = Number(request.headers.get('content-length') ?? 0)
      if (declared > MAX_WEBHOOK_BYTES) return fail(413, 'Too large')
      const rawBody = await request.text()
      if (rawBody.length > MAX_WEBHOOK_BYTES) return fail(413, 'Too large')
      const incoming = { rawBody, headers: request.headers, url: request.url, method: request.method }
      if (!provider.verify(incoming, deps.now())) return fail(401, 'Signature not valid')
      let events
      try {
        events = await provider.parse(incoming)
      } catch (error) {
        // The order could not be read back from the service: it sends the webhook again.
        console.error(`[delivery-apps] ${service} webhook not read`, isProviderError(error) ? error.message : error)
        return fail(503, 'Try again')
      }
      try {
        const outcome = await deps.engine.handleEvents(service, events)
        if (outcome.outcome === 'unknown_store') return fail(404, 'No store here is connected to that store')
        return json({ received: true, applied: outcome.applied })
      } catch (error) {
        console.error(`[delivery-apps] ${service} webhook failed`, error)
        return fail(500, 'Try again')
      }
    }

  return {
    /** GET ?hostId — what the deployment offers, and the site's stores. */
    async stores(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'settings')
      if (gate instanceof Response) return gate
      const config = deps.config()
      const stores = (await deps.store.storesForHost(gate.hostId))
        .filter((entry) => offered().includes(entry.store.service))
        .map((entry) => storeView(entry.store))
      return json({ offered: offered().map((id) => ({ id, sandbox: config[id]?.sandbox === true })), stores })
    },

    /** POST { hostId, service, externalStoreId, settings } — connect or update; DELETE { hostId, service } — disconnect. */
    async store(request: Request): Promise<Response> {
      if (request.method !== 'POST' && request.method !== 'DELETE') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'settings')
      if (gate instanceof Response) return gate
      const service = readService(gate.body, request)
      if (!service || !offered().includes(service)) return fail(400, 'Choose a delivery service')
      const existing = await hostStore(gate.hostId, service)
      if (request.method === 'DELETE') {
        if (existing) await deps.store.deleteStore(existing.id)
        return json({ ok: true })
      }
      const nowMs = deps.now()
      const externalStoreId = param(gate.body, request, 'externalStoreId')
      const settings = readStoreSettings(gate.body['settings'], existing?.store.settings ?? DEFAULT_STORE_SETTINGS)
      if (existing && (!externalStoreId || externalStoreId === existing.store.externalStoreId)) {
        await deps.store.updateStore(existing.id, () => ({ settings, updatedAtMs: nowMs }))
        return json({ ok: true, store: storeView({ ...existing.store, settings }) })
      }
      if (!EXTERNAL_ID.test(externalStoreId)) return fail(400, 'Enter the store ID the service shows you')
      const id = storeDocId(service, externalStoreId)
      const store: StoredStore = {
        orgId: gate.orgId,
        hostId: gate.hostId,
        service,
        externalStoreId,
        settings,
        connectedAtMs: nowMs,
        connectedBy: gate.uid,
        updatedAtMs: nowMs,
        // A new store id keeps the matches the merchant already made.
        itemMatches: existing?.store.itemMatches ?? {},
        unmatched: existing?.store.unmatched ?? {},
        menu: { publishedAtMs: null, items: 0, error: null },
      }
      if ((await deps.store.connectStore(id, store)) === 'taken') {
        return fail(409, 'That store is connected to another site. Disconnect it there first.')
      }
      if (existing && existing.id !== id) await deps.store.deleteStore(existing.id)
      return json({ ok: true, store: storeView(store) })
    },

    /** POST { hostId, service } — send the menu, built from the catalog. */
    async menu(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'settings')
      if (gate instanceof Response) return gate
      const service = readService(gate.body, request)
      const existing = service ? await hostStore(gate.hostId, service) : null
      if (!existing) return fail(404, 'That store is not connected')
      const outcome = await deps.engine.publishMenu(existing.id)
      return 'message' in outcome ? fail(422, outcome.message) : json({ ok: true, items: outcome.items })
    },

    /** GET ?hostId&service — the items matched and waiting; POST — match an item or clear its match. */
    async items(request: Request): Promise<Response> {
      if (request.method !== 'GET' && request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'settings')
      if (gate instanceof Response) return gate
      const service = readService(gate.body, request)
      const existing = service ? await hostStore(gate.hostId, service) : null
      if (!existing) return fail(404, 'That store is not connected')
      if (request.method === 'POST') {
        const externalItemId = param(gate.body, request, 'externalItemId').slice(0, 200)
        if (!externalItemId) return fail(400, 'Choose an item')
        const key = itemKey(externalItemId)
        const productId = param(gate.body, request, 'productId')
        const variantId = param(gate.body, request, 'variantId')
        const clear = gate.body['clear'] === true
        if (!clear && (!DOC_ID.test(productId) || !DOC_ID.test(variantId) || /^__.*__$/.test(productId))) {
          return fail(400, 'Choose a product')
        }
        await deps.store.updateStore(existing.id, (store) => {
          const itemMatches = { ...(store.itemMatches ?? {}) }
          const unmatched = { ...(store.unmatched ?? {}) }
          const name = itemMatches[key]?.name ?? unmatched[key]?.name ?? (String(gate.body['name'] ?? '').slice(0, 200) || externalItemId)
          if (clear) {
            delete itemMatches[key]
            unmatched[key] = { externalItemId, name, lastSeenAtMs: deps.now() }
          } else {
            itemMatches[key] = {
              externalItemId,
              name,
              productId,
              variantId,
              title: String(gate.body['title'] ?? '').slice(0, 200) || name,
            }
            delete unmatched[key]
          }
          return { itemMatches, unmatched, updatedAtMs: deps.now() }
        })
        return json({ ok: true })
      }
      const store = existing.store
      const items: DeliveryItemMatchView[] = [
        ...Object.values(store.unmatched ?? {})
          .sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs)
          .map((item) => ({ externalItemId: item.externalItemId, name: item.name, productId: null, variantId: null, title: null, lastSeenAtMs: item.lastSeenAtMs })),
        ...Object.values(store.itemMatches ?? {})
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => ({ externalItemId: item.externalItemId, name: item.name, productId: item.productId, variantId: item.variantId, title: item.title, lastSeenAtMs: null })),
      ]
      return json({ items })
    },

    /** GET ?hostId&q — offers to match an item to. */
    async catalog(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'settings')
      if (gate instanceof Response) return gate
      return json({ options: await deps.engine.searchCatalog(gate.hostId, param(gate.body, request, 'q').slice(0, 80)) })
    },

    /** GET ?hostId — the register's open delivery orders, oldest first, and the latest finished. */
    async queue(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'register')
      if (gate instanceof Response) return gate
      const connected = (await deps.store.storesForHost(gate.hostId)).some((entry) => offered().includes(entry.store.service))
      if (!connected) return json({ connected: false, open: [], recent: [] })
      const [open, recent] = await Promise.all([
        deps.store.openOrders(gate.hostId, OPEN_ORDERS),
        deps.store.recentOrders(gate.hostId, RECENT_ORDERS),
      ])
      return json({
        connected: true,
        open: open.map((entry) => orderView(entry.id, entry.order)),
        recent: recent.map((entry) => orderView(entry.id, entry.order)),
      })
    },

    /** POST { hostId, orderId, action, reason? } — accept, reject, ready, picked up, or send again. */
    async orderAction(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'register')
      if (gate instanceof Response) return gate
      const orderId = param(gate.body, request, 'orderId')
      const action = gate.body['action'] as DeliveryOrderAction
      if (!DOC_ID.test(orderId) || !ACTIONS.includes(action)) return fail(400, 'Choose an order and what to do')
      const order = await deps.store.getOrder(orderId)
      // Another site's order is answered as missing, never acted on.
      if (!order || order.hostId !== gate.hostId) return fail(404, 'That order was not found')
      if (!offered().includes(order.service)) return fail(404, 'That order was not found')
      let outcome
      try {
        outcome = await deps.engine.act(orderId, action, { reason: String(gate.body['reason'] ?? '').slice(0, 200) })
      } catch (error) {
        console.error('[delivery-apps] order action failed', orderId, action, error)
        return fail(500, 'That did not go through. Try again in a moment.')
      }
      switch (outcome.outcome) {
        case 'done': {
          const after = await deps.store.getOrder(orderId)
          return json({ ok: true, message: outcome.message, order: after ? orderView(orderId, after) : null })
        }
        case 'refused':
          return fail(409, outcome.message)
        case 'busy':
          return fail(409, 'This order is being updated. Try again in a moment.')
        case 'no_such_order':
          return fail(404, 'That order was not found')
      }
    },

    webhookDoordash: webhook('doordash'),
    webhookUberEats: webhook('uber-eats'),
    webhookGrubhub: webhook('grubhub'),
  }
}

export type DeliveryRoutes = ReturnType<typeof createDeliveryRoutes>
