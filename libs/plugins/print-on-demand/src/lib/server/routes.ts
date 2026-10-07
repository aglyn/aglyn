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

import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { pluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { randomBytes } from 'node:crypto'
import { POD_API_ROUTES } from '../constants/api-routes'
import { POD_COLLECTIONS } from '../constants/bundle-common'
import {
  isPodProvider,
  POD_PROVIDER_LABELS,
  POD_PROVIDERS,
  POD_TOKEN_HELP,
  type PodCatalogEntry,
  type PodProviderId,
} from '../model/print-on-demand'
import { PodProviderError } from '../providers/http'
import type { PodStore } from '../providers/types'
import { importSourceProduct, type PodImportResult } from './catalog'
import { podProviderFor } from './config'
import { cancelPodOrder, confirmPodOrder, podOrderIdsFor, refreshPodOrder, sendPodOrder } from './orders'
import { podError, podGate, podJson } from './route-gate'
import {
  connectionId,
  connectionRef,
  connectionView,
  isDocumentId,
  linkId,
  linkRef,
  linkView,
  openCredentials,
  openWebhookToken,
  podDb,
  podOrderId,
  podOrderRef,
  podOrderView,
  readConnection,
  readConnections,
  readLinksForProducts,
  readStoredLink,
  readStoredPodOrder,
  sealConnectionSecrets,
  type StoredPodConnection,
} from './store'

/**
 * The console routes (AGL-3641), each behind `podGate`. A token is stored
 * only after the service accepted it: a connect that fails stores nothing,
 * so a site never holds a token it cannot use.
 */

const MAX_TOKEN_LENGTH = 2_000
/** Products imported per request: each is several calls to the service and a few photo uploads. */
export const POD_IMPORT_BATCH = 5
const PAGE_MAX = 50

function methodNotAllowed(): Response {
  return podError(405, 'Method not allowed')
}

function message(error: unknown, provider: PodProviderId): string {
  if (error instanceof PodProviderError) return error.message
  return `${POD_PROVIDER_LABELS[provider]} could not be reached. Try again.`
}

function providerOf(value: unknown): PodProviderId | null {
  return isPodProvider(value) ? value : null
}

/** The address a service tells about orders: the console's own, with the connection and its secret. */
export function podWebhookUrl(provider: PodProviderId, connection: string, token: string): string {
  const route = provider === 'printful' ? POD_API_ROUTES.webhookPrintful : POD_API_ROUTES.webhookPrintify
  const query = new URLSearchParams({ c: connection, t: token })
  return `${platformConsoleOrigin()}/api/${route}?${query.toString()}`
}

/** GET: whether the deployment can hold a connection, and the site's connections. */
export async function connectionsRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const gate = await podGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  const connections = await readConnections(gate.hostId)
  const store = await pluginProductCatalog()?.store(gate.hostId).catch(() => null)
  return podJson({
    available: true,
    storeCurrency: String(store?.currency ?? 'USD').toUpperCase(),
    providers: POD_PROVIDERS.map((id) => ({ id, label: POD_PROVIDER_LABELS[id], tokenHelp: POD_TOKEN_HELP[id] })),
    connections: connections.map(connectionView),
  })
}

/** POST: the stores a token reaches, to choose one before connecting. */
export async function storesRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await podGate(request, { role: 'admin' })
  if (gate instanceof Response) return gate
  const provider = providerOf(gate.body['provider'])
  if (!provider) return podError(400, 'Choose Printful or Printify.')
  const token = String(gate.body['token'] ?? '').trim()
  if (!token || token.length > MAX_TOKEN_LENGTH) return podError(400, `Paste your ${POD_PROVIDER_LABELS[provider]} ${POD_TOKEN_HELP[provider].label}.`)
  try {
    return podJson({ stores: await podProviderFor(provider).listStores(token) })
  } catch (error) {
    return podError(400, message(error, provider))
  }
}

async function forgetWebhooks(connection: StoredPodConnection, keyring: Parameters<typeof openCredentials>[1]): Promise<void> {
  const secret = openWebhookToken(connection, keyring)
  if (!secret) return
  try {
    await podProviderFor(connection.provider).removeWebhooks(
      openCredentials(connection, keyring),
      podWebhookUrl(connection.provider, connectionId(connection.hostId, connection.provider), secret),
    )
  } catch {
    // Best effort: a hook left behind names a connection that no longer opens.
  }
}

