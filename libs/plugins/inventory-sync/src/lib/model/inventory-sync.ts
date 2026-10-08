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
 * The client-safe model of a site's inventory and ERP connection (AGL-3642):
 * which systems there are, what a connection's settings may hold, and what
 * the console reads of a connection and of one order's hand-off. Nothing
 * here holds or names a credential.
 */

export type InventoryProviderId = 'cin7-core' | 'inflow' | 'brightpearl'

export const INVENTORY_PROVIDER_IDS: readonly InventoryProviderId[] = ['cin7-core', 'inflow', 'brightpearl']

/** A field the merchant pastes from their own account to connect it. */
export interface InventoryKeyField {
  name: 'accountId' | 'apiKey' | 'companyId'
  label: string
  helper: string
  secret: boolean
}

export interface InventoryProviderInfo {
  id: InventoryProviderId
  /** What a merchant calls it. */
  label: string
  /** One sentence under the name on the card. */
  summary: string
  /** `keys`: the merchant pastes their own API keys. `oauth`: they sign in and grant access. */
  auth: 'keys' | 'oauth'
  /** The fields a `keys` connect asks for, in order. */
  keyFields: readonly InventoryKeyField[]
  /** What the location setting is called in the system. */
  locationLabel: string
  /** What the order-customer setting asks for. */
  customerLabel: string
  customerHelper: string
  /** Whether a canceled order is canceled in the system too; otherwise the merchant is told to. */
  cancelsOrders: boolean
  /** Whether the store's products can be made in the system (`productSync: 'export'`). */
  exportsProducts: boolean
}

export const INVENTORY_PROVIDERS: Readonly<Record<InventoryProviderId, InventoryProviderInfo>> = {
  'cin7-core': {
    id: 'cin7-core',
    label: 'Cin7 Core',
    summary: 'Stock and products from Cin7 Core (formerly DEAR Inventory), with paid orders sent to it as sales.',
    auth: 'keys',
    keyFields: [
      {
        name: 'accountId',
        label: 'Account ID',
        helper: 'In Cin7 Core under Integrations → API.',
        secret: false,
      },
      {
        name: 'apiKey',
        label: 'Application key',
        helper: 'The key of the API application you made for this store.',
        secret: true,
      },
    ],
    locationLabel: 'Location',
    customerLabel: 'Customer for web orders',
    customerHelper: 'The name of a Cin7 Core customer that store orders are recorded under.',
    cancelsOrders: true,
    exportsProducts: true,
  },
  inflow: {
    id: 'inflow',
    label: 'inFlow Inventory',
    summary: 'Stock and products from inFlow Inventory, with paid orders sent to it as sales orders.',
    auth: 'keys',
    keyFields: [
      {
        name: 'companyId',
        label: 'Company ID',
        helper: 'In inFlow under Options → Integrations, beside your API key.',
        secret: false,
      },
      {
        name: 'apiKey',
        label: 'API key',
        helper: 'An API key from the same page. It needs inFlow’s API access add-on.',
        secret: true,
      },
    ],
    locationLabel: 'Location',
    customerLabel: 'Customer for web orders',
    customerHelper: 'The name of an inFlow customer that store orders are recorded under.',
    cancelsOrders: true,
    exportsProducts: true,
  },
  brightpearl: {
    id: 'brightpearl',
    label: 'Brightpearl',
    summary: 'Stock and products from Brightpearl, with paid orders sent to it as sales orders.',
    auth: 'oauth',
    keyFields: [],
    locationLabel: 'Warehouse',
    customerLabel: 'Customer contact ID',
    customerHelper: 'The ID of the Brightpearl contact that store orders are recorded under.',
    cancelsOrders: false,
    exportsProducts: false,
  },
}

export function isInventoryProviderId(value: unknown): value is InventoryProviderId {
  return value === 'cin7-core' || value === 'inflow' || value === 'brightpearl'
}

/** A site's connection, as the document id spells it: one per site. */
export const inventoryConnectionId = (hostId: string): string => hostId

/** One order's hand-off, as the document id spells it. */
export const inventoryOrderId = (hostId: string, recordId: string): string => `${hostId}_${recordId}`

/**
 * - `active` — syncing.
 * - `paused` — the merchant paused it: nothing is read or written.
 * - `reconnect` — the keys or grant were refused: nothing moves until the
 *   merchant connects again. Orders paid meanwhile wait and are sent then.
 */
export type InventoryConnectionStatus = 'active' | 'paused' | 'reconnect'

/**
 * Which side's stock count is the true one, per connection.
 *
 * - `system` — the connected system's: its available count of each SKU
 *   becomes the store's.
 * - `store` — the store's: the system's count of each SKU is adjusted to the
 *   store's.
 * - `off` — counts are left alone on both sides.
 */
export type InventoryStockSource = 'system' | 'store' | 'off'

export const INVENTORY_STOCK_SOURCES: readonly InventoryStockSource[] = ['system', 'store', 'off']

/**
 * Which way products go.
 *
 * - `import` — the system's products are made and kept in step in the store,
 *   matched by the system's own id.
 * - `export` — the store's products with a SKU the system lacks are made there.
 * - `off` — products are matched by SKU and nothing is made on either side.
 */
export type InventoryProductSync = 'import' | 'export' | 'off'

export const INVENTORY_PRODUCT_SYNCS: readonly InventoryProductSync[] = ['import', 'export', 'off']

