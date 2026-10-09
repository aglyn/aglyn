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

/**
 * The client-safe model of a site's fulfillment networks (AGL-3634): which
 * networks there are, what a connection's settings may hold, and what the
 * console reads of a connection and of one order's hand-off. Nothing here
 * holds or names a credential.
 */

export type NetworkProviderId = 'shipbob' | 'amazon-mcf' | 'shipmonk'

export const NETWORK_PROVIDER_IDS: readonly NetworkProviderId[] = ['shipbob', 'amazon-mcf', 'shipmonk']

/** Amazon's shipping speeds a Multi-Channel Fulfillment order may ask for. */
export type AmazonShippingSpeed = 'Standard' | 'Expedited' | 'Priority'

export const AMAZON_SHIPPING_SPEEDS: readonly AmazonShippingSpeed[] = ['Standard', 'Expedited', 'Priority']

export interface NetworkProviderInfo {
  id: NetworkProviderId
  /** What a merchant calls it. */
  label: string
  /** The short name, for a stock-history row and a chip. */
  shortLabel: string
  /** One sentence under the name on the card. */
  summary: string
  /** Whether the network tells us about a parcel by webhook, beside what we read back. */
  webhooks: boolean
  /**
   * How a merchant connects it: `oauth` — signs in at the network and grants
   * the deployment's app; `api-key` — pastes their own key (AGL-3697).
   */
  auth: 'oauth' | 'api-key'
}

export const NETWORK_PROVIDERS: Readonly<Record<NetworkProviderId, NetworkProviderInfo>> = {
  shipbob: {
    id: 'shipbob',
    label: 'ShipBob',
    shortLabel: 'ShipBob',
    summary: 'Paid orders go to ShipBob’s warehouses to pick, pack and ship; shipments and tracking come back to the order.',
    webhooks: true,
    auth: 'oauth',
  },
  'amazon-mcf': {
    id: 'amazon-mcf',
    label: 'Amazon Multi-Channel Fulfillment',
    shortLabel: 'Amazon',
    summary: 'Paid orders ship from your FBA inventory in Amazon’s warehouses; shipments and tracking come back to the order.',
    webhooks: false,
    auth: 'oauth',
  },
  shipmonk: {
    id: 'shipmonk',
    label: 'ShipMonk',
    shortLabel: 'ShipMonk',
    summary: 'Paid orders go to ShipMonk’s warehouses to pick, pack and ship; shipments and tracking come back to the order.',
    webhooks: true,
    auth: 'api-key',
  },
}

export function isNetworkProviderId(value: unknown): value is NetworkProviderId {
  return value === 'shipbob' || value === 'amazon-mcf' || value === 'shipmonk'
}

/** One site's connection to one network, as the document id spells it. */
export const networkConnectionId = (hostId: string, provider: NetworkProviderId): string => `${hostId}_${provider}`

/** One order's hand-off to one network, as the document id spells it. */
export const networkOrderId = (hostId: string, recordId: string, provider: NetworkProviderId): string =>
  `${hostId}_${recordId}_${provider}`

/**
 * - `active` — sending and reading back.
 * - `paused` — the merchant paused it: paid orders are not sent; what was
 *   sent is still read back.
 * - `reconnect` — the grant was refused or revoked: nothing moves until the
 *   merchant connects again.
 */
export type NetworkConnectionStatus = 'active' | 'paused' | 'reconnect'

/** How paid orders reach the network. */
export type NetworkRoutingMode = 'automatic' | 'manual'

export interface NetworkConnectionSettings {
  routing?: NetworkRoutingMode
  /**
   * ShipBob: the ship option orders ask for, as named in the merchant's
   * ShipBob account. ShipMonk: the requested shipping service, which must
   * match a shipping mapping in the merchant's ShipMonk account.
   */
  shippingMethod?: string
  /** Amazon: the shipping speed orders ask for. */
  shippingSpeed?: AmazonShippingSpeed
  /** Amazon: the marketplace whose FBA inventory ships. */
  marketplaceId?: string
  /** Whether the store's stock counts follow the network's. */
  syncInventory?: boolean
  paused?: boolean
}

/** A marketplace an Amazon seller account takes part in. */
export interface NetworkMarketplace {
  id: string
  name: string
  countryCode: string
}

export interface NetworkInventorySummary {
  syncedAtMs: number | null
  /** SKUs the network holds. */
  skus: number
  /** Of those, the store's counts set this time / already agreeing / not in the store / not tracked / counted per location. */
  updated: number
  unchanged: number
  unknown: number
  untracked: number
  perLocation: number
}

/** The console's view of a connection: never a credential, a lease or a token hash. */
export interface NetworkConnectionView {
  id: string
  provider: NetworkProviderId
  hostId: string
  status: NetworkConnectionStatus
  /** Whether the network's sandbox, where nothing real ships. */
  sandbox: boolean
  accountName: string | null
  routing: NetworkRoutingMode
  shippingMethod: string
  shippingSpeed: AmazonShippingSpeed
  marketplaceId: string | null
  marketplaces: NetworkMarketplace[]
  /** ShipMonk: the merchant's API store the key belongs to (AGL-3697). */
  storeId: string | null
  /** ShipMonk: whether a webhook signing secret is set, so ShipMonk's webhooks are taken. */
  webhookSecretSet: boolean
  syncInventory: boolean
  inventory: NetworkInventorySummary
  lastError: string | null
  connectedAtMs: number | null
  totals: { sent: number; shipped: number; canceled: number }
}

