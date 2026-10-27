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

/*==========================================
 * THE POS HARDWARE SHOP (AGL-4038), PHASE 1: THE MODEL.
 *
 * A merchant buys Stripe Terminal readers from the platform, the platform
 * places the order in Stripe's Terminal hardware shop and Stripe ships it
 * straight to the merchant. The platform is the seller of record, because the
 * register's card payments are destination charges on the PLATFORM account
 * and a reader must be registered there to take them.
 *
 * THE CATALOG IS CODE, THE PRICES ARE CONFIG. Which readers the register
 * works with is a fact about this codebase; what Stripe charges for them, the
 * markup on top and what shipping costs are business decisions that change
 * without a release. Every figure comes from the console's environment, read
 * by {@link parsePosHardwareConfig}, and a missing or malformed figure keeps
 * the shop HIDDEN: it is a gate only the platform can lift, so no workspace is
 * shown a control it cannot use.
 *
 * Everything here is pure, so the price math, the metadata a Checkout Session
 * carries and the status rules are specced without Firestore or Stripe.
 *=========================================*/

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'

/** The register's currency, and so the shop's: US dollars. */
export const POS_HARDWARE_CURRENCY = 'usd'

/**
 * Where the shop ships. Stripe's Terminal hardware shop ships to many
 * countries, but the register sells in US dollars only and the readers a
 * merchant buys here are registered to a US Location, so the shop is US-only
 * (Stripe itself excludes the US Virgin Islands, military addresses and
 * P.O. boxes).
 */
export const POS_HARDWARE_SHIP_COUNTRIES: readonly string[] = ['US']

/** The most of one item, and the most units, a single order may hold. */
export const POS_HARDWARE_MAX_PER_LINE = 10
export const POS_HARDWARE_MAX_UNITS = 20

/** The env names the shop reads, named once for the reader and the docs. */
export const POS_HARDWARE_ENV = {
  /** `true` releases the shop. Absent or anything else keeps it hidden. */
  enabled: 'POS_HARDWARE_SHOP_ENABLED',
  /** JSON `{ "<sku>": <Stripe's price in cents> }`. */
  prices: 'POS_HARDWARE_PRICES',
  /**
   * The markup on Stripe's price, an integer in basis points (100 = 1%).
   * Absent, {@link POS_HARDWARE_DEFAULT_MARKUP_BPS} applies.
   */
  markupBps: 'POS_HARDWARE_MARKUP_BPS',
  /** JSON `{ "standard" | "express" | "priority": <cents> }`. */
  shipping: 'POS_HARDWARE_SHIPPING',
  /** `true` turns Stripe automatic tax on for hardware checkouts. */
  automaticTax: 'POS_HARDWARE_AUTOMATIC_TAX',
} as const

/**
 * The markup when the deployment sets none: 3000 basis points on Stripe's
 * price. The business sets it; this is the one place the default lives, and
 * `POS_HARDWARE_MARKUP_BPS` overrides it.
 */
export const POS_HARDWARE_DEFAULT_MARKUP_BPS = 3000

export type PosHardwareSkuId =
  | 'stripe-reader-s710'
  | 'stripe-reader-s700'
  | 'stripe-reader-t600'
  | 'stripe-reader-m2'
  | 'bbpos-wisepos-e'
  | 'stripe-reader-s700-dock'
  | 'stripe-reader-hub'
  | 'stripe-reader-s700-case'
  | 'stripe-reader-s700-cable'
  | 'stripe-reader-charger'
  | 'stripe-reader-m2-dock'
  | 'stripe-reader-m2-mount'
  | 'bbpos-wisepos-e-dock'
  | 'bbpos-wisepos-e-power-cable'

export interface PosHardwareSku {
  id: PosHardwareSkuId
  kind: 'reader' | 'accessory'
  /** What Stripe's hardware shop calls it, for the staff member ordering it. */
  stripeProductName: string
  /** What the merchant sees. */
  displayName: string
  /** One line on what it is for. */
  use: string
  /**
   * Set when Stripe may stop selling the item. The shop still sells it while
   * its price is configured, and the Hardware card says so beside it, so a
   * merchant choosing between readers is not surprised later. Remove the
   * item's price once Stripe stops selling it, as for any other item.
   */
  mayBeDiscontinued?: boolean
}