export interface InventoryConnectionSettings {
  stockSource?: InventoryStockSource
  productSync?: InventoryProductSync
  /** Whether paid orders are sent to the system. */
  sendOrders?: boolean
  /** The location (or Brightpearl warehouse) stock is counted at and orders ship from; `null` for all. */
  locationId?: string | null
  /** Who orders are recorded under in the system; see {@link InventoryProviderInfo.customerLabel}. */
  orderCustomer?: string
  /** Cin7 Core: the tax rule order lines carry. Empty for the customer's own. */
  taxRule?: string
  paused?: boolean
}

/** A location or warehouse in the connected system. */
export interface InventoryLocation {
  id: string
  name: string
}

export interface InventoryStockSummary {
  syncedAtMs: number | null
  direction: InventoryStockSource
  /** SKUs the system counted. */
  skus: number
  /** Store counts set from the system / system counts adjusted to the store's. */
  updated: number
  unchanged: number
  /** Not in the store (system → store) or not in the system (store → system). */
  unknown: number
  untracked: number
  perLocation: number
  failed: number
}

export interface InventoryProductSummary {
  syncedAtMs: number | null
  created: number
  updated: number
  unchanged: number
  /** Products that could not be written, each in the activity with its reason. */
  failed: number
  /** Whether the last run stopped at its limit and continues on the next. */
  more: boolean
}

/** The console's view of a connection: never a credential, a lease or a cursor. */
export interface InventoryConnectionView {
  hostId: string
  provider: InventoryProviderId
  status: InventoryConnectionStatus
  accountName: string | null
  stockSource: InventoryStockSource
  productSync: InventoryProductSync
  sendOrders: boolean
  locationId: string | null
  orderCustomer: string
  taxRule: string
  stock: InventoryStockSummary
  products: InventoryProductSummary
  lastError: string | null
  connectedAtMs: number | null
  totals: { ordersSent: number; ordersFailed: number }
}

/** What happened on a connection, for its activity log. */
export interface InventoryLogEntry {
  id: string
  atMs: number
  kind: 'connected' | 'order' | 'stock' | 'products' | 'canceled' | 'error'
  message: string
  /** The order it was about, when it was about one. */
  recordId?: string
}

/**
 * Where one order's hand-off stands.
 *
 * - `queued` — waiting to be sent on the next run.
 * - `sent` — the system has it.
 * - `failed` — the system refused it, or sending kept failing: the merchant fixes it and sends it again.
 * - `skipped` — nothing was sent, and `note` says why.
 * - `canceled` — canceled before it was sent, or voided in the system after.
 */
export type InventoryOrderStatus = 'queued' | 'sent' | 'failed' | 'skipped' | 'canceled'

export interface InventoryOrderLine {
  lineIndex: number
  sku: string
  name: string
  quantity: number
  /** Per unit, integer minor units, before tax. */
  unitAmountCents: number
}

/** The console's view of one order's hand-off. */
export interface InventoryOrderView {
  recordId: string
  displayRef: string
  provider: InventoryProviderId
  status: InventoryOrderStatus
  /** Ours, which the system's record carries: what to search for there. */
  reference: string
  /** The system's own number for it, when it gave one. */
  externalNumber: string | null
  lines: InventoryOrderLine[]
  /** Why it was skipped, why it failed, or what still needs the merchant. */
  note: string | null
  attempts: number
  updatedAtMs: number
}

const LOCATION_ID = /^[A-Za-z0-9 _\-.:/&()#'’]{1,120}$/

/** A connection's settings read from a request body, or what was wrong with them. */
export function readInventorySettings(
  body: Record<string, unknown>,
): { ok: true; settings: InventoryConnectionSettings } | { ok: false; error: string } {
  const settings: InventoryConnectionSettings = {}
  if (body['stockSource'] !== undefined) {
    if (!INVENTORY_STOCK_SOURCES.includes(body['stockSource'] as InventoryStockSource)) {
      return { ok: false, error: 'Choose which side’s stock counts are kept' }
    }
    settings.stockSource = body['stockSource'] as InventoryStockSource
  }
  if (body['productSync'] !== undefined) {
    if (!INVENTORY_PRODUCT_SYNCS.includes(body['productSync'] as InventoryProductSync)) {
      return { ok: false, error: 'Choose how products are synced' }
    }
    settings.productSync = body['productSync'] as InventoryProductSync
  }
  if (body['locationId'] !== undefined) {
    if (body['locationId'] === null || body['locationId'] === '') settings.locationId = null
    else {
      const id = String(body['locationId']).trim()
      if (!LOCATION_ID.test(id)) return { ok: false, error: 'Choose a location from the menu' }
      settings.locationId = id
    }
  }
  if (body['orderCustomer'] !== undefined) {
    const customer = String(body['orderCustomer'] ?? '').trim()
    if (customer.length > 120) return { ok: false, error: 'Name the customer in up to 120 characters' }
    settings.orderCustomer = customer
  }
  if (body['taxRule'] !== undefined) {
    const rule = String(body['taxRule'] ?? '').trim()
    if (rule.length > 80) return { ok: false, error: 'Name the tax rule in up to 80 characters' }
    settings.taxRule = rule
  }
  for (const key of ['sendOrders', 'paused'] as const) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean') return { ok: false, error: `${key} must be true or false` }
    settings[key] = body[key] as boolean
  }
  return { ok: true, settings }
}

/** Whether a Brightpearl customer setting is usable: a contact's numeric id. */
export const isBrightpearlContactId = (value: string): boolean => /^[1-9][0-9]{0,11}$/.test(value)
