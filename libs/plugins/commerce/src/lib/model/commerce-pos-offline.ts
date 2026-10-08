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

import { computeOrderTotals, type OrderLineItem, type OrderTotals } from './commerce-orders'
import { computeTaxCents } from './commerce-tax'
import type { ModifierSelection } from './product-modifiers'

/*==========================================
 * THE OFFLINE REGISTER (AGL-3625): the contract every register client — the
 * web register and the native Aglyn POS app — shares with
 * `POST /api/commerce/pos-offline-sync`.
 *
 * WHAT SELLS OFFLINE IS CASH, AND ONLY CASH.
 *
 *  - Card tenders cannot: the reader, Tap to Pay, the typed card and the QR
 *    link are all server-driven Stripe payments, and Stripe does not take a
 *    server-driven card payment without the server.
 *  - Gift cards DO NOT, deliberately. A balance cannot be checked without the
 *    server, and a capped "allow it anyway" (Square's offer for cards) turns a
 *    short balance into a sale whose money nobody collected — discovered at
 *    sync, after the customer left. Square itself does not redeem gift cards
 *    offline. A gift card is never over-redeemed silently because it is never
 *    redeemed offline at all.
 *  - Room charges do not: the stay is validated on the server.
 *  - Codes and store promotions do not: a redemption cap is counted on the
 *    server. The cashier's own discount, bounded by the site's ceiling, does.
 *
 * WHAT THE SALE IS: the register prices the basket from its cached catalog and
 * the store's own tax rate, takes the cash and queues the sale with a key it
 * minted. That key is the order's id on the server, so the receipt printed
 * offline carries the barcode the real order answers to, and a sale sent twice
 * — a flapping connection, a retry after a lost answer — lands once.
 *
 * WHAT THE SERVER DOES WITH IT: records it as it happened, never re-prices the
 * money the customer handed over, and FLAGS what does not match — a price
 * that changed, stock that went short, a shift that closed first — on the
 * order and back to the register. A sale is never dropped for a flag.
 *=========================================*/

/** The route both register clients sync through. */
export const POS_OFFLINE_SYNC_ROUTE = '/api/commerce/pos-offline-sync'

/** The most sales one sync request carries; a longer queue sends in batches. */
export const POS_OFFLINE_SYNC_BATCH_MAX = 25

/** Lines one offline sale may carry, the same bound the register's basket has. */
export const POS_OFFLINE_SALE_MAX_LINES = 100

/** A sale synced later than this after it was rung is flagged `late-sync`. */
export const POS_OFFLINE_LATE_SYNC_MS = 24 * 60 * 60 * 1000

/**
 * How far back a sale's own clock is believed. Older, and the server stamps
 * the sale at this bound and flags it, rather than letting a device clock
 * place a sale anywhere in history.
 */
export const POS_OFFLINE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** How far ahead of the server a device clock may run before it is clamped. */
export const POS_OFFLINE_CLOCK_SKEW_MS = 10 * 60 * 1000

/** The one tender an offline sale takes. */
export type PosOfflineTender = 'cash'

/** Every tender the register turns off while offline, and why, in its words. */
export const POS_OFFLINE_DISABLED_TENDERS: Readonly<Record<string, string>> = {
  card_present: 'Card readers need the connection.',
  card_keyed: 'Typed cards need the connection.',
  card_link: 'The QR card link needs the connection.',
  gift_card: 'A gift card balance can only be checked online.',
  folio: 'Room charges are checked against the stay online.',
}

/** One basket line as the register rang it. */
export interface PosOfflineSaleLine {
  productId: string
  variantId?: string
  name: string
  /** Variant options and modifier choices, as the receipt printed them. */
  variantLabel?: string
  sku?: string
  productType?: 'physical' | 'digital' | 'service'
  quantity: number
  /** Per unit, modifiers included, from the cached catalog. */
  unitAmountCents: number
  modifiers?: ModifierSelection[]
}

/** The customer the register attached: only what the sale and its receipt need. */
export interface PosOfflineSaleCustomer {
  email?: string
  name?: string
  kind?: string
  id?: string
}