/**
 * Every item the shop can sell. An item is offered only once its Stripe
 * price is configured, so one Stripe stops selling disappears by deleting its
 * price, not by a release.
 */
export const POS_HARDWARE_SKUS: readonly PosHardwareSku[] = [
  {
    id: 'stripe-reader-s710',
    kind: 'reader',
    stripeProductName: 'Stripe Reader S710',
    displayName: 'Stripe Reader S710',
    use: 'Handheld with its own 4G connection, for events and parking lots',
  },
  {
    id: 'stripe-reader-s700',
    kind: 'reader',
    stripeProductName: 'Stripe Reader S700',
    displayName: 'Stripe Reader S700',
    use: 'Handheld or countertop reader on Wi-Fi',
  },
  {
    id: 'stripe-reader-t600',
    kind: 'reader',
    stripeProductName: 'Stripe Reader T600',
    displayName: 'Stripe Reader T600',
    use: 'Countertop reader on Wi-Fi, or on Ethernet with the hub',
  },
  {
    id: 'bbpos-wisepos-e',
    kind: 'reader',
    stripeProductName: 'BBPOS WisePOS E',
    displayName: 'BBPOS WisePOS E',
    use: 'Countertop reader on Wi-Fi',
    mayBeDiscontinued: true,
  },
  {
    id: 'stripe-reader-m2',
    kind: 'reader',
    stripeProductName: 'Stripe Reader M2',
    displayName: 'Stripe Reader M2',
    use: `Pairs with the ${PLATFORM_BRAND_NAME} POS app on your phone or tablet by Bluetooth`,
  },
  {
    id: 'stripe-reader-s700-dock',
    kind: 'accessory',
    stripeProductName: 'Stripe Reader S700/S710 Dock',
    displayName: 'Charging dock for the S700 and S710',
    use: 'Keeps the reader charged at the counter and adds an Ethernet port',
  },
  {
    id: 'stripe-reader-hub',
    kind: 'accessory',
    stripeProductName: 'Stripe Reader Hub',
    displayName: 'Hub for the S700, S710 and T600',
    use: 'Connects the reader to Ethernet and power',
  },
  {
    id: 'stripe-reader-s700-case',
    kind: 'accessory',
    stripeProductName: 'Stripe Reader S700/S710 Case',
    displayName: 'Case for the S700 and S710',
    use: 'Protects a handheld reader on the move',
  },
  {
    id: 'stripe-reader-s700-cable',
    kind: 'accessory',
    stripeProductName: 'Stripe Reader S700/S710 Cable',
    displayName: 'Cable for the S700 and S710',
    use: 'A spare cable for the reader',
  },
  {
    id: 'stripe-reader-charger',
    kind: 'accessory',
    stripeProductName: 'Stripe Reader Charger',
    displayName: 'Charger for Stripe readers',
    use: 'A spare wall charger',
  },
  {
    id: 'stripe-reader-m2-dock',
    kind: 'accessory',
    stripeProductName: 'Stripe Reader M2 Dock',
    displayName: 'Charging dock for the M2',
    use: 'Keeps the M2 charged at the counter',
  },
  {
    id: 'stripe-reader-m2-mount',
    kind: 'accessory',
    stripeProductName: 'Stripe Reader M2 Mount',
    displayName: 'Mount for the M2',
    use: 'Holds the M2 in place at the counter',
  },
  {
    id: 'bbpos-wisepos-e-dock',
    kind: 'accessory',
    stripeProductName: 'BBPOS WisePOS E Dock',
    displayName: 'Charging dock for the WisePOS E',
    use: 'Keeps the reader charged at the counter and adds an Ethernet port',
  },
  {
    id: 'bbpos-wisepos-e-power-cable',
    kind: 'accessory',
    stripeProductName: 'BBPOS WisePOS E 5ft Power Cable',
    displayName: '5 ft power cable for the WisePOS E',
    use: 'A spare power cable for the reader',
  },
]

export function posHardwareSku(id: string): PosHardwareSku | null {
  return POS_HARDWARE_SKUS.find((sku) => sku.id === id) ?? null
}