/** What happened on a connection, for its activity log. */
export interface NetworkLogEntry {
  id: string
  atMs: number
  kind: 'sent' | 'shipped' | 'canceled' | 'stock' | 'error' | 'connected'
  message: string
  /** The order it was about, when it was about one. */
  recordId?: string
}

/**
 * Where one order's hand-off stands.
 *
 * - `queued` — waiting to be sent on the next run.
 * - `accepted` — the network has it and nothing has shipped yet.
 * - `partially_shipped` / `shipped` — shipments have come back.
 * - `canceled` — canceled at the network, or before it was sent.
 * - `failed` — the network refused it, or sending kept failing: the merchant decides.
 * - `skipped` — nothing was sent, and `note` says why (a test order, nothing the network stocks).
 */
export type NetworkOrderStatus =
  | 'queued'
  | 'accepted'
  | 'partially_shipped'
  | 'shipped'
  | 'canceled'
  | 'failed'
  | 'skipped'

export interface NetworkOrderLine {
  lineIndex: number
  sku: string
  name: string
  quantity: number
  shippedQuantity: number
}

export interface NetworkOrderShipment {
  id: string
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  /** A carrier-neutral word: `in_transit`, `delivered`, … */
  trackingStatus: string | null
  atMs: number
}

/** The console's view of one order's hand-off to one network. */
export interface NetworkOrderView {
  provider: NetworkProviderId
  status: NetworkOrderStatus
  /** The network's own reference, to find it there. */
  reference: string | null
  lines: NetworkOrderLine[]
  shipments: NetworkOrderShipment[]
  /** Why it was skipped, why it failed, or what still needs the merchant. */
  note: string | null
  cancelRequested: boolean
  updatedAtMs: number
}

/** A connection's settings read from a request body, or what was wrong with them. */
export function readConnectionSettings(
  body: Record<string, unknown>,
): { ok: true; settings: NetworkConnectionSettings } | { ok: false; error: string } {
  const settings: NetworkConnectionSettings = {}
  if (body['routing'] !== undefined) {
    if (body['routing'] !== 'automatic' && body['routing'] !== 'manual') {
      return { ok: false, error: 'Choose automatic or manual sending' }
    }
    settings.routing = body['routing']
  }
  if (body['shippingMethod'] !== undefined) {
    const method = String(body['shippingMethod'] ?? '').trim()
    if (!method || method.length > 80) return { ok: false, error: 'Name the ship option, up to 80 characters' }
    settings.shippingMethod = method
  }
  if (body['shippingSpeed'] !== undefined) {
    if (!AMAZON_SHIPPING_SPEEDS.includes(body['shippingSpeed'] as AmazonShippingSpeed)) {
      return { ok: false, error: 'Choose Standard, Expedited or Priority' }
    }
    settings.shippingSpeed = body['shippingSpeed'] as AmazonShippingSpeed
  }
  if (body['marketplaceId'] !== undefined) {
    const id = String(body['marketplaceId'] ?? '').trim()
    if (!/^[A-Z0-9]{8,20}$/.test(id)) return { ok: false, error: 'Choose a marketplace from the menu' }
    settings.marketplaceId = id
  }
  for (const key of ['syncInventory', 'paused'] as const) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean') return { ok: false, error: `${key} must be true or false` }
    settings[key] = body[key] as boolean
  }
  return { ok: true, settings }
}

/** A ShipMonk API store id: digits only, as ShipMonk's Integration API Keys page shows it. */
export const SHIPMONK_STORE_ID = /^[1-9][0-9]{0,11}$/

/**
 * What a connect with the merchant's own API key reads from the request
 * (AGL-3697): the key, and for ShipMonk the API store it belongs to. The key
 * is never echoed back; a refusal names the field, never its value.
 */
export function readApiKeyConnect(
  provider: NetworkProviderId,
  body: Record<string, unknown>,
): { ok: true; apiKey: string; storeId: string | null } | { ok: false; error: string } {
  const apiKey = typeof body['apiKey'] === 'string' ? body['apiKey'].trim() : ''
  if (apiKey.length < 8 || apiKey.length > 512 || /\s/.test(apiKey)) {
    return { ok: false, error: `Paste the ${NETWORK_PROVIDERS[provider].label} API key` }
  }
  if (provider !== 'shipmonk') return { ok: true, apiKey, storeId: null }
  const storeId = String(body['storeId'] ?? '').trim()
  if (!SHIPMONK_STORE_ID.test(storeId)) return { ok: false, error: 'Enter the ShipMonk store id: the number next to the API key' }
  return { ok: true, apiKey, storeId }
}