/** One sale rung while offline, exactly as the register queued it. */
export interface PosOfflineSale {
  v: 1
  /** The register's key for this sale, minted once; the order's id on the server. */
  saleKey: string
  hostId: string
  /** The workspace the register was signed in to. */
  orgId: string
  /** Who was signed in on the device: the only member who may sync it. */
  signedInUid: string
  registerId: string
  /** The shift open on the register when the sale was rung. */
  shiftId?: string | null
  locationId?: string
  /** A PIN-switched cashier's assertion, valid when the sale was rung. */
  cashierAssertion?: string
  /** The device's clock when the cash was taken. */
  soldAtMs: number
  lines: PosOfflineSaleLine[]
  /** The cashier's discount, a percentage of the goods. */
  discountPct: number
  /** The totals the receipt printed and the customer paid. */
  totals: OrderTotals
  cashTenderedCents: number
  changeCents: number
  customer?: PosOfflineSaleCustomer
}

/** What does not match, said on the order and back to the register. */
export type PosOfflineFlag =
  | 'price-changed'
  | 'unknown-product'
  | 'tax-differs'
  | 'totals-restated'
  | 'discount-over-limit'
  | 'cash-short'
  | 'stock-short'
  | 'shift-closed'
  | 'no-shift'
  | 'unknown-register'
  | 'register-over-cap'
  | 'late-sync'
  | 'clock-adjusted'
  | 'cashier-unverified'

/** Each flag in the words the order and the register show. */
export const POS_OFFLINE_FLAG_LABELS: Record<PosOfflineFlag, string> = {
  'price-changed': 'A price changed after the register cached it; the sale kept the price it was rung at',
  'unknown-product': 'A product was deleted before the sale synced; the line kept what the receipt printed',
  'tax-differs': 'The tax rung differs from the store’s rate now; the sale kept the tax it collected',
  'totals-restated': 'The register’s totals did not add up; the server restated them from the lines',
  'discount-over-limit': 'The discount is above this register’s limit',
  'cash-short': 'The cash recorded is less than the total',
  'stock-short': 'Stock went short: more was sold than the shelf held',
  'shift-closed': 'Rung in a shift that closed before the sale synced; its Z report does not include it',
  'no-shift': 'Rung with no shift open, on a site that requires one',
  'unknown-register': 'The register it was rung on no longer exists',
  'register-over-cap': 'The register it was rung on is over the plan’s register limit',
  'late-sync': 'Synced more than a day after it was rung',
  'clock-adjusted': 'The device clock was off; the sale is dated when it synced',
  'cashier-unverified': 'The PIN-switched cashier could not be confirmed; the sale is under the signed-in member',
}

/** A line whose stock went short when the sale synced. */
export interface PosOfflineStockConflict {
  productId: string
  variantId?: string
  name: string
  /** Units sold. */
  requested: number
  /** Units the shelf actually gave up. */
  applied: number
  /** Units sold that the shelf did not hold. */
  shortUnits: number
}

/** What the order records about having been rung offline. */
export interface PosOfflineOrderStamp {
  saleKey: string
  /** The device's clock when the cash was taken. */
  soldAtMs: number
  syncedAtMs: number
  /** Who synced it: always the member who was signed in when it was rung. */
  syncedBy: string
  flags: PosOfflineFlag[]
  stockConflicts?: PosOfflineStockConflict[]
  /** The server's own price per line where it differed, for the merchant to compare. */
  priceDrift?: Array<{ index: number; rungCents: number; currentCents: number }>
}

/** Why a sale was refused, and whether the register should keep trying. */
export type PosOfflineRefusal =
  | 'wrong-staff'
  | 'wrong-site'
  | 'wrong-workspace'
  | 'invalid'
  | 'conflict'
  | 'failed'

/** What became of one sale the register sent. */
export type PosOfflineOutcomeStatus = 'recorded' | 'replayed' | 'refused'

/**
 * One sale's answer, in the order the request sent them. `recorded` and
 * `replayed` carry the order; `refused` carries the reason, the sentence and
 * whether to keep trying. One flat shape, so every register client — the web
 * register and the native apps — decodes it the same way.
 */
export interface PosOfflineSaleOutcome {
  saleKey: string
  status: PosOfflineOutcomeStatus
  orderId?: string
  number?: number | null
  flags?: PosOfflineFlag[]
  stockConflicts?: PosOfflineStockConflict[]
  reason?: PosOfflineRefusal
  error?: string
  /** Keep it queued and try again later (a transient failure). */
  retry?: boolean
}

export interface PosOfflineSyncRequest {
  hostId: string
  sales: PosOfflineSale[]
}

export interface PosOfflineSyncResponse {
  results: PosOfflineSaleOutcome[]
}

/** One register as the offline kit lists it. */
export interface PosOfflineKitRegister {
  id: string
  name: string
  locationId?: string
  openShiftId: string | null
}