export type PosHardwareShippingMethod = 'standard' | 'express' | 'priority'

export const POS_HARDWARE_SHIPPING_LABELS: Record<PosHardwareShippingMethod, string> = {
  standard: 'Standard shipping',
  express: 'Express shipping',
  priority: 'Priority shipping',
}

const SHIPPING_METHODS = Object.keys(POS_HARDWARE_SHIPPING_LABELS) as PosHardwareShippingMethod[]

export function isPosHardwareShippingMethod(value: unknown): value is PosHardwareShippingMethod {
  return typeof value === 'string' && (SHIPPING_METHODS as string[]).includes(value)
}

/** The shop's configuration, once every figure it needs is present and sane. */
export interface PosHardwareConfig {
  /** Stripe's price for each configured item, in cents. */
  costs: Partial<Record<PosHardwareSkuId, number>>
  markupBps: number
  shipping: Array<{ method: PosHardwareShippingMethod; cents: number }>
  automaticTax: boolean
}

/** The highest single figure the parser accepts, in cents: $10,000. */
const MAX_FIGURE_CENTS = 1_000_000
/** The highest markup the parser accepts: 1000%. */
const MAX_MARKUP_BPS = 100_000

const isCents = (value: unknown, min: number): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= MAX_FIGURE_CENTS

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The shop's configuration from the environment, or `null` while the shop is
 * hidden: not released, no reader priced, a malformed markup, or no shipping
 * figure. An ABSENT markup is the default
 * ({@link POS_HARDWARE_DEFAULT_MARKUP_BPS}), so a deployment can never sell
 * at cost by forgetting a variable; `0` is a valid, explicit choice to sell
 * at Stripe's price. A markup that is set but unreadable hides the shop
 * rather than guessing.
 *
 * Unknown item ids and malformed figures are dropped one by one rather than
 * failing the whole shop, so a typo in one price hides that one item.
 */
export function parsePosHardwareConfig(
  env: Record<string, string | undefined>,
): PosHardwareConfig | null {
  if (String(env[POS_HARDWARE_ENV.enabled] ?? '').trim().toLowerCase() !== 'true') return null

  const markupText = String(env[POS_HARDWARE_ENV.markupBps] ?? '').trim()
  if (markupText && !/^\d+$/.test(markupText)) return null
  const markupBps = markupText ? Number(markupText) : POS_HARDWARE_DEFAULT_MARKUP_BPS
  if (!Number.isSafeInteger(markupBps) || markupBps > MAX_MARKUP_BPS) return null

  const prices = parseJsonObject(env[POS_HARDWARE_ENV.prices])
  if (!prices) return null
  const costs: Partial<Record<PosHardwareSkuId, number>> = {}
  for (const sku of POS_HARDWARE_SKUS) {
    const cost = prices[sku.id]
    if (isCents(cost, 1)) costs[sku.id] = cost
  }
  const anyReader = POS_HARDWARE_SKUS.some((sku) => sku.kind === 'reader' && costs[sku.id] !== undefined)
  if (!anyReader) return null

  const shippingRaw = parseJsonObject(env[POS_HARDWARE_ENV.shipping])
  if (!shippingRaw) return null
  const shipping = SHIPPING_METHODS.flatMap((method) => {
    const cents = shippingRaw[method]
    return isCents(cents, 0) ? [{ method, cents }] : []
  })
  if (!shipping.length) return null

  return {
    costs,
    markupBps,
    shipping,
    automaticTax:
      String(env[POS_HARDWARE_ENV.automaticTax] ?? '').trim().toLowerCase() === 'true',
  }
}

/**
 * What the merchant pays for one item: Stripe's price plus the markup,
 * rounded half up to the cent, in integer math throughout.
 *
 * `cost + round(cost × bps / 10 000)`. The markup is basis points ON COST, so
 * a 50% markup is `5000` and a price at which half of it is profit (a 50%
 * margin) is `10000`. Whichever the business means, it is this one number.
 */
export function posHardwareUnitCents(costCents: number, markupBps: number): number {
  if (!Number.isSafeInteger(costCents) || costCents <= 0) return 0
  if (!Number.isSafeInteger(markupBps) || markupBps < 0) return costCents
  return costCents + Math.floor((costCents * markupBps + 5_000) / 10_000)
}

