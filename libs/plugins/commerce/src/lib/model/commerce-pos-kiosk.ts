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

import { posTipFromPercent, posTipProblem, type PosReceiptChannel } from './commerce-pos'
import type { ModifierSelection, ProductModifierGroup } from './product-modifiers'

/*==========================================
 * THE SELF-SERVICE KIOSK (AGL-3623).
 *
 * A register's second kind of paired screen: where the customer display
 * (AGL-3608) mirrors the cashier's basket, a kiosk lets the customer build
 * their own order — a product grid with categories and modifiers, a cart, a
 * tip, payment on the register's card reader or Tap to Pay, or "pay at
 * counter", which sends the order to the register's queue for a cashier.
 *
 * It pairs exactly like a display (the same six-digit code and the same
 * hashed device token, with `mode: 'kiosk'` on both), and it never holds a
 * staff session: every request carries the device token and the server
 * prices everything. These are the shapes the kiosk route and every client
 * of it — the web kiosk and the native POS app — agree on.
 *=========================================*/

/** Which kind of paired screen a device token opens. */
export type PosDeviceMode = 'display' | 'kiosk'

/** A product as the kiosk grid shows it: no cost, no stock count, no supplier. */
export interface PosKioskProduct {
  id: string
  name: string
  description?: string
  imageUrl?: string
  categoryIds: string[]
  /** The product's option axes ("Size": S, M, L), for the variant picker. */
  options: Array<{ name: string; values: string[] }>
  variants: PosKioskVariant[]
  modifierGroups: ProductModifierGroup[]
}

export interface PosKioskVariant {
  id: string
  /** Option selections keyed by option name; empty for the default variant. */
  options: Record<string, string>
  priceCents: number
  /** A tracked variant at or below zero whose product refuses to oversell. */
  soldOut: boolean
}

export interface PosKioskCategory {
  id: string
  name: string
}

export interface PosKioskCatalog {
  products: PosKioskProduct[]
  categories: PosKioskCategory[]
  /** The store's currency, lower case (`usd`). */
  currency: string
}

/** What the kiosk offers, resolved on the server for one paired register. */
export interface PosKioskContext {
  branding: {
    name: string
    logoUrl: string | null
    logoDarkUrl: string | null
    message: string
  }
  currency: string
  tipping: { enabled: boolean; percentages: number[] }
  payments: {
    /** A Stripe Terminal smart reader is assigned to this register. */
    reader: boolean
    /** Card-present payments are switched on for the platform (Tap to Pay needs the native app too). */
    cardPresent: boolean
    /** "Pay at counter" sends the order to the register's queue. */
    payAtCounter: boolean
  }
  receipts: PosReceiptChannel[]
  offerMarketing: boolean
  /** Seconds without a touch before the kiosk asks "Still there?". */
  idleSeconds: number
  /** Stripe test mode: a test card can be tapped from the payment screen. */
  testMode: boolean
}

/** One cart line as the kiosk sends it: ids and a count, never a price. */
export interface PosKioskLine {
  productId: string
  variantId?: string
  quantity: number
  modifiers?: ModifierSelection[]
}

/** A line of a priced kiosk order, as the customer's screen shows it. */
export interface PosKioskSaleLine {
  name: string
  variantLabel?: string
  quantity: number
  amountCents: number
}

export type PosKioskSaleStatus =
  /** Priced and waiting for a card at the kiosk. */
  | 'open'
  /** Sent to the register's queue; a cashier takes payment. */
  | 'queued'
  | 'paid'
  | 'voided'

/** A kiosk order as its own screen reads it back. */
export interface PosKioskSale {
  orderId: string
  /** The order number the customer is called by. */
  number: number
  status: PosKioskSaleStatus
  lines: PosKioskSaleLine[]
  itemsCents: number
  discountCents: number
  taxCents: number
  totalCents: number
  tipCents: number
  paidCents: number
  dueCents: number
  /** The card payment in flight, if any. */
  payment: { id: string; status: string; failureMessage?: string } | null
}

/** Seconds without a touch before the kiosk asks "Still there?", by default. */
export const POS_KIOSK_IDLE_SECONDS_DEFAULT = 90
export const POS_KIOSK_IDLE_SECONDS_MIN = 30
export const POS_KIOSK_IDLE_SECONDS_MAX = 600

/** How long "Still there?" waits before the kiosk clears itself. */
export const POS_KIOSK_IDLE_WARNING_SECONDS = 20

/** The order-number screen returns to the start after this long. */
export const POS_KIOSK_DONE_SECONDS = 15

/** Most lines one kiosk order carries. */
export const POS_KIOSK_MAX_LINES = 40

/** Most of one line a customer may order at a kiosk. */
export const POS_KIOSK_MAX_QUANTITY = 20

/** Most products the kiosk grid lists in one category. */
export const POS_KIOSK_CATALOG_LIMIT = 200