/** POST: test a token with the service, and store it only if it works. */
export async function connectRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await podGate(request, { role: 'admin' })
  if (gate instanceof Response) return gate
  const { body, hostId, keyring } = gate
  const provider = providerOf(body['provider'])
  if (!provider) return podError(400, 'Choose Printful or Printify.')
  const label = POD_PROVIDER_LABELS[provider]
  const token = String(body['token'] ?? '').trim()
  if (!token || token.length > MAX_TOKEN_LENGTH) return podError(400, `Paste your ${label} ${POD_TOKEN_HELP[provider].label}.`)
  const adapter = podProviderFor(provider)
  let stores: PodStore[]
  try {
    stores = await adapter.listStores(token)
  } catch (error) {
    return podError(400, message(error, provider))
  }
  const wanted = String(body['storeId'] ?? '').trim()
  const store = wanted ? stores.find((entry) => entry.id === wanted) : stores.length === 1 ? stores[0] : undefined
  if (!store) {
    return stores.length === 0
      ? podError(400, `The token reaches no ${provider === 'printful' ? 'store' : 'shop'} at ${label}.`)
      : podError(409, `Choose which ${label} ${provider === 'printful' ? 'store' : 'shop'} to connect.`)
  }
  // The token must read the store's products, not just list stores.
  try {
    await adapter.listProducts({ token, storeId: store.id }, null)
  } catch (error) {
    return podError(400, message(error, provider))
  }

  const now = Date.now()
  const previous = await readConnection(hostId, provider)
  if (previous) await forgetWebhooks(previous, keyring)
  const id = connectionId(hostId, provider)
  const webhookToken = randomBytes(32).toString('base64url')
  const currency = (store.currency ?? 'USD').toUpperCase()
  let webhooks: { registered: boolean; detail: string | null }
  try {
    webhooks = await adapter.registerWebhooks({ token, storeId: store.id }, podWebhookUrl(provider, id, webhookToken), webhookToken)
  } catch (error) {
    webhooks = {
      registered: false,
      detail: `${label} did not accept the notice address (${message(error, provider)}), so shipments are checked every 15 minutes instead.`,
    }
  }
  await connectionRef(hostId, provider).set({
    orgId: gate.orgId,
    hostId,
    provider,
    storeId: store.id,
    storeName: store.name,
    currency,
    ...sealConnectionSecrets({ apiToken: token, webhookToken }, hostId, provider, keyring),
    submitMode: previous?.submitMode ?? 'automatic',
    syncPrices: previous?.syncPrices ?? false,
    webhooks: webhooks.registered ? 'registered' : 'polling',
    webhookDetail: webhooks.detail,
    lastError: null,
    connectedByUid: gate.uid,
    connectedAtMs: previous?.connectedAtMs || now,
    updatedAtMs: now,
  })
  const stored = await readConnection(hostId, provider)
  const catalogStore = await pluginProductCatalog()?.store(hostId).catch(() => null)
  const storeCurrency = String(catalogStore?.currency ?? 'USD').toUpperCase()
  return podJson({
    connection: stored ? connectionView(stored) : null,
    notice:
      storeCurrency !== currency
        ? `${label} prices this ${provider === 'printful' ? 'store' : 'shop'} in ${currency} and your store sells in ${storeCurrency}, so its products cannot be imported until both use the same currency.`
        : null,
  })
}

/** POST: how paid orders are sent, and whether re-syncs rewrite prices. */
export async function settingsRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await podGate(request, { role: 'admin' })
  if (gate instanceof Response) return gate
  const provider = providerOf(gate.body['provider'])
  if (!provider) return podError(400, 'Choose Printful or Printify.')
  const connection = await readConnection(gate.hostId, provider)
  if (!connection) return podError(404, `${POD_PROVIDER_LABELS[provider]} is not connected.`)
  const patch: Record<string, unknown> = { updatedAtMs: Date.now() }
  if ('submitMode' in gate.body) patch['submitMode'] = gate.body['submitMode'] === 'review' ? 'review' : 'automatic'
  if ('syncPrices' in gate.body) patch['syncPrices'] = gate.body['syncPrices'] === true
  await connectionRef(gate.hostId, provider).set(patch, { merge: true })
  const stored = await readConnection(gate.hostId, provider)
  return podJson({ connection: stored ? connectionView(stored) : null })
}