/** An item as the shop offers it: the merchant's price, never Stripe's. */
export interface PosHardwareOffer {
  sku: PosHardwareSkuId
  kind: PosHardwareSku['kind']
  name: string
  use: string
  unitCents: number
  /** Stripe may stop selling it ({@link PosHardwareSku.mayBeDiscontinued}). */
  mayBeDiscontinued: boolean
}

/** The items on offer, readers first, in catalog order. */
export function posHardwareOffers(config: PosHardwareConfig): PosHardwareOffer[] {
  return POS_HARDWARE_SKUS.flatMap((sku) => {
    const cost = config.costs[sku.id]
    if (cost === undefined) return []
    return [
      {
        sku: sku.id,
        kind: sku.kind,
        name: sku.displayName,
        use: sku.use,
        unitCents: posHardwareUnitCents(cost, config.markupBps),
        mayBeDiscontinued: sku.mayBeDiscontinued === true,
      },
    ]
  })
}

export interface PosHardwareLine {
  sku: PosHardwareSkuId
  name: string
  quantity: number
  unitCents: number
  lineCents: number
}

export type PosHardwareCartResult =
  | { ok: true; lines: PosHardwareLine[]; subtotalCents: number }
  | { ok: false; error: string }

/**
 * A merchant's basket priced on the SERVER: every item must be on offer, each
 * quantity a whole number from 1 to {@link POS_HARDWARE_MAX_PER_LINE}, and
 * the order at most {@link POS_HARDWARE_MAX_UNITS} units. A repeated item is
 * folded into one line. Prices come from the config, never the request.
 */
export function pricePosHardwareCart(
  config: PosHardwareConfig,
  requested: unknown,
): PosHardwareCartResult {
  if (!Array.isArray(requested) || requested.length === 0) {
    return { ok: false, error: 'Choose at least one item.' }
  }
  const offers = new Map(posHardwareOffers(config).map((offer) => [offer.sku as string, offer]))
  const quantities = new Map<string, number>()
  for (const entry of requested) {
    const sku = String((entry as { sku?: unknown })?.sku ?? '')
    const quantity = Number((entry as { quantity?: unknown })?.quantity)
    if (!offers.has(sku)) return { ok: false, error: 'That item is not available.' }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, error: 'Each quantity must be a whole number of at least 1.' }
    }
    quantities.set(sku, (quantities.get(sku) ?? 0) + quantity)
  }
  let units = 0
  const lines: PosHardwareLine[] = []
  for (const [sku, quantity] of quantities) {
    if (quantity > POS_HARDWARE_MAX_PER_LINE) {
      return { ok: false, error: `Order at most ${POS_HARDWARE_MAX_PER_LINE} of each item.` }
    }
    units += quantity
    const offer = offers.get(sku) as PosHardwareOffer
    lines.push({
      sku: offer.sku,
      name: offer.name,
      quantity,
      unitCents: offer.unitCents,
      lineCents: offer.unitCents * quantity,
    })
  }
  if (units > POS_HARDWARE_MAX_UNITS) {
    return { ok: false, error: `One order holds at most ${POS_HARDWARE_MAX_UNITS} items.` }
  }
  // Accessories alone are allowed: a merchant may want a second dock.
  return { ok: true, lines, subtotalCents: lines.reduce((sum, line) => sum + line.lineCents, 0) }
}

/*==========================================
 * THE CHECKOUT SESSION'S METADATA.
 *
 * The webhook builds the order from the session Stripe hands back, so the
 * lines ride in its metadata in a compact form (`sku*qty*unit;…`, inside
 * Stripe's 500-character value limit even with every item in the catalog in
 * one basket at the highest price the config accepts, which a spec holds),
 * and the webhook re-reads every one against the catalog rather than trusting
 * a name from the wire.
 *=========================================*/

export const POS_HARDWARE_METADATA_TYPE = 'pos-hardware-order'

export function encodePosHardwareLines(lines: readonly PosHardwareLine[]): string {
  return lines.map((line) => `${line.sku}*${line.quantity}*${line.unitCents}`).join(';')
}

