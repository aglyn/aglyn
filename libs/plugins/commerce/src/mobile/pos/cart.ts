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

import { type ModifierSelection, modifierSelectionKey } from '../../lib/model/product-modifiers'

/*==========================================
 * THE REGISTER'S BASKET (AGL-3618).
 *
 * What the cashier has rung up, before it is a sale. Pure and immutable, so
 * the screens, the persisted copy that survives an app restart and the specs
 * all read the same arithmetic.
 *
 * The basket's figures are a PREVIEW. The sale is priced by the server when
 * it opens (`commerce/pos-order`, `payment: 'open'`): it re-reads every
 * product, prices each modifier from the product (AGL-3607), applies the
 * discount ceiling and the store's tax, and the total it answers is the one
 * the customer pays. The basket sends only what was picked (product,
 * variant, modifier ids, quantity), never a price.
 *=========================================*/

/** The most of one line the server rings up (`pos-order.ts` clamps to 1..99). */
export const POS_LINE_MAX_QUANTITY = 99
/** The most lines one sale carries, so a stuck key cannot build a basket the route refuses. */
export const POS_CART_MAX_LINES = 100

export interface PosCartLine {
  /** Product, variant and modifier choices: the same item with the same choices is one line. */
  key: string
  productId: string
  /** Null for a product's only (default) variant. */
  variantId: string | null
  name: string
  /** "Large / Oat milk, Extra shot": the variant, then the modifiers; null for neither. */
  variantLabel: string | null
  /** The modifier options picked, by id; the server prices them. */
  modifiers: ModifierSelection[]
  /** One unit as the grid priced it, modifiers included: the preview only. */
  unitCents: number
  quantity: number
}

export interface PosCart {
  lines: PosCartLine[]
  /** A whole-sale discount, as the register's discount field takes it. */
  discountPct: number
  /** Who the receipt goes to, when the cashier asked. */
  customerEmail: string
}

export const EMPTY_CART: PosCart = { lines: [], discountPct: 0, customerEmail: '' }

export function cartLineKey(
  productId: string,
  variantId: string | null,
  modifiers: readonly ModifierSelection[] = [],
): string {
  return `${productId}:${variantId ?? ''}:${modifierSelectionKey(modifiers)}`
}

export interface PosCartPick {
  productId: string
  variantId: string | null
  name: string
  variantLabel: string | null
  modifiers?: ModifierSelection[]
  unitCents: number
}

const clampQuantity = (quantity: number) =>
  Math.max(0, Math.min(POS_LINE_MAX_QUANTITY, Math.round(Number(quantity) || 0)))

/** Adds `quantity` of a pick: the same variant again grows its line. */
export function cartAdd(cart: PosCart, pick: PosCartPick, quantity = 1): PosCart {
  const modifiers = (pick.modifiers ?? []).map((entry) => ({ groupId: entry.groupId, optionId: entry.optionId }))
  const key = cartLineKey(pick.productId, pick.variantId, modifiers)
  const existing = cart.lines.find((line) => line.key === key)
  if (existing) return cartSetQuantity(cart, key, existing.quantity + quantity)
  if (cart.lines.length >= POS_CART_MAX_LINES) return cart
  const added = clampQuantity(quantity)
  if (!added) return cart
  return {
    ...cart,
    lines: [
      ...cart.lines,
      {
        key,
        productId: pick.productId,
        variantId: pick.variantId,
        name: pick.name,
        variantLabel: pick.variantLabel,
        modifiers,
        unitCents: Math.max(0, Math.round(pick.unitCents)),
        quantity: added,
      },
    ],
  }
}

/** Sets a line's quantity; zero removes it. */
export function cartSetQuantity(cart: PosCart, key: string, quantity: number): PosCart {
  const next = clampQuantity(quantity)
  return {
    ...cart,
    lines: next
      ? cart.lines.map((line) => (line.key === key ? { ...line, quantity: next } : line))
      : cart.lines.filter((line) => line.key !== key),
  }
}

export function cartRemove(cart: PosCart, key: string): PosCart {
  return cartSetQuantity(cart, key, 0)
}

export function cartSetDiscount(cart: PosCart, pct: number): PosCart {
  const value = Number(pct)
  return { ...cart, discountPct: Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0 }
}

export function cartSetCustomerEmail(cart: PosCart, email: string): PosCart {
  return { ...cart, customerEmail: email.trim().slice(0, 200) }
}

export function cartCount(cart: PosCart): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0)
}

export function cartSubtotalCents(cart: PosCart): number {
  return cart.lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0)
}

/** The discount as the server takes it off each line, summed: a preview. */
export function cartDiscountCents(cart: PosCart): number {
  if (!(cart.discountPct > 0)) return 0
  return cart.lines.reduce(
    (sum, line) => sum + Math.round((line.unitCents * line.quantity * cart.discountPct) / 100),
    0,
  )
}

/** What `commerce/pos-order` takes for `lines`: picks and counts, never prices. */
export function cartSaleLines(cart: PosCart): Array<{
  productId: string
  variantId?: string
  modifiers?: ModifierSelection[]
  quantity: number
}> {
  return cart.lines.map((line) => ({
    productId: line.productId,
    ...(line.variantId ? { variantId: line.variantId } : {}),
    ...(line.modifiers.length ? { modifiers: line.modifiers } : {}),
    quantity: line.quantity,
  }))
}

/** A persisted basket read back defensively: anything unreadable is an empty one. */
export function readStoredCart(raw: unknown): PosCart {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Partial<PosCart>
  const lines = Array.isArray(record.lines) ? record.lines : []
  let cart: PosCart = EMPTY_CART
  for (const line of lines.slice(0, POS_CART_MAX_LINES)) {
    if (!line || typeof line !== 'object' || typeof line.productId !== 'string' || !line.productId) continue
    cart = cartAdd(
      cart,
      {
        productId: line.productId,
        variantId: typeof line.variantId === 'string' && line.variantId ? line.variantId : null,
        name: typeof line.name === 'string' ? line.name : 'Item',
        variantLabel: typeof line.variantLabel === 'string' ? line.variantLabel : null,
        modifiers: (Array.isArray(line.modifiers) ? line.modifiers : []).filter(
          (entry) => typeof entry?.groupId === 'string' && typeof entry?.optionId === 'string',
        ),
        unitCents: Number(line.unitCents) || 0,
      },
      Number(line.quantity) || 0,
    )
  }
  cart = cartSetDiscount(cart, Number(record.discountPct) || 0)
  return cartSetCustomerEmail(cart, typeof record.customerEmail === 'string' ? record.customerEmail : '')
}