/**
 * Everything a register needs to sell offline besides the catalog, from
 * `GET /api/commerce/pos-offline-sync?hostId=`: the server's own answers, so
 * the register and the sync agree about the rate and the rules.
 */
export interface PosOfflineKit {
  v: 1
  hostId: string
  orgId: string
  issuedAtMs: number
  /** Offline selling is possible for this site right now. */
  available: boolean
  /** Why not, in the cashier's words, when it is not. */
  unavailableReason?: string
  /** The store's own in-person rate; `null` pct is no tax. */
  tax: { pct: number | null; pricesIncludeTax: boolean }
  maxDiscountPct: number
  requireOpenShift: boolean
  registers: PosOfflineKitRegister[]
  /** What the receipt prints at its head and foot. `logo` is the stored value. */
  receipt: {
    name: string
    logo?: string
    address?: string
    footer?: string
    returnPolicy?: string
  }
}

/**
 * The totals of an offline sale: the cashier's discount on the goods, then
 * the store's in-person tax on what is left — exactly the arithmetic the
 * online register's sale route uses for the same basket with no promotion.
 * `pricesIncludeTax` adds nothing, as at the online till.
 */
export function posOfflineSaleTotals(input: {
  lines: ReadonlyArray<Pick<PosOfflineSaleLine, 'unitAmountCents' | 'quantity'>>
  discountPct: number
  tax: { pct: number | null; pricesIncludeTax: boolean }
}): OrderTotals {
  const lines = input.lines.map((line) => ({
    unitAmountCents: wholeCents(line.unitAmountCents),
    quantity: Math.max(1, Math.round(Number(line.quantity) || 1)),
  }))
  const itemsCents = lines.reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0)
  const pct = Number.isFinite(input.discountPct) ? Math.min(100, Math.max(0, input.discountPct)) : 0
  const discountCents = Math.min(itemsCents, Math.round((itemsCents * pct) / 100))
  const taxPct = Number(input.tax.pct)
  const taxCents =
    taxPct > 0 && !input.tax.pricesIncludeTax ? computeTaxCents(itemsCents - discountCents, taxPct) : 0
  return computeOrderTotals(lines as unknown as OrderLineItem[], { discountCents, taxCents, feeCents: 0 })
}

/** Change for cash handed over, never negative. */
export function posOfflineChangeCents(totalCents: number, tenderedCents: number): number {
  return Math.max(0, wholeCents(tenderedCents) - wholeCents(totalCents))
}

/** A key the register minted: an id the order can take, and nothing else. */
export function posOfflineSaleKeyIsValid(key: unknown): key is string {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(key) && !/^__.*__$/.test(key)
}

/**
 * The sale's time as the server records it: the device's clock when it is
 * believable, clamped to now when it runs ahead, and to the oldest believable
 * moment when it claims to be older.
 */
export function posOfflineSoldAt(
  soldAtMs: number,
  nowMs: number,
): { atMs: number; adjusted: boolean } {
  const at = Number(soldAtMs)
  if (!Number.isFinite(at) || at <= 0) return { atMs: nowMs, adjusted: true }
  if (at > nowMs + POS_OFFLINE_CLOCK_SKEW_MS) return { atMs: nowMs, adjusted: true }
  if (at < nowMs - POS_OFFLINE_MAX_AGE_MS) return { atMs: nowMs, adjusted: true }
  return { atMs: Math.min(at, nowMs), adjusted: false }
}

const bounded = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const cleanId = (value: unknown): string => {
  const id = String(value ?? '').trim()
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) && !/^__.*__$/.test(id) ? id : ''
}