export function decodePosHardwareLines(encoded: unknown): PosHardwareLine[] | null {
  const text = String(encoded ?? '').trim()
  if (!text) return null
  const lines: PosHardwareLine[] = []
  for (const part of text.split(';')) {
    const [skuId, quantityText, unitText] = part.split('*')
    const sku = posHardwareSku(String(skuId ?? ''))
    const quantity = Number(quantityText)
    const unitCents = Number(unitText)
    if (!sku) return null
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > POS_HARDWARE_MAX_PER_LINE) return null
    if (!Number.isSafeInteger(unitCents) || unitCents < 1) return null
    lines.push({ sku: sku.id, name: sku.displayName, quantity, unitCents, lineCents: quantity * unitCents })
  }
  return lines
}

/*==========================================
 * THE ORDER AND ITS STATUSES.
 *=========================================*/

export type PosHardwareOrderStatus =
  | 'paid'
  | 'ordered'
  | 'shipped'
  | 'delivered'
  | 'registered'
  | 'canceled'
  | 'refunded'

export const POS_HARDWARE_ORDER_STATUSES: readonly PosHardwareOrderStatus[] = [
  'paid',
  'ordered',
  'shipped',
  'delivered',
  'registered',
  'canceled',
  'refunded',
]

export function isPosHardwareOrderStatus(value: unknown): value is PosHardwareOrderStatus {
  return typeof value === 'string' && (POS_HARDWARE_ORDER_STATUSES as readonly string[]).includes(value)
}

/** What the merchant reads on the Hardware card. */
export const POS_HARDWARE_STATUS_LABELS: Record<PosHardwareOrderStatus, string> = {
  paid: 'Order received',
  ordered: 'Being prepared',
  shipped: 'Shipped',
  delivered: 'Delivered',
  registered: 'Set up',
  canceled: 'Canceled',
  refunded: 'Refunded',
}

/** What staff read on the orders page: where the order is in fulfillment. */
export const POS_HARDWARE_STAFF_STATUS_LABELS: Record<PosHardwareOrderStatus, string> = {
  paid: 'Paid',
  ordered: 'Ordered from Stripe',
  shipped: 'Shipped',
  delivered: 'Delivered',
  registered: 'Registered',
  canceled: 'Canceled',
  refunded: 'Refunded',
}

/**
 * The forward steps staff may move an order through. Canceling and refunding
 * are separate acts with their own rule ({@link posHardwareRefundable}),
 * because each returns money.
 */
const NEXT_STATUS: Partial<Record<PosHardwareOrderStatus, PosHardwareOrderStatus>> = {
  paid: 'ordered',
  ordered: 'shipped',
  shipped: 'delivered',
  delivered: 'registered',
}

export function nextPosHardwareStatus(
  status: PosHardwareOrderStatus,
): PosHardwareOrderStatus | null {
  return NEXT_STATUS[status] ?? null
}

/**
 * Whether the order may still be canceled or refunded in full: only before it
 * ships. Once a parcel is on its way the money comes back through a return of
 * the hardware, which is a separate process this phase does not automate.
 */
export function posHardwareRefundable(status: PosHardwareOrderStatus): boolean {
  return status === 'paid' || status === 'ordered'
}

export interface PosHardwareAddress {
  line1: string
  line2?: string
  city: string
  state?: string
  postalCode: string
  country: string
}

/**
 * What sales tax is sourced by: where the order shipped, without the street
 * or the person. An erasure keeps this much of the address (see
 * {@link posHardwareBuyerErasedPatch}) and the retained sale record holds
 * nothing finer ({@link PosHardwareSaleRecord}).
 */
export interface PosHardwareTaxRegion {
  country: string
  state: string | null
  postalCode: string | null
}

export interface PosHardwareTracking {
  carrier: string
  number: string
  url: string | null
}

/**
 * Why an order was canceled and refunded: by staff on the Hardware orders
 * page, or because the workspace that bought it was deleted or the account
 * that placed it was closed before it shipped (AGL-4038 closure).
 */
export type PosHardwareCancelReason = 'staff' | 'workspace-closed' | 'account-closed'

/**
 * One entry of the tax Stripe computed on a hardware checkout, as the
 * storefront's tax rows store it (`StorefrontTaxLine`): the amount, the base
 * it was applied to (`taxable_amount`, null when Stripe did not state one)
 * and the rate, for the working papers of the platform's own return.
 */