/** POST: forget a connection's token. Imported products and sent orders are kept. */
export async function disconnectRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await podGate(request, { role: 'admin' })
  if (gate instanceof Response) return gate
  const provider = providerOf(gate.body['provider'])
  if (!provider) return podError(400, 'Choose Printful or Printify.')
  const connection = await readConnection(gate.hostId, provider)
  if (connection) await forgetWebhooks(connection, gate.keyring)
  await connectionRef(gate.hostId, provider).delete()
  return podJson({ disconnected: true })
}

async function connected(gate: { hostId: string }, value: unknown): Promise<StoredPodConnection | Response> {
  const provider = providerOf(value)
  if (!provider) return podError(400, 'Choose Printful or Printify.')
  const connection = await readConnection(gate.hostId, provider)
  return connection ?? podError(404, `Connect ${POD_PROVIDER_LABELS[provider]} first.`)
}

/** GET: one page of the service's products, marked with what is already imported. */
export async function catalogRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const gate = await podGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const params = new URL(request.url).searchParams
  const connection = await connected(gate, params.get('provider'))
  if (connection instanceof Response) return connection
  const cursor = params.get('cursor')
  try {
    const page = await podProviderFor(connection.provider).listProducts(openCredentials(connection, gate.keyring), cursor || null)
    const links = await Promise.all(
      page.products.map((product) => linkRef(linkId(gate.hostId, connection.provider, product.id)).get()),
    )
    const products: PodCatalogEntry[] = page.products.map((product, index) => ({
      ...product,
      importedProductId: readStoredLink(links[index].data())?.productId ?? null,
    }))
    return podJson({ products, nextCursor: page.nextCursor, total: page.total })
  } catch (error) {
    return podError(502, message(error, connection.provider))
  }
}

/** POST: import or re-sync up to {@link POD_IMPORT_BATCH} products. */
export async function importRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await podGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const connection = await connected(gate, gate.body['provider'])
  if (connection instanceof Response) return connection
  const ids = (Array.isArray(gate.body['productIds']) ? gate.body['productIds'] : [])
    .map((id) => String(id ?? '').trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))
  const unique = [...new Set(ids)]
  if (unique.length === 0) return podError(400, 'Choose the products to import.')
  if (unique.length > POD_IMPORT_BATCH) return podError(400, `Import up to ${POD_IMPORT_BATCH} products at a time.`)
  const status = gate.body['status'] === 'active' ? 'active' : 'draft'
  const store = await pluginProductCatalog()?.store(gate.hostId).catch(() => null)
  const currency = String(store?.currency ?? 'USD').toUpperCase()
  const results: PodImportResult[] = []
  for (const sourceProductId of unique) {
    results.push(
      await importSourceProduct({
        hostId: gate.hostId,
        orgId: gate.orgId,
        connection,
        keyring: gate.keyring,
        sourceProductId,
        status,
        content: gate.body['content'] === true,
        media: { origin: new URL(request.url).origin, authorization: gate.authorization, hostId: gate.hostId },
        actorUid: gate.uid,
        currency,
      }).catch((error): PodImportResult => ({
        sourceProductId,
        outcome: 'failed',
        message: error instanceof Error ? error.message : 'The product could not be imported.',
      })),
    )
  }
  return podJson({ results })
}

/** GET: one page of the site's imported products, newest first. */
export async function importedRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const gate = await podGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  const params = new URL(request.url).searchParams
  const size = Math.min(PAGE_MAX, Math.max(1, Number(params.get('pageSize')) || 25))
  const after = Number(params.get('after'))
  let query = podDb()
    .collection(POD_COLLECTIONS.links)
    .where('hostId', '==', gate.hostId)
    .orderBy('importedAtMs', 'desc')
  if (Number.isFinite(after) && after > 0) query = query.startAfter(after)
  const snapshot = await query.limit(size + 1).get()
  const docs = snapshot.docs.slice(0, size)
  const links = docs
    .map((doc: { id: string; data: () => unknown }) => {
      const link = readStoredLink(doc.data())
      return link ? linkView(doc.id, link) : null
    })
    .filter(Boolean)
  return podJson({
    links,
    next: snapshot.docs.length > size ? String(readStoredLink(docs[docs.length - 1].data())?.importedAtMs ?? '') : null,
  })
}