function wholeCents(value: unknown): number {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * A queued sale read off the wire, every field typed and bounded — or the
 * sentence that says why it cannot be read at all. Pure, so the server and
 * any client that wants to check its own queue answer the same.
 */
export function sanitizePosOfflineSale(
  raw: unknown,
): { ok: true; sale: PosOfflineSale } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Not a sale' }
  const input = raw as Record<string, any>
  const saleKey = input['saleKey']
  if (!posOfflineSaleKeyIsValid(saleKey)) return { ok: false, error: 'The sale has no valid key' }
  const hostId = cleanId(input['hostId'])
  const registerId = cleanId(input['registerId'])
  const signedInUid = bounded(input['signedInUid'], 128)
  if (!hostId || !registerId || !signedInUid) {
    return { ok: false, error: 'The sale is missing its site, register or member' }
  }
  const rawLines = Array.isArray(input['lines']) ? input['lines'] : []
  if (rawLines.length === 0 || rawLines.length > POS_OFFLINE_SALE_MAX_LINES) {
    return { ok: false, error: 'The sale has no lines' }
  }
  const lines: PosOfflineSaleLine[] = []
  for (const line of rawLines) {
    const productId = cleanId(line?.productId)
    const name = bounded(line?.name, 200)
    const unit = Math.round(Number(line?.unitAmountCents))
    const quantity = Math.round(Number(line?.quantity))
    if (!productId || !name || !Number.isFinite(unit) || unit < 0 || !(quantity >= 1 && quantity <= 99)) {
      return { ok: false, error: 'A line of the sale cannot be read' }
    }
    const variantId = cleanId(line?.variantId)
    const variantLabel = bounded(line?.variantLabel, 200)
    const sku = bounded(line?.sku, 100)
    const productType = ['physical', 'digital', 'service'].includes(line?.productType)
      ? (line.productType as PosOfflineSaleLine['productType'])
      : undefined
    const modifiers = Array.isArray(line?.modifiers)
      ? (line.modifiers as unknown[])
          .slice(0, 50)
          .map((pick: any) => ({ groupId: cleanId(pick?.groupId), optionId: cleanId(pick?.optionId) }))
          .filter((pick) => pick.groupId && pick.optionId)
      : []
    lines.push({
      productId,
      ...(variantId ? { variantId } : {}),
      name,
      ...(variantLabel ? { variantLabel } : {}),
      ...(sku ? { sku } : {}),
      ...(productType ? { productType } : {}),
      quantity,
      unitAmountCents: unit,
      ...(modifiers.length ? { modifiers } : {}),
    })
  }
  const discountPct = Number(input['discountPct'] ?? 0)
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    return { ok: false, error: 'The sale’s discount cannot be read' }
  }
  const totals = (input['totals'] ?? {}) as Record<string, unknown>
  const customerRaw = input['customer']
  const customer: PosOfflineSaleCustomer = {}
  if (customerRaw && typeof customerRaw === 'object') {
    const email = bounded((customerRaw as any).email, 254).toLowerCase()
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) customer.email = email
    const name = bounded((customerRaw as any).name, 200)
    if (name) customer.name = name
    const kind = bounded((customerRaw as any).kind, 40)
    const id = cleanId((customerRaw as any).id)
    if (kind && kind !== 'none' && id) {
      customer.kind = kind
      customer.id = id
    }
  }
  const shiftId = cleanId(input['shiftId'])
  const locationId = cleanId(input['locationId'])
  const assertion = bounded(input['cashierAssertion'], 2000)
  const orgId = bounded(input['orgId'], 128)
  return {
    ok: true,
    sale: {
      v: 1,
      saleKey,
      hostId,
      orgId,
      signedInUid,
      registerId,
      shiftId: shiftId || null,
      ...(locationId ? { locationId } : {}),
      ...(assertion ? { cashierAssertion: assertion } : {}),
      soldAtMs: Number(input['soldAtMs']) || 0,
      lines,
      discountPct,
      totals: {
        itemsCents: wholeCents(totals['itemsCents']),
        shippingCents: 0,
        taxCents: wholeCents(totals['taxCents']),
        discountCents: wholeCents(totals['discountCents']),
        totalCents: wholeCents(totals['totalCents']),
        feeCents: 0,
      },
      cashTenderedCents: wholeCents(input['cashTenderedCents']),
      changeCents: wholeCents(input['changeCents']),
      ...(Object.keys(customer).length ? { customer } : {}),
    },
  }
}

/**
 * Whether the register's totals are the arithmetic of its own lines: the
 * goods are the lines' sum, the discount is the percentage of them, and the
 * total is goods less discount plus the tax it rang. The tax itself is the
 * register's, and checked against the store's rate separately.
 */
export function posOfflineTotalsAddUp(sale: Pick<PosOfflineSale, 'lines' | 'discountPct' | 'totals'>): boolean {
  const expected = posOfflineSaleTotals({
    lines: sale.lines,
    discountPct: sale.discountPct,
    tax: { pct: null, pricesIncludeTax: false },
  })
  return (
    expected.itemsCents === sale.totals.itemsCents &&
    expected.discountCents === sale.totals.discountCents &&
    sale.totals.taxCents <= sale.totals.itemsCents &&
    sale.totals.totalCents === expected.itemsCents - expected.discountCents + sale.totals.taxCents
  )
}

/** The flags in the order and words the register lists them. */
export function posOfflineFlagLabels(flags: readonly PosOfflineFlag[]): string[] {
  return flags.map((flag) => POS_OFFLINE_FLAG_LABELS[flag] ?? flag)
}