export interface PosHardwareTaxLine {
  amountCents: number
  taxabilityReason: string | null
  taxRateId: string | null
  taxableAmountCents: number | null
  jurisdiction: string | null
  rateState: string | null
  percentage: number | null
}

/** `orgs/{orgId}/hardwareOrders/{orderId}`, written only by the server. */
export interface PosHardwareOrder {
  orgId: string
  /** The site whose POS settings the order was placed from. */
  hostId: string
  /** The member who started the checkout; `null` once their account is erased. */
  createdBy: string | null
  /** Where the order emails go: the address entered at checkout. */
  contactEmail: string | null
  lines: PosHardwareLine[]
  subtotalCents: number
  shipping: {
    method: PosHardwareShippingMethod
    label: string
    cents: number
    name: string | null
    phone: string | null
    address: PosHardwareAddress | null
    /**
     * Set when the buyer's account is erased, in place of `address`: the part
     * of it sales tax is sourced by.
     */
    taxRegion?: PosHardwareTaxRegion | null
  }
  taxCents: number
  totalCents: number
  currency: string
  /** Whether Stripe Tax computed the tax on the checkout. Absent on orders before it was recorded. */
  automaticTax?: boolean
  /** Stripe's tax breakdown for the checkout, when Stripe Tax computed it. */
  taxLines?: PosHardwareTaxLine[]
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
  /** Stripe's hardware order id, recorded by staff (phase 2 sets it itself). */
  stripeHardwareOrderId: string | null
  tracking: PosHardwareTracking | null
  status: PosHardwareOrderStatus
  livemode: boolean
  createdAtMs: number
  updatedAtMs: number
  paidAtMs: number
  orderedAtMs?: number
  shippedAtMs?: number
  deliveredAtMs?: number
  registeredAtMs?: number
  canceledAtMs?: number
  refundedAtMs?: number
  refundId?: string | null
  /** The cents Stripe reported refunding. */
  refundedCents?: number
  /** Why it was canceled, when it was. */
  cancelReason?: PosHardwareCancelReason
  /** When the buyer's account was erased and their details taken off the order. */
  buyerErasedAtMs?: number
}

/** The timestamp field each status stamps when it is reached. */
export const POS_HARDWARE_STATUS_STAMP: Record<PosHardwareOrderStatus, keyof PosHardwareOrder> = {
  paid: 'paidAtMs',
  ordered: 'orderedAtMs',
  shipped: 'shippedAtMs',
  delivered: 'deliveredAtMs',
  registered: 'registeredAtMs',
  canceled: 'canceledAtMs',
  refunded: 'refundedAtMs',
}

/** The Hardware card's anchor: Checkout returns to it and the emails link at it. */
export const POS_HARDWARE_ANCHOR = 'pos-hardware'

/** The collection under `orgs/{orgId}`, named once. */
export const POS_HARDWARE_ORDERS_COLLECTION = 'hardwareOrders'

/*==========================================
 * THE SALE RECORD THE PLATFORM KEEPS (AGL-4038).
 *
 * A hardware order is the PLATFORM's own sale: the platform is the seller of
 * record and owes the sales tax on it. So beside every order the server keeps
 * `posHardwareSales/{orderId}`, a TOP-LEVEL record of what tax and accounting
 * need — the lines, the amounts, the tax, Stripe's ids, the status dates and
 * the region it shipped to — and nothing about the person who bought it.
 *
 * It is the `platformRevenue` / `storefrontTaxCollected` shape on purpose
 * (AGL-1811, AGL-1904): keyed to the workspace by FIELD, outside
 * `orgs/{orgId}`, so the workspace erasure's `recursiveDelete(orgs/{orgId})`
 * cannot see it, and never in any org-keyed sweep. GDPR Art. 17(3)(b) exempts
 * records kept to comply with a legal obligation. The order under the
 * workspace, with the buyer's name, street, phone, email and tracking, is
 * erased with the workspace as before.
 *
 * Written in the same transaction as every write to the order, from the
 * order as it stands after that write, so the two never disagree and a
 * missing record heals on the next write.
 *
 * KEPT SEVEN YEARS FROM THE SALE, THEN DELETED. Every write stamps
 * `expiresAt` ({@link posHardwareSaleExpiry}) and the Firestore TTL policy on
 * `posHardwareSales.expiresAt` deletes the record once it passes.
 *=========================================*/

