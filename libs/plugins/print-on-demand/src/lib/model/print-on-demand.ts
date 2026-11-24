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
 * Print-on-demand's words, shared by the server and the console (AGL-3641).
 * Every amount is integer minor units (cents for USD) with its currency
 * beside it; a service's cost and the store's price are never mixed with
 * each other's currency.
 */

/** The services a merchant connects with a token of their own. */
export type PodProviderId = 'printful' | 'printify'

export const POD_PROVIDERS: readonly PodProviderId[] = ['printful', 'printify']

export const POD_PROVIDER_LABELS: Record<PodProviderId, string> = {
  printful: 'Printful',
  printify: 'Printify',
}

/** Where a merchant makes the token they paste, in the service's own words. */
export const POD_TOKEN_HELP: Record<PodProviderId, { label: string; url: string; steps: string }> = {
  printful: {
    label: 'private token',
    url: 'https://developers.printful.com/',
    steps:
      'Sign in to Printful’s Developer Portal, create a private token for your store that may view and manage its orders, products and webhooks, and paste it here.',
  },
  printify: {
    label: 'personal access token',
    url: 'https://printify.com/app/account/api',
    steps:
      'In Printify, open your account’s Connections page, generate a personal access token that may read your shops and products and read and write orders and webhooks, and paste it here.',
  },
}

export function isPodProvider(value: unknown): value is PodProviderId {
  return value === 'printful' || value === 'printify'
}

/** How a paid order reaches the service. */
export type PodSubmitMode = 'automatic' | 'review'

/** How the service ships what it makes. Printify offers all four; Printful ships by the method it picks. */
export type PodShippingMethod = 'standard' | 'priority' | 'express' | 'economy'

export const POD_SHIPPING_METHODS: readonly PodShippingMethod[] = ['standard', 'priority', 'express', 'economy']

export const POD_SHIPPING_METHOD_LABELS: Record<PodShippingMethod, string> = {
  standard: 'Standard',
  priority: 'Priority',
  express: 'Express',
  economy: 'Economy',
}

export function isPodShippingMethod(value: unknown): value is PodShippingMethod {
  return typeof value === 'string' && (POD_SHIPPING_METHODS as readonly string[]).includes(value)
}

/**
 * The longest an automatic send may wait before an order goes to
 * production: a buyer who cancels in that window is cancelled at the
 * service before anything is made.
 */
export const POD_SEND_DELAY_MAX_HOURS = 72

/** The send delay a member asked for, as a whole number of hours within the bounds. */
export function podSendDelayHours(value: unknown): number {
  const hours = Math.round(Number(value))
  return Number.isFinite(hours) ? Math.min(POD_SEND_DELAY_MAX_HOURS, Math.max(0, hours)) : 0
}

/** What a site's connection says, without its token. */
export interface PodConnectionView {
  provider: PodProviderId
  providerLabel: string
  storeId: string
  storeName: string
  /** ISO 4217, upper case: what the service prices in. */
  currency: string
  /** `automatic`: confirmed for production at once. `review`: left a draft for the merchant. */
  submitMode: PodSubmitMode
  /** Whether a re-sync rewrites the store's prices from the service's. */
  syncPrices: boolean
  /** With `automatic`: hours a paid order waits as a draft before it is confirmed; 0 confirms at once. */
  sendDelayHours: number
  /** How the service ships orders, where it lets the store choose. */
  shippingMethod: PodShippingMethod
  /** Whether the service tells the store about shipments, or the store asks. */
  webhooks: 'registered' | 'polling'
  webhookDetail: string | null
  lastError: string | null
  connectedAtMs: number
  updatedAtMs: number
}

/** One product in the service's catalog, as a picker lists it. */
export interface PodCatalogEntry {
  id: string
  name: string
  thumbnailUrl: string | null
  variantCount: number
  /** The store's product made from it, when it is already imported. */
  importedProductId: string | null
}

/** What the service charges the merchant to ship one of its products, by destination. */
export interface PodShippingCost {
  /** ISO 3166-1 alpha-2, or `REST_OF_THE_WORLD`. */
  countries: string[]
  /** The first unit of the product in a parcel. */
  firstItemMinor: number
  /** Each further unit in the same parcel. */
  additionalItemMinor: number
  currency: string
}

/** One imported variant: the store's id, the service's, and what the service charges for it. */
export interface PodLinkedVariant {
  variantId: string
  sourceVariantId: string
  name: string
  sku: string | null
  /** The service's price to the merchant, per unit, in `costCurrency`; `null` when it did not say. */
  costMinor: number | null
  /** The store's price when last synced, in the store's currency. */
  retailMinor: number
  available: boolean
}