/** POST: stop filling a product through the service; the store's product stays. */
export async function unlinkRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await podGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const id = String(gate.body['linkId'] ?? '')
  // The id names the site, so a member of one site cannot touch another's.
  if (!isDocumentId(id) || !id.startsWith(`${gate.hostId}__`)) return podError(400, 'Missing linkId')
  await linkRef(id).delete()
  return podJson({ unlinked: true })
}

/** GET: the service behind one product, and each variant's cost. */
export async function productLinkRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const gate = await podGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  const productId = String(new URL(request.url).searchParams.get('productId') ?? '')
  if (!isDocumentId(productId)) return podError(400, 'Missing productId')
  const found = (await readLinksForProducts(gate.hostId, [productId])).get(productId)
  return podJson({ link: found ? linkView(found.id, found.link) : null })
}

/** GET: the parts of one order the services fill. */
export async function orderRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const gate = await podGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  const orderId = String(new URL(request.url).searchParams.get('orderId') ?? '')
  if (!isDocumentId(orderId)) return podError(400, 'Missing orderId')
  const parts = []
  for (const id of podOrderIdsFor(gate.hostId, orderId)) {
    const stored = readStoredPodOrder((await podOrderRef(id).get()).data())
    if (stored) parts.push(podOrderView(id, stored))
  }
  return podJson({ parts })
}

/** GET: one page of the site's service orders, newest first. */
export async function ordersRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const gate = await podGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const params = new URL(request.url).searchParams
  const size = Math.min(PAGE_MAX, Math.max(1, Number(params.get('pageSize')) || 25))
  const after = Number(params.get('after'))
  let query = podDb()
    .collection(POD_COLLECTIONS.orders)
    .where('hostId', '==', gate.hostId)
    .orderBy('createdAtMs', 'desc')
  if (Number.isFinite(after) && after > 0) query = query.startAfter(after)
  const snapshot = await query.limit(size + 1).get()
  const docs = snapshot.docs.slice(0, size)
  const parts = docs
    .map((doc: { id: string; data: () => unknown }) => {
      const stored = readStoredPodOrder(doc.data())
      return stored ? podOrderView(doc.id, stored) : null
    })
    .filter(Boolean)
  return podJson({
    parts,
    next: snapshot.docs.length > size ? String(readStoredPodOrder(docs[docs.length - 1].data())?.createdAtMs ?? '') : null,
  })
}

/** POST: send, confirm, refresh or cancel one order's part at a service. */
export async function orderActionRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await podGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const orderId = String(gate.body['orderId'] ?? '')
  const provider = providerOf(gate.body['provider'])
  if (!isDocumentId(orderId) || !provider) return podError(400, 'Missing orderId or provider')
  const id = podOrderId(gate.hostId, orderId, provider)
  if (!(await podOrderRef(id).get()).exists) return podError(404, 'Nothing was sent to a service for this order.')
  const action = String(gate.body['action'] ?? '')
  let failure: string | null = null
  switch (action) {
    case 'retry':
    case 'send': {
      const outcome = await sendPodOrder(id, { keyring: gate.keyring, force: true })
      if (outcome === 'skipped') failure = 'The order is already sent, or is being sent now.'
      break
    }
    case 'confirm': {
      const outcome = await confirmPodOrder(id, gate.keyring)
      if (!outcome.ok) failure = outcome.message
      break
    }
    case 'refresh': {
      const outcome = await refreshPodOrder(id, { keyring: gate.keyring })
      if (outcome === 'unsent') failure = 'The order has not reached the service yet.'
      else if (outcome === 'skipped') failure = 'The order is being updated now. Try again in a moment.'
      break
    }
    case 'cancel': {
      const outcome = await cancelPodOrder(id, gate.keyring, 'The order was canceled from the store’s order page.')
      if (!outcome.ok) failure = outcome.message
      break
    }
    default:
      return podError(400, 'Unknown action')
  }
  const stored = readStoredPodOrder((await podOrderRef(id).get()).data())
  if (failure) return podJson({ error: failure, part: stored ? podOrderView(id, stored) : null }, 409)
  return podJson({ part: stored ? podOrderView(id, stored) : null })
}