/** The top-level collection of retained hardware sale records. */
export const POS_HARDWARE_SALES_COLLECTION = 'posHardwareSales'

/** `posHardwareSales/{orderId}`: an order with every personal detail left out. */
export interface PosHardwareSaleRecord {
  orderId: string
  /** The workspace that bought it, by id; the record outlives the workspace. */
  orgId: string
  lines: Array<Pick<PosHardwareLine, 'sku' | 'name' | 'quantity' | 'unitCents' | 'lineCents'>>
  subtotalCents: number
  shippingMethod: PosHardwareShippingMethod
  shippingCents: number
  taxCents: number
  totalCents: number
  currency: string
  /** The sales tax sourcing input: country, state and postal code, never the street. */
  shipTo: PosHardwareTaxRegion | null
  /** Whether Stripe Tax computed the tax; null on orders before it was recorded. */
  automaticTax: boolean | null
  /** Stripe's tax breakdown: the base each rate was applied to, for the return. */
  taxLines: PosHardwareTaxLine[]
  stripeCheckoutSessionId: string | null
  stripePaymentIntentId: string | null
  stripeHardwareOrderId: string | null
  refundId: string | null
  refundedCents: number | null
  status: PosHardwareOrderStatus
  livemode: boolean
  createdAtMs: number
  updatedAtMs: number
  paidAtMs: number | null
  orderedAtMs: number | null
  shippedAtMs: number | null
  deliveredAtMs: number | null
  registeredAtMs: number | null
  canceledAtMs: number | null
  refundedAtMs: number | null
  /**
   * When the record is deleted: {@link POS_HARDWARE_SALE_RETENTION_YEARS}
   * after the sale, by the Firestore TTL policy on `posHardwareSales.expiresAt`.
   * Null when the record states no sale date, which keeps it rather than
   * guessing a date to delete it by.
   */
  expiresAt: Date | null
}

/**
 * How long the platform keeps a hardware sale record (AGL-4038): seven years
 * from the sale, then the record is deleted. Longer than the four years Texas
 * requires for sales tax records, a margin for an audit of an older period.
 */
export const POS_HARDWARE_SALE_RETENTION_YEARS = 7

/**
 * When a sale record expires: the same calendar instant, seven years after
 * the sale was paid (the order's creation where no payment time is stated).
 * A sale on 29 February expires on 1 March, a day late rather than early.
 * Null when there is no sale time, so the record is kept, never reaped at
 * the epoch.
 */