/** Wrong staff PINs a kiosk takes before it locks its unlock screen. */
export const POS_KIOSK_UNLOCK_MAX_ATTEMPTS = 5

/** How long a kiosk's unlock screen stays locked after too many wrong PINs. */
export const POS_KIOSK_UNLOCK_LOCKOUT_MS = 15 * 60 * 1000

/** How long a staff unlock keeps the kiosk's settings open. */
export const POS_KIOSK_UNLOCK_TTL_MS = 5 * 60 * 1000

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The cart as the kiosk may send it, or why not. Ids are shape-checked and
 * quantities bounded here; everything else — whether the product exists, is
 * for sale, what it costs and whether its modifiers are valid — is the sale
 * route's to decide from the product documents.
 */
export function sanitizePosKioskLines(
  raw: unknown,
): { ok: true; lines: PosKioskLine[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Your cart is empty.' }
  if (raw.length > POS_KIOSK_MAX_LINES) {
    return { ok: false, error: `An order can have at most ${POS_KIOSK_MAX_LINES} items.` }
  }
  const lines: PosKioskLine[] = []
  for (const entry of raw as Array<Record<string, unknown>>) {
    const productId = String(entry?.['productId'] ?? '')
    const variantId = entry?.['variantId'] == null ? '' : String(entry['variantId'])
    const quantity = Number(entry?.['quantity'])
    if (!ID_PATTERN.test(productId) || (variantId && !ID_PATTERN.test(variantId))) {
      return { ok: false, error: 'An item in your cart is no longer available.' }
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > POS_KIOSK_MAX_QUANTITY) {
      return { ok: false, error: `Order 1 to ${POS_KIOSK_MAX_QUANTITY} of each item.` }
    }
    const rawModifiers = Array.isArray(entry?.['modifiers']) ? (entry['modifiers'] as unknown[]) : []
    if (rawModifiers.length > 200) return { ok: false, error: 'Too many choices on one item.' }
    const modifiers: ModifierSelection[] = []
    for (const pick of rawModifiers as Array<Record<string, unknown>>) {
      const groupId = String(pick?.['groupId'] ?? '')
      const optionId = String(pick?.['optionId'] ?? '')
      if (!ID_PATTERN.test(groupId) || !ID_PATTERN.test(optionId)) {
        return { ok: false, error: 'A choice on an item is no longer offered.' }
      }
      modifiers.push({ groupId, optionId })
    }
    lines.push({
      productId,
      ...(variantId ? { variantId } : {}),
      quantity,
      ...(modifiers.length ? { modifiers } : {}),
    })
  }
  return { ok: true, lines }
}

/**
 * The tip a kiosk customer chose, recomputed from the server's own figure
 * for what is being paid: a percentage only from the store's presets, a
 * custom amount bounded like every register tip. Null when the choice is
 * not one the store offers.
 */
export function posKioskTipCents(
  choice: unknown,
  input: { baseCents: number; enabled: boolean; percentages: readonly number[]; percent?: unknown; cents?: unknown },
): number | null {
  if (choice === undefined || choice === null || choice === 'none') return 0
  if (!input.enabled) return null
  if (choice === 'percent') {
    const percent = Math.round(Number(input.percent))
    if (!input.percentages.includes(percent)) return null
    return posTipFromPercent(input.baseCents, percent)
  }
  if (choice === 'custom') {
    const cents = Math.round(Number(input.cents))
    return posTipProblem(cents, input.baseCents) ? null : cents
  }
  return null
}

/** The idle timeout a merchant set, bounded. */
export function posKioskIdleSeconds(raw: unknown): number {
  const value = Math.round(Number(raw))
  if (!Number.isFinite(value) || value <= 0) return POS_KIOSK_IDLE_SECONDS_DEFAULT
  return Math.min(POS_KIOSK_IDLE_SECONDS_MAX, Math.max(POS_KIOSK_IDLE_SECONDS_MIN, value))
}

/**
 * The kiosk's estimate of its cart, from the catalog prices it was given —
 * shown while the customer shops and never sent. The order is priced again,
 * with tax, by the server when they check out.
 */
export function posKioskEstimateCents(
  lines: readonly PosKioskLine[],
  products: readonly PosKioskProduct[],
): number {
  let total = 0
  for (const line of lines) {
    const product = products.find((candidate) => candidate.id === line.productId)
    if (!product) continue
    const variant =
      product.variants.find((candidate) => candidate.id === line.variantId) ?? product.variants[0]
    if (!variant) continue
    const extra = (line.modifiers ?? []).reduce((sum, pick) => {
      const group = product.modifierGroups.find((candidate) => candidate.id === pick.groupId)
      const option = group?.options.find((candidate) => candidate.id === pick.optionId)
      return sum + (option?.priceCents ?? 0)
    }, 0)
    total += (variant.priceCents + extra) * line.quantity
  }
  return total
}