/** An imported product, as the console lists it. */
export interface PodProductLinkView {
  id: string
  provider: PodProviderId
  providerLabel: string
  productId: string
  sourceProductId: string
  name: string
  thumbnailUrl: string | null
  costCurrency: string
  variants: PodLinkedVariant[]
  /** What the service charges to ship it with its standard method, when it says; the widest range per destination. */
  shippingCosts: PodShippingCost[]
  /** The service no longer has the product: the store's product was taken off sale. */
  sourceGone: boolean
  importedAtMs: number
  syncedAtMs: number
  lastError: string | null
}

/** Where the part of an order a service fills stands. */
export type PodOrderStatus =
  /** Waiting to be sent (a first try, or a retry after a failure that may pass). */
  | 'queued'
  /** At the service as a draft: nothing is made until it is confirmed. */
  | 'draft'
  /** Confirmed, waiting for the service to start. */
  | 'submitted'
  /** The service is holding it (a payment or a file problem): the merchant acts at the service. */
  | 'on_hold'
  | 'in_production'
  | 'partially_shipped'
  | 'shipped'
  | 'canceled'
  /** The service refused it, or every try failed: the merchant acts. */
  | 'failed'

export const POD_ACTIVE_STATUSES: readonly PodOrderStatus[] = [
  'submitted',
  'on_hold',
  'in_production',
  'partially_shipped',
]

/** Money the service charged for one order, in the service's currency. */
export interface PodOrderCosts {
  currency: string
  itemsMinor: number
  shippingMinor: number
  taxMinor: number
  totalMinor: number
}

/** A parcel the service shipped. */
export interface PodShipmentView {
  id: string
  carrier: string
  trackingNumber: string
  trackingUrl: string | null
  /** Whether it is on the store's order as a shipment yet. */
  recorded: boolean
  deliveredAtMs: number | null
}

/** One order's part at one service, as the console shows it. */
export interface PodOrderView {
  id: string
  orderId: string
  orderRef: string
  provider: PodProviderId
  providerLabel: string
  status: PodOrderStatus
  testMode: boolean
  sourceOrderId: string | null
  dashboardUrl: string | null
  lines: Array<{ lineIndex: number; name: string; quantity: number; costMinor: number | null }>
  /** What the buyer paid for these lines, in the store's currency. */
  retailMinor: number
  retailCurrency: string
  costs: PodOrderCosts | null
  shipments: PodShipmentView[]
  attempts: number
  lastError: string | null
  /** What the merchant can do now. */
  actions: Array<'send' | 'confirm' | 'refresh' | 'cancel' | 'retry'>
  createdAtMs: number
  updatedAtMs: number
}

export const POD_ORDER_STATUS_LABELS: Record<PodOrderStatus, string> = {
  queued: 'Sending',
  draft: 'Draft at the service',
  submitted: 'Sent',
  on_hold: 'On hold',
  in_production: 'In production',
  partially_shipped: 'Partly shipped',
  shipped: 'Shipped',
  canceled: 'Canceled',
  failed: 'Not sent',
}

/**
 * The words of a description a service wrote in HTML, as the store's plain
 * text: paragraphs, headings and line breaks kept, list items as lines, a
 * table's rows as lines with their cells apart (a size chart stays
 * readable), tags and entities gone.
 */
export function htmlToPlainText(html: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(html ?? '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    // A size table stays a table a shopper can read: one row a line, cells apart.
    .replace(/<\s*\/\s*t[dh]\s*>\s*(?=<\s*t[dh][\s>])/gi, ' · ')
    .replace(/<\s*\/\s*tr\s*>/gi, '\n')
    .replace(/<\s*(h[1-6]|p|div|table|ul|ol)(\s[^>]*)?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6]|table)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === '#') {
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : ''
      }
      return named[code.toLowerCase()] ?? entity
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The longest search title and description the product editor allows. */
export const POD_SEO_TITLE_MAX = 60
export const POD_SEO_DESCRIPTION_MAX = 155

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`
}

/**
 * A search title and description for a product brought from a service,
 * within the editor's limits: its name, and its description's opening words
 * without the bullets. Only fills what the merchant left empty.
 */
export function podSeoFor(name: string, description: string): { title: string; description: string } {
  const prose = description
    .split('\n')
    .map((line) => line.replace(/^•\s*/, '').trim())
    .filter((line) => line && !line.includes(' · '))
    .join(' ')
  return { title: clip(name, POD_SEO_TITLE_MAX), description: clip(prose, POD_SEO_DESCRIPTION_MAX) }
}

/** Integer minor units from a decimal the service wrote as a string or number ("29.99"). */
export function decimalToMinor(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const [whole, fraction = ''] = text.replace('-', '').split('.')
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2)) + (Number(fraction[2] ?? 0) >= 5 ? 1 : 0)
  return text.startsWith('-') ? -cents : cents
}

/** A decimal string for a service that takes one, from integer minor units. */
export function minorToDecimal(minor: number): string {
  const value = Math.round(Number(minor) || 0)
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