export function posHardwareSaleExpiry(
  order: Pick<PosHardwareOrder, 'paidAtMs' | 'createdAtMs'>,
): Date | null {
  const saleAtMs = [order.paidAtMs, order.createdAtMs].find(
    (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
  )
  if (saleAtMs === undefined) return null
  const expires = new Date(saleAtMs)
  expires.setUTCFullYear(expires.getUTCFullYear() + POS_HARDWARE_SALE_RETENTION_YEARS)
  return expires
}

/** A tax line as the record keeps it: every field picked, every figure an integer. */
function saleTaxLine(line: Partial<PosHardwareTaxLine> | null | undefined): PosHardwareTaxLine {
  const integerOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  const numberOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  const textOf = (value: unknown): string | null =>
    typeof value === 'string' && value ? value : null
  return {
    amountCents: integerOrNull(line?.amountCents) ?? 0,
    taxabilityReason: textOf(line?.taxabilityReason),
    taxRateId: textOf(line?.taxRateId),
    taxableAmountCents: integerOrNull(line?.taxableAmountCents),
    jurisdiction: textOf(line?.jurisdiction),
    rateState: textOf(line?.rateState),
    percentage: numberOrNull(line?.percentage),
  }
}

const stampOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

/** The tax region of an order: its address cut down, or what an erasure left. */
export function posHardwareTaxRegion(order: Pick<PosHardwareOrder, 'shipping'>): PosHardwareTaxRegion | null {
  const address = order.shipping?.address
  if (address?.country) {
    return {
      country: address.country,
      state: textOrNull(address.state),
      postalCode: textOrNull(address.postalCode),
    }
  }
  const kept = order.shipping?.taxRegion
  return kept?.country
    ? { country: kept.country, state: textOrNull(kept.state), postalCode: textOrNull(kept.postalCode) }
    : null
}

/**
 * The retained sale record of an order, as it stands. Every field is picked
 * by name, so a field added to the order later reaches the record only when
 * someone decides it should.
 */
export function posHardwareSaleRecord(orderId: string, order: PosHardwareOrder): PosHardwareSaleRecord {
  return {
    orderId,
    orgId: order.orgId,
    lines: (order.lines ?? []).map((line) => ({
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitCents: line.unitCents,
      lineCents: line.lineCents,
    })),
    subtotalCents: order.subtotalCents ?? 0,
    shippingMethod: order.shipping?.method ?? 'standard',
    shippingCents: order.shipping?.cents ?? 0,
    taxCents: order.taxCents ?? 0,
    totalCents: order.totalCents ?? 0,
    currency: order.currency ?? POS_HARDWARE_CURRENCY,
    shipTo: posHardwareTaxRegion(order),
    automaticTax: typeof order.automaticTax === 'boolean' ? order.automaticTax : null,
    taxLines: (Array.isArray(order.taxLines) ? order.taxLines : []).map(saleTaxLine),
    stripeCheckoutSessionId: textOrNull(order.stripeCheckoutSessionId),
    stripePaymentIntentId: textOrNull(order.stripePaymentIntentId),
    stripeHardwareOrderId: textOrNull(order.stripeHardwareOrderId),
    refundId: textOrNull(order.refundId),
    refundedCents: stampOrNull(order.refundedCents),
    status: order.status,
    livemode: order.livemode === true,
    createdAtMs: order.createdAtMs ?? 0,
    updatedAtMs: order.updatedAtMs ?? order.createdAtMs ?? 0,
    paidAtMs: stampOrNull(order.paidAtMs),
    orderedAtMs: stampOrNull(order.orderedAtMs),
    shippedAtMs: stampOrNull(order.shippedAtMs),
    deliveredAtMs: stampOrNull(order.deliveredAtMs),
    registeredAtMs: stampOrNull(order.registeredAtMs),
    canceledAtMs: stampOrNull(order.canceledAtMs),
    refundedAtMs: stampOrNull(order.refundedAtMs),
    // The TTL policy's field: the record outlives the workspace, not the law.
    expiresAt: posHardwareSaleExpiry(order),
  }
}

/**
 * What an account erasure does to an order the person placed (AGL-4038): the
 * workspace keeps the order and every amount on it; the buyer comes off it —
 * who started it, the email, the name, the phone, the street and the
 * tracking, which names the parcel to a carrier who would say where it went.
 * The country, state and postal code stay, because sales tax is sourced by
 * them. Deterministic but for the stamp, and an order already erased no
 * longer answers to the person's uid, so a second run finds nothing.
 */
export function posHardwareBuyerErasedPatch(
  order: Pick<PosHardwareOrder, 'shipping'>,
  now: number,
): Record<string, unknown> {
  // The whole map, read in the same transaction: a dotted-path update would
  // leave a field added to `shipping` later standing with the person in it.
  const shipping = order.shipping
  return {
    createdBy: null,
    contactEmail: null,
    shipping: {
      method: shipping?.method ?? 'standard',
      label: shipping?.label ?? POS_HARDWARE_SHIPPING_LABELS[shipping?.method ?? 'standard'],
      cents: shipping?.cents ?? 0,
      name: null,
      phone: null,
      address: null,
      taxRegion: posHardwareTaxRegion(order),
    },
    tracking: null,
    buyerErasedAtMs: now,
    updatedAtMs: now,
  }
}

/** An order id: `hw_` and twenty hex characters. */
export const POS_HARDWARE_ORDER_ID = /^hw_[a-f0-9]{20}$/

/** Dollars and cents for the card and the emails. */
export function formatPosHardwareCents(cents: number): string {
  const value = Number.isFinite(cents) ? cents : 0
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100)
}
